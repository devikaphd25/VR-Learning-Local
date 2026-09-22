/// <reference types="vite/client" />
/**
 * Browser/VR application entry point.
 *
 * Goal: load IWSDK assets, create the classroom world, register ECS systems,
 * connect the authenticated user, and coordinate mode/environment changes.
 * Depends on login identity, Socket.IO events, Supabase session services,
 * classroom GLBs/textures, UI documents, and the systems under src/systems.
 */

import {
  ACESFilmicToneMapping,
  AssetManager,
  AssetManifest,
  AssetType,
  DomeGradient,
  EnvironmentType,
  IBLTexture,
  LocomotionEnvironment,
  PanelUI,
  RayInteractable,
  SessionMode,
  World
} from "@iwsdk/core";

import * as THREE from "three";

import { SeatComponent } from "./components/seat.component";
import { ProjectorScreenComponent } from "./components/projector-screen.component";

import { SeatSystem } from "./systems/seat.system";

import { ProjectorScreenSystem } from "./systems/projector-screen.system";
import { PresentationSystem } from "./systems/presentation.system";
import { RaiseHandSystem } from "./systems/raise-hand.system";
import {
  InstructorDashboardSystem
} from "./systems/instructor-menu.system";
import {
  PanelSystem,
  PanelSystemComponent
} from "./panel";

import { connectSocketForUser, socket } from "./network/socket";
import {
  disposeVRLoginResources,
  showVRLoginPanel
} from "./systems/vr-login.system";
if (typeof socket !== 'undefined') {
  socket.on("modeChanged", (data) => {
    console.log(`[Student] 🔔 TOP-LEVEL modeChanged received:`, data);
  });
}
import {
  updateSeatMarkers,
  updateMarkerVisibility,
  hideAllMarkers,
  showAllMarkers,
  setSeatMarkersForcedVisible,
  setSeatMarkerTheme
} from "./components/instructor/seat-markers";
import { RaiseHandNotificationSystem }
from "./systems/raise-hand-notification.system";
import { StudentResultSystem }
from "./systems/student-result.system";
import { QuickChallengeSystem }
from "./systems/quick-challenge.system";
import { Challenge2System }
from "./systems/challenge-2.system";
import { Challenge2Device }
from "./components/challenge-2.component";
import { LabEnvironmentManager } from "./lab/LabEnvironmentManager";

// ============================================================
// USER ROLE TYPES
// ============================================================

type VRUserRole = "student" | "instructor";

interface VRUser {
  id: number;
  username: string;
  fullName?: string;
  role: VRUserRole;
  seat?: string | null;
  loginTime?: string;
}

// ============================================================
// ASSETS
// ============================================================

const assets: AssetManifest = {
  classroom2: {
    url: "./gltf/classroom2/theater_classroom2.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  nasaSeatSource: {
    url: "./gltf/classroom2/vrclass-nasa-classroom.glb",
    type: AssetType.GLTF,
    priority: "background"
  },

  sunsetHDR: {
    url: "./hdr/venice_sunset_1k.hdr",
    type: AssetType.HDRTexture,
    priority: "critical"
  },

  raiseHandIcon: {
    url: "./gltf/icons/raise-hand1.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  labEnvironmentModel: {
    url: "./python-type-lab-models/lab-environment.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  tableModel: {
    url: "./python-type-lab-models/table.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  cardModel: {
    url: "./python-type-lab-models/card.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  intBinModel: {
    url: "./python-type-lab-models/bin-int.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  floatBinModel: {
    url: "./python-type-lab-models/bin-float.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  boolBinModel: {
    url: "./python-type-lab-models/bin-bool.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  strBinModel: {
    url: "./python-type-lab-models/bin-str.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  newCardButtonModel: {
    url: "./python-type-lab-models/new-card-button.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  resetButtonModel: {
    url: "./python-type-lab-models/reset-button.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  dispenserModel: {
    url: "./python-type-lab-models/card-dispenser-animation.glb",
    type: AssetType.GLTF,
    priority: "critical"
  }
};

// ============================================================
// LOGIN HELPERS
// ============================================================

function getLoggedInUser(): VRUser | null {
  const savedUser = localStorage.getItem("vrUser");

  if (!savedUser) {
    return null;
  }

  try {
    const parsedUser = JSON.parse(
      savedUser
    ) as Partial<VRUser>;

    const userId = Number(parsedUser.id);

    if (
      !Number.isInteger(userId) ||
      userId <= 0
    ) {
      console.error(
        "[Login] The saved user has no valid database ID."
      );

      return null;
    }

    if (
      typeof parsedUser.username !== "string" ||
      parsedUser.username.trim() === ""
    ) {
      return null;
    }

    if (
      parsedUser.role !== "student" &&
      parsedUser.role !== "instructor"
    ) {
      return null;
    }

    return {
      id: userId,
      username: parsedUser.username.trim(),
      fullName: parsedUser.fullName,
      role: parsedUser.role,
      seat: parsedUser.seat ?? null,
      loginTime: parsedUser.loginTime
    };
  } catch (error) {
    console.error(
      "[Login] Could not read saved user:",
      error
    );

    return null;
  }
}

function redirectToLogin(): void {
  window.location.replace("./");
}

function logout(): void {
  localStorage.removeItem("vrUser");
  localStorage.removeItem("vrClassroomSession");
  window.location.replace("./");
}

(window as any).logout = logout;

// ============================================================
// CHECK LOGIN BEFORE CREATING THE VR WORLD
// ============================================================

let currentUser: VRUser | null = null;
let isInstructor = false;
let isStudent = false;
function registerCurrentClassroomUser(): void {
  if (!socket.connected) {
    return;
  }

  if (!currentUser) {
    console.warn(
      "[Classroom] Cannot register because currentUser is null."
    );

    return;
  }

  console.log(
    "[Classroom] Registering user:",
    {
      userId: currentUser.id,
      username: currentUser.username,
      role: currentUser.role
    }
  );

  let classroomSession: { roomId?: string; participantId?: string | null } = {};
  try {
    classroomSession = JSON.parse(
      localStorage.getItem("vrClassroomSession") ?? "{}"
    );
  } catch (error) {
    console.error("[Classroom] Invalid saved classroom session:", error);
  }

  socket.emit(
    "registerClassroomClient",
    {
      userId: currentUser.id,
      username: currentUser.username,
      roomId: classroomSession.roomId ?? null,
      participantId: classroomSession.participantId ?? null
    }
  );
}

socket.on("connect", () => {
  console.log(
    "[Classroom] Socket connected:",
    socket.id
  );

  registerCurrentClassroomUser();
});

socket.on("classEnded", (data: { roomId?: string; message?: string }) => {
  // The first deployment supports one live classroom. Always honor the
  // server shutdown event, even if an older client has a missing/stale saved
  // room id, so no student remains trapped after the instructor disconnects.
  console.log("[Classroom] Session ended:", data?.message ?? data?.roomId);
  localStorage.removeItem("vrUser");
  localStorage.removeItem("vrClassroomSession");
  window.location.replace("./");
});

if (socket.connected) {
  registerCurrentClassroomUser();
}
console.log("[Login] Saved user: none");


// ============================================================
// CREATE WORLD
// ============================================================

