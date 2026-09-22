/**
 * Student raise/lower-hand control.
 * Goal: expose a reachable button in classroom, presentation, and briefing
 * modes and send the state to server.ts by Socket.IO. Supports mouse and ray.
 */

import {
  AssetManager,
  createSystem,
  PanelDocument
} from "@iwsdk/core";

import * as THREE from "three";
import { socket } from "../network/socket";

type UIKitElement = any;

export class RaiseHandSystem extends createSystem({}) {
  private circleElement: UIKitElement = null;
  private rootElement: UIKitElement = null;
  private labelElement: UIKitElement = null;
  private statusElement: UIKitElement = null;

  private handModel: THREE.Object3D | null = null;
  private modelContainer: THREE.Object3D | null = null;

  private isRaised = false;
  private isEnabled = false;
  private destroyed = false;
  private isRTTriggerPressed = false;
  private isMuted = false; // ✅ Track mute state
  private resultCooldown = false;
  private quickChallengeOpen = false;
  private lastActivationAt = 0;

  init(): void {
    console.log("[RaiseHandSystem] Initializing");

    // ✅ Store reference to this instance
    (window as any).RaiseHandSystem = this;
    (window as any).resetStudentRaiseHandAfterResult =
      this.resetAfterResult;

    this.isEnabled = Boolean((window as any).isRaiseHandReady);

    window.addEventListener("hintFinished", this.onHintFinished);
    window.addEventListener(
      "quickChallengeVisibilityChanged",
      this.onQuickChallengeVisibilityChanged as EventListener
    );

    // ✅ Listen for hand updates from server
    socket.on("raiseHandUpdated", this.onRaiseHandUpdated);
    
    // ✅ Listen for instructor toggling hand
    socket.on("handToggled", this.onHandToggled);
    

    this.waitForRaiseHandEntity();
  }

  private waitForRaiseHandEntity(): void {
    let attempts = 0;
    const maximumAttempts = 300;

    const check = (): void => {
      if (this.destroyed) {
        return;
      }

      attempts++;

      const entity = (window as any).raiseHandEntity;

      if (!entity || !entity.object3D) {
        if (attempts < maximumAttempts) {
          requestAnimationFrame(check);
        } else {
          console.error("[RaiseHandSystem] Raise Hand entity was not found");
        }
        return;
      }

      const panelDocument = entity.getComponent?.(PanelDocument);

      if (panelDocument) {
        this.connectPanel(panelDocument);
      }

      this.createHandModel(entity.object3D);
      this.updateVisibility();

      console.log("[RaiseHandSystem] Ready with 3D model");
    };

    requestAnimationFrame(check);
  }

  private connectPanel(panelDocument: any): void {
    const root = panelDocument.getRoot?.();

    if (!root) {
      console.error("[RaiseHandSystem] Panel root was not found");
      return;
    }

    this.rootElement = root.querySelector?.("#raise-hand-root") ?? root;
    this.circleElement = root.querySelector?.("#raise-hand-circle");
    this.labelElement = root.querySelector?.("#raise-hand-label");
    this.statusElement = root.querySelector?.("#raise-hand-status");

    if (!this.circleElement) {
      console.error('[RaiseHandSystem] Element "#raise-hand-circle" was not found');
      return;
    }

    // UIKit controller rays can emit pointerdown followed by click. Listen to
    // both for headset/browser compatibility and debounce the shared action.
    this.circleElement.addEventListener?.("click", this.onButtonClick);
    this.circleElement.addEventListener?.("pointerdown", this.onButtonClick);
    // Also accept the transparent panel area around the circle. This makes the
    // compact HUD forgiving to select with a desktop mouse without changing
    // the controller-ray target on the circular button itself.
    this.rootElement?.addEventListener?.("click", this.onButtonClick);
    this.rootElement?.addEventListener?.("pointerdown", this.onButtonClick);

    console.log("[RaiseHandSystem] UI click connected");
  }

