/**
 * Legacy controller-attached classroom menu.
 * It listens for navigation actions, while the newer instructor workflow is
 * provided by InstructorMenuSystem.
 */
import {
  createSystem,
  PanelUI,
  PanelDocument,
  eq,
  UIKitDocument,
  Entity,
  Mesh,
  MeshBasicMaterial,
  BoxGeometry,
  BackSide,
} from "@iwsdk/core";

import { socket } from "../network/socket";

export class MenuSystem extends createSystem({
  menuPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "./ui/classroom-menu-vr.json")],
  },
}) {
  private menuRoot: any = null;
  private menuEntity: Entity | null = null;
  //private renderer: any = null;

  private initialized = false;
  private isOpen = false;
  private currentMode = "Classroom Mode";
  private blackRoom?: Mesh;
  private _inputContext: any = null;
  private _xButtonDebounce = false;
  private _lastToggleTime = 0;
  private savedPlayerPosition: any = null;
  private savedPlayerQuaternion: any = null;
  init() {
    console.log("[MenuSystem] started");

    //this.renderer = (this.world as any).renderer;
    this._inputContext = (this.world as any).input || (window as any).appInput;

    window.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() === "m" || event.key.toLowerCase() === "x") {
        this.toggleMenu();
      }
    });

    socket.on("modeChanged", (mode: string) => {
      this.currentMode = mode;
    });

    this.queries.menuPanel.subscribe("qualify", (entity) => {
      console.log(`[MenuSystem] Menu PanelUI qualified: ${entity.index}`);

      this.menuEntity = entity;

      let retries = 0;
      const MAX_RETRIES = 20;

      const tryInitMenu = () => {
        const document = PanelDocument.data?.document?.[entity.index] as UIKitDocument;

        if (!document) {
          if (retries++ < MAX_RETRIES) {
            setTimeout(tryInitMenu, 300);
          } else {
            console.error("[MenuSystem] Menu document not ready.");
          }
          return;
        }

        this.menuRoot = document.getElementById("vr-menu-container");

        if (!this.menuRoot) {
          if (retries++ < MAX_RETRIES) {
            setTimeout(tryInitMenu, 300);
          } else {
            console.error("[MenuSystem] vr-menu-container not found.");
          }
          return;
        }

        this.setupVRMenu(document);

        this.menuRoot.setProperties({
          visible: false,
          display: "none",
        });

        this.initialized = true;
        this.isOpen = false;

        console.log("[MenuSystem] VR menu ready.");
      };

      tryInitMenu();
    });
  }

  private setupVRMenu(document: UIKitDocument) {
   const itemIds = [
      "raisehand",
      "chat",
      "participants",
      "presentation",
      "microphone",
      "speaker",
      "settings",
      "exit"
    ];

    itemIds.forEach((id) => {
      const element = document.getElementById(`vr-menu-item-${id}`);

      if (element) {
        element.addEventListener("click", () => {
          console.log(`[MenuSystem] Clicked: ${id}`);
          this.handleVRAction(id);
        });
      }
    });

    const closeBtn = document.getElementById("vr-menu-close-btn");

    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        this.closeMenu();
      });
    }
  }

  update() {
    if (!this._inputContext) {
      this._inputContext = (this.world as any).input || (window as any).appInput;
    }

    const leftCtrl = this._inputContext?.xr?.gamepads?.left;
    if (!leftCtrl) return;

    let xPressed = false;

    if (typeof leftCtrl.getButtonDown === "function") {
      xPressed =
        leftCtrl.getButtonDown("x-button") ||
        leftCtrl.getButtonDown(3);
    }

    if (!xPressed && leftCtrl.buttons?.[3]) {
      const btn = leftCtrl.buttons[3];

      if (btn.pressed && !this._xButtonDebounce) {
        xPressed = true;
        this._xButtonDebounce = true;
      } else if (!btn.pressed) {
        this._xButtonDebounce = false;
      }
    }

    if (xPressed) {
      const now = Date.now();

      if (now - this._lastToggleTime > 300) {
        this._lastToggleTime = now;
        this.toggleMenu();
      }
    }
  }

  public toggleMenu() {
    if (!this.initialized || !this.menuRoot) {
      console.warn("[MenuSystem] Menu not ready yet.");
      return;
    }

    if (this.isOpen) {
      this.closeMenu();
    } else {
      this.openMenu();
    }
  }

private createBlackRoom() {
  if (this.blackRoom) return;

  const roomGeo = new BoxGeometry(30, 20, 30);
  const roomMat = new MeshBasicMaterial({
    color: 0x000000,
    side: BackSide,
  });

  this.blackRoom = new Mesh(roomGeo, roomMat);
  this.blackRoom.position.set(0, 0, 0);
  this.blackRoom.visible = false;

  this.world.scene.add(this.blackRoom);
}

private openMenu() {
  if (!this.menuRoot) return;

  const classroomMesh = (window as any).classroomMesh;
  const instructorMesh = (window as any).instructorMesh;

  this.createBlackRoom();

  this.isOpen = true;

  this.savedPlayerPosition = this.player.position.clone();
  this.savedPlayerQuaternion = this.player.quaternion.clone();
  (window as any).isMenuOpen = true;
  if (classroomMesh) classroomMesh.visible = false;
  if (instructorMesh) instructorMesh.visible = false;
  if (this.blackRoom) this.blackRoom.visible = true;

 this.player.position.set(0, 1.0, -1.8);
  this.player.quaternion.set(0, 1, 0, 0);

  const obj = this.menuEntity?.object3D;

  if (obj) {
    obj.position.set(0, 2.1, 2.6);
    obj.rotation.set(0, Math.PI, 0);
    obj.scale.set(4.25, 4.25, 4.25);
    obj.visible = true;
  }

  this.menuRoot.setProperties({
    visible: true,
    display: "flex",
  });

  console.log("[MenuSystem] Black menu mode opened");
}

private closeMenu() {
  if (!this.menuRoot) return;

  const classroomMesh = (window as any).classroomMesh;
  const instructorMesh = (window as any).instructorMesh;

  this.isOpen = false;
  (window as any).isMenuOpen = false;
  this.menuRoot.setProperties({
    visible: false,
    display: "none",
  });

  if (this.blackRoom) this.blackRoom.visible = false;

  if (this.savedPlayerPosition) {
    this.player.position.copy(this.savedPlayerPosition);
  }

  if (this.savedPlayerQuaternion) {
    this.player.quaternion.copy(this.savedPlayerQuaternion);
  }

    if (classroomMesh) classroomMesh.visible = true;
    if (instructorMesh) {
      instructorMesh.visible = !(window as any).isInstructor;
    }

  console.log("[MenuSystem] Returned to classroom");
}

  private handleVRAction(action: string) {
    console.log(`[MenuSystem] VR Action: ${action}`);

    this.closeMenu();

    switch (action) {
      case "teleport":
        socket.emit("teleportToStage");
        break;

      case "reset":
        socket.emit("resetView");
        break;

      case "audio":
        socket.emit("toggleAudio");
        break;

      case "scene":
        socket.emit("changeScene");
        break;

      case "seat":
        socket.emit("openSeatSelection");
        break;

      case "exit":
        socket.emit("exitVR");
        break;
    }
  }
}
