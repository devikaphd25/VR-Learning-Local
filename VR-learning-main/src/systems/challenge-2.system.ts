/**
 * Student-side Lesson 2 Challenge 2 prototype.
 *
 * Uses the dedicated 360-degree Challenge 2 environment, places all
 * gameplay objects once in classroom world space, rotates the current device
 * while idle, and validates controller grab-and-drop releases against the four
 * non-ray-interactive destination boxes.
 */
import {
  createSystem,
  DistanceGrabbable,
  Grabbed,
  Interactable,
  MovementMode,
  RayInteractable,
  type Entity
} from "@iwsdk/core";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { Challenge2Device } from "../components/challenge-2.component";
import {
  createChallenge2DropBoxes,
  type Challenge2DropBox
} from "../components/challenge-2-drop-boxes";
import {
  CHALLENGE_2_ITEMS,
  type Challenge2Category,
  type Challenge2Item
} from "../config/challenge-2-content";
import { socket } from "../network/socket";

// ============================================================
// WORLD LAYOUT AND ANIMATION SETTINGS
// ============================================================

// Place the complete activity this many meters in front of the student.
const ROOT_DISTANCE = 1.55;
// Lower the root from eye height so the boxes sit near floor/table height.
const ROOT_BELOW_CAMERA = 1.18;
// Desktop cameras have a narrower vertical viewport than a headset. Moving
// the activity farther away and centering its full height keeps the question,
// device, and all four boxes inside the browser window at the same time.
const DESKTOP_ROOT_DISTANCE = 2.40;
const DESKTOP_ROOT_BELOW_CAMERA = 0.75;
// Starting position of the current device relative to the Challenge 2 root.
// Keep the device completely below the instruction container with a visible
// gap, while still leaving enough height above the destination boxes.
// X = 0 aligns the device with the exact center of the question container.
// Positive local Z moves it toward the student, making controller reach and
// mouse selection easier without moving the fixed panel or destination boxes.
const DEVICE_LOCAL_POSITION = new THREE.Vector3(0, 0.70, 0.22);
// Width and height of the square card that displays the device PNG.
const DEVICE_CARD_SIZE = 0.42;
// Slow idle rotation in radians per second. Rotation stops while grabbed.
const IDLE_ROTATION_SPEED = 0.42;
// Match the release tolerance to the box-highlight tolerance so releasing
// while a box is highlighted always counts as a drop into that box.
const DROP_SNAP_DISTANCE = 0.16;
const WRONG_FEEDBACK_DELAY_MS = 300;
const CORRECT_FEEDBACK_DELAY_MS = 400;

type DisabledUi = {
  // Remember the original state of another student panel so it can be
  // restored exactly when Challenge 2 closes.
  entity: any;
  visible: boolean;
  pointerEvents: any;
  hadRayInteractable: boolean;
};

