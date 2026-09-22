/**
 * Instructor raised-hand notification system.
 * Goal: listen for student hand state, display student name/seat, and let the
 * instructor lower the hand with mouse or controller ray.
 */

import {
  AssetManager,
  createSystem,
  PanelUI,
  PanelDocument,
  UIKitDocument,
  UIKit,
  eq,
  Entity
} from "@iwsdk/core";
import * as THREE from "three";
import { socket } from "../network/socket";
import { PanelSystemComponent } from "../panel";

interface RaiseHandNotification {
  playerId: string;
  raised: boolean;
  name?: string;
  seat?: string;
  isMuted?: boolean;
  fromInstructor?: boolean;
}

export class RaiseHandNotificationSystem extends createSystem({
  notificationPanel: {
    required: [
      PanelUI,
      PanelDocument,
      PanelSystemComponent
    ],

    where: [
      eq(
        PanelUI,
        "config",
        "./ui/raise-hand-notification.json"
      )
    ]
  }
}) {
  private notificationEntity?: Entity;
  private notificationDocument?: UIKitDocument;

  private studentNameElement: any = null;
  private messageElement: any = null;
  private seatElement: any = null;
  private iconElement: any = null;
  private titleElement: any = null;
  private notificationRoot: any = null;
  private unmuteButton: any = null;
  private cancelButton: any = null;

  private currentStudentId = "";
  private currentStudentName = "";
  private currentStudentSeat = "";
  private notificationHandModel: THREE.Object3D | null = null;
  /*
   * An event may arrive shortly before the UIKit document
   * finishes qualifying. Save it and display it afterward.
   */
  private pendingNotification:
    RaiseHandNotification | null = null;

  init(): void {
    console.log(
      "[RaiseHandNotification] Initializing"
    );

    (window as any).refreshInstructorHandNotification =
      this.refreshVisibility;

    socket.on(
      "raiseHandUpdated",
      this.onRaiseHandUpdated
    );

    this.queries.notificationPanel.subscribe(
      "qualify",
      this.onPanelQualified
    );
  }

  // ========================================================
  // PANEL READY
  // ========================================================

  private onPanelQualified = (
    entity: Entity
  ): void => {
    console.log(
      "[RaiseHandNotification] Panel qualified"
    );

    const document =
      PanelDocument.data.document[
        entity.index
      ] as UIKitDocument;

    if (!document) {
      console.error(
        "[RaiseHandNotification] No UIKit document found."
      );
      return;
    }

    this.notificationEntity = entity;
    this.notificationDocument = document;

    this.studentNameElement =
      document.getElementById(
        "notification-student-name"
      );

    this.messageElement =
      document.getElementById(
        "notification-message"
      );

    this.seatElement =
      document.getElementById(
        "notification-seat"
      );

    this.iconElement =
      document.getElementById(
        "notification-icon"
      );

    this.titleElement =
      document.getElementById(
        "notification-title"
      );

    this.notificationRoot =
      document.getElementById(
        "raise-hand-notification-root"
      );

    this.unmuteButton =
      document.getElementById(
        "notification-unmute"
      );

    this.cancelButton =
      document.getElementById(
        "notification-cancel"
      );

    console.log(
      "[RaiseHandNotification] Elements:",
      {
        studentName:
          Boolean(this.studentNameElement),
        message:
          Boolean(this.messageElement),
        seat:
          Boolean(this.seatElement),
        unmute:
          Boolean(this.unmuteButton),
        cancel:
          Boolean(this.cancelButton)
      }
    );
    // The compact banner uses a lightweight UIKit hand glyph. Avoid adding a
    // second GLB to the camera HUD during video playback.
    this.unmuteButton?.addEventListener(
      "click",
      this.onUnmuteClick
    );
    this.unmuteButton?.addEventListener(
      "pointerdown",
      this.onUnmuteClick
    );

    this.cancelButton?.addEventListener(
      "click",
      this.onCancelClick
    );

    if (entity.object3D) {
      entity.object3D.visible = false;
      entity.object3D.frustumCulled = false;
      entity.object3D.updateMatrixWorld(true);
    }

    console.log(
      "[RaiseHandNotification] UI connected."
    );

    if (this.pendingNotification) {
      const pending =
        this.pendingNotification;

      this.pendingNotification = null;
      this.processRaiseHandUpdate(pending);
    }
  };

  private createNotificationHandIcon(
  panelObject: THREE.Object3D
): void {
  if (this.notificationHandModel) {
    return;
  }

  const asset =
    AssetManager.getGLTF("raiseHandIcon");

  if (!asset) {
    console.error(
      '[RaiseHandNotification] Asset "raiseHandIcon" was not loaded.'
    );
    return;
  }

  this.notificationHandModel =
    asset.scene.clone(true);

  this.notificationHandModel.name =
    "NotificationRaiseHandIcon";

  /*
   * Because the panel is attached to the camera,
   * these values are relative to the notification panel.
   *
   * Adjust these three values slightly if needed.
   */
  this.notificationHandModel.position.set(
    -0.57,
    0.16,
    0.03
  );

  this.notificationHandModel.rotation.set(
    0,
    Math.PI,
    0
  );

  this.notificationHandModel.scale.set(
    0.1,
    0.1,
    0.1
  );

  this.notificationHandModel.traverse(
    (child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }

      child.renderOrder = 2000;
      child.frustumCulled = false;

      const materials =
        Array.isArray(child.material)
          ? child.material
          : [child.material];

      for (const material of materials) {
        material.depthTest = false;
        material.depthWrite = false;
        material.needsUpdate = true;

                // ✅ Make the hand glow yellow/gold
        if (material instanceof THREE.MeshStandardMaterial) {
          material.emissive.setHex(0xfbbf24);
          material.emissiveIntensity = 0.5;}

      }
    }
  );

  panelObject.add(
    this.notificationHandModel
  );

  console.log(
    "[RaiseHandNotification] Hand icon added."
  );
}
  // ========================================================
  // SOCKET EVENT
  // ========================================================

  private onRaiseHandUpdated = (
    data: RaiseHandNotification
  ): void => {
    console.log(
      "[RaiseHandNotification] Received:",
      data
    );

    if (!this.notificationDocument) {
      console.warn(
        "[RaiseHandNotification] Panel is not ready. Saving notification."
      );

      this.pendingNotification = data;
      return;
    }

    this.processRaiseHandUpdate(data);
  };

  private processRaiseHandUpdate(
    data: RaiseHandNotification
  ): void {
    if (!data?.playerId) {
      console.warn(
        "[RaiseHandNotification] Missing playerId:",
        data
      );
      return;
    }

    if (!data.raised) {
      /*
       * Only hide this panel when the lowered-hand event
       * belongs to the student currently displayed.
       */
      if (
        data.playerId ===
        this.currentStudentId
      ) {
        this.hideNotification();
      }

      return;
    }

    if (
      data.playerId.startsWith("demo-")
    ) {
      return;
    }

    this.currentStudentId =
      data.playerId;

    this.currentStudentName =
      data.name?.trim() ||
      "Student";

    this.currentStudentSeat =
      data.seat?.trim() ||
      "Not selected";

    this.showNotification();
  }

  // ========================================================
  // SHOW
  // ========================================================

  private showNotification(): void {
    if (
      !this.notificationEntity?.object3D ||
      !this.notificationDocument
    ) {
      console.warn(
        "[RaiseHandNotification] Panel is unavailable."
      );
      return;
    }

    this.setText(
      this.studentNameElement,
      `✋ ${this.currentStudentName} · ${this.currentStudentSeat} raised their hand`
    );

    this.setText(
      this.messageElement,
      ""
    );

    this.setText(
      this.seatElement,
      ""
    );

    this.setText(
      this.iconElement,
      ""
    );

    this.setText(
      this.titleElement,
      ""
    );

    this.refreshVisibility();

    this.notificationEntity.object3D
      .updateMatrixWorld(true);

    this.refreshDocument();

    console.log(
      `[RaiseHandNotification] Showing ${this.currentStudentName}, seat ${this.currentStudentSeat}`
    );
  }

  // ========================================================
  // HIDE
  // ========================================================

  private hideNotification(): void {
    if (this.notificationEntity?.object3D) {
      this.notificationEntity.object3D.visible =
        false;

      this.notificationEntity.object3D
        .updateMatrixWorld(true);
    }

    this.currentStudentId = "";
    this.currentStudentName = "";
    this.currentStudentSeat = "";
    this.notificationRoot?.classList.add(
      "notification-input-disabled"
    );

    console.log(
      "[RaiseHandNotification] Hidden"
    );
  }

  private refreshVisibility = (): void => {
    if (!this.notificationEntity?.object3D) {
      return;
    }

    // A raised hand is urgent classroom information. Keep this compact HUD
    // visible even while a dashboard or live monitor is open.
    const shouldShow = Boolean(this.currentStudentId);

    // Environment transitions can re-parent or move scene-owned UI. Restore
    // this compact alert to the instructor camera every time it is displayed.
    const notificationObject = this.notificationEntity.object3D;
    if (shouldShow && notificationObject.parent !== this.camera) {
      this.camera.add(notificationObject);
      notificationObject.position.set(0, -0.31, -1.08);
      notificationObject.rotation.set(0, 0, 0);
      notificationObject.scale.setScalar(0.88);
    }

    notificationObject.visible = shouldShow;

    if (shouldShow) {
      this.notificationRoot?.classList.remove(
        "notification-input-disabled"
      );
    } else {
      this.notificationRoot?.classList.add(
        "notification-input-disabled"
      );
    }

    this.notificationEntity.object3D
      .updateMatrixWorld(true);
  };

  // ========================================================
  // BUTTONS
  // ========================================================

  private onUnmuteClick = (): void => {
  const studentId = this.currentStudentId;

  if (!studentId) {
    return;
  }

  console.log(
    "[RaiseHandNotification] Sending lower-hand request:",
    studentId
  );

  socket.emit(
    "instructorLowerHand",
    {
      studentId
    }
  );

  this.hideNotification();
};