World.create(
  document.getElementById("scene-container") as HTMLDivElement,
  {
    assets,
    xr: {
      sessionMode: SessionMode.ImmersiveVR,
      offer: "always",
      features: {
        handTracking: true,
        layers: true
      }
    },
    input: {
      canvasPointerEvents: {
        enabled: true,
        activeDuringXR: true
      }
    },
    features: {
      locomotion: false,
      grabbing: true,
      physics: true,
      sceneUnderstanding: false,
      environmentRaycast: false
    },
    render: {
      defaultLighting: true,
      camera: {
        position: [0, 1.0, 0]
      }
    }
  }
)
  .then(async (world) => {
    const { renderer, scene, camera, player } = world;
    (window as any).renderer =
  renderer;

  (window as any).scene =
    scene;

  (window as any).camera =
    camera;

    (window as any).player =
    player;

    const skyLevel = world.activeLevel.value;
    skyLevel.addComponent(DomeGradient, {
      sky: [0.04, 0.18, 0.38, 1],
      equator: [0.18, 0.52, 0.78, 1],
      ground: [0.015, 0.025, 0.06, 1],
      intensity: 1.15,
    });

    // Configure the renderer and HDR environment before waiting for the VR
    // login. On physical Quest hardware the XR session may already be
    // presenting by the time the user submits the panel.
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;
    renderer.xr.enabled = true;

    const headsetDebugEnabled =
      new URLSearchParams(window.location.search).get("debug") === "1";
    let headsetDebugStatus: HTMLDivElement | null = null;

    if (headsetDebugEnabled) {
      headsetDebugStatus = document.createElement("div");
      headsetDebugStatus.style.cssText = [
        "position:fixed",
        "left:12px",
        "right:12px",
        "bottom:12px",
        "z-index:2147483647",
        "padding:12px",
        "border-radius:10px",
        "background:#111827",
        "color:#ffffff",
        "font:16px sans-serif",
        "border:2px solid #38bdf8"
      ].join(";");
      const previousLoss = localStorage.getItem(
        "vrclass-last-webgl-context-loss"
      );
      headsetDebugStatus.textContent = previousLoss
        ? `VR DEBUG — Previous WebGL context loss: ${previousLoss}`
        : "VR DEBUG — No WebGL context loss recorded.";
      headsetDebugStatus.title = "Tap to clear the saved diagnostic.";
      headsetDebugStatus.addEventListener("click", () => {
        localStorage.removeItem("vrclass-last-webgl-context-loss");
        localStorage.removeItem("vrclass-last-xr-pose");
        if (headsetDebugStatus) {
          headsetDebugStatus.textContent =
            "VR DEBUG — Cleared. No WebGL context loss recorded.";
          headsetDebugStatus.style.background = "#111827";
        }
      });
      document.body.appendChild(headsetDebugStatus);
    }

    renderer.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      const lossTime = new Date().toISOString();
      localStorage.setItem("vrclass-last-webgl-context-loss", lossTime);
      if (headsetDebugStatus) {
        headsetDebugStatus.textContent =
          `VR DEBUG — WebGL context LOST at ${lossTime}`;
        headsetDebugStatus.style.background = "#7f1d1d";
      }
      console.error("[WebXR] WebGL context lost while rendering in the headset.");
    });
    renderer.domElement.addEventListener("webglcontextrestored", () => {
      if (headsetDebugStatus) {
        headsetDebugStatus.textContent = "VR DEBUG — WebGL context restored.";
        headsetDebugStatus.style.background = "#14532d";
      }
      console.info("[WebXR] WebGL context restored.");
    });

    const captureXRDebugPose = (): void => {
      if (!headsetDebugEnabled || !renderer.xr.isPresenting) return;

      const playerObject = (player as any)?.object3D ?? (player as any);
      const xrCamera = renderer.xr.getCamera() as THREE.ArrayCamera;
      const eyeCamera = xrCamera.cameras?.[0] ?? xrCamera;
      const eyeWorld = new THREE.Vector3();
      const baseCameraWorld = new THREE.Vector3();
      eyeCamera.getWorldPosition(eyeWorld);
      camera.getWorldPosition(baseCameraWorld);

      const pose = {
        role: (window as any).vrUser?.role ?? "login",
        player: playerObject
          ? {
              x: Number(playerObject.position.x.toFixed(2)),
              y: Number(playerObject.position.y.toFixed(2)),
              z: Number(playerObject.position.z.toFixed(2))
            }
          : null,
        eye: {
          x: Number(eyeWorld.x.toFixed(2)),
          y: Number(eyeWorld.y.toFixed(2)),
          z: Number(eyeWorld.z.toFixed(2))
        },
        camera: {
          x: Number(baseCameraWorld.x.toFixed(2)),
          y: Number(baseCameraWorld.y.toFixed(2)),
          z: Number(baseCameraWorld.z.toFixed(2))
        },
        near: eyeCamera.near,
        far: eyeCamera.far
      };
      localStorage.setItem("vrclass-last-xr-pose", JSON.stringify(pose));
      console.info("[WebXR] Diagnostic pose", pose);
    };

    if (headsetDebugEnabled) {
      renderer.xr.addEventListener("sessionstart", () => {
        [300, 1000, 2000, 4000].forEach((delay) => {
          window.setTimeout(captureXRDebugPose, delay);
        });
      });
      renderer.xr.addEventListener("sessionend", () => {
        const pose = localStorage.getItem("vrclass-last-xr-pose");
        if (headsetDebugStatus) {
          headsetDebugStatus.textContent = pose
            ? `VR DEBUG — XR pose: ${pose}`
            : "VR DEBUG — No XR pose was captured.";
          headsetDebugStatus.style.background = "#1e3a8a";
        }
      });
    }

    skyLevel.addComponent(IBLTexture, {
      src: "sunsetHDR",
      intensity: 0.9,
      rotation: [0, Math.PI / 4, 0]
    });

    const startupMessage = document.getElementById("startup-message");

    if (!currentUser) {
      if (startupMessage) startupMessage.style.display = "none";
      const login = await showVRLoginPanel(world, camera);
      currentUser = login.user;
    }

    const activeUser = currentUser;
    isInstructor = activeUser.role === "instructor";
    isStudent = activeUser.role === "student";

    (window as any).vrUser = activeUser;
    (window as any).isInstructor = isInstructor;
    (window as any).isStudent = isStudent;
    connectSocketForUser(activeUser);

    if (startupMessage) {
      startupMessage.textContent = isInstructor
        ? `Welcome Instructor ${activeUser.username}`
        : `Welcome Student ${activeUser.username}`;
    }

    document.title = isInstructor ? "UMES VR – Instructor" : "UMES VR – Student";

    // ========================================================
    // LOAD CLASSROOM
    // ========================================================

    const classroomAsset = AssetManager.getGLTF("classroom2");
    const nasaSeatAsset = AssetManager.getGLTF("nasaSeatSource");

    if (!classroomAsset) {
      throw new Error("The classroom2 asset could not be loaded.");
    }

    if (!nasaSeatAsset) {
      throw new Error("The NASA seat source asset could not be loaded.");
    }

    const envMesh = classroomAsset.scene;
    const useNasaSeatVisuals = true;
    const isPhysicalQuest = /OculusBrowser|Quest/i.test(navigator.userAgent);
    const lightweightSeatAnchors: THREE.Object3D[] = [];

    // Balanced Quest-safe classroom lighting. These two lights add no shadow
    // maps, textures, or geometry and improve the seats and walls
    // from every viewing direction.
    const classroomFillLight = new THREE.HemisphereLight(
      0xbadfff,
      0x101827,
      0.82
    );
    classroomFillLight.name = "ClassroomBalancedFill";
    envMesh.add(classroomFillLight);

    const classroomStageLight = new THREE.DirectionalLight(0xffead0, 0.9);
    classroomStageLight.name = "ClassroomStageKey";
    classroomStageLight.position.set(2.5, 6.5, 3.8);
    classroomStageLight.castShadow = false;
    classroomStageLight.target.position.set(0, 1.2, -1.5);
    envMesh.add(classroomStageLight);
    envMesh.add(classroomStageLight.target);

    // The NASA room is viewed from inside. Quest's stereo cameras can cull
    // large wall and ceiling meshes differently from desktop preview, which
    // previously made the rear half of the room appear black. Render the room
    // shell from both sides and keep its meshes available to both eye cameras.
    envMesh.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;

      mesh.frustumCulled = false;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      materials.forEach((material) => {
        if (!material) return;
        material.side = THREE.DoubleSide;
        material.needsUpdate = true;
      });
    });

    // Expand only the traditional classroom shell. Seats retain their normal
    // size while the floor, ceiling, and curved wall gain room for five rows.
    ["Floor", "Ceiling", "Wall_Curved"].forEach((name) => {
      const shellPart = envMesh.getObjectByName(name);
      if (shellPart) {
        shellPart.scale.x *= 1.35;
        shellPart.scale.z *= 1.35;
      }
    });
    const frontWall = envMesh.getObjectByName("Wall_Front_Flat");
    if (frontWall) frontWall.scale.x *= 1.35;

    // Quest-safe NASA wall treatment: retain the original low-poly wall
    // geometry and replace only its materials with an opaque graphite/navy
    // finish. This avoids importing the high-cost NASA architecture meshes.
    const nasaWallMaterial = new THREE.MeshStandardMaterial({
      color: 0xaebdca,
      roughness: 0.5,
      metalness: 0.18,
      emissive: 0x26384c,
      emissiveIntensity: 0.28,
      side: THREE.DoubleSide
    });
    ["Wall_Curved", "Wall_Front_Flat"].forEach((wallName) => {
      const wall = envMesh.getObjectByName(wallName);
      wall?.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = nasaWallMaterial;
        mesh.frustumCulled = false;
        mesh.receiveShadow = true;
      });
    });

    // Add only the two large NASA panoramic observation windows. Their exact
    // frame geometry comes from the NASA model, while one shared image texture
    // keeps the additional GPU cost small.
    nasaSeatAsset.scene.updateWorldMatrix(true, true);
    const nasaWindowSceneInverse = nasaSeatAsset.scene.matrixWorld.clone().invert();
    const nasaWindowGroups: THREE.Object3D[] = [];
    [
      ...Array.from(
        { length: 13 },
        (_, index) => `NASA_Wall_Bay_${String(index + 1).padStart(2, "0")}`
      ),
      "NASA_Left_Panoramic_Observation_Window",
      "NASA_Right_Panoramic_Observation_Window"
    ].forEach((windowName) => {
      const sourceWindow = nasaSeatAsset.scene.getObjectByName(windowName);
      if (!sourceWindow) {
        console.warn(`[Classroom] Missing ${windowName}.`);
        return;
      }

      const nasaWindow = sourceWindow.clone(true);
      const windowMatrix = nasaWindowSceneInverse
        .clone()
        .multiply(sourceWindow.matrixWorld);
      windowMatrix.decompose(
        nasaWindow.position,
        nasaWindow.quaternion,
        nasaWindow.scale
      );
      // The lightweight wall was enlarged for five rows. Apply the same room
      // expansion to the authored NASA window transform so its frames remain
      // flush with the curved wall instead of floating inside the room.
      nasaWindow.position.x *= 1.35;
      nasaWindow.position.z *= 1.35;
      nasaWindow.scale.x *= 1.35;
      nasaWindow.scale.z *= 1.35;
      nasaWindow.name = `${windowName}_Only`;
      nasaWindow.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.frustumCulled = false;
        if (
          mesh.name.startsWith("Panorama_Space_Backdrop") ||
          mesh.name.startsWith("Panorama_Glass") ||
          mesh.name.startsWith("Window_Backdrop") ||
          mesh.name.startsWith("Observation_Window")
        ) {
          mesh.visible = false;
          return;
        }
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        materials.forEach((material) => {
          material.side = THREE.DoubleSide;
          material.needsUpdate = true;
        });
      });
      nasaWindowGroups.push(nasaWindow);
      envMesh.add(nasaWindow);
    });

    if (nasaWindowGroups.length > 0) {
      new THREE.TextureLoader().load(
        "./textures/nasa/nasa-earth-galaxy-window-v3.png",
        (windowTexture) => {
          windowTexture.colorSpace = THREE.SRGBColorSpace;
          windowTexture.wrapS = THREE.ClampToEdgeWrapping;
          windowTexture.wrapT = THREE.ClampToEdgeWrapping;
          nasaWindowGroups.forEach((windowGroup) => {
            windowGroup.traverse((object) => {
              const mesh = object as THREE.Mesh;
              if (
                !mesh.isMesh ||
                (!mesh.name.startsWith("Panorama_Image_Surface") &&
                  !mesh.name.startsWith("Window_Panorama_Surface"))
              ) {
                return;
              }
              if (mesh.name.startsWith("Window_Panorama_Surface")) {
                const bayMatch = windowGroup.name.match(/NASA_Wall_Bay_(\d+)/);
                const bayIndex = bayMatch ? Number(bayMatch[1]) - 1 : 0;
                const cropWidth = 0.126;
                const cropOffset = (bayIndex / 12) * (1 - cropWidth);
                const croppedGeometry = mesh.geometry.clone();
                const uv = croppedGeometry.getAttribute("uv");
                if (uv) {
                  for (let index = 0; index < uv.count; index += 1) {
                    uv.setX(index, cropOffset + uv.getX(index) * cropWidth);
                  }
                  uv.needsUpdate = true;
                }
                mesh.geometry = croppedGeometry;
              }
              mesh.material = new THREE.MeshBasicMaterial({
                map: windowTexture,
                color: 0xffffff,
                side: THREE.DoubleSide,
                toneMapped: false
              });
              mesh.renderOrder = 2;
              mesh.visible = true;
            });
          });
        },
        undefined,
        (error) => console.error("[NASA Windows] Image load failed:", error)
      );
    }

    // Quest-safe floor: use only the original low-poly classroom geometry.
    // A shared opaque material keeps the floor and every tier visually simple
    // and prevents the login panorama from showing through any gaps.
    const simpleFloorMaterial = new THREE.MeshStandardMaterial({
      color: 0x10233d,
      roughness: 0.72,
      metalness: 0.12,
      emissive: 0x04223a,
      emissiveIntensity: 0.42,
      side: THREE.DoubleSide
    });
    const applySimpleFloorMaterial = (root: THREE.Object3D | null): void => {
      if (!root) return;
      root.visible = true;
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = simpleFloorMaterial;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
      });
    };
    applySimpleFloorMaterial(envMesh.getObjectByName("Floor") ?? null);

    // Add only the self-contained NASA ceiling assembly. The traditional
    // ceiling remains as a dark backing so the blue scene clear-color cannot
    // show through the open NASA ring structure.
    const traditionalCeiling = envMesh.getObjectByName("Ceiling");
    if (traditionalCeiling) {
      traditionalCeiling.visible = true;
      traditionalCeiling.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = new THREE.MeshStandardMaterial({
          color: 0x07111f,
          roughness: 0.58,
          metalness: 0.32,
          emissive: 0x020813,
          emissiveIntensity: 0.22,
          side: THREE.DoubleSide
        });
        mesh.frustumCulled = false;
      });
    }

    const nasaCeilingSource = nasaSeatAsset.scene.getObjectByName(
      "NASA_Aerospace_Ceiling"
    );
    if (nasaCeilingSource) {
      nasaSeatAsset.scene.updateWorldMatrix(true, true);
      const nasaSceneInverse = nasaSeatAsset.scene.matrixWorld.clone().invert();
      const nasaCeiling = nasaCeilingSource.clone(true);
      const ceilingMatrix = nasaSceneInverse
        .clone()
        .multiply(nasaCeilingSource.matrixWorld);
      ceilingMatrix.decompose(
        nasaCeiling.position,
        nasaCeiling.quaternion,
        nasaCeiling.scale
      );
      nasaCeiling.name = "NASA_Aerospace_Ceiling_Only";
      nasaCeiling.scale.x *= 1.35;
      nasaCeiling.scale.z *= 1.35;
      nasaCeiling.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.frustumCulled = false;
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        materials.forEach((material) => {
          material.side = THREE.DoubleSide;
          material.needsUpdate = true;
        });
      });
      envMesh.add(nasaCeiling);
    } else {
      console.warn("[Classroom] NASA aerospace ceiling was not found.");
    }

    // Keep the NASA classroom at its original three rows (15 seats). The two
    // experimental cloned rows are disabled for physical Quest stability.
    const enableAdditionalSeatRows = true;
    if (enableAdditionalSeatRows) {
    // The source classroom model contains three rows. Build two additional
    // tiered rows inside the existing large shell so the room supports 25
    // fixed seats while retaining generous clearance from the curved wall.
    for (let targetRow = 4; targetRow <= 5; targetRow += 1) {
      for (let column = 1; column <= 5; column += 1) {
        const suffix = String(column).padStart(2, "0");
        const sourceSeat = envMesh.getObjectByName(`Seat_R3_${suffix}`);

        if (!sourceSeat) {
          console.warn(`[Classroom] Could not build Seat_R${targetRow}_${suffix}.`);
          continue;
        }

        const seatName = `Seat_R${targetRow}_${suffix}`;
        const additionalRow = targetRow - 3;
        const seat = isPhysicalQuest
          ? new THREE.Group()
          : sourceSeat.clone(true);

        seat.name = seatName;
        seat.position.copy(sourceSeat.position);
        seat.quaternion.copy(sourceSeat.quaternion);
        if (!useNasaSeatVisuals) seat.rotateY(Math.PI);
        seat.scale.copy(sourceSeat.scale);
        seat.position.x *= 1 + additionalRow * 0.12;
        // Keep the two outside seats of the final row over its narrower tier.
        // The generic row expansion otherwise leaves them floating past the
        // left and right ends of Riser_Row5.
        if (targetRow === 5 && (column === 1 || column === 5)) {
          seat.position.x *= 0.72;
        }
        seat.position.y += additionalRow * 0.35;
        seat.position.z -= additionalRow * 1.15;
        seat.userData = {
          ...sourceSeat.userData,
          meta_spatial: {
            ...(sourceSeat.userData?.meta_spatial ?? {}),
            entity_id: seatName
          }
        };
        envMesh.add(seat);
        if (isPhysicalQuest) lightweightSeatAnchors.push(seat);
      }
    }

    if (
      isPhysicalQuest &&
      !useNasaSeatVisuals &&
      lightweightSeatAnchors.length > 0
    ) {
      const seatParts = [
        {
          name: "QuestSeatCushions",
          geometry: new THREE.BoxGeometry(0.72, 0.14, 0.68),
          material: new THREE.MeshStandardMaterial({
            color: 0x13243d,
            roughness: 0.55,
            metalness: 0.25
          }),
          position: new THREE.Vector3(0, 0.62, 0)
        },
        {
          name: "QuestSeatBacks",
          geometry: new THREE.BoxGeometry(0.72, 0.78, 0.14),
          material: new THREE.MeshStandardMaterial({
            color: 0x13243d,
            roughness: 0.55,
            metalness: 0.25
          }),
          position: new THREE.Vector3(0, 1.04, 0.28)
        },
        {
          name: "QuestSeatPedestals",
          geometry: new THREE.CylinderGeometry(0.13, 0.2, 0.55, 8),
          material: new THREE.MeshStandardMaterial({
            color: 0xe7eef8,
            roughness: 0.38,
            metalness: 0.55
          }),
          position: new THREE.Vector3(0, 0.28, 0)
        }
      ];

      seatParts.forEach((part) => {
        const instances = new THREE.InstancedMesh(
          part.geometry,
          part.material,
          lightweightSeatAnchors.length
        );
        const localMatrix = new THREE.Matrix4().makeTranslation(
          part.position.x,
          part.position.y,
          part.position.z
        );
        lightweightSeatAnchors.forEach((anchor, index) => {
          anchor.updateMatrix();
          const instanceMatrix = anchor.matrix.clone().multiply(localMatrix);
          instances.setMatrixAt(index, instanceMatrix);
        });
        instances.instanceMatrix.needsUpdate = true;
        instances.name = part.name;
        instances.frustumCulled = false;
        envMesh.add(instances);
      });

      console.log(
        `[Classroom] Quest optimization active: ${lightweightSeatAnchors.length} added seats use 3 instanced draw calls.`
      );
    }

    // Clone the third-row riser to create a proper step below each new row.
    // The later step is slightly narrower to follow the curved rear wall.
    const sourceRiser = envMesh.getObjectByName("Riser_Row3");
    if (sourceRiser) {
      for (let targetRow = 4; targetRow <= 5; targetRow += 1) {
        const additionalRow = targetRow - 3;
        const riser = sourceRiser.clone(true);
        const riserName = `Riser_Row${targetRow}`;

        riser.name = riserName;
        riser.position.copy(sourceRiser.position);
        riser.position.y += additionalRow * 0.35;
        riser.position.z -= additionalRow * 1.15;
        riser.scale.copy(sourceRiser.scale);
        riser.scale.x *= targetRow === 4 ? 0.92 : 0.82;
        riser.userData = {
          ...sourceRiser.userData,
          meta_spatial: {
            ...(sourceRiser.userData?.meta_spatial ?? {}),
            entity_id: riserName
          }
        };
        envMesh.add(riser);
      }
    } else {
      console.warn("[Classroom] Could not build the additional tiered risers.");
    }
    }

    ["Riser_Row2", "Riser_Row3", "Riser_Row4", "Riser_Row5"].forEach(
      (riserName) => applySimpleFloorMaterial(envMesh.getObjectByName(riserName) ?? null)
    );

    // Keep this named group for presentation/challenge visibility handling,
    // but do not add outer tier panels. The previous end-cap geometry looked
    // like detached floating walls when viewed from the side.
    const tierEndCaps = new THREE.Group();
    tierEndCaps.name = "NASA_Sealed_Tier_Ends";
    scene.add(tierEndCaps);

    // Follow the real curved front edge of each riser. A straight accent bar
    // floats beyond a curved tier at both ends, so derive a lightweight tube
    // path directly from each riser's top-front geometry.
    envMesh.updateWorldMatrix(true, true);
    const tierRisers = ["Riser_Row2", "Riser_Row3", "Riser_Row4", "Riser_Row5"]
      .map((name) => envMesh.getObjectByName(name))
      .filter((riser): riser is THREE.Object3D => Boolean(riser));
    if (tierRisers.length > 0) {
      const accentMaterial = new THREE.MeshBasicMaterial({
        color: 0x35cfee,
        toneMapped: false
      });
      const tierAccents = new THREE.Group();
      tierAccents.name = "NASA_Tier_Edge_Accents";
      const envInverse = envMesh.matrixWorld.clone().invert();

      tierRisers.forEach((riser, riserIndex) => {
        riser.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(riser);

        const candidates: THREE.Vector3[] = [];
        riser.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh || !mesh.geometry) return;
          const positions = mesh.geometry.getAttribute("position");
          if (!positions) return;
          for (let index = 0; index < positions.count; index += 1) {
            const point = new THREE.Vector3()
              .fromBufferAttribute(positions, index)
              .applyMatrix4(mesh.matrixWorld);
            if (point.y >= bounds.max.y - 0.035) candidates.push(point);
          }
        });

        const binCount = 32;
        const frontByBin = new Map<number, THREE.Vector3>();
        const width = Math.max(0.001, bounds.max.x - bounds.min.x);
        candidates.forEach((point) => {
          const bin = Math.min(
            binCount - 1,
            Math.max(0, Math.floor(((point.x - bounds.min.x) / width) * binCount))
          );
          const existing = frontByBin.get(bin);
          if (!existing || point.z > existing.z) frontByBin.set(bin, point);
        });

        const curvePoints = [...frontByBin.entries()]
          .sort(([left], [right]) => left - right)
          .map(([, point]) =>
            point.clone().setY(bounds.max.y + 0.014).applyMatrix4(envInverse)
          );
        if (curvePoints.length < 3) return;

        const curve = new THREE.CatmullRomCurve3(
          curvePoints,
          false,
          "centripetal"
        );
        const accent = new THREE.Mesh(
          new THREE.TubeGeometry(curve, 40, 0.016, 4, false),
          accentMaterial
        );
        accent.name = `NASA_Tier_Edge_Accent_${riserIndex + 2}`;
        accent.frustumCulled = false;
        tierAccents.add(accent);
      });
      envMesh.add(tierAccents);
    }

    // One small curved floor light gives a restrained holographic accent
    // without a full grid, texture, animation, or additional light source.
    const floorBounds = envMesh.getObjectByName("Floor")
      ? new THREE.Box3().setFromObject(envMesh.getObjectByName("Floor")!)
      : null;
    if (floorBounds) {
      envMesh.updateWorldMatrix(true, true);
      const floorEnvInverse = envMesh.matrixWorld.clone().invert();
      const floorCenter = floorBounds.getCenter(new THREE.Vector3());
      const floorArcGroup = new THREE.Group();
      floorArcGroup.name = "NASA_Simple_Curved_Floor_Lights";
      const floorArcMaterial = new THREE.LineBasicMaterial({
        color: 0x42ddff,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
        toneMapped: false
      });
      [1.25, 2.05, 2.85].forEach((radius, arcIndex) => {
        const arcPoints: THREE.Vector3[] = [];
        for (let segment = 0; segment <= 32; segment += 1) {
          const angle = THREE.MathUtils.lerp(-1.12, 1.12, segment / 32);
          arcPoints.push(
            new THREE.Vector3(
              floorCenter.x + Math.sin(angle) * radius,
              floorBounds.max.y + 0.018,
              floorCenter.z + 1.25 + Math.cos(angle) * radius
            ).applyMatrix4(floorEnvInverse)
          );
        }
        const floorArc = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(arcPoints),
          floorArcMaterial
        );
        floorArc.name = `NASA_Curved_Floor_Light_${arcIndex + 1}`;
        floorArc.renderOrder = 2;
        floorArc.frustumCulled = false;
        floorArcGroup.add(floorArc);
      });
      envMesh.add(floorArcGroup);
    }

    if (useNasaSeatVisuals) {
      const nasaSeat = nasaSeatAsset.scene.getObjectByName("Seat_R3_03");
      const targetSeats: THREE.Object3D[] = [];

      for (let row = 1; row <= 5; row += 1) {
        for (let column = 1; column <= 5; column += 1) {
          const seatName = `Seat_R${row}_${String(column).padStart(2, "0")}`;
          const targetSeat = envMesh.getObjectByName(seatName);
          if (targetSeat) {
            targetSeat.visible = false;
            targetSeats.push(targetSeat);
          }
        }
      }

      if (!nasaSeat || targetSeats.length !== 25) {
        console.warn(
          `[Classroom] NASA seat replacement incomplete: source=${Boolean(nasaSeat)}, targets=${targetSeats.length}.`
        );
      } else {
        nasaSeatAsset.scene.updateWorldMatrix(true, true);
        envMesh.updateWorldMatrix(true, true);

        const nasaSeatInverse = nasaSeat.matrixWorld.clone().invert();
        const envInverse = envMesh.matrixWorld.clone().invert();
        let seatPartIndex = 0;

        nasaSeat.traverse((object) => {
          const sourceMesh = object as THREE.Mesh;
          if (!sourceMesh.isMesh || !sourceMesh.geometry || !sourceMesh.material) {
            return;
          }

          const relativePartMatrix = nasaSeatInverse
            .clone()
            .multiply(sourceMesh.matrixWorld);
          const instances = new THREE.InstancedMesh(
            sourceMesh.geometry,
            sourceMesh.material,
            targetSeats.length
          );

          targetSeats.forEach((targetSeat, index) => {
            targetSeat.updateWorldMatrix(true, false);
            const instanceMatrix = envInverse
              .clone()
              .multiply(targetSeat.matrixWorld)
              .multiply(relativePartMatrix);
            instances.setMatrixAt(index, instanceMatrix);
          });

          instances.instanceMatrix.needsUpdate = true;
          instances.frustumCulled = false;
          instances.name = `NASASeatInstances_${seatPartIndex}`;
          seatPartIndex += 1;
          envMesh.add(instances);
        });

        console.log(
          `[Classroom] Replaced 25 traditional seats with ${seatPartIndex} instanced NASA seat parts.`
        );
      }
    }

    console.log("===== CLASSROOM OBJECTS START =====");
    envMesh.traverse((object) => {
      console.log("[Classroom Object]", object.name || "(no name)", object.type);
    });
    console.log("===== CLASSROOM OBJECTS END =====");

    // ========================================================
    // CHALLENGE 2 USES THE 360 ENVIRONMENT; OTHER QUIZZES STAY IN CLASS
    // ========================================================

    let challenge2Panorama: THREE.Mesh | null = null;
    let challenge2SavedVisibility: { classroom: boolean; tiers: boolean } | null = null;
    const setChallenge2PanoramaVisible = (visible: boolean): void => {
      if (visible) {
        if (!challenge2Panorama) {
          const texture = new THREE.TextureLoader().load(
            "./textures/quiz/quick-challenge-space-360-enhanced.png"
          );
          texture.colorSpace = THREE.SRGBColorSpace;
          challenge2Panorama = new THREE.Mesh(
            new THREE.SphereGeometry(40, 48, 32),
            new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide })
          );
          challenge2Panorama.name = "Challenge2Panorama";
          scene.add(challenge2Panorama);
        }
        if (!challenge2SavedVisibility) {
          challenge2SavedVisibility = { classroom: envMesh.visible, tiers: tierEndCaps.visible };
        }
        challenge2Panorama.visible = true;
        envMesh.visible = false;
        tierEndCaps.visible = false;
      } else {
        if (challenge2Panorama) challenge2Panorama.visible = false;
        if (challenge2SavedVisibility) {
          envMesh.visible = challenge2SavedVisibility.classroom;
          tierEndCaps.visible = challenge2SavedVisibility.tiers;
          challenge2SavedVisibility = null;
        }
      }
    };

    window.addEventListener(
      "quickChallengeVisibilityChanged",
      ((event: CustomEvent<{ visible?: boolean; challengeType?: string }>) => {
        if (!isStudent) return;
        const visible = Boolean(event.detail?.visible);
        const isChallenge2 = event.detail?.challengeType === "challenge-2";
        if (isChallenge2) setChallenge2PanoramaVisible(visible);
        setSeatMarkerTheme(isChallenge2 && visible ? "astronaut" : "default");
        setSeatMarkersForcedVisible(visible);
        if (visible) showAllMarkers();
      }) as EventListener
    );

    // Hide the large box beside the instructor
    const podium = envMesh.getObjectByName("Podium");
    if (podium) {
      podium.visible = false;
      podium.traverse((child) => {
        child.visible = false;
      });
      console.log("[Classroom] Podium hidden.");
    } else {
      console.warn("[Classroom] Podium object was not found.");
    }

    envMesh.position.set(0, 0, 0);
    envMesh.updateWorldMatrix(true, true);
    envMesh.name = "theater_classroom2";

    // Match the NASA theme from VRClass-AI. The GLB contains flat window
    // surfaces; applying cropped sections of one Earth/galaxy image keeps the
    // panorama continuous without stretching it across each window bay.
    if (envMesh.getObjectByName("NASA_Instructor_Command_Stage")) {
      const nasaWindowViewUrl =
        "./textures/nasa/nasa-earth-galaxy-window-v3.png";
      new THREE.TextureLoader().load(
      nasaWindowViewUrl,
      (windowViewSource) => {
        windowViewSource.colorSpace = THREE.SRGBColorSpace;
        windowViewSource.wrapS = THREE.ClampToEdgeWrapping;
        windowViewSource.wrapT = THREE.ClampToEdgeWrapping;

        envMesh.traverse((object) => {
          if (
            object.name.startsWith("Observation_Window") ||
            object.name.startsWith("Window_Backdrop") ||
            object.name.startsWith("Panorama_Glass") ||
            object.name.startsWith("Panorama_Space_Backdrop")
          ) {
            object.visible = false;
            return;
          }

          if (
            !object.name.startsWith("Window_Panorama_Surface") &&
            !object.name.startsWith("Panorama_Image_Surface")
          ) {
            return;
          }

          const windowTexture = windowViewSource.clone();
          windowTexture.needsUpdate = true;

          if (object.name.startsWith("Window_Panorama_Surface")) {
            const bayMatch = object.parent?.name.match(/NASA_Wall_Bay_(\d+)/);
            const bayIndex = bayMatch ? Number(bayMatch[1]) - 1 : 0;
            const cropWidth = 0.126;
            windowTexture.repeat.set(cropWidth, 1);
            windowTexture.offset.set(
              (bayIndex / 12) * (1 - cropWidth),
              0
            );
          } else {
            windowTexture.repeat.set(0.99, 1);
            windowTexture.offset.set(0.005, 0);
          }

          object.position.z = 0.105;
          object.visible = true;
          (object as THREE.Mesh).material = new THREE.MeshBasicMaterial({
            map: windowTexture,
            color: 0xffffff,
            side: THREE.DoubleSide,
            toneMapped: false
          });
        });
      },
      undefined,
      (error) => console.error(
        "[NASA Classroom] Could not load the space-window texture:",
        error
      )
      );
    }

    // ========================================================
    // FIND INSTRUCTOR STAGE POSITION
    // ========================================================

    const instructorAnchor = envMesh.getObjectByName("InstructorAvatar_Anchor");
    const instructorStagePosition = new THREE.Vector3(0, 0, -3);

    if (instructorAnchor) {
      instructorAnchor.getWorldPosition(instructorStagePosition);
      console.log("[Instructor] Anchor found:", instructorStagePosition);
    } else {
      console.warn("[Instructor] InstructorAvatar_Anchor was not found. Using fallback position.");
    }

    // ========================================================
    // REGISTER COMPONENTS
    // ========================================================

    world
      .registerComponent(SeatComponent)
      .registerComponent(ProjectorScreenComponent)
      .registerComponent(Challenge2Device);

    // ========================================================
    // REGISTER SYSTEMS
    // ========================================================

    world
      .registerSystem(PanelSystem, { priority: 1 })
      .registerSystem(ProjectorScreenSystem, { priority: 3 })
      .registerSystem(PresentationSystem, { priority: 4 });

    const studentRaiseHandEnabled = false;

    if (isStudent) {
      world
        .registerSystem(SeatSystem, { priority: 2 })
        .registerSystem(StudentResultSystem, { priority: 10 })
        .registerSystem(QuickChallengeSystem, { priority: 11 })
        .registerSystem(Challenge2System, { priority: 12 });

      if (studentRaiseHandEnabled) {
        world.registerSystem(RaiseHandSystem, { priority: 7 });
        (window as any).RaiseHandSystem = world.getSystem(RaiseHandSystem);
      }
      console.log("[Systems] Student systems registered.");
    } else {
      world
        .registerSystem(InstructorDashboardSystem, { priority: 8 })
        .registerSystem(RaiseHandNotificationSystem, { priority: 9 });
      console.log("[Systems] Instructor mode active.");
    }

    // ========================================================
    // CREATE CLASSROOM ENVIRONMENT
    // ========================================================

    world
      .createTransformEntity(envMesh)
      .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC })
      .addComponent(ProjectorScreenComponent, { scene: envMesh });

    // ========================================================
    // POSITION INSTRUCTOR PLAYER
    // ========================================================

    function positionInstructorOnStage(): void {
      if (!isInstructor) return;

      const playerObject = (player as any)?.object3D ?? (player as any);
      if (!playerObject) {
        console.error("[Instructor] Could not access the player transform.");
        return;
      }

      playerObject.position.copy(instructorStagePosition);
      // Use the successful headset placement in both physical XR and the
      // browser VR emulator so the instructor starts in the same location.
      playerObject.position.z += 0.1;
      playerObject.rotation.y = 0;
      playerObject.updateMatrixWorld(true);

      console.log("[Instructor] Position:", playerObject.position.x.toFixed(2), playerObject.position.y.toFixed(2), playerObject.position.z.toFixed(2));
    }

    function faceInstructorTowardStudents(): void {
      if (!isInstructor) return;

      const playerObject = (player as any)?.object3D ?? (player as any);
      if (!playerObject) {
        console.error("[Instructor] Player transform unavailable.");
        return;
      }

      playerObject.rotation.y = 0;
      playerObject.updateMatrixWorld(true);
      console.log("[Instructor] Facing toward students (positive Z)");
    }

    function prepareInstructorView(): void {
      if (!isInstructor) return;
      positionInstructorOnStage();
      requestAnimationFrame(() => {
        camera.updateMatrixWorld(true);
        faceInstructorTowardStudents();
      });
    }

    requestAnimationFrame(() => prepareInstructorView());
    setTimeout(() => prepareInstructorView(), 500);

    renderer.xr.addEventListener("sessionstart", () => {
      console.log("[Instructor] XR session started.");
      [300, 600, 1000, 1500, 2000].forEach((delay) => {
        setTimeout(() => {
          console.log(`[Instructor] Re-applying position (${delay}ms)`);
          prepareInstructorView();
        }, delay);
      });
    });

    // ========================================================
    // PANEL ENTITIES
    // ========================================================

    let panelEntity: any = null;
    let hintEntity: any = null;
    let raiseHandEntity: any = null;
    let notificationEntity: any = null;
    let transitionEntity: any = null;
    let studentResultEntity: any = null;
    let studentBoardViewButtonEntity: any = null;
    let quickChallengeEntity: any = null;

    // ========================================================
    // STUDENT LIST AND SEAT MARKERS
    // ========================================================

    socket.on("studentList", (students) => {
      console.log("[Index] Received student list:", students.length);
      updateSeatMarkers(students, scene, envMesh);
    });
    socket.emit("requestStudentList");

    // ========================================================
    // GLOBAL UI FLAGS
    // ========================================================

    (window as any).isMenuOpen = false;
    (window as any).isPresentationOpen = false;
    // Startup controller hints are intentionally disabled. Student controls
    // are ready together as soon as the classroom UI is created.
    (window as any).isHintVisible = false;
    (window as any).isRaiseHandReady = isStudent;

    // ========================================================
    // MARKER VISIBILITY LOOP
    // ========================================================

    function updateMarkersLoop(): void {
      if (player) {
        if (
          (window as any).isMenuOpen &&
          !(window as any).isPresentationOpen
        ) {
          hideAllMarkers();
        } else {
          // Physical head rotation lives on the XR camera, not necessarily on
          // the locomotion rig. Use it when deciding whether seats are ahead.
          updateMarkerVisibility(camera);
        }
      }
      requestAnimationFrame(updateMarkersLoop);
    }
    updateMarkersLoop();

    // ========================================================
    // STUDENT SEAT-SELECTION PANEL (DISABLED)
    // ========================================================
    panelEntity = { object3D: null };
    console.log("[Seat Panel] Disabled - using SeatAssignmentSystem");

    if (isStudent) {
      // Presentation, briefing, challenge, and classroom assets already live in
      // the same WebXR world. Switching modes does not require a loading page.
      // Run the transition action immediately so a decorative overlay cannot
      // remain visible or intercept mouse/controller input if an asset stalls.
      transitionEntity = { object3D: null };
      (window as any).performEnvironmentTransition =
        async (action: () => void): Promise<void> => {
          action();
        };
    }

    if (isStudent) {
      studentResultEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, {
          config: "./ui/student-result-panel.json",
          maxWidth: 1.8,
          maxHeight: 1.5
        })
        .addComponent(RayInteractable);

      if (studentResultEntity.object3D) {
        camera.add(studentResultEntity.object3D);
        studentResultEntity.object3D.pointerEvents = "none";
        studentResultEntity.object3D.pointerEventsOrder = 70000;
        studentResultEntity.object3D.position.set(0, -0.03, -1.45);
        studentResultEntity.object3D.visible = false;
        studentResultEntity.object3D.frustumCulled = false;
      }

      (window as any).studentResultEntity =
        studentResultEntity;

      studentBoardViewButtonEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, {
          config: "./ui/student-board-view-button.json",
          maxWidth: 0.48,
          maxHeight: 0.24
        })
        .addComponent(RayInteractable);
      if (studentBoardViewButtonEntity.object3D) {
        camera.add(studentBoardViewButtonEntity.object3D);
        // Browser fallback: keep the complete icon inside the lower-left view.
        studentBoardViewButtonEntity.object3D.position.set(-0.46, -0.28, -1.12);
        studentBoardViewButtonEntity.object3D.scale.setScalar(1);
        studentBoardViewButtonEntity.object3D.visible = true;
        studentBoardViewButtonEntity.object3D.pointerEvents = "auto";
        studentBoardViewButtonEntity.object3D.pointerEventsOrder = 71000;
        studentBoardViewButtonEntity.object3D.frustumCulled = false;
      }
      (window as any).studentBoardViewButtonEntity = studentBoardViewButtonEntity;
      (window as any).isStudentBoardViewAvailable = true;
    }

    const attachStudentBoardButton = (): void => {
      const button = studentBoardViewButtonEntity?.object3D as
        THREE.Object3D | undefined;
      if (!isStudent || !button) return;
      const leftRay = world.player?.raySpaces?.left;
      const useController = renderer.xr.isPresenting && Boolean(leftRay);
      const parent = useController ? leftRay! : camera;
      if (button.parent !== parent) parent.add(button);
      if (useController) {
        // Float just above and forward of the left controller without sitting
        // directly on its ray, so the trigger remains comfortable to use.
        button.position.set(0, 0.095, -0.2);
        // UIKit already inherits the target-ray orientation. Adding a half
        // roll here made the Screen label appear upside down in the headset.
        button.rotation.set(0, 0, 0);
        button.scale.setScalar(0.8);
      } else {
        // Mirror the Raise Hand HUD position so both controls have the same
        // apparent size, height, and distance from the student.
        button.position.set(-0.46, -0.28, -1.12);
        button.rotation.set(0, 0, 0);
        button.scale.setScalar(1);
      }
      button.updateMatrixWorld(true);
    };
    (window as any).refreshStudentBoardButton = attachStudentBoardButton;
    if (isStudent) requestAnimationFrame(() => attachStudentBoardButton());

    if (isStudent) {
      quickChallengeEntity = world
        .createTransformEntity(undefined, { persistent: true })
        .addComponent(PanelUI, {
          config: "./ui/quick-challenge.json",
          maxWidth: 1.75,
          maxHeight: 1.35
        })
        .addComponent(RayInteractable);

      if (quickChallengeEntity.object3D) {
        const panel = quickChallengeEntity.object3D;
        scene.add(panel);
        panel.pointerEventsOrder = 50000;
        // Positioned in front of the student when the challenge opens.
        // Its scene parent keeps it stationary after placement.
        panel.updateMatrixWorld(true);
        quickChallengeEntity.object3D.visible = false;
        quickChallengeEntity.object3D.frustumCulled = false;
      }

      (window as any).quickChallengeEntity = quickChallengeEntity;
    }

    // ========================================================
    // STUDENT RAISE-HAND PANEL
    // ========================================================

    if (isStudent && studentRaiseHandEnabled) {
      raiseHandEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, { config: "./ui/raise-hand-button.json", maxHeight: 0.24, maxWidth: 0.48 })
        .addComponent(RayInteractable)
        .addComponent(PanelSystemComponent, { scene: envMesh });

      const raiseHandObject = raiseHandEntity.object3D;
      if (raiseHandObject) {
        const positionRaiseHandForMode = (presentationMode: boolean) => {
          const rightRay = world.player?.raySpaces?.right;
          const useController = renderer.xr.isPresenting && Boolean(rightRay);
          if (useController) {
            // Match the Screen control exactly on the opposite controller.
            // Both controls now have the same height, distance, scale, and
            // upright orientation in a physical headset.
            rightRay!.add(raiseHandObject);
            raiseHandObject.position.set(0, 0.095, -0.2);
            raiseHandObject.rotation.set(0, 0, 0);
            raiseHandObject.scale.setScalar(0.8);
          } else if (presentationMode) {
            camera.add(raiseHandObject);
            // Keep the complete control inside the lower-right black media
            // bar. The former 1.28 scale straddled the image edge and made
            // the circle appear detached from its labels.
            raiseHandObject.position.set(0.58, -0.45, -1.18);
            raiseHandObject.rotation.set(0, 0, 0);
            raiseHandObject.scale.setScalar(0.96);
          } else {
            camera.add(raiseHandObject);
            // Classroom HUD: float beside the student's right controller.
            raiseHandObject.position.set(0.46, -0.28, -1.12);
            raiseHandObject.rotation.set(0, 0, 0);
            raiseHandObject.scale.setScalar(1);
          }
          raiseHandObject.updateMatrixWorld(true);
        };
        (window as any).positionStudentRaiseHand = positionRaiseHandForMode;
        positionRaiseHandForMode(false);
        raiseHandObject.pointerEventsOrder = 60000;
        raiseHandObject.visible = true;
        raiseHandObject.frustumCulled = false;
      }
      console.log("[Raise Hand] Created for student.");
    }

    // ========================================================
    // INSTRUCTOR MENU ICON
    // ========================================================

    let instructorMenuButtonEntity: any = null;
    let instructorMenuButtonObject: THREE.Object3D | null = null;
    (window as any).isInstructorMenuButtonReady = false;

    if (isInstructor) {
      console.log("[Instructor Menu] Creating menu icon...");
      instructorMenuButtonEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, { config: "./ui/instructor-menu-button.json", maxWidth: 0.2, maxHeight: 0.2 })
        .addComponent(RayInteractable);

      instructorMenuButtonObject = instructorMenuButtonEntity.object3D ?? null;
      if (instructorMenuButtonObject) {
        instructorMenuButtonObject.name = "InstructorMenuButton";
        // Do not expose an inactive visual before UIKit has connected its
        // first-click handler.
        instructorMenuButtonObject.visible = false;
        instructorMenuButtonObject.frustumCulled = false;
        (window as any).instructorMenuButtonObject = instructorMenuButtonObject;
        console.log("[Instructor Menu] Menu entity created.");
      }
    }

    function attachInstructorMenuToCamera(): void {
      if (!isInstructor || !instructorMenuButtonObject) return;

      const dashboardOpen =
        Boolean(
          (window as any)
            .isInstructorDashboardOpen
        );
      const presentationOpen = Boolean((window as any).isPresentationOpen);
      const presentationTransitionInProgress = Boolean(
        (window as any).isPresentationTransitionInProgress
      );
      const anotherInstructorPanelOpen =
        Boolean(
          (window as any)
            .isInstructorLabMonitorOpen
        ) ||
        Boolean(
          (window as any)
            .isInstructorQuizMonitorOpen
        ) ||
        Boolean(
          (window as any)
            .isInstructorMistakesOpen
        ) ||
        Boolean((window as any).isInstructorDebriefChoiceOpen);
      const targetParent =
        renderer.xr.isPresenting &&
        !dashboardOpen &&
        !presentationOpen &&
        !presentationTransitionInProgress &&
        !anotherInstructorPanelOpen
          ? world.player.raySpaces.right
          : camera;

      if (instructorMenuButtonObject.parent !== targetParent) {
        targetParent.add(instructorMenuButtonObject);
      }

      if (targetParent === camera) {
        instructorMenuButtonObject.position.set(
          0.42,
          dashboardOpen ||
          anotherInstructorPanelOpen
            ? -100
            : -0.22,
          -0.85
        );
        instructorMenuButtonObject.rotation.set(0, 0, 0);
        instructorMenuButtonObject.scale.set(1, 1, 1);
      } else {
        // Keep the button just above and slightly in front of the
        // physical right controller so it does not overlap the model.
        instructorMenuButtonObject.position.set(0, 0.08, -0.22);
        // The IWSDK target-ray space keeps the panel aligned with
        // the controller's pointing direction on physical hardware.
        instructorMenuButtonObject.rotation.set(0, 0, 0);
        instructorMenuButtonObject.scale.set(0.8, 0.8, 0.8);
      }

      instructorMenuButtonObject.visible =
        Boolean((window as any).isInstructorMenuButtonReady) &&
        !dashboardOpen &&
        !presentationOpen &&
        !presentationTransitionInProgress &&
        !anotherInstructorPanelOpen;
      instructorMenuButtonObject.pointerEvents =
        instructorMenuButtonObject.visible ? "auto" : "none";
      instructorMenuButtonObject.pointerEventsOrder = 65000;
      instructorMenuButtonObject.updateMatrix();
      instructorMenuButtonObject.updateMatrixWorld(true);
      console.log(
        "[Instructor Menu] Attached to",
        targetParent === camera
          ? "camera"
          : "IWSDK right controller ray"
      );
    }

    (window as any).refreshInstructorMenuButton = attachInstructorMenuToCamera;

    if (isInstructor) {
      requestAnimationFrame(() => attachInstructorMenuToCamera());
      setTimeout(() => attachInstructorMenuToCamera(), 500);
    }

    renderer.xr.addEventListener("sessionstart", () => {
      if (!isInstructor) return;
      console.log("[Instructor Menu] XR session started.");

      const session =
        renderer.xr.getSession();

      session?.addEventListener(
        "selectstart",
        (event: XRInputSourceEvent) => {
          if (
            event.inputSource
              .handedness !== "right" ||
            !instructorMenuButtonObject
              ?.visible ||
            Boolean(
              (window as any)
                .isInstructorDashboardOpen
            )
          ) {
            return;
          }

          // RT opens the menu just like selecting the
          // floating Dashboard button. While the menu is
          // open, RT remains available for normal ray input.
          (
            window as any
          ).setInstructorDashboardOpen?.(
            true
          );
        }
      );

      session?.addEventListener(
        "selectstart",
        (event: XRInputSourceEvent) => {
          if (
            event.inputSource
              .handedness !== "left" ||
            !Boolean(
              (window as any)
                .isInstructorLabMonitorAvailable
            ) ||
            Boolean(
              (window as any)
                .isInstructorLabMonitorOpen
            ) ||
            Boolean(
              (window as any)
                .isInstructorDashboardOpen
            )
          ) {
            return;
          }

          (
            window as any
          ).setInstructorLabMonitorOpen?.(
            true
          );
        }
      );

      [300, 700, 1200, 2000].forEach((delay) => {
        setTimeout(() => attachInstructorMenuToCamera(), delay);
      });
    });

    renderer.xr.addEventListener("sessionstart", () => {
      if (!isStudent) return;
      requestAnimationFrame(() => attachStudentBoardButton());
      [250, 600, 1000].forEach(delay => {
        setTimeout(() => {
          attachStudentBoardButton();
          (window as any).positionStudentRaiseHand?.(
            Boolean((window as any).isPresentationOpen)
          );
        }, delay);
      });
      const session = renderer.xr.getSession();
      session?.addEventListener("selectstart", (event: XRInputSourceEvent) => {
        if (
          event.inputSource.handedness === "left" &&
          Boolean((window as any).isStudentBoardViewAvailable)
        ) {
          (window as any).toggleStudentBoardView?.();
        }
      });
    });

    renderer.xr.addEventListener("sessionend", () => {
      if (isInstructor) {
        requestAnimationFrame(() => attachInstructorMenuToCamera());
      }
      if (isStudent) {
        requestAnimationFrame(() => {
          attachStudentBoardButton();
          (window as any).positionStudentRaiseHand?.(
            Boolean((window as any).isPresentationOpen)
          );
        });
      }
    });

    // ========================================================
    // INSTRUCTOR DASHBOARD
    // ========================================================

    let instructorDashboardEntity: any = null;
    let instructorDashboardObject: THREE.Object3D | null = null;
    let instructorDebriefChoiceEntity: any = null;
    let instructorDebriefChoiceObject: THREE.Object3D | null = null;
    let instructorLabMonitorEntity: any = null;
    let instructorLabMonitorObject: THREE.Object3D | null = null;
    let instructorLabMonitorButtonEntity: any = null;
    let instructorLabMonitorButtonObject: THREE.Object3D | null = null;
    let instructorMistakesEntity: any = null;
    let instructorMistakesObject: THREE.Object3D | null = null;
    let instructorSaveReportEntity: any = null;
    let instructorQuizMonitorEntity: any = null;
    let instructorQuizMonitorObject: THREE.Object3D | null = null;
    let instructorVideoControlsEntity: any = null;
    // Capture the headset pose when a large instructor panel opens, then keep
    // the panel under the scene. It opens in front of the instructor but does
    // not continue following later headset movement or rotation.
    const positionLargeInstructorPanel = (
      panel: THREE.Object3D,
      scale: number,
      verticalOffset: number,
      distance: number
    ): void => {
      camera.updateMatrixWorld(true);
      const cameraPosition = new THREE.Vector3();
      const cameraQuaternion = new THREE.Quaternion();
      camera.getWorldPosition(cameraPosition);
      camera.getWorldQuaternion(cameraQuaternion);
      const cameraRelativeOffset = new THREE.Vector3(
        0,
        verticalOffset,
        -distance
      ).applyQuaternion(cameraQuaternion);

      if (panel.parent !== world.scene) {
        world.scene.add(panel);
      }
      panel.position.copy(cameraPosition).add(cameraRelativeOffset);
      panel.quaternion.copy(cameraQuaternion);
      panel.scale.setScalar(scale);
      panel.updateMatrixWorld(true);
    };

    const setLargeInstructorPanelInteractive = (
      panel: THREE.Object3D,
      interactive: boolean
    ): void => {
      panel.pointerEvents = interactive ? "auto" : "none";
      panel.traverse((child: any) => {
        child.pointerEvents = interactive ? "auto" : "none";
      });
    };

    const hideLargeInstructorPanel = (panel: THREE.Object3D): void => {
      setLargeInstructorPanelInteractive(panel, false);
      panel.visible = false;
      // IWSDK ray targets can outlive Three.js visibility changes. Moving the
      // hidden target away guarantees it cannot sit in front of the open panel.
      panel.position.set(0, -100, 0);
      panel.updateMatrixWorld(true);
    };

    const showLargeInstructorPanel = (
      panel: THREE.Object3D,
      scale: number,
      verticalOffset: number,
      distance: number
    ): void => {
      positionLargeInstructorPanel(panel, scale, verticalOffset, distance);
      panel.visible = true;
      setLargeInstructorPanelInteractive(panel, true);
      panel.updateMatrixWorld(true);
    };

    if (isInstructor) {
      instructorVideoControlsEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, {
          config: "./ui/instructor-video-controls.json",
          maxWidth: 3.0,
          maxHeight: 0.34
        })
        .addComponent(RayInteractable);

      if (instructorVideoControlsEntity.object3D) {
        // Keep video controls fixed in the presentation room. Parenting them
        // to the camera made the panel move whenever the headset turned.
        world.scene.add(instructorVideoControlsEntity.object3D);
        instructorVideoControlsEntity.object3D.position.set(0, -100, 3.35);
        instructorVideoControlsEntity.object3D.rotation.set(0, Math.PI, 0);
        instructorVideoControlsEntity.object3D.pointerEventsOrder = 15000;
        instructorVideoControlsEntity.object3D.visible = false;
        instructorVideoControlsEntity.object3D.frustumCulled = false;
        (window as any).instructorVideoControlsObject =
          instructorVideoControlsEntity.object3D;
      }

      instructorSaveReportEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, {
          config: "./ui/instructor-save-report.json",
          maxWidth: 1.4,
          maxHeight: 0.65
        });

      if (instructorSaveReportEntity.object3D) {
        camera.add(instructorSaveReportEntity.object3D);
        instructorSaveReportEntity.object3D.position.set(0, 0, -1.3);
        instructorSaveReportEntity.object3D.visible = false;
        instructorSaveReportEntity.object3D.frustumCulled = false;
      }

      instructorDashboardEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, { config: "./ui/instructor-menu.json", maxWidth: 2.7, maxHeight: 2.4 })
        .addComponent(RayInteractable);

      instructorDashboardObject = instructorDashboardEntity.object3D ?? null;
      if (instructorDashboardObject) {
        positionLargeInstructorPanel(instructorDashboardObject, 1.12, -0.12, 2.6);
        instructorDashboardObject.pointerEventsOrder = 1000;
        instructorDashboardObject.renderOrder = 10000;
        hideLargeInstructorPanel(instructorDashboardObject);
        instructorDashboardObject.frustumCulled = false;
        instructorDashboardObject.updateMatrixWorld(true);
        console.log("[Instructor Dashboard] Created and hidden.");
      }

      instructorDebriefChoiceEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, {
          config: "./ui/instructor-debrief-choice.json",
          maxWidth: 2.35,
          maxHeight: 1.35
        })
        .addComponent(RayInteractable);

      instructorDebriefChoiceObject =
        instructorDebriefChoiceEntity.object3D ?? null;
      if (instructorDebriefChoiceObject) {
        world.scene.add(instructorDebriefChoiceObject);
        instructorDebriefChoiceObject.position.set(0, -100, 0);
        instructorDebriefChoiceObject.pointerEvents = "none";
        instructorDebriefChoiceObject.pointerEventsOrder = 14000;
        // Keep the static UIKit tree alive offscreen so its text geometry is
        // fully built before the first time the instructor opens it.
        instructorDebriefChoiceObject.visible = true;
        instructorDebriefChoiceObject.frustumCulled = false;
      }

      (window as any).isInstructorDebriefChoiceOpen = false;
      (window as any).setInstructorDebriefChoiceOpen = (open: boolean): void => {
        if (!instructorDebriefChoiceObject) return;
        (window as any).isInstructorDebriefChoiceOpen = open;
        if (open) {
          showLargeInstructorPanel(instructorDebriefChoiceObject, 1, -0.12, 2.25);
          instructorDebriefChoiceObject.pointerEventsOrder = 14000;
        } else {
          setLargeInstructorPanelInteractive(instructorDebriefChoiceObject, false);
          instructorDebriefChoiceObject.position.set(0, -100, 0);
          instructorDebriefChoiceObject.updateMatrixWorld(true);
        }
        attachInstructorMenuToCamera();
      };

      instructorQuizMonitorEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, {
          config: "./ui/instructor-quiz-monitor.json",
          maxWidth: 2.8,
          maxHeight: 2.45
        })
        .addComponent(RayInteractable);

      instructorQuizMonitorObject =
        instructorQuizMonitorEntity.object3D ?? null;

      if (instructorQuizMonitorObject) {
        positionLargeInstructorPanel(instructorQuizMonitorObject, 1, -0.32, 2.85);
        instructorQuizMonitorObject.pointerEventsOrder = 13000;
        hideLargeInstructorPanel(instructorQuizMonitorObject);
        instructorQuizMonitorObject.frustumCulled = false;
      }

      (window as any).isInstructorQuizMonitorOpen = false;
      (window as any).setInstructorQuizMonitorOpen = (open: boolean): void => {
        if (!instructorQuizMonitorObject) return;

        (window as any).isInstructorQuizMonitorOpen = open;
        if (open) {
          showLargeInstructorPanel(instructorQuizMonitorObject, 1, -0.32, 2.85);
        } else {
          hideLargeInstructorPanel(instructorQuizMonitorObject);
        }
        instructorQuizMonitorObject.pointerEventsOrder = 13000;
        instructorQuizMonitorObject.traverse((child: any) => {
          child.pointerEventsOrder = 13001;
        });
        instructorQuizMonitorObject.updateMatrixWorld(true);

        if (open && instructorQuizMonitorEntity) {
          // The monitor is built while hidden. Refresh its IWSDK ray target
          // after opening so Stop, X, Up, and Down are reachable in a headset.
          instructorQuizMonitorEntity.removeComponent(RayInteractable);
          instructorQuizMonitorEntity.addComponent(RayInteractable);
          requestAnimationFrame(() => {
            instructorQuizMonitorObject?.updateMatrixWorld(true);
          });
        }

        if (open && instructorDashboardObject) {
          isInstructorDashboardOpen = false;
          (window as any).isInstructorDashboardOpen = false;
          hideLargeInstructorPanel(instructorDashboardObject);
        }

        if (open && instructorLabMonitorObject) {
          (window as any).isInstructorLabMonitorOpen = false;
          hideLargeInstructorPanel(instructorLabMonitorObject);
        }

        if (open && instructorMistakesObject) {
          (window as any).isInstructorMistakesOpen = false;
          hideLargeInstructorPanel(instructorMistakesObject);
        }

        // Refresh the shared floating Results launcher. It must not sit on
        // top of the live challenge monitor, but should return after X closes
        // the monitor.
        (window as any).setInstructorLabMonitorAvailable?.(
          Boolean((window as any).isInstructorLabMonitorAvailable)
        );

        attachInstructorMenuToCamera();
        (window as any).refreshInstructorHandNotification?.();
      };
    }

    if (isInstructor) {
      instructorLabMonitorEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, {
          config: "./ui/instructor-lab-monitor.json",
          maxWidth: 2.8,
          maxHeight: 2.45
        })
        .addComponent(RayInteractable);

      instructorLabMonitorObject =
        instructorLabMonitorEntity.object3D ?? null;

      if (instructorLabMonitorObject) {
        positionLargeInstructorPanel(instructorLabMonitorObject, 1, -0.32, 2.85);
        instructorLabMonitorObject.pointerEventsOrder = 11000;
        hideLargeInstructorPanel(instructorLabMonitorObject);
        instructorLabMonitorObject.frustumCulled = false;
      }

      instructorLabMonitorButtonEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, {
          config: "./ui/instructor-lab-monitor-button.json",
          maxWidth: 0.2,
          maxHeight: 0.2
        })
        .addComponent(RayInteractable);

      instructorLabMonitorButtonObject =
        instructorLabMonitorButtonEntity.object3D ?? null;

      if (instructorLabMonitorButtonObject) {
        camera.add(instructorLabMonitorButtonObject);
        instructorLabMonitorButtonObject.position.set(-0.38, -100, -0.9);
        instructorLabMonitorButtonObject.scale.set(0.8, 0.8, 0.8);
        instructorLabMonitorButtonObject.visible = false;
        instructorLabMonitorButtonObject.frustumCulled = false;
      }

      instructorMistakesEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, {
          config: "./ui/instructor-mistakes.json",
          maxWidth: 2.8,
          maxHeight: 2.55
        })
        .addComponent(RayInteractable);

      instructorMistakesObject =
        instructorMistakesEntity.object3D ?? null;

      if (instructorMistakesObject) {
        positionLargeInstructorPanel(instructorMistakesObject, 1, -0.32, 2.85);
        instructorMistakesObject.pointerEventsOrder = 12000;
        hideLargeInstructorPanel(instructorMistakesObject);
        instructorMistakesObject.frustumCulled = false;
      }

      (window as any).setInstructorMistakesOpen =
        (open: boolean): void => {
          if (!instructorMistakesObject) return;
          (window as any).isInstructorMistakesOpen = open;
          instructorMistakesObject.pointerEventsOrder = 12000;
          if (open) {
            showLargeInstructorPanel(instructorMistakesObject, 1, -0.32, 2.85);
          } else {
            hideLargeInstructorPanel(instructorMistakesObject);
          }

          if (instructorLabMonitorObject) {
            const showLabMonitor =
              !open && Boolean((window as any).isInstructorLabMonitorOpen);
            if (showLabMonitor) {
              showLargeInstructorPanel(instructorLabMonitorObject, 1, -0.32, 2.85);
            } else {
              hideLargeInstructorPanel(instructorLabMonitorObject);
            }
          }

          if (open && instructorDashboardObject) {
            isInstructorDashboardOpen = false;
            (window as any).isInstructorDashboardOpen = false;
            hideLargeInstructorPanel(instructorDashboardObject);
          }

          if (open && instructorQuizMonitorObject) {
            (window as any).isInstructorQuizMonitorOpen = false;
            hideLargeInstructorPanel(instructorQuizMonitorObject);
          }

          attachInstructorMenuToCamera();
          (window as any).refreshInstructorHandNotification?.();
        };

      (window as any).isInstructorLabMonitorOpen = false;
      (window as any).isInstructorLabMonitorAvailable = false;

      (window as any).setInstructorLabMonitorAvailable =
        (available: boolean): void => {
          (window as any).isInstructorLabMonitorAvailable = available;
          if (!instructorLabMonitorButtonObject) return;

          const targetParent =
            renderer.xr.isPresenting
              ? world.player.raySpaces.left
              : camera;

          if (
            instructorLabMonitorButtonObject.parent !==
            targetParent
          ) {
            targetParent.add(
              instructorLabMonitorButtonObject
            );
          }

          if (targetParent === camera) {
            instructorLabMonitorButtonObject.position.set(
              -0.38,
              available &&
              !(window as any).isInstructorLabMonitorOpen &&
              !(window as any).isInstructorQuizMonitorOpen
                ? -0.2
                : -100,
              -0.9
            );
          } else {
            instructorLabMonitorButtonObject.position.set(
              0,
              available &&
              !(window as any).isInstructorLabMonitorOpen &&
              !(window as any).isInstructorQuizMonitorOpen
                ? 0.08
                : -100,
              -0.22
            );
          }

          instructorLabMonitorButtonObject.rotation.set(
            0,
            0,
            0
          );
          instructorLabMonitorButtonObject.scale.set(
            0.8,
            0.8,
            0.8
          );
          instructorLabMonitorButtonObject.visible =
            available &&
            !(window as any).isInstructorLabMonitorOpen &&
            !(window as any).isInstructorQuizMonitorOpen;
          instructorLabMonitorButtonObject.updateMatrixWorld(
            true
          );
        };

      (window as any).setInstructorLabMonitorOpen =
        (open: boolean): void => {
          if (!instructorLabMonitorObject) return;

          (window as any).isInstructorLabMonitorOpen = open;
          instructorLabMonitorObject.pointerEventsOrder = 11000;
          if (open) {
            showLargeInstructorPanel(instructorLabMonitorObject, 1, -0.32, 2.85);
          } else {
            hideLargeInstructorPanel(instructorLabMonitorObject);
          }

          if (open && instructorDashboardObject) {
            isInstructorDashboardOpen = false;
            (window as any).isInstructorDashboardOpen = false;
            hideLargeInstructorPanel(instructorDashboardObject);
          }

          if (open && instructorMistakesObject) {
            (window as any).isInstructorMistakesOpen = false;
            hideLargeInstructorPanel(instructorMistakesObject);
          }

          if (open && instructorQuizMonitorObject) {
            (window as any).isInstructorQuizMonitorOpen = false;
            hideLargeInstructorPanel(instructorQuizMonitorObject);
          }

          if (instructorMenuButtonObject) {
            attachInstructorMenuToCamera();
          }

          if (instructorLabMonitorButtonObject) {
            const targetParent =
              open
                ? camera
                : renderer.xr.isPresenting
                  ? world.player.raySpaces.left
                  : camera;

            if (
              instructorLabMonitorButtonObject.parent !==
              targetParent
            ) {
              targetParent.add(
                instructorLabMonitorButtonObject
              );
            }

            if (
              targetParent === camera
            ) {
              instructorLabMonitorButtonObject.position.set(
                -0.38,
                open ? -100 : -0.2,
                -0.9
              );
            } else {
              instructorLabMonitorButtonObject.position.set(
                0,
                0.08,
                -0.22
              );
            }

            instructorLabMonitorButtonObject.rotation.set(
              0,
              0,
              0
            );
            instructorLabMonitorButtonObject.visible =
              !open &&
              Boolean(
                (window as any).isInstructorLabMonitorAvailable
              );
            instructorLabMonitorButtonObject.updateMatrixWorld(true);
          }

          (window as any).refreshInstructorHandNotification?.();
        };
    }

    // ========================================================
    // INSTRUCTOR DASHBOARD STATE
    // ========================================================

    let isInstructorDashboardOpen = false;
    (window as any).isInstructorDashboardOpen = false;

    function setInstructorDashboardOpen(open: boolean): void {
      if (!isInstructor || !instructorDashboardObject) return;

      // A controller trigger can remain active after selecting Emergency
      // Return. Ignore attempts to open the large dashboard until the entire
      // doorway transfer—not merely its environment swap—has completed.
      if (
        open &&
        (Boolean((window as any).isPresentationOpen) ||
          Boolean((window as any).isPresentationTransitionInProgress))
      ) {
        hideLargeInstructorPanel(instructorDashboardObject);
        return;
      }

      isInstructorDashboardOpen = open;
      (window as any).isInstructorDashboardOpen = open;

      if (open && instructorLabMonitorObject) {
        (window as any).isInstructorLabMonitorOpen = false;
        hideLargeInstructorPanel(instructorLabMonitorObject);
      }

      if (open && instructorQuizMonitorObject) {
        (window as any).isInstructorQuizMonitorOpen = false;
        hideLargeInstructorPanel(instructorQuizMonitorObject);
      }

      if (open && instructorMistakesObject) {
        (window as any).isInstructorMistakesOpen = false;
        hideLargeInstructorPanel(instructorMistakesObject);
      }

      // Capture a world-space pose directly in front of the current headset.
      // Because the panel remains a scene child, it stays there after opening.
      if (open) {
        showLargeInstructorPanel(instructorDashboardObject, 1.12, -0.12, 2.6);
      } else {
        hideLargeInstructorPanel(instructorDashboardObject);
      }
      instructorDashboardObject.pointerEventsOrder = 10000;
      instructorDashboardObject.renderOrder = 10000;
      instructorDashboardObject.frustumCulled = false;
      instructorDashboardObject.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        materials.forEach((material) => {
          material.depthTest = false;
          material.depthWrite = false;
          material.needsUpdate = true;
        });
        mesh.renderOrder = 10000;
      });

      if (instructorMenuButtonObject) {
        // When open, move the hidden launcher away from the right
        // controller ray so it cannot intercept menu selections.
        // When closed, attach it back to the right controller.
        attachInstructorMenuToCamera();
      }

      if (instructorLabMonitorButtonObject) {
        instructorLabMonitorButtonObject.visible =
          !open &&
          Boolean(
            (window as any).isInstructorLabMonitorAvailable
          );
        instructorLabMonitorButtonObject.updateMatrixWorld(true);
      }
      instructorDashboardObject.updateMatrixWorld(true);
      (window as any).refreshInstructorHandNotification?.();
      console.log("[Instructor Dashboard]", open ? "Opened" : "Closed");
    }

    function toggleInstructorDashboard(): void {
      setInstructorDashboardOpen(!isInstructorDashboardOpen);
    }

    (window as any).setInstructorDashboardOpen = setInstructorDashboardOpen;
    (window as any).socket = socket;
    (window as any).toggleInstructorDashboard = toggleInstructorDashboard;

    // ========================================================
    // RAISE HAND NOTIFICATION PANEL (Instructor Only)
    // ========================================================

    if (isInstructor) {
      notificationEntity = world
        .createTransformEntity()
        .addComponent(PanelUI, { config: "./ui/raise-hand-notification.json", maxWidth: 1.9, maxHeight: 0.28 })
        .addComponent(RayInteractable)
        .addComponent(PanelSystemComponent, { scene: envMesh });

      const notificationObject = notificationEntity.object3D;
      if (notificationObject) {
        // This is a compact transient alert rather than a large dashboard.
        // Keep it in the instructor's view so it cannot remain behind the
        // projector after a challenge/environment transition.
        camera.add(notificationObject);
        notificationObject.position.set(0, -0.31, -1.08);
        notificationObject.rotation.set(0, 0, 0);
        notificationObject.scale.setScalar(0.88);
        notificationObject.pointerEventsOrder = 60000;
        notificationObject.visible = false;
        notificationObject.frustumCulled = false;
        notificationObject.traverse((object: any) => {
          object.renderOrder = 2100;
          const materials = object.material
            ? (Array.isArray(object.material) ? object.material : [object.material])
            : [];
          materials.forEach((material: THREE.Material) => {
            material.depthTest = false;
            material.depthWrite = false;
            material.needsUpdate = true;
          });
        });
        notificationObject.updateMatrixWorld(true);
        console.log("[Notification] Panel created and hidden.");
      }
      console.log("[Notification] Panel created for instructor.");
    }

    // ========================================================
    // EXPOSE PRESENTATION SYSTEM
    // ========================================================

    const presentationSystem = world.getSystem(PresentationSystem);
    if (presentationSystem) {
      presentationSystem.initializeClassroomSideScreens();
      (window as any).presentationSystem = presentationSystem;
      console.log("[Index] PresentationSystem exposed globally");
    }

    // ========================================================
    // LISTEN FOR MODE CHANGES
    // ========================================================

    if (isStudent) {
      socket.on("modeChanged", (data: { mode: string; destination: string }) => {
        console.log(`[Student] 📢 Mode changed to: ${data.mode} (${data.destination})`);

        const modeIndicator = document.getElementById("mode-indicator");
        if (modeIndicator) {
          const modeIcons: { [key: string]: string } = {
            "Classroom Mode": "🏫",
            "Presentation Mode": "📽️",
            "Game Mode": "🎮"
          };
          const icon = modeIcons[data.mode] || "📱";
          modeIndicator.textContent = `${icon} ${data.mode}`;
        }

        if ((window as any).RaiseHandSystem) {
          (window as any).currentMode = data.mode;
        }

        // PresentationSystem owns this transition because it also receives
        // assetPath/mediaType. Entering here can race that metadata and cause
        // an image debrief to be treated as an ordinary video on Quest.
      });

      socket.on("studentModeChanged", (data: { studentId: string; mode: string; destination: string; name: string; seat: string }) => {
        console.log(`[Student] 📢 ${data.name} mode changed to: ${data.mode}`);
      });

    }

    const labEnvironmentManager = isStudent
      ? new LabEnvironmentManager(world, [
          envMesh,
          hintEntity?.object3D,
          raiseHandEntity?.object3D,
        ])
      : null;

    // ========================================================
    // DEBUGGING REFERENCES
    // ========================================================

    // The legacy left-controller classroom menu has been retired. Students
    // follow instructor-driven transitions and cannot navigate presentation
    // modes independently.
    (window as any).menuEntity = null;
    (window as any).instructorMenuButtonEntity = instructorMenuButtonEntity;
    (window as any).panelEntity = panelEntity;
    (window as any).hintEntity = hintEntity;
    (window as any).raiseHandEntity = raiseHandEntity;
    (window as any).notificationEntity = notificationEntity;
    (window as any).transitionEntity = transitionEntity;
    (window as any).studentResultEntity = studentResultEntity;
    (window as any).world = world;
    (window as any).player = player;
    // Retain a null compatibility reference for optional legacy visibility
    // checks; the instructor GLB and its environment entity no longer exist.
    (window as any).instructorMesh = null;
    (window as any).classroomMesh = envMesh;
    (window as any).positionInstructorOnStage = positionInstructorOnStage;
    (window as any).prepareInstructorView = prepareInstructorView;
    (window as any).instructorDashboardEntity = instructorDashboardEntity;
    (window as any).instructorDashboardObject = instructorDashboardObject;
    (window as any).instructorDebriefChoiceEntity = instructorDebriefChoiceEntity;
    (window as any).instructorDebriefChoiceObject = instructorDebriefChoiceObject;
    (window as any).instructorLabMonitorEntity = instructorLabMonitorEntity;
    (window as any).instructorLabMonitorObject = instructorLabMonitorObject;
    (window as any).instructorLabMonitorButtonEntity = instructorLabMonitorButtonEntity;
    (window as any).instructorLabMonitorButtonObject = instructorLabMonitorButtonObject;
    (window as any).instructorMistakesEntity = instructorMistakesEntity;
    (window as any).instructorMistakesObject = instructorMistakesObject;
    (window as any).toggleInstructorDashboard = toggleInstructorDashboard;
    (window as any).setInstructorDashboardOpen = setInstructorDashboardOpen;
    (window as any).labEnvironmentManager = labEnvironmentManager;

    // ========================================================
    // REMOVE STARTUP SCREEN
    // ========================================================

    if (startupMessage) {
      startupMessage.style.display = "none";
    }

    // Dispose the logo, UIKit panel, materials, and textures synchronously.
    // Window requestAnimationFrame is unreliable once Quest is presenting XR.
    envMesh.updateMatrixWorld(true);
    renderer.render(scene, camera);
    disposeVRLoginResources();

    console.log(`[Index] ✅ Application initialized for ${activeUser.role}: ${activeUser.username}`);
  })
  .catch((error) => {
    console.error("Failed to create world:", error);
    const startupMessage = document.getElementById("startup-message");
    if (startupMessage) {
      startupMessage.textContent = "Failed to start the VR classroom. Check the browser console.";
    }
  });