export class Challenge2System extends createSystem({
  // Every Challenge2Device is updated for idle rotation.
  devices: { required: [Challenge2Device] },
  // This second query only contains a device while a controller is holding it.
  // Its "disqualify" event fires when Grabbed is removed on release.
  heldDevices: { required: [Challenge2Device, Grabbed] }
}) {
  // ==========================================================
  // CURRENT CHALLENGE STATE
  // ==========================================================

  // World-space parent containing the boxes, device, and instruction panel.
  private root?: THREE.Group;
  // ECS entity for the same root. Grabbable children must explicitly use this
  // parent or IWSDK reparents them to the scene and their local X/Z coordinates
  // no longer line up with the question panel in a rotated headset view.
  private rootEntity?: Entity;
  // The four reusable INPUT, OUTPUT, BOTH, and STORAGE boxes.
  private boxes: Challenge2DropBox[] = [];
  // Only one device question is visible/grabbable at a time.
  private device?: Entity;
  // Correctly classified devices remain visible inside their boxes while the
  // student answers later questions. They are no longer ray-interactive.
  private completedDevices: Entity[] = [];
  // Canvas-backed world-space plane used for instructions and feedback. A
  // Mesh is intentional: unlike a Sprite, it does not follow headset rotation.
  private statusSprite?: THREE.Mesh;
  private statusTexture?: THREE.CanvasTexture;
  private statusTitle = "";
  private statusDetail = "";
  private statusColor = "#ffffff";
  private challengeStartedAt = 0;
  private challengeDurationSeconds = 180;
  private lastCountdownSecond = -1;
  // Index of the current item in CHALLENGE_2_ITEMS.
  private currentIndex = 0;
  // Server session ID used to associate every student's drop with the
  // instructor-started Challenge 2 run.
  private challengeId?: string;
  // Session-only personal review data. This mirrors server-confirmed wrong
  // answers so the student can still see details if an older server omits the
  // per-student mistake array from its final payload.
  private personalMistakes = new Map<string, {
    itemId: string;
    itemName: string;
    firstAnswer: Challenge2Category;
    correctAnswer: Challenge2Category;
  }>();
  // Prevents animation and drop handling while the challenge is closed.
  private active = false;
  // Prevents multiple releases while correct-answer feedback is displayed.
  private advancing = false;
  // Student panels temporarily hidden to avoid ray intersections.
  private disabledUi: DisabledUi[] = [];
  // Reused math objects avoid creating garbage every animation frame.
  private worldPoint = new THREE.Vector3();
  private boxWorldBounds = new THREE.Box3();
  // Desktop browsers do not add IWSDK's Grabbed component for mouse input, so
  // these objects implement an equivalent mouse drag on the render canvas.
  private desktopDragging = false;
  private desktopRaycaster = new THREE.Raycaster();
  private desktopPointer = new THREE.Vector2();
  private desktopDragPlane = new THREE.Plane();
  private desktopDragOffset = new THREE.Vector3();

  /** Connect release events, browser events, and temporary test commands. */
  init(): void {
    this.queries.heldDevices.subscribe("disqualify", device => {
      this.handleRelease(device);
    });

    window.addEventListener("challenge2:start", this.startFromEvent);
    window.addEventListener("challenge2:stop", this.stopFromEvent);
    socket.on("challenge2Started", this.handleServerStart);
    socket.on("challenge2ItemResult", this.handleServerItemResult);
    socket.on("challenge2Ended", this.handleServerEnd);
    this.renderer.domElement.addEventListener(
      "pointerdown",
      this.handleDesktopPointerDown,
      true
    );
    this.renderer.domElement.addEventListener(
      "pointermove",
      this.handleDesktopPointerMove,
      true
    );
    this.renderer.domElement.addEventListener(
      "pointerup",
      this.handleDesktopPointerUp,
      true
    );
    this.renderer.domElement.addEventListener(
      "pointercancel",
      this.handleDesktopPointerUp,
      true
    );
    // Temporary manual entry points for testing before instructor/server
    // synchronization is connected: startChallenge2() and stopChallenge2().
    (window as any).startChallenge2 = this.startChallenge2;
    (window as any).stopChallenge2 = this.stopChallenge2;

    this.cleanupFuncs.push(() => {
      window.removeEventListener("challenge2:start", this.startFromEvent);
      window.removeEventListener("challenge2:stop", this.stopFromEvent);
      socket.off("challenge2Started", this.handleServerStart);
      socket.off("challenge2ItemResult", this.handleServerItemResult);
      socket.off("challenge2Ended", this.handleServerEnd);
      this.renderer.domElement.removeEventListener(
        "pointerdown",
        this.handleDesktopPointerDown,
        true
      );
      this.renderer.domElement.removeEventListener(
        "pointermove",
        this.handleDesktopPointerMove,
        true
      );
      this.renderer.domElement.removeEventListener(
        "pointerup",
        this.handleDesktopPointerUp,
        true
      );
      this.renderer.domElement.removeEventListener(
        "pointercancel",
        this.handleDesktopPointerUp,
        true
      );
      delete (window as any).startChallenge2;
      delete (window as any).stopChallenge2;
      this.disposeScene();
    });
  }

  /**
   * Runs every frame: rotate an idle device and highlight the closest box
   * while the student is actively holding the device.
   */
  update(delta: number): void {
    if (!this.active) return;
    this.updateStudentCountdown();
    if (!this.device?.object3D) return;

    // DistanceGrabbable automatically adds/removes Grabbed during interaction.
    const isGrabbed =
      this.device.hasComponent(Grabbed) || this.desktopDragging;
    if (!isGrabbed && !this.advancing) {
      this.device.object3D.rotation.y += delta * IDLE_ROTATION_SPEED;
    }

    if (!isGrabbed) {
      this.boxes.forEach(box => box.setHighlighted(false));
      return;
    }

    // Compare world positions because the controller can move the device out
    // of the Challenge 2 root's local coordinate system while it is grabbed.
    this.device.object3D.getWorldPosition(this.worldPoint);
    let nearest: Challenge2DropBox | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const box of this.boxes) {
      const bounds = this.getBoxWorldBounds(box).expandByScalar(0.07);
      const distance = bounds.distanceToPoint(this.worldPoint);
      if (distance < nearestDistance) {
        nearest = box;
        nearestDistance = distance;
      }
    }

    this.boxes.forEach(box => {
      box.setHighlighted(box === nearest && nearestDistance <= 0.16);
    });
  }

  private startFromEvent = (): void => this.startChallenge2();
  private stopFromEvent = (): void => this.stopChallenge2();
  private handleServerStart = (payload: {
    id?: string;
    durationSeconds?: number;
    startedAt?: number;
  }): void => {
    this.challengeId = payload?.id;
    this.challengeDurationSeconds = Number(payload?.durationSeconds) || 180;
    this.challengeStartedAt = Number(payload?.startedAt) || Date.now();
    this.lastCountdownSecond = -1;
    this.personalMistakes.clear();
    this.startChallenge2();
  };
  private handleServerItemResult = (payload: {
    challengeId?: string;
    itemId?: string;
    selectedCategory?: Challenge2Category;
    expectedCategory?: Challenge2Category;
    correct?: boolean;
  }): void => {
    if (
      payload.challengeId !== this.challengeId ||
      payload.correct ||
      !payload.itemId ||
      !payload.selectedCategory ||
      !payload.expectedCategory ||
      this.personalMistakes.has(payload.itemId)
    ) return;
    const item = CHALLENGE_2_ITEMS.find(entry => entry.id === payload.itemId);
    this.personalMistakes.set(payload.itemId, {
      itemId: payload.itemId,
      itemName: item?.name ?? payload.itemId,
      firstAnswer: payload.selectedCategory,
      correctAnswer: payload.expectedCategory
    });
  };
  private handleServerEnd = (payload: {
    challengeId?: string;
    finalResults?: unknown;
  }): void => {
    if (payload?.challengeId && this.challengeId && payload.challengeId !== this.challengeId) {
      return;
    }
    this.stopChallenge2();
    if (payload.finalResults) {
      const finalResults = payload.finalResults as {
        rankings?: Array<{ studentId?: string; mistakes?: unknown[] }>;
      };
      const personal = finalResults.rankings?.find(
        result => result.studentId === socket.id
      );
      if (personal && (!Array.isArray(personal.mistakes) || personal.mistakes.length === 0)) {
        personal.mistakes = [...this.personalMistakes.values()];
      }
      window.dispatchEvent(new CustomEvent("challenge2FinalResult", {
        detail: finalResults
      }));
    }
  };

  /** Convert a browser pointer position into a Three.js camera ray. */
  private updateDesktopRay(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.desktopPointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.desktopRaycaster.setFromCamera(this.desktopPointer, this.camera);
  }

  /** Begin desktop dragging only when the left mouse button hits the device. */
  private handleDesktopPointerDown = (event: PointerEvent): void => {
    if (
      this.renderer.xr.isPresenting ||
      !this.active ||
      this.advancing ||
      !this.device?.object3D ||
      event.button !== 0
    ) return;

    this.updateDesktopRay(event);
    this.device.object3D.updateMatrixWorld(true);
    const hit = this.desktopRaycaster.intersectObject(
      this.device.object3D,
      true
    )[0];
    if (!hit) return;

    const deviceWorldPosition = new THREE.Vector3();
    const cameraForward = new THREE.Vector3();
    this.device.object3D.getWorldPosition(deviceWorldPosition);
    this.camera.getWorldDirection(cameraForward);
    this.desktopDragPlane.setFromNormalAndCoplanarPoint(
      cameraForward,
      deviceWorldPosition
    );

    const planeHit = new THREE.Vector3();
    if (!this.desktopRaycaster.ray.intersectPlane(this.desktopDragPlane, planeHit)) {
      return;
    }

    // Preserve the exact point where the user clicked instead of snapping the
    // device's center directly under the cursor.
    this.desktopDragOffset.copy(deviceWorldPosition).sub(planeHit);
    this.desktopDragging = true;
    this.renderer.domElement.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  /** Move the held device along a plane parallel to the student's view. */
  private handleDesktopPointerMove = (event: PointerEvent): void => {
    if (!this.desktopDragging || !this.device?.object3D) return;

    this.updateDesktopRay(event);
    const planeHit = new THREE.Vector3();
    if (!this.desktopRaycaster.ray.intersectPlane(this.desktopDragPlane, planeHit)) {
      return;
    }

    const targetWorld = planeHit.add(this.desktopDragOffset);
    const parent = this.device.object3D.parent;
    if (parent) parent.worldToLocal(targetWorld);
    this.device.object3D.position.copy(targetWorld);
    this.device.object3D.updateMatrixWorld(true);
    event.preventDefault();
    event.stopPropagation();
  };

  /** Release the mouse-held device and run the same box validation as VR. */
  private handleDesktopPointerUp = (event: PointerEvent): void => {
    if (!this.desktopDragging) return;
    this.desktopDragging = false;
    if (this.renderer.domElement.hasPointerCapture?.(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture?.(event.pointerId);
    }
    if (this.device) this.handleRelease(this.device);
    event.preventDefault();
    event.stopPropagation();
  };

  /** Open Challenge 2 and show its first device. */
  private startChallenge2 = (): void => {
    if (this.active) return;
    this.active = true;
    this.advancing = false;
    this.currentIndex = 0;
    if (!this.challengeStartedAt) this.challengeStartedAt = Date.now();

    this.createSceneIfNeeded();
    this.positionRootInFrontOfCamera();
    if (this.root) this.root.visible = true;
    this.disableOtherStudentUi();
    this.notifyChallengeVisibility(true);
    this.showCurrentItem();
    (window as any).isChallenge2Open = true;
  };

  /** Close Challenge 2 and restore the normal classroom/UI state. */
  private stopChallenge2 = (): void => {
    if (!this.active && !this.root?.visible) return;
    this.active = false;
    this.advancing = false;
    this.desktopDragging = false;
    this.challengeId = undefined;
    this.disposeDevice();
    this.disposeCompletedDevices();
    this.boxes.forEach(box => box.setHighlighted(false));
    if (this.root) this.root.visible = false;
    this.restoreOtherStudentUi();
    this.notifyChallengeVisibility(false);
    (window as any).isChallenge2Open = false;
  };

  /** Build the reusable boxes and status panel only once. */
  private createSceneIfNeeded(): void {
    if (this.root) return;

    const root = new THREE.Group();
    root.name = "Challenge2Root";
    root.visible = false;
    this.rootEntity = this.world.createTransformEntity(root);
    this.root = root;

    this.boxes = createChallenge2DropBoxes();
    this.boxes.forEach(box => root.add(box.group));
    this.createStatusSprite();
  }

  /**
   * Place the activity in front of the current headset once at startup.
   * The root is attached to the scene, not the camera, so it stays fixed in
   * world space when the headset later moves or rotates.
   */
  private positionRootInFrontOfCamera(): void {
    if (!this.root) return;

    const cameraPosition = new THREE.Vector3();
    const forward = new THREE.Vector3();
    this.camera.getWorldPosition(cameraPosition);
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1);
    forward.normalize();

    const desktopMode = !this.renderer.xr.isPresenting;
    const distance = desktopMode ? DESKTOP_ROOT_DISTANCE : ROOT_DISTANCE;
    const belowCamera = desktopMode
      ? DESKTOP_ROOT_BELOW_CAMERA
      : ROOT_BELOW_CAMERA;
    this.root.position.copy(cameraPosition).addScaledVector(forward, distance);
    this.root.position.y = cameraPosition.y - belowCamera;

    const towardCamera = cameraPosition.clone().sub(this.root.position);
    towardCamera.y = 0;
    this.root.rotation.set(
      0,
      Math.atan2(towardCamera.x, towardCamera.z),
      0
    );
    this.root.updateMatrixWorld(true);
  }

  /**
   * Create a non-interactive world-space plane for instructions and feedback.
   * Do not use THREE.Sprite here because sprites billboard toward the camera
   * and would appear to move or rotate with the headset.
   */
  private createStatusSprite(): void {
    if (!this.root) return;

    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 256;
    this.statusTexture = new THREE.CanvasTexture(canvas);
    this.statusTexture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshBasicMaterial({
      map: this.statusTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide
    });
    const sprite = new THREE.Mesh(
      new THREE.PlaneGeometry(1.72, 0.43),
      material
    );
    sprite.name = "Challenge2Status";
    // Leave a dedicated middle band for the device: the container's bottom
    // stays above the model, and the model's bottom stays above the box rims.
    sprite.position.set(0, 1.34, -0.03);
    sprite.renderOrder = 20000;
    (sprite as any).pointerEvents = "none";
    sprite.raycast = () => undefined;
    this.root.add(sprite);
    this.statusSprite = sprite;
  }

  /** Redraw the status canvas with new title/detail text. */
  private updateStatus(title: string, detail: string, color = "#ffffff"): void {
    this.statusTitle = title;
    this.statusDetail = detail;
    this.statusColor = color;
    this.redrawStatus();
  }

  /** Redraw the fixed question panel, including the synchronized countdown. */
  private redrawStatus(): void {
    const canvas = this.statusTexture?.image as HTMLCanvasElement | undefined;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !this.statusTexture) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(7, 17, 34, 0.88)";
    context.roundRect(10, 10, canvas.width - 20, canvas.height - 20, 34);
    context.fill();
    context.strokeStyle = "rgba(103, 232, 249, 0.85)";
    context.lineWidth = 6;
    context.stroke();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = this.statusColor;
    context.font = "700 58px Arial, sans-serif";
    context.fillText(this.statusTitle, canvas.width / 2, 91);
    context.fillStyle = "#dbeafe";
    context.font = "400 35px Arial, sans-serif";
    context.fillText(this.statusDetail, canvas.width / 2, 169);
    const remaining = Math.max(
      0,
      this.challengeDurationSeconds -
        Math.floor((Date.now() - this.challengeStartedAt) / 1000)
    );
    context.textAlign = "right";
    context.fillStyle = remaining <= 15 ? "#fca5a5" : "#67e8f9";
    context.font = "700 28px Arial, sans-serif";
    context.fillText(
      `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`,
      canvas.width - 42,
      48
    );
    this.statusTexture.needsUpdate = true;
  }

  /** Refresh only when the displayed second changes. */
  private updateStudentCountdown(): void {
    const remaining = Math.max(
      0,
      this.challengeDurationSeconds -
        Math.floor((Date.now() - this.challengeStartedAt) / 1000)
    );
    if (remaining === this.lastCountdownSecond) return;
    this.lastCountdownSecond = remaining;
    this.redrawStatus();
  }

  /** Remove the previous device and spawn the next question item. */
  private showCurrentItem(): void {
    const item = CHALLENGE_2_ITEMS[this.currentIndex];
    if (!item) {
      this.finishChallenge();
      return;
    }

    this.disposeDevice();
    this.advancing = false;
    this.updateStatus(
      `${item.name}  -  ${this.currentIndex + 1} / ${CHALLENGE_2_ITEMS.length}`,
      "Grab the device and drop it into the correct box."
    );
    this.device = this.createDevice(item, this.currentIndex);
  }

  /**
   * Create the current device as a thin 3D card with its transparent PNG on
   * the front, then add IWSDK grabbing components for controller interaction.
   */
  private createDevice(item: Challenge2Item, itemIndex: number): Entity {
    if (!this.root || !this.rootEntity) {
      throw new Error("Challenge 2 root must exist before creating a device.");
    }

    const group = new THREE.Group();
    group.name = `Challenge2Device_${item.id}`;
    group.position.copy(DEVICE_LOCAL_POSITION);
    group.userData.challenge2Disposed = false;

    // Register a centered grab surface before any asynchronous PNG/GLB load.
    // Without this mesh, the webcam entity is initially empty, so IWSDK can
    // miss it when building the controller interaction target. This surface
    // is invisible but belongs only to the visible device (not to a hidden UI
    // panel), and its center matches the model's visual center exactly.
    const grabTarget = new THREE.Mesh(
      new THREE.BoxGeometry(
        DEVICE_CARD_SIZE * 1.08,
        DEVICE_CARD_SIZE * 1.08,
        DEVICE_CARD_SIZE * 0.48
      ),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        colorWrite: false,
        depthWrite: false
      })
    );
    grabTarget.name = "DeviceGrabTarget";
    group.add(grabTarget);

    // Show a PNG immediately while the browser downloads and decodes the GLB.
    // The fallback also remains usable if WebGL cannot render the model.
    let modelReady = false;
    const fallbackGroup = new THREE.Group();
    fallbackGroup.name = "DeviceFallback";
    if (item.imagePath) {
      // Use a blue loading card rather than an unlabelled black block. The
      // card is replaced by the PNG or GLB as soon as either asset is ready.
      const backing = new THREE.Mesh(
        new THREE.BoxGeometry(DEVICE_CARD_SIZE, DEVICE_CARD_SIZE, 0.018),
        new THREE.MeshBasicMaterial({
          color: 0x185b82,
          transparent: true,
          opacity: 0.82,
          toneMapped: false
        })
      );
      backing.castShadow = true;
      fallbackGroup.add(backing);
      new THREE.TextureLoader().load(
        item.imagePath,
        texture => {
          if (group.userData.challenge2Disposed || modelReady) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          const image = new THREE.Mesh(
            new THREE.PlaneGeometry(
              DEVICE_CARD_SIZE * 0.92,
              DEVICE_CARD_SIZE * 0.92
            ),
            new THREE.MeshBasicMaterial({
              map: texture,
              transparent: true,
              alphaTest: 0.02,
              side: THREE.DoubleSide,
              toneMapped: false
            })
          );
          image.name = "DeviceFallbackImage";
          image.position.z = 0.012;
          fallbackGroup.add(image);
        },
        undefined,
        error => console.error(
          `[Challenge 2] Could not load fallback ${item.imagePath}:`,
          error
        )
      );
      group.add(fallbackGroup);
    }

    const removeFallback = (): void => {
      fallbackGroup.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        child.geometry.dispose();
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];
        materials.forEach(material => {
          const texture = (material as THREE.Material & {
            map?: THREE.Texture | null;
          }).map;
          texture?.dispose();
          material.dispose();
        });
      });
      fallbackGroup.removeFromParent();
    };

    if (item.modelPath) {
      // The webcam uses the supplied GLB. Normalize its unknown authoring
      // scale and center so it occupies the same reachable area as PNG items.
      new GLTFLoader().load(
        item.modelPath,
        gltf => {
          // Asset loading can finish before IWSDK attaches this transform to
          // its parent. `group.parent` therefore cannot be used as a lifetime
          // check; doing so left only the fallback black square in browsers.
          if (group.userData.challenge2Disposed) {
            gltf.scene.traverse(child => {
              if (!(child instanceof THREE.Mesh)) return;
              child.geometry.dispose();
              const materials = Array.isArray(child.material)
                ? child.material
                : [child.material];
              materials.forEach(material => material.dispose());
            });
            return;
          }
          const model = gltf.scene;
          model.name = "DeviceModel";
          model.rotation.y = item.modelRotationY ?? 0;
          model.updateMatrixWorld(true);
          const initialBounds = new THREE.Box3().setFromObject(model);
          const initialSize = initialBounds.getSize(new THREE.Vector3());
          const largestDimension = Math.max(
            initialSize.x,
            initialSize.y,
            initialSize.z,
            0.0001
          );
          model.scale.multiplyScalar((DEVICE_CARD_SIZE * 0.95) / largestDimension);
          model.updateMatrixWorld(true);
          const centeredBounds = new THREE.Box3().setFromObject(model);
          const center = centeredBounds.getCenter(new THREE.Vector3());
          model.position.sub(center);
          // Recalculate once after centering and keep the visible GLB exactly
          // around the grab target's local origin.
          model.updateMatrixWorld(true);
          model.traverse(child => {
            if (!(child instanceof THREE.Mesh)) return;
            child.castShadow = true;
            child.receiveShadow = true;
            const materials = Array.isArray(child.material)
              ? child.material
              : [child.material];
            materials.forEach(material => {
              material.side = THREE.DoubleSide;
              material.needsUpdate = true;
            });
          });
          modelReady = true;
          removeFallback();
          group.add(model);
        },
        undefined,
        error => console.error(
          `[Challenge 2] Could not load ${item.modelPath}:`,
          error
        )
      );
    }

    // Keep the device in the same rotated local coordinate space as the
    // question panel and boxes. This makes local X = 0 visually centered in
    // both desktop preview and the VR headset.
    const entity = this.world.createTransformEntity(group, {
      parent: this.rootEntity
    });
    entity.addComponent(Challenge2Device, {
      itemIndex,
      expectedCategory: item.category
    });
    // Interactable exposes the device to the controller ray. DistanceGrabbable
    // is required here because IWSDK's OneHandGrabbable intentionally rejects
    // ray pointers and only supports direct hand/controller contact.
    entity.addComponent(Interactable);
    entity.addComponent(DistanceGrabbable, {
      rotate: true,
      translate: true,
      scale: false,
      // Follow the ray endpoint instead of copying the controller's small
      // physical movement. MoveAtSource made the device feel heavy and would
      // require an unrealistic arm reach to reach the two outer boxes.
      movementMode: MovementMode.MoveFromTarget,
      detachOnGrab: false,
      returnToOrigin: false
    });
    return entity;
  }

  /**
   * Called when the controller releases the device. Find the containing box,
   * validate its category, then reset, retry, or advance to the next item.
   */
  private handleRelease(device: Entity): void {
    if (!this.active || this.advancing || device !== this.device) return;

    device.object3D?.getWorldPosition(this.worldPoint);
    // The boxes themselves never receive ray hits. Choose the closest box
    // within the same tolerance used by the visible hover highlight, so the
    // result always agrees with what the student saw before releasing.
    let droppedIn: Challenge2DropBox | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const box of this.boxes) {
      const distance = this.getBoxWorldBounds(box).distanceToPoint(this.worldPoint);
      if (distance < closestDistance) {
        droppedIn = box;
        closestDistance = distance;
      }
    }
    if (closestDistance > DROP_SNAP_DISTANCE) droppedIn = undefined;

    if (!droppedIn) {
      this.resetDevicePosition();
      this.updateStatus(
        "Try again",
        "Move the device fully inside one of the four boxes.",
        "#fbbf24"
      );
      return;
    }

    // Put the released device visibly inside the selected open-top box before
    // showing feedback. Incorrect answers remain there briefly, then reset;
    // correct answers remain there until the next item appears.
    this.snapDeviceIntoBox(droppedIn);

    const expected = device.getValue(
      Challenge2Device,
      "expectedCategory"
    ) as Challenge2Category | undefined;

    // Report every valid box drop to the server. The server independently
    // validates the item/category pair and forwards progress to the instructor.
    const currentItem = CHALLENGE_2_ITEMS[this.currentIndex];
    if (this.challengeId && currentItem) {
      socket.emit("challenge2ItemAnswer", {
        challengeId: this.challengeId,
        itemId: currentItem.id,
        selectedCategory: droppedIn.category
      });
    }

    if (droppedIn.category !== expected) {
      droppedIn.setHighlighted(true);
      this.updateStatus(
        "Incorrect - try again",
        CHALLENGE_2_ITEMS[this.currentIndex]?.feedback ?? "Choose another box.",
        "#fca5a5"
      );
      window.setTimeout(() => {
        droppedIn.setHighlighted(false);
        this.resetDevicePosition();
      }, WRONG_FEEDBACK_DELAY_MS);
      return;
    }

    this.advancing = true;
    droppedIn.setHighlighted(true);
    this.keepCurrentDeviceInBox();
    this.updateStatus(
      "Correct!",
      CHALLENGE_2_ITEMS[this.currentIndex]?.feedback ?? "Correct category.",
      "#86efac"
    );
    window.setTimeout(() => {
      droppedIn.setHighlighted(false);
      if (!this.active) return;
      this.currentIndex += 1;
      this.showCurrentItem();
    }, CORRECT_FEEDBACK_DELAY_MS);
  }

  /** Convert one box's local detection volume into current world coordinates. */
  private getBoxWorldBounds(box: Challenge2DropBox): THREE.Box3 {
    box.group.updateMatrixWorld(true);
    return this.boxWorldBounds
      .copy(box.dropBounds)
      .applyMatrix4(box.group.matrixWorld)
      .clone();
  }

  /** Center the released device inside an open-top destination box. */
  private snapDeviceIntoBox(box: Challenge2DropBox): void {
    if (!this.device?.object3D) return;
    const category = this.device.getValue(
      Challenge2Device,
      "expectedCategory"
    ) as Challenge2Category;
    const totalForBox = CHALLENGE_2_ITEMS.filter(
      item => item.category === category
    ).length;
    const placedInBox = this.completedDevices.filter(entity =>
      entity.getValue(Challenge2Device, "expectedCategory") === category
    ).length;

    // A box may contain several answers. Use compact side-by-side slots for
    // two items and a small grid if more items are added to this category.
    const columns = Math.min(totalForBox, 2);
    const row = Math.floor(placedInBox / columns);
    const column = placedInBox % columns;
    const x = columns === 1 ? 0 : (column - (columns - 1) / 2) * 0.20;
    const z = row * 0.10 - (totalForBox > 2 ? 0.05 : 0);
    const target = box.group.localToWorld(new THREE.Vector3(x, 0.18, z));
    const parent = this.device.object3D.parent;
    if (parent) parent.worldToLocal(target);
    this.device.object3D.position.copy(target);
    this.device.object3D.rotation.set(0, 0, 0);
    this.device.object3D.scale.setScalar(totalForBox > 1 ? 0.58 : 0.82);
    this.device.object3D.updateMatrixWorld(true);
  }

  /** Preserve a correct answer in its box without letting it block the ray. */
  private keepCurrentDeviceInBox(): void {
    if (!this.device) return;
    const completed = this.device;
    if (completed.hasComponent(DistanceGrabbable)) {
      completed.removeComponent(DistanceGrabbable);
    }
    if (completed.hasComponent(RayInteractable)) {
      completed.removeComponent(RayInteractable);
    }
    if (completed.object3D) {
      completed.object3D.pointerEvents = "none";
      completed.object3D.traverse((child: any) => {
        child.pointerEvents = "none";
      });
    }
    this.completedDevices.push(completed);
    this.device = undefined;
  }

  /** Return a missed or incorrect device to its original floating position. */
  private resetDevicePosition(): void {
    if (!this.device?.object3D) return;
    this.device.object3D.position.copy(DEVICE_LOCAL_POSITION);
    this.device.object3D.rotation.set(0, 0, 0);
    this.device.object3D.scale.setScalar(1);
    this.device.object3D.updateMatrixWorld(true);
  }

  /** Keep the completed scene visible and notify future instructor logic. */
  private finishChallenge(): void {
    this.advancing = false;
    this.updateStatus(
      "Challenge complete!",
      `${CHALLENGE_2_ITEMS.length} devices classified.`,
      "#86efac"
    );
    window.dispatchEvent(new CustomEvent("challenge2:complete"));
  }

  /** Notify shared classroom UI when the challenge opens or closes. */
  private notifyChallengeVisibility(visible: boolean): void {
    window.dispatchEvent(new CustomEvent("quickChallengeVisibilityChanged", {
      detail: { visible, challengeType: "challenge-2" }
    }));
  }

  /**
   * Hide unrelated student panels and remove their RayInteractable component.
   * This prevents invisible UI from intercepting controller rays.
   */
  private disableOtherStudentUi(): void {
    if (this.disabledUi.length > 0) return;
    const names = [
      "menuEntity",
      "panelEntity",
      "hintEntity",
      "raiseHandEntity",
      "studentBoardViewButtonEntity",
      "studentResultEntity",
      "quickChallengeEntity"
    ];

    names.forEach(name => {
      const entity = (window as any)[name];
      const object = entity?.object3D;
      if (!entity || !object) return;
      const hadRayInteractable = Boolean(entity.hasComponent?.(RayInteractable));
      this.disabledUi.push({
        entity,
        visible: object.visible,
        pointerEvents: object.pointerEvents,
        hadRayInteractable
      });
      object.visible = false;
      object.pointerEvents = "none";
      object.traverse((child: any) => {
        child.pointerEvents = "none";
      });
      if (hadRayInteractable) entity.removeComponent(RayInteractable);
    });
  }

  /** Restore every panel to the state it had before Challenge 2 opened. */
  private restoreOtherStudentUi(): void {
    this.disabledUi.forEach(record => {
      const object = record.entity?.object3D;
      if (!object) return;
      object.visible = record.visible;
      object.pointerEvents = record.pointerEvents ?? "auto";
      if (record.hadRayInteractable && !record.entity.hasComponent?.(RayInteractable)) {
        record.entity.addComponent(RayInteractable);
      }
    });
    this.disabledUi = [];
  }

  /** Dispose one question device and its texture/material/geometry resources. */
  private disposeDevice(): void {
    if (!this.device) return;
    this.desktopDragging = false;
    const object = this.device.object3D;
    if (object) object.userData.challenge2Disposed = true;
    object?.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach(material => {
        const texture = (material as THREE.Material & {
          map?: THREE.Texture | null;
        }).map;
        texture?.dispose();
        material.dispose();
      });
    });
    this.device.dispose();
    this.device = undefined;
  }

  /** Remove the devices retained in boxes when Challenge 2 is closed. */
  private disposeCompletedDevices(): void {
    this.completedDevices.forEach(entity => {
      const object = entity.object3D;
      object?.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        child.geometry.dispose();
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];
        materials.forEach(material => {
          const texture = (material as THREE.Material & {
            map?: THREE.Texture | null;
          }).map;
          texture?.dispose();
          material.dispose();
        });
      });
      entity.dispose();
    });
    this.completedDevices = [];
  }

  /** Dispose all reusable Challenge 2 scene resources when the system ends. */
  private disposeScene(): void {
    this.disposeDevice();
    this.disposeCompletedDevices();
    this.boxes.forEach(box => box.dispose());
    this.boxes = [];
    if (this.statusSprite) {
      this.statusSprite.geometry.dispose();
      const statusMaterials = Array.isArray(this.statusSprite.material)
        ? this.statusSprite.material
        : [this.statusSprite.material];
      statusMaterials.forEach(material => material.dispose());
    }
    this.statusTexture?.dispose();
    this.rootEntity?.dispose();
    this.rootEntity = undefined;
    this.root = undefined;
    this.statusSprite = undefined;
    this.statusTexture = undefined;
  }
}
