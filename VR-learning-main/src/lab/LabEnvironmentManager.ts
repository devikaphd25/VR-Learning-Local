/**
 * Owns the Python-lab scene lifecycle: assets, audio, lighting, systems, and
 * cleanup when a student moves between the classroom and the lab.
 */
import {
  AssetManager,
  AudioSource,
  AudioUtils,
  BoxGeometry,
  Group,
  Interactable,
  Mesh,
  MeshStandardMaterial,
  PanelUI,
  PlaybackMode,
  type World,
} from "@iwsdk/core";
import type { Object3D } from "three";

import { socket } from "../network/socket";
import { hideAllMarkers } from "../components/instructor/seat-markers";
import {
  CardDispenser,
  NewCardButton,
  ResetButton,
  TypeBin,
  TypeCard,
} from "./components/gameComponents";
import {
  getActiveDeckLength,
  getCardIndexSignal,
  getCorrectAnswersSignal,
  getLessonStateSignal,
  getScoreSignal,
  getStreakSignal,
  getWrongAnswersSignal,
  installGameState,
  requestCommand,
  setCorrectAudioEntity,
  setWrongAudioEntity,
} from "./state/gameState";
import {
  TABLE_DEPTH,
  TABLE_FLOOR_POSITION,
  TABLE_POSITION,
  TABLE_THICKNESS,
  TABLE_TOP_Y,
  TABLE_WIDTH,
} from "./state/layout";
import { CardDispenserSystem } from "./systems/CardDispenserSystem";
import { DropSystem } from "./systems/DropSystem";
import { FlipRevealSystem } from "./systems/FlipRevealSystem";
import { LessonSystem } from "./systems/LessonSystem";
import { ResetButtonSystem } from "./systems/ResetButtonSystem";
import { TypeBinSystem } from "./systems/TypeBinSystem";
import { UIPanelSystem } from "./systems/UIPanelSystem";
import { setLabRoot } from "./runtime/labRoot";
import {
  alignFloorToY0,
  getModelOrNull,
  scaleToHeightAndGround,
} from "./visuals/modelBinding";

type VisibilityRecord = {
  object: Object3D;
  visible: boolean;
};

export class LabEnvironmentManager {
  private readonly root = new Group();
  private readonly classroomObjects: Object3D[];
  private readonly playerObject: Object3D;
  private savedClassroomVisibility: VisibilityRecord[] = [];
  private active = false;
  private enteredAt = 0;
  private completionReported = false;
  private progressTimer: number | null = null;
  private transitionInProgress = false;

  constructor(
    private readonly world: World,
    classroomObjects: Array<Object3D | null | undefined>,
  ) {
    this.classroomObjects = classroomObjects.filter(
      (object): object is Object3D => Boolean(object),
    );

    this.playerObject =
      ((world.player as any)?.object3D ?? world.player) as Object3D;

    this.root.name = "PythonTypeLabRoot";
    this.root.visible = false;
    this.world.createTransformEntity(this.root);
    setLabRoot(this.root);

    this.buildEnvironment();
    this.buildPanels();
    this.installGame();
    this.connectNetwork();
    this.connectXrPositionRestore();

    (window as any).reportLabMistake =
      (mistake: Record<string, unknown>): void => {
        if (!this.active) {
          return;
        }

        socket.emit("labMistake", mistake);
      };
  }

  isActive(): boolean {
    return this.active;
  }

  enter(): void {
    if (this.active || this.transitionInProgress) {
      return;
    }

    this.transitionInProgress = true;
    this.performTransition(() => {
      this.transitionInProgress = false;
      this.enterImmediately();
    });
  }

  private enterImmediately(): void {
    if (this.active) {
      return;
    }

    this.active = true;
    (window as any).isLabActive = true;
    hideAllMarkers();
    this.enteredAt = Date.now();
    this.completionReported = false;

    this.savedClassroomVisibility = this.classroomObjects.map(object => ({
      object,
      visible: object.visible,
    }));

    for (const { object } of this.savedClassroomVisibility) {
      object.visible = false;
    }

    this.root.visible = true;
    /*
     * Match the original standalone lab origin. The table is
     * centered at z = -0.65, so the player must remain at z = 0.
     * The headset supplies the user's real eye height.
     */
    this.playerObject.position.set(0, 0, 0);
    this.playerObject.rotation.set(0, 0, 0);
    this.playerObject.updateMatrixWorld(true);

    const lessonState = getLessonStateSignal().peek();
    requestCommand(lessonState === "complete" ? "reset" : "start");

    socket.emit("studentJoinLab", {});
    this.reportProgress("working");
    console.log("[Lab] Entered private lab without leaving WebXR.");
  }

