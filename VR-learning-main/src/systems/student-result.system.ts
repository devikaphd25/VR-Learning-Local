/**
 * Student result-panel system.
 * Goal: display final Python-lab or challenge outcomes after return, provide a
 * mouse/ray close button, and restore normal classroom controls afterward.
 */
import {
  createSystem,
  eq,
  PanelDocument,
  PanelUI,
  RayInteractable,
  UIKit,
  type UIKitDocument,
} from "@iwsdk/core";
import * as THREE from "three";

import { CHALLENGE_2_ITEMS } from "../config/challenge-2-content";
import { socket } from "../network/socket";

export class StudentResultSystem extends createSystem({
  resultPanel: {
    required: [PanelUI, PanelDocument],
    where: [
      eq(
        PanelUI,
        "config",
        "./ui/student-result-panel.json"
      )
    ]
  },
  boardViewButton: {
    required: [PanelUI, PanelDocument],
    where: [
      eq(PanelUI, "config", "./ui/student-board-view-button.json")
    ]
  }
}) {
  private document?: UIKitDocument;
  private boardViewDocument?: UIKitDocument;
  private lastCloseActivation = 0;
  private lastBoardViewActivation = 0;
  private connectedCloseButton?: object;
  private connectedBoardViewButton?: object;
  private connectedBoardViewRoot?: object;
  private isLeftTriggerPressed = false;
  private boardViewActive = false;
  private resultWasVisible = false;
  private savedPlayerPosition = new THREE.Vector3();
  private savedPlayerQuaternion = new THREE.Quaternion();

  init(): void {
    this.queries.resultPanel.subscribe(
      "qualify",
      entity => {
        this.document =
          PanelDocument.data.document[
            entity.index
          ] as UIKitDocument;

        this.connectCloseButton();
      }
    );
    this.queries.boardViewButton.subscribe("qualify", entity => {
      this.boardViewDocument = PanelDocument.data.document[entity.index] as UIKitDocument;
      this.connectBoardViewButton();
      // SCREEN is a normal classroom navigation control, like Raise Hand. It
      // must not depend on completing Challenge 2 before it becomes visible.
      this.setBoardViewButtonVisible(true);
    });

    (window as any).toggleStudentBoardView = this.activateBoardView;
    (window as any).closeStudentResultForRoomTransition =
      this.closeForRoomTransition;
    (window as any).isStudentBoardViewAvailable = true;

    window.addEventListener(
      "studentLabResult",
      this.onResult as EventListener
    );
    window.addEventListener(
      "challenge2FinalResult",
      this.onChallenge2Result as EventListener
    );
    socket.on("challenge2Started", this.onChallenge2Started);
  }

  private onResult = (
    event: CustomEvent
  ): void => {
    const result = event.detail ?? {};
    this.setText("student-result-title", "Python Lab Result");
    this.setDisplay("student-result-score-row", true);
    this.setDisplay("student-result-stats", true);
    this.setDisplay("student-challenge-review", false);

    /* Reconnect after UIKit has rebuilt a previously hidden panel. */
    this.connectCloseButton();

    this.setText(
      "student-result-status",
      result.status === "completed"
        ? "Lesson completed — welcome back!"
        : "Returned by instructor — progress saved"
    );
    this.setText(
      "student-result-score",
      String(result.score ?? 0)
    );
    this.setText(
      "student-result-correct",
      String(result.correctAnswers ?? 0)
    );
    this.setText(
      "student-result-mistakes",
      String(result.wrongAnswers ?? 0)
    );
    this.setText(
      "student-result-accuracy",
      `${result.accuracy ?? 0}%`
    );
    this.setText(
      "student-result-time",
      `${result.durationSeconds ?? 0} sec`
    );

    this.setVisible(true);
    this.sync();
    window.setTimeout(() => this.connectCloseButton(), 0);
  };

  /** Show the server-authoritative Challenge 2 review to every student. */
  private onChallenge2Result = (event: CustomEvent): void => {
    const review = event.detail ?? {};
    const rankings = Array.isArray(review.rankings) ? review.rankings : [];
    const personal = rankings.find((result: any) => result.studentId === socket.id);
    this.connectCloseButton();
    this.setText("student-result-title", "Challenge 2: Your Result");
    this.setText(
      "student-result-status",
      personal?.attempts > 0
        ? "Your challenge performance"
        : "No challenge attempt recorded"
    );
    this.setDisplay("student-result-score-row", false);
    this.setDisplay("student-result-stats", true);
    this.setDisplay("student-challenge-review", true);
    this.setText(
      "student-result-correct",
      `${Number(personal?.correctAnswers) || 0} / 5`
    );
    this.setText(
      "student-result-mistakes",
      String(Number(personal?.wrongAnswers) || 0)
    );
    this.setText(
      "student-result-accuracy",
      `${(Number(personal?.accuracy) || 0).toFixed(1)}%`
    );
    this.setText(
      "student-result-time",
      personal?.correctAnswers >= 5
        ? `${(Number(personal.elapsedSeconds) || 0).toFixed(1)} sec`
        : "Not completed"
    );
    const personalMistakes = Array.isArray(personal?.mistakes)
      ? personal.mistakes
      : [];
    this.setText(
      "student-challenge-errors",
      personalMistakes.length > 0
        ? "Review your first answer and the correct answer."
        : "No mistakes. All your first answers were correct."
    );
    for (let index = 0; index < 5; index += 1) {
      const row = index + 1;
      const mistake = personalMistakes[index];
      this.setDisplay(`student-mistake-card-${row}`, Boolean(mistake));
      if (!mistake) continue;
      const configuredItem = CHALLENGE_2_ITEMS.find(
        item => item.id === mistake.itemId
      );
      const image = this.document?.getElementById(
        `student-mistake-image-${row}`
      ) as UIKit.Image;
      image?.setProperties({ src: configuredItem?.imagePath });
      this.setText(
        `student-mistake-device-${row}`,
        mistake.itemName ?? configuredItem?.name ?? "Device"
      );
      this.setText(
        `student-mistake-wrong-${row}`,
        `X  Your first answer: ${String(mistake.firstAnswer).toUpperCase()}`
      );
      this.setText(
        `student-mistake-correct-${row}`,
        `Correct answer: ${String(mistake.correctAnswer).toUpperCase()}`
      );
    }
    this.positionFixedInClassroom();
    this.setVisible(true);
    this.setBoardViewButtonVisible(true);
    this.sync();
    window.setTimeout(() => this.connectCloseButton(), 0);
  };

  private onChallenge2Started = (): void => {
    if (this.boardViewActive) this.restoreSavedPlayerPose();
    this.setVisible(false);
    this.setBoardViewButtonVisible(false);
  };

  private connectCloseButton(): void {
    const closeButton = this.document
      ?.getElementById("student-result-close");

    if (!closeButton || closeButton === this.connectedCloseButton) {
      return;
    }

    this.connectedCloseButton = closeButton;
    closeButton.addEventListener("pointerdown", this.activateClose);
    closeButton.addEventListener("click", this.activateClose);
  }

  private connectBoardViewButton(): void {
    const button = this.boardViewDocument?.getElementById(
      "student-board-view-toggle"
    );
    if (button && button !== this.connectedBoardViewButton) {
      this.connectedBoardViewButton = button;
      button.addEventListener("pointerdown", this.activateBoardView);
      button.addEventListener("click", this.activateBoardView);
    }

    // Also accept the surrounding circular control area. The projector image
    // is decorative and must never become the only ray-intersection target.
    const root = this.boardViewDocument?.getElementById(
      "student-board-view-root"
    );
    if (root && root !== this.connectedBoardViewRoot) {
      this.connectedBoardViewRoot = root;
      root.addEventListener("pointerdown", this.activateBoardView);
      root.addEventListener("click", this.activateBoardView);
    }
  }

  /** Toggle a saved classroom pose and the center first-row board-view pose. */
  private activateBoardView = (event?: any): void => {
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    if (!(window as any).isStudentBoardViewAvailable) return;
    const now = performance.now();
    if (now - this.lastBoardViewActivation < 250) return;
    this.lastBoardViewActivation = now;

    const player = (window as any).player as THREE.Object3D | undefined;
    if (!player) return;
    if (!this.boardViewActive) {
      const seat = this.world.scene.getObjectByName("Seat_R1_03");
      const board = this.world.scene.getObjectByName("ProjectorScreen");
      if (!seat || !board) return;
      this.savedPlayerPosition.copy(player.position);
      this.savedPlayerQuaternion.copy(player.quaternion);
      this.resultWasVisible = Boolean((window as any).isStudentResultOpen);
      this.setVisible(false);

      const seatWorld = new THREE.Vector3();
      const boardWorld = new THREE.Vector3();
      seat.getWorldPosition(seatWorld);
      board.getWorldPosition(boardWorld);
      const parent = player.parent;
      player.position.copy(parent ? parent.worldToLocal(seatWorld.clone()) : seatWorld);
      const direction = boardWorld.sub(seatWorld);
      player.rotation.set(0, Math.atan2(-direction.x, -direction.z), 0);
      player.updateMatrixWorld(true);
      this.boardViewActive = true;
      this.setBoardViewLabel("RETURN");
    } else {
      this.restoreSavedPlayerPose();
    }
  };

  private restoreSavedPlayerPose(): void {
    const player = (window as any).player as THREE.Object3D | undefined;
    if (!player) return;
    player.position.copy(this.savedPlayerPosition);
    player.quaternion.copy(this.savedPlayerQuaternion);
    player.updateMatrixWorld(true);
    this.boardViewActive = false;
    this.setBoardViewLabel("SCREEN");
    if (this.resultWasVisible) this.setVisible(true);
  }

  private setBoardViewLabel(text: string): void {
    const label = this.boardViewDocument?.getElementById(
      "student-board-view-label"
    ) as UIKit.Text;
    label?.setProperties({ text });
    (this.boardViewDocument as any)?.requestUpdate?.();
  }

  private setBoardViewButtonVisible(visible: boolean): void {
    (window as any).isStudentBoardViewAvailable = visible;
    (window as any).refreshStudentBoardButton?.();
    const entity = (window as any).studentBoardViewButtonEntity;
    if (!entity?.object3D) return;
    entity.object3D.visible = visible;
    entity.object3D.pointerEvents = visible ? "auto" : "none";
    entity.object3D.traverse((object: any) => {
      object.pointerEvents = visible ? "auto" : "none";
      object.pointerEventsOrder = 71000;
    });
    if (visible) {
      entity.removeComponent(RayInteractable);
      entity.addComponent(RayInteractable);
      requestAnimationFrame(() => this.connectBoardViewButton());
    }
  }

  private setText(
    id: string,
    text: string
  ): void {
    const element =
      this.document
        ?.getElementById(id) as UIKit.Text;

    element?.setProperties({ text });
  }

  private setDisplay(id: string, visible: boolean): void {
    const element = this.document?.getElementById(id) as any;
    element?.setProperties({ display: visible ? "flex" : "none" });
  }

  /** Detach the monitor from the headset and place it once in world space. */
  private positionFixedInClassroom(): void {
    const entity = (window as any).studentResultEntity;
    const object = entity?.object3D as THREE.Object3D | undefined;
    if (!object) return;
    this.scene.add(object);
    const cameraPosition = new THREE.Vector3();
    const forward = new THREE.Vector3();
    this.camera.getWorldPosition(cameraPosition);
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1);
    forward.normalize();
    object.position.copy(cameraPosition).addScaledVector(forward, 1.8);
    object.position.y = cameraPosition.y - 0.12;
    const towardCamera = cameraPosition.clone().sub(object.position);
    object.rotation.set(0, Math.atan2(towardCamera.x, towardCamera.z), 0);
    object.updateMatrixWorld(true);
  }

  private setVisible(visible: boolean): void {
    (window as any).isStudentResultOpen = visible;

    // The board status is a transparent canvas. Hide it while the student's
    // personal monitor is open so board text cannot be composited over the
    // monitor in the browser or a Quest headset.
    const classroomBoardStatus = this.scene.getObjectByName(
      "ClassroomBoardStatus"
    );
    if (classroomBoardStatus) {
      classroomBoardStatus.visible =
        !visible && !Boolean((window as any).isPresentationOpen);
    }

    const entity =
      (window as any).studentResultEntity;

    if (entity?.object3D) {
      entity.object3D.visible = visible;
      entity.object3D.pointerEvents = visible ? "auto" : "none";
      entity.object3D.pointerEventsOrder = 70000;
      entity.object3D.traverse((object: any) => {
        object.pointerEvents = visible ? "auto" : "none";
        object.pointerEventsOrder = 70000;
      });
      entity.object3D.updateMatrixWorld(true);

      if (visible) {
        // This panel is constructed while hidden. Refresh the IWSDK
        // interaction component after UIKit has created the X-button meshes,
        // otherwise both canvas mouse input and controller rays can miss it.
        entity.removeComponent(RayInteractable);
        entity.addComponent(RayInteractable);
        requestAnimationFrame(() => {
          entity.object3D?.updateMatrixWorld(true);
          this.connectCloseButton();
          this.sync();
        });
      }
    }
  }

  private closeResult = (): void => {
    this.setVisible(false);
    (window as any)
      .resetStudentRaiseHandAfterResult?.();
  };

  /** Remove result/view overlays before presentation or debrief begins. */
  private closeForRoomTransition = (): void => {
    // Do not let restoreSavedPlayerPose reopen a result that was visible when
    // the student selected the Screen shortcut.
    this.resultWasVisible = false;
    if (this.boardViewActive) this.restoreSavedPlayerPose();
    this.setVisible(false);
  };

  private activateClose = (event?: any): void => {
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();

    const now = performance.now();
    if (now - this.lastCloseActivation < 220) {
      return;
    }

    this.lastCloseActivation = now;
    this.closeResult();
  };

  private sync(): void {
    const document = this.document as any;
    document?.requestUpdate?.();
    document?.update?.();
  }

  update(): void {
    // A control mounted on the left controller cannot reliably be targeted by
    // that controller's own ray. Treat its physical trigger as a direct click,
    // while retaining mouse and right-controller ray interaction.
    try {
      const leftController = this.input?.xr?.gamepads?.left;
      const triggerPressed = Boolean(
        leftController?.getButtonDown("xr-standard-trigger")
      );
      if (triggerPressed && !this.isLeftTriggerPressed) {
        this.isLeftTriggerPressed = true;
        this.activateBoardView();
      } else if (!triggerPressed) {
        this.isLeftTriggerPressed = false;
      }
    } catch {
      this.isLeftTriggerPressed = false;
    }
  }

  destroy(): void {
    delete (window as any).toggleStudentBoardView;
    delete (window as any).closeStudentResultForRoomTransition;
    (window as any).isStudentBoardViewAvailable = false;
    window.removeEventListener(
      "studentLabResult",
      this.onResult as EventListener
    );
    window.removeEventListener(
      "challenge2FinalResult",
      this.onChallenge2Result as EventListener
    );
    socket.off("challenge2Started", this.onChallenge2Started);
  }
}