  private createHandModel(panelObject: THREE.Object3D): void {
    const asset = AssetManager.getGLTF("raiseHandIcon");

    if (!asset) {
      console.error('[RaiseHandSystem] Asset "raiseHandIcon" was not loaded');
      return;
    }

    this.handModel = asset.scene.clone(true);
    this.handModel.name = "RaiseHandEmojiModel";

    // Find the container
    panelObject.traverse((child) => {
      if (child.isObject3D && child.name === 'raise-hand-model-container') {
        this.modelContainer = child;
        console.log("[RaiseHandSystem] ✅ Found model container:", child.name);
      }
    });

    // Add the hand to the container or panel
    if (this.modelContainer) {
      this.modelContainer.add(this.handModel);
      console.log("[RaiseHandSystem] Added hand to container");
    } else {
      panelObject.add(this.handModel);
      console.log("[RaiseHandSystem] Added hand to panel (fallback)");
    }

    // Keep the hand centered with comfortable padding inside the circular HUD.
    // The previous offset and scale pushed the fingers above the border.
    // The GLB origin is slightly left of the visible palm. Compensate for
    // that baked-in offset so the rendered hand—not only its origin—is
    // centered inside the circular button.
    this.handModel.position.set(-0.016, 0.014, 0.02);
    this.handModel.rotation.set(0, Math.PI, 0);
    this.handModel.scale.set(0.092, 0.092, 0.092);

    // Make materials look good
    this.handModel.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }

      child.castShadow = false;
      child.receiveShadow = false;
      child.renderOrder = 1000;
      child.frustumCulled = false;

      const sourceMaterials = Array.isArray(child.material)
        ? child.material
        : [child.material];

      // Use an unlit material for this HUD icon. A MeshStandardMaterial can
      // become black in a physical headset when the panel is outside the
      // useful range of the classroom lights.
      const hudMaterials = sourceMaterials.map((sourceMaterial) => {
        const source = sourceMaterial as THREE.MeshStandardMaterial;
        return new THREE.MeshBasicMaterial({
          color: 0xffffff,
          map: source.map ?? null,
          alphaMap: source.alphaMap ?? null,
          transparent: Boolean(source.transparent),
          opacity: source.opacity ?? 1,
          alphaTest: source.alphaTest ?? 0,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        });
      });

      child.material = Array.isArray(child.material)
        ? hudMaterials
        : hudMaterials[0];
    });

    console.log("[RaiseHandSystem] ✅ GLB hand placed inside circle");
  }

  private onButtonClick = (event?: any): void => {
    event?.stopPropagation?.();
    const now = Date.now();
    if (now - this.lastActivationAt < 350) return;
    this.lastActivationAt = now;
    console.log("[RaiseHandSystem] Click detected!");
    
    if (!this.isEnabled) {
      console.log("[RaiseHandSystem] Button is not enabled yet");
      return;
    }

    // ✅ If muted, don't allow hand raise
    if (this.isMuted) {
      console.log("[RaiseHandSystem] Student is muted - cannot raise hand");
      if (this.statusElement) {
        this.statusElement.textContent = "🔇 Muted - Cannot raise";
        this.statusElement.style.color = "rgba(239, 68, 68, 0.9)";
        setTimeout(() => {
          if (this.statusElement && !this.isRaised) {
            this.statusElement.textContent = "Select to raise";
            this.statusElement.style.color = "rgba(255, 255, 255, 0.4)";
          }
        }, 2000);
      }
      return;
    }

    this.isRaised = !this.isRaised;
    this.updateAppearance();

    socket.emit("raiseHand", {
      raised: this.isRaised
    });

    // Visual feedback
    this.showPulseFeedback();

    console.log(
      this.isRaised ? "[RaiseHandSystem] ✅ Hand RAISED" : "[RaiseHandSystem] ✅ Hand LOWERED"
    );
  };