private onCancelClick = (): void => {
  const studentId = this.currentStudentId;

  if (!studentId) {
    return;
  }

  console.log(
    "[RaiseHandNotification] Sending lower-hand request:",
    studentId
  );

  socket.emit("instructorLowerHand", {
    studentId
  });

  /*
   * Do not rely only on this local hide.
   * The server will broadcast raised:false too.
   */
  this.hideNotification();
};
  // ========================================================
  // UI HELPERS
  // ========================================================

  private setText(
    element: any,
    text: string
  ): void {
    if (!element) {
      return;
    }

    /*
     * IWSDK UIKit normally updates Text elements through
     * setProperties rather than textContent.
     */
    if (
      typeof element.setProperties ===
      "function"
    ) {
      element.setProperties({
        text
      });

      return;
    }

    element.textContent = text;
  }

  private refreshDocument(): void {
    if (!this.notificationDocument) {
      return;
    }

    const document =
      this.notificationDocument as any;

    if (
      typeof document.update ===
      "function"
    ) {
      document.update();
    } else if (
      typeof document.requestUpdate ===
      "function"
    ) {
      document.requestUpdate();
    }
  }

  // ========================================================
  // DESTROY
  // ========================================================

  destroy(): void {
  delete (window as any).refreshInstructorHandNotification;
  socket.off(
    "raiseHandUpdated",
    this.onRaiseHandUpdated
  );

  this.unmuteButton?.removeEventListener(
    "click",
    this.onUnmuteClick
  );

  this.cancelButton?.removeEventListener(
    "click",
    this.onCancelClick
  );

  if (
    this.notificationHandModel?.parent
  ) {
    this.notificationHandModel.parent.remove(
      this.notificationHandModel
    );
  }

  this.notificationHandModel = null;

  this.hideNotification();

  this.notificationEntity = undefined;
  this.notificationDocument = undefined;

  this.studentNameElement = null;
  this.messageElement = null;
  this.seatElement = null;
  this.iconElement = null;
  this.titleElement = null;
  this.unmuteButton = null;
  this.cancelButton = null;

  console.log(
    "[RaiseHandNotification] Destroyed"
  );
}
}