  returnToClassroom(reason = "instructor_return"): void {
    if (!this.active || this.transitionInProgress) {
      return;
    }

    this.transitionInProgress = true;
    this.performTransition(() => {
      this.transitionInProgress = false;
      this.returnImmediately(reason);
    });
  }

  private returnImmediately(reason: string): void {
    if (!this.active) {
      return;
    }

    const status =
      getLessonStateSignal().peek() === "complete"
        ? "completed"
        : "incomplete";

    this.reportProgress(status, reason);
    this.active = false;
    (window as any).isLabActive = false;
    this.root.visible = false;

    for (const { object, visible } of this.savedClassroomVisibility) {
      object.visible = visible;
    }

    window.dispatchEvent(new CustomEvent("restoreClassroomSeat"));

    socket.emit("labReturnConfirmed", {
      reason,
      result: this.getProgress(status),
    });

    const result = this.getProgress(status);
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent(
          "studentLabResult",
          {
            detail: result
          }
        )
      );
    }, 250);

    console.log("[Lab] Returned to the assigned classroom seat.");
  }

  private performTransition(action: () => void): void {
    const transition =
      (window as any).performEnvironmentTransition as
        ((action: () => void) => Promise<void>) | undefined;

    if (transition) {
      void transition(action);
      return;
    }

    action();
  }

  private connectXrPositionRestore(): void {
    const restoreLabOrigin = () => {
      if (!this.active) {
        return;
      }

      window.setTimeout(() => {
        if (!this.active) {
          return;
        }

        this.playerObject.position.set(0, 0, 0);
        this.playerObject.rotation.set(0, 0, 0);
        this.playerObject.updateMatrixWorld(true);
        console.log(
          "[Lab] Player origin restored after XR session change."
        );
      }, 100);
    };

    this.world.renderer.xr.addEventListener(
      "sessionend",
      restoreLabOrigin
    );

    this.world.renderer.xr.addEventListener(
      "sessionstart",
      restoreLabOrigin
    );
  }

  private installGame(): void {
    installGameState(this.world);

    this.world
      .registerComponent(TypeCard)
      .registerComponent(TypeBin)
      .registerComponent(ResetButton)
      .registerComponent(CardDispenser)
      .registerComponent(NewCardButton)
      .registerSystem(LessonSystem)
      .registerSystem(FlipRevealSystem)
      .registerSystem(DropSystem)
      .registerSystem(TypeBinSystem)
      .registerSystem(UIPanelSystem)
      .registerSystem(ResetButtonSystem)
      .registerSystem(CardDispenserSystem);

    const correctAudio = this.world
      .createTransformEntity()
      .addComponent(AudioSource, {
        src: "/audio/card-correct.wav",
        volume: 0.8,
        positional: false,
        maxInstances: 1,
        playbackMode: PlaybackMode.Restart,
      });

    const wrongAudio = this.world
      .createTransformEntity()
      .addComponent(AudioSource, {
        src: "/audio/card-wrong.wav",
        volume: 0.75,
        positional: false,
        maxInstances: 1,
        playbackMode: PlaybackMode.Restart,
      });

    setCorrectAudioEntity(correctAudio);
    setWrongAudioEntity(wrongAudio);

    const scheduleProgress = () => {
      if (!this.active || this.progressTimer !== null) {
        return;
      }

      this.progressTimer = window.setTimeout(() => {
        this.progressTimer = null;
        this.reportProgress("working");
      }, 100);
    };

    getScoreSignal().subscribe(scheduleProgress);
    getCardIndexSignal().subscribe(scheduleProgress);
    getWrongAnswersSignal().subscribe(scheduleProgress);
    getLessonStateSignal().subscribe(state => {
      if (!this.active) {
        return;
      }

      if (state === "complete" && !this.completionReported) {
        this.completionReported = true;
        this.reportProgress("completed", "student_completed");
        socket.emit("labCompleted", {
          result: this.getProgress("completed"),
        });
        AudioUtils.play(correctAudio);

        window.setTimeout(() => {
          if (this.active) {
            this.returnToClassroom(
              "student_completed"
            );
          }
        }, 1200);
        return;
      }

      scheduleProgress();
    });
  }

  private connectNetwork(): void {
    socket.on("gameChanged", data => {
      if (data?.gameId === "python-type-lab") {
        this.enter();
      }
    });

    socket.on("returnToClassroom", data => {
      this.returnToClassroom(
        data?.returnReason ?? "instructor_return",
      );
    });

    socket.on("modeChanged", data => {
      if (data?.mode === "Classroom Mode" && this.active) {
        this.returnToClassroom("instructor_return");
      }
    });

    socket.on("returnAllToClassroomNow", data => {
      if (this.active) {
        this.returnToClassroom(
          data?.returnReason ?? "instructor_return",
        );
      }
    });

    socket.on("allStudentsReturnedToClass", () => {
      if (this.active) {
        this.returnToClassroom("instructor_return");
      }
    });
  }

  private getProgress(status: string) {
    const correctAnswers = getCorrectAnswersSignal().peek();
    const wrongAnswers = getWrongAnswersSignal().peek();
    const attempts = correctAnswers + wrongAnswers;
    const completedCards =
      getLessonStateSignal().peek() === "complete"
        ? getActiveDeckLength()
        : getCardIndexSignal().peek();

    return {
      status,
      score: getScoreSignal().peek(),
      streak: getStreakSignal().peek(),
      completedCards,
      totalCards: getActiveDeckLength() || 12,
      correctAnswers,
      wrongAnswers,
      accuracy:
        attempts > 0
          ? Math.round((correctAnswers / attempts) * 1000) / 10
          : 0,
      durationSeconds:
        this.enteredAt > 0
          ? Math.max(0, Math.round((Date.now() - this.enteredAt) / 1000))
          : 0,
    };
  }

  private reportProgress(status: string, returnReason?: string): void {
    if (!this.active && !returnReason) {
      return;
    }

    socket.emit("labProgressUpdated", {
      ...this.getProgress(status),
      returnReason,
    });
  }

  private buildEnvironment(): void {
    const environment = getModelOrNull("labEnvironmentModel");

    if (environment) {
      environment.scale.multiplyScalar(1.25);
      alignFloorToY0(environment);
      this.root.add(environment);
    } else {
      const roomMaterial = new MeshStandardMaterial({
        color: 0xcfc8bd,
        roughness: 0.95,
      });
      const floor = new Mesh(
        new BoxGeometry(6.1, 0.05, 4.6),
        new MeshStandardMaterial({ color: 0x8a8378, roughness: 0.95 }),
      );
      floor.position.y = -0.025;
      const backWall = new Mesh(
        new BoxGeometry(6.1, 3.4, 0.05),
        roomMaterial,
      );
      backWall.position.set(0, 1.7, -2.3);
      this.root.add(floor, backWall);
    }

    const tableGroup = new Group();
    const tableModel = getModelOrNull("tableModel");

    if (tableModel) {
      scaleToHeightAndGround(tableModel, TABLE_TOP_Y);
      tableGroup.add(tableModel);
      tableGroup.position.set(...TABLE_FLOOR_POSITION);
    } else {
      tableGroup.add(
        new Mesh(
          new BoxGeometry(TABLE_WIDTH, TABLE_THICKNESS, TABLE_DEPTH),
          new MeshStandardMaterial({ color: 0x9b9690, roughness: 0.9 }),
        ),
      );
      tableGroup.position.set(...TABLE_POSITION);
    }

    this.root.add(tableGroup);
  }

  private buildPanels(): void {
    const definitions = [
      {
        config: "./ui/lessonPanel.json",
        position: [0, 1.35, -0.95],
        rotationY: 0,
        maxWidth: 0.6,
        maxHeight: 0.4,
      },
      {
        config: "./ui/scorePanel.json",
        position: [-0.72, 1.35, -0.95],
        rotationY: 0.6,
        maxWidth: 0.6,
        maxHeight: 0.4,
      },
      {
        config: "./ui/feedbackPanel.json",
        position: [0.72, 1.35, -0.95],
        rotationY: -0.6,
        maxWidth: 0.6,
        maxHeight: 0.55,
      },
    ] as const;

    for (const definition of definitions) {
      const panel = this.world
        .createTransformEntity()
        .addComponent(PanelUI, {
          config: definition.config,
          maxWidth: definition.maxWidth,
          maxHeight: definition.maxHeight,
        })
        .addComponent(Interactable);

      panel.object3D!.position.set(
        definition.position[0],
        definition.position[1],
        definition.position[2],
      );
      panel.object3D!.rotation.y = definition.rotationY;
      this.root.add(panel.object3D!);
    }
  }
}