private applyRaisedState(
  raised: boolean,
  source: string
): void {
  this.isRaised = raised;

  this.updateAppearance();
  this.showPulseFeedback();

  console.log(
    `[RaiseHandSystem] State from ${source}:`,
    raised
      ? "HAND RAISED"
      : "HAND LOWERED — default style restored"
  );
}
// ✅ Handle instructor toggling hand
private onHandToggled = (
  data: {
    studentId?: string;
    playerId?: string;
    raised: boolean;
    fromInstructor?: boolean;
  }
): void => {
  console.log(
    "[RaiseHandSystem] 🔔 handToggled event RECEIVED!",
    data
  );
  const targetId =
    data.studentId ??
    data.playerId ??
    "";

  // ✅ Get the current socket ID from multiple sources
  const currentSocketId = (window as any).socket?.id || socket.id;

 console.log(
    "[RaiseHandSystem] targetId:",
    targetId,
    "socket.id:",
    socket.id
  );

  if (!targetId) {
    console.warn(
      "[RaiseHandSystem] Hand update has no studentId or playerId."
    );
    return;
  }
   if (targetId !== socket.id) {
    console.log(
      "[RaiseHandSystem] Hand update belongs to another student. Ignoring."
    );
    return;
  }
  
  // ✅ Force update the hand state
  this.isRaised = Boolean(data.raised);
  this.updateAppearance();
  this.showPulseFeedback();

  console.log(
    `[RaiseHandSystem] ✅ Hand ${this.isRaised ? 'RAISED' : 'LOWERED'} by instructor`
  );
};

  // ✅ Handle mute update from instructor
  private onMuteUpdated = (data: { playerId: string; isMuted: boolean; name: string; seat: string }): void => {
    console.log(`[RaiseHandSystem] Mute updated: ${data.name} -> ${data.isMuted}`);
    
    const currentSocketId = (window as any).socket?.id || socket.id;
    
    if (data.playerId === currentSocketId) {
      this.isMuted = data.isMuted;
      this.updateMuteStatus();
    }
  };

  // ✅ Handle mute toggled from instructor
  private onMuteToggled = (data: { isMuted: boolean }): void => {
    console.log(`[RaiseHandSystem] Mute toggled by instructor: ${data.isMuted}`);
    this.isMuted = data.isMuted;
    this.updateMuteStatus();
  };

  // ✅ Update mute status in UI
  private updateMuteStatus(): void {
    if (this.statusElement) {
      if (this.isMuted) {
        this.statusElement.textContent = "🔇 Muted by instructor";
        this.statusElement.style.color = "rgba(239, 68, 68, 0.9)";
        // If hand was raised, lower it when muted
        if (this.isRaised) {
          this.isRaised = false;
          this.updateAppearance();
          socket.emit("raiseHand", { raised: false });
        }
      } else {
        this.statusElement.textContent = "Select to raise";
        this.statusElement.style.color = "rgba(255, 255, 255, 0.4)";
      }
    }
  }

  private showPulseFeedback(): void {
    if (!this.circleElement) return;

    if (this.isRaised) {
      this.circleElement.setAttribute('class', 'raise-hand-circle raised pulse');
      
      if (this.statusElement && !this.isMuted) {
        this.statusElement.textContent = "✋ Hand Raised!";
        this.statusElement.style.color = "rgba(255, 200, 0, 0.9)";
      }
    } else {
      this.circleElement.setAttribute('class', 'raise-hand-circle');
      
      if (this.statusElement && !this.isMuted) {
        this.statusElement.textContent = "Select to raise";
        this.statusElement.style.color = "rgba(255, 255, 255, 0.4)";
      }
    }

    setTimeout(() => {
      if (this.circleElement && this.isRaised) {
        this.circleElement.setAttribute('class', 'raise-hand-circle raised');
      }
    }, 1500);
  }

  private onHintFinished = (): void => {
    this.isEnabled = true;
    (window as any).isRaiseHandReady = true;
    this.updateVisibility();

    console.log("[RaiseHandSystem] Hint finished — button enabled");
  };

  private onQuickChallengeVisibilityChanged = (
    event: CustomEvent<{ visible?: boolean }>
  ): void => {
    this.quickChallengeOpen = Boolean(event.detail?.visible);
    this.updateVisibility();
  };

  private updateAppearance(): void {
    if (this.labelElement) {
      this.labelElement.textContent = this.isRaised ? "Lower Hand" : "Raise Hand";
    }

    if (this.circleElement) {
      if (this.isRaised) {
        this.circleElement.setAttribute('class', 'raise-hand-circle raised');
      } else {
        this.circleElement.setAttribute('class', 'raise-hand-circle');
      }
    }

    if (!this.handModel) {
      return;
    }

    const baseScale = 0.092;
    const scale = this.isRaised ? 0.104 : baseScale;
    this.handModel.scale.set(scale, scale, scale);

    this.handModel.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }

      const materials = Array.isArray(child.material) ? child.material : [child.material];

      for (const material of materials) {
        if (material instanceof THREE.MeshBasicMaterial) {
          material.color.setHex(this.isRaised ? 0xff8800 : 0xffffff);
        }
      }
    });
  }

  private updateVisibility(): void {
    const entity = (window as any).raiseHandEntity;
    const object = entity?.object3D;

    if (!object) {
      return;
    }

    const menuOpen = Boolean((window as any).isMenuOpen);
    const labActive = Boolean((window as any).isLabActive);
    const resultOpen = Boolean((window as any).isStudentResultOpen);

    object.visible =
      this.isEnabled &&
      !menuOpen &&
      !labActive &&
      !resultOpen &&
      !this.quickChallengeOpen &&
      !this.resultCooldown;

    if (object.visible) {
      this.restoreHandModel(object);
    }
  }

  /**
   * UIKit may rebuild the model container when the student result panel closes.
   * Reattach the existing GLB so the blue raise-hand button does not return empty.
   */
  private restoreHandModel(panelObject: THREE.Object3D): void {
    if (!this.handModel) {
      this.createHandModel(panelObject);
      return;
    }

    let currentContainer: THREE.Object3D | null = null;
    panelObject.traverse((child) => {
      if (child.name === "raise-hand-model-container") {
        currentContainer = child;
      }
    });

    const target = currentContainer ?? panelObject;
    if (this.handModel.parent !== target) {
      target.add(this.handModel);
      this.modelContainer = currentContainer;
    }

    this.handModel.visible = true;
  }

  private resetAfterResult = (): void => {
    this.isRaised = false;
    this.resultCooldown = true;
    this.updateAppearance();

    socket.emit("raiseHand", {
      raised: false
    });

    window.setTimeout(() => {
      this.resultCooldown = false;
      this.updateVisibility();
    }, 1500);
  };

 private onRaiseHandUpdated = (
  data: {
    playerId?: string;
    studentId?: string;
    raised: boolean;
    name?: string;
    seat?: string;
    fromInstructor?: boolean;
  }
): void => {
  const targetId =
    data.playerId ??
    data.studentId ??
    "";

  const currentSocketId = (window as any).socket?.id || socket.id;

  console.log(
    "[RaiseHandSystem] 📡 raiseHandUpdated received:",
    {
      data,
      targetId,
      currentSocketId,
      socketId: socket.id,
      fromInstructor: data.fromInstructor
    }
  );

  // ✅ Compare with both socket.id and window.socket.id
  const isForThisStudent = 
    targetId === socket.id || 
    targetId === (window as any).socket?.id;

  if (!targetId || !isForThisStudent) {
    console.log("[RaiseHandSystem] Not for this student, ignoring.");
    return;
  }

  // ✅ Force update the hand state
  this.isRaised = Boolean(data.raised);
  this.updateAppearance();
  this.showPulseFeedback();

  console.log(
    `[RaiseHandSystem] ✅ Hand state from server: ${this.isRaised ? 'RAISED' : 'LOWERED'}`
  );
};
  update(): void {
    if ((window as any).isRaiseHandReady) {
      this.isEnabled = true;
    }

    this.checkRTTrigger();
    this.updateVisibility();
  }

  private checkRTTrigger(): void {
    try {
      if ((window as any).isLabActive) {
        this.isRTTriggerPressed = false;
        return;
      }

      const rightCtrl = this.input?.xr?.gamepads?.right;
      
      if (rightCtrl) {
        const triggerPressed = rightCtrl.getButtonDown("xr-standard-trigger");
        
        if (triggerPressed && !this.isRTTriggerPressed) {
          this.isRTTriggerPressed = true;
          this.onButtonClick();
          console.log("[RaiseHandSystem] RT Trigger pressed - Toggling hand");
        }
        
        if (!triggerPressed) {
          this.isRTTriggerPressed = false;
        }
      }
    } catch (error) {
      // Silently handle if input is not available yet
    }
  }

  destroy(): void {
    this.destroyed = true;
    delete (window as any).resetStudentRaiseHandAfterResult;

    window.removeEventListener("hintFinished", this.onHintFinished);
    window.removeEventListener(
      "quickChallengeVisibilityChanged",
      this.onQuickChallengeVisibilityChanged as EventListener
    );

    socket.off("raiseHandUpdated", this.onRaiseHandUpdated);
    socket.off("handToggled", this.onHandToggled);
    socket.off("muteUpdated", this.onMuteUpdated);
    socket.off("muteToggled", this.onMuteToggled);

    if (this.circleElement) {
      this.circleElement.removeEventListener?.("click", this.onButtonClick);
      this.circleElement.removeEventListener?.("pointerdown", this.onButtonClick);
    }

    if (this.handModel?.parent) {
      this.handModel.parent.remove(this.handModel);
    }

    this.handModel = null;
    this.circleElement = null;
    this.labelElement = null;
    this.statusElement = null;
    this.modelContainer = null;
  }
}
