/**
 * Classroom seat-assignment and avatar-placement system.
 * Goal: match each connected student's Supabase seat name to scene coordinates
 * and keep seat markers/avatars consistent across classroom modes.
 */
import {
  createSystem,
  ne
} from "@iwsdk/core";

import * as THREE from "three";

import {
  SeatComponent
} from "../components/seat.component";

import {
  SeatType
} from "../utils/utils";

import {
  socket
} from "../network/socket";

type VRUser = {
  id?: number;
  userId?: number;
  username?: string;
  fullName?: string;
  role?: "student" | "instructor";
};

type SeatRejectedData = {
  seat?: string;
  message?: string;
};

export class SeatSystem extends createSystem({
  seat: {
    required: [SeatComponent],
    where: [
      ne(
        SeatComponent,
        "name",
        SeatType.Seat_R0_00
      )
    ]
  }
}) {
  private assignedSeat: string | null = null;
  private studentName = "Student";
  private userId: number | null = null;
  private isStudent = false;

  private requestSent = false;
  private classroomRegistered = false;
  private destroyed = false;

  init(): void {
    console.log(
      "[SeatSystem] Initializing database-seat system"
    );

    const currentUser =
      (window as any).vrUser as
        VRUser | undefined;

    this.isStudent =
      currentUser?.role === "student";

    if (!this.isStudent) {
      console.log(
        "[SeatSystem] Instructor mode — skipped"
      );

      return;
    }

    this.studentName =
      currentUser?.fullName?.trim() ||
      currentUser?.username?.trim() ||
      "Student";

    const parsedUserId =
      Number(
        currentUser?.id ??
        currentUser?.userId
      );

    if (
      !Number.isInteger(parsedUserId) ||
      parsedUserId <= 0
    ) {
      console.error(
        "[SeatSystem] A valid database user ID is required."
      );

      this.showSeatError(
        "Your database user ID is missing. Please log in again."
      );

      return;
    }

    this.userId = parsedUserId;

    this.setupSocketListeners();
    window.addEventListener(
      "restoreClassroomSeat",
      this.onRestoreClassroomSeat
    );
    console.log(
      `[SeatSystem] Waiting for classroom registration for ${this.studentName}`,
      {
        userId: this.userId
      }
    );
  }

  private setupSocketListeners(): void {
    socket.on(
      "seatAccepted",
      this.onSeatAccepted
    );

    socket.on(
      "seatRejected",
      this.onSeatRejected
    );

    socket.on(
      "connect",
      this.onSocketConnected
    );

    socket.on(
      "classroomClientRegistered",
      this.onClassroomClientRegistered
    );
  }

  private onSocketConnected = (): void => {
    if (this.destroyed) {
      return;
    }

    console.log(
      "[SeatSystem] Socket connected"
    );

    this.classroomRegistered = false;
    this.requestSent = false;
  };

  private onRestoreClassroomSeat = (): void => {
    if (this.destroyed) {
      return;
    }

    if (this.assignedSeat) {
      this.moveToSeatWithRetry(
        this.assignedSeat,
        0
      );
      return;
    }

    this.requestSent = false;
    this.requestAssignedSeat();
  };

  private onClassroomClientRegistered = (
    data: {
      success?: boolean;
      user?: {
        seat?: string | null;
      };
    }
  ): void => {
    if (
      this.destroyed ||
      !data?.success
    ) {
      return;
    }

    this.classroomRegistered = true;

    const seatName =
      data.user?.seat?.trim();

    /*
     * The registration response may already contain
     * the database seat. Process it immediately.
     */
    if (
      seatName &&
      seatName !== "Not selected"
    ) {
      this.onSeatAccepted(
        seatName
      );

      return;
    }

    /*
     * If the registration response does not contain
     * a seat, explicitly request it from the server.
     */
    this.requestSent = false;
    this.requestAssignedSeat();
  };

  private requestAssignedSeat(): void {
    if (
      this.destroyed ||
      this.requestSent ||
      !this.classroomRegistered ||
      !this.userId
    ) {
      return;
    }

    if (!socket.connected) {
      console.log(
        "[SeatSystem] Waiting for socket connection"
      );

      window.setTimeout(
        () => {
          this.requestAssignedSeat();
        },
        400
      );

      return;
    }

    this.requestSent = true;

    console.log(
      `[SeatSystem] Requesting database seat for ${this.studentName}`,
      {
        userId: this.userId
      }
    );

    socket.emit(
      "requestAssignedSeat",
      {
        userId: this.userId
      }
    );
  }

  private onSeatAccepted = (
    seatName: string
  ): void => {
    if (
      typeof seatName !== "string"
    ) {
      console.warn(
        "[SeatSystem] Invalid seat received:",
        seatName
      );

      return;
    }

    const normalizedSeat =
      seatName.trim();

    if (
      normalizedSeat === "" ||
      normalizedSeat ===
        "Not selected"
    ) {
      console.warn(
        "[SeatSystem] No database seat was assigned:",
        seatName
      );

      this.showSeatError(
        `${this.studentName} does not have an assigned seat in the database.`
      );

      return;
    }

    /*
     * The server/database is the only authority.
     */
    this.assignedSeat =
      normalizedSeat;

    console.log(
      `[SeatSystem] Database seat accepted: ${this.assignedSeat}`
    );

    this.moveToSeatWithRetry(
      this.assignedSeat,
      0
    );
  };

  private onSeatRejected = (
    data: SeatRejectedData
  ): void => {
    this.requestSent = false;

    const seatName =
      data?.seat ??
      "Unknown seat";

    const message =
      data?.message ??
      "The assigned seat could not be restored.";

    console.error(
      `[SeatSystem] Database seat rejected: ${seatName}`,
      message
    );

    this.showSeatError(
      message
    );
  };

  private moveToSeatWithRetry(
    seatName: string,
    attempt: number
  ): void {
    if (this.destroyed) {
      return;
    }

    const maximumAttempts = 30;

    const moved =
      this.moveToExactSeat(
        seatName
      );

    if (moved) {
      return;
    }

    if (
      attempt >=
      maximumAttempts
    ) {
      console.error(
        `[SeatSystem] Could not find or use ${seatName}`
      );

      this.showSeatError(
        `The classroom model does not contain the database seat ${seatName}.`
      );

      return;
    }

    window.setTimeout(
      () => {
        this.moveToSeatWithRetry(
          seatName,
          attempt + 1
        );
      },
      200
    );
  }

  private moveToExactSeat(
    seatName: string
  ): boolean {
    const classroom =
      (window as any)
        .classroomMesh as
        THREE.Object3D | undefined;

    if (!classroom) {
      console.warn(
        "[SeatSystem] Classroom mesh is not ready"
      );

      return false;
    }

    const seatObject =
      classroom.getObjectByName(
        seatName
      );

    if (!seatObject) {
      console.warn(
        `[SeatSystem] Seat object not found: ${seatName}`
      );

      return false;
    }

    classroom.updateWorldMatrix(
      true,
      true
    );

    seatObject.updateWorldMatrix(
      true,
      false
    );

    const seatPosition =
      new THREE.Vector3();

    const seatQuaternion =
      new THREE.Quaternion();

    seatObject.getWorldPosition(
      seatPosition
    );

    seatObject.getWorldQuaternion(
      seatQuaternion
    );

    const playerObject =
      (
        (this.player as any)
          ?.object3D ??
        this.player
      ) as
        THREE.Object3D | undefined;

    if (!playerObject) {
      console.warn(
        "[SeatSystem] Player transform is unavailable"
      );

      return false;
    }

    /*
     * Move the XR origin to the seat anchor.
     */
    playerObject.position.copy(
      seatPosition
    );

    playerObject.quaternion.copy(
      seatQuaternion
    );

    /*
     * Turn the student toward the front screen.
     * Remove this block if your seat anchors already
     * face the correct direction.
     */
    const turnTowardScreen =
      new THREE.Quaternion()
        .setFromAxisAngle(
          new THREE.Vector3(
            0,
            1,
            0
          ),
          Math.PI
        );

    playerObject.quaternion.multiply(
      turnTowardScreen
    );

    playerObject.updateMatrix();
    playerObject.updateMatrixWorld(
      true
    );

    console.log(
      `[SeatSystem] Moved ${this.studentName} to database seat ${seatName}`,
      {
        userId:
          this.userId,

        position: {
          x:
            playerObject.position.x,

          y:
            playerObject.position.y,

          z:
            playerObject.position.z
        },

        rotationY:
          playerObject.rotation.y
      }
    );

    this.installXRSeatRestoreListener();

    return true;
  }

  private installXRSeatRestoreListener(): void {
    const renderer =
      (window as any).renderer;

    if (
      !renderer?.xr ||
      (window as any)
        .seatSessionListenerInstalled
    ) {
      return;
    }

    (window as any)
      .seatSessionListenerInstalled =
      true;

    renderer.xr.addEventListener(
      "sessionstart",
      () => {
        console.log(
          "[SeatSystem] XR started — restoring database seat"
        );

        [
          250,
          600,
          1200
        ].forEach(
          delay => {
            window.setTimeout(
              () => {
                if (
                  this.assignedSeat
                ) {
                  this.moveToExactSeat(
                    this.assignedSeat
                  );
                }
              },
              delay
            );
          }
        );
      }
    );
  }

  private showSeatError(
    message: string
  ): void {
    const existing =
      document.getElementById(
        "seat-error"
      );

    existing?.remove();

    const overlay =
      document.createElement(
        "div"
      );

    overlay.id =
      "seat-error";

    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      background: rgba(0, 0, 0, 0.78);
      color: white;
      font-family: Arial, sans-serif;
    `;

    overlay.innerHTML = `
      <div style="
        max-width: 520px;
        padding: 30px;
        border-radius: 14px;
        background: rgba(20, 24, 38, 0.96);
        text-align: center;
      ">
        <div style="font-size: 48px;">
          🚫
        </div>

        <div style="
          margin-top: 14px;
          font-size: 22px;
          font-weight: 700;
        ">
          Seat assignment problem
        </div>

        <div style="
          margin-top: 10px;
          font-size: 15px;
          opacity: 0.8;
        ">
          ${message}
        </div>
      </div>
    `;

    document.body.appendChild(
      overlay
    );
  }

  destroy(): void {
    this.destroyed = true;

    socket.off(
      "seatAccepted",
      this.onSeatAccepted
    );

    socket.off(
      "seatRejected",
      this.onSeatRejected
    );

    socket.off(
      "connect",
      this.onSocketConnected
    );

    socket.off(
      "classroomClientRegistered",
      this.onClassroomClientRegistered
    );

    window.removeEventListener(
      "restoreClassroomSeat",
      this.onRestoreClassroomSeat
    );
  }
}
