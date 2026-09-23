/**
 * Owns the castle scene lifecycle for the "Python Puzzle 1" activity.
 * Builds a castle interior from Three.js primitives (no external GLB needed),
 * hides classroom objects while active, and restores them on return.
 */
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  type World,
} from "@iwsdk/core";
import type { Object3D } from "three";

import { socket } from "../network/socket";
import { hideAllMarkers } from "../components/instructor/seat-markers";
import { setCastleRoot } from "./jigsaw/castleRoot.js";
import { JigsawBlock, JigsawButton } from "./jigsaw/jigsawComponents.js";
import { JigsawPuzzleSystem } from "./jigsaw/JigsawPuzzleSystem.js";

type VisibilityRecord = {
  object: Object3D;
  visible: boolean;
};

const STONE_COLOR = 0x8a8276;
const STONE_DARK = 0x6b6358;
const ROOF_COLOR = 0x8b3a2e;
const FLOOR_COLOR = 0x5a5044;
const TORCH_COLOR = 0xff9a3c;

const ROOM_WIDTH = 10;
const ROOM_DEPTH = 10;
const WALL_HEIGHT = 5;
const WALL_THICKNESS = 0.4;
const TOWER_RADIUS = 1.1;
const TOWER_HEIGHT = 7;
const MERLON_WIDTH = 0.8;
const MERLON_HEIGHT = 0.7;
const MERLON_GAP = 0.5;

export class CastleEnvironmentManager {
  private readonly root = new Group();
  private readonly classroomObjects: Object3D[];
  private readonly playerObject: Object3D;
  private savedClassroomVisibility: VisibilityRecord[] = [];
  private active = false;
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

    this.root.name = "CastleRoomRoot";
    this.root.visible = false;
    this.world.createTransformEntity(this.root);

    setCastleRoot(this.root);
    this.installJigsaw();

    this.buildCastle();
    this.connectNetwork();
    this.connectExitHandler();
  }

  private installJigsaw(): void {
    this.world
      .registerComponent(JigsawBlock)
      .registerComponent(JigsawButton)
      .registerSystem(JigsawPuzzleSystem);
  }

  private connectExitHandler(): void {
    window.addEventListener("castleExitRequested", () => {
      this.returnToClassroom("student_exit");
    });
  }

  isActive(): boolean {
    return this.active;
  }

  enter(): void {
    if (this.active || this.transitionInProgress) return;

    this.transitionInProgress = true;
    this.performTransition(() => {
      this.transitionInProgress = false;
      this.enterImmediately();
    });
  }

  private enterImmediately(): void {
    if (this.active) return;

    this.active = true;
    (window as any).isCastleActive = true;
    hideAllMarkers();

    this.savedClassroomVisibility = this.classroomObjects.map(object => ({
      object,
      visible: object.visible,
    }));

    for (const { object } of this.savedClassroomVisibility) {
      object.visible = false;
    }

    this.root.visible = true;

    // Player faces the back wall (-z) where the puzzle assembly is mounted.
    this.playerObject.position.set(0, 0, 1.0);
    this.playerObject.rotation.set(0, 0, 0);
    this.playerObject.updateMatrixWorld(true);

    socket.emit("studentJoinLab", {});
    socket.emit("labProgressUpdated", {
      status: "working",
      completedCards: 0,
      totalCards: 1,
      correctAnswers: 0,
      wrongAnswers: 0,
      score: 0,
      streak: 0,
      accuracy: 0,
      durationSeconds: 0,
    });

    console.log("[Castle] Entered castle room.");
  }

  returnToClassroom(reason = "instructor_return"): void {
    if (!this.active || this.transitionInProgress) return;

    this.transitionInProgress = true;
    this.performTransition(() => {
      this.transitionInProgress = false;
      this.returnImmediately(reason);
    });
  }

  private returnImmediately(reason: string): void {
    if (!this.active) return;

    this.active = false;
    (window as any).isCastleActive = false;
    this.root.visible = false;

    for (const { object, visible } of this.savedClassroomVisibility) {
      object.visible = visible;
    }

    window.dispatchEvent(new CustomEvent("restoreClassroomSeat"));

    socket.emit("labReturnConfirmed", {
      reason,
      result: {
        status: "incomplete",
        score: 0,
        streak: 0,
        completedCards: 0,
        totalCards: 1,
        correctAnswers: 0,
        wrongAnswers: 0,
        accuracy: 0,
        durationSeconds: 0,
      },
    });

    console.log("[Castle] Returned to classroom.");
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

  // ── Castle geometry ──────────────────────────────────────────

  private buildCastle(): void {
    const stoneMat = new MeshStandardMaterial({
      color: STONE_COLOR,
      roughness: 0.95,
      metalness: 0.02,
    });
    const stoneDarkMat = new MeshStandardMaterial({
      color: STONE_DARK,
      roughness: 0.92,
    });
    const roofMat = new MeshStandardMaterial({
      color: ROOF_COLOR,
      roughness: 0.8,
    });
    const floorMat = new MeshStandardMaterial({
      color: FLOOR_COLOR,
      roughness: 0.98,
    });

    // Floor
    const floor = new Mesh(
      new BoxGeometry(ROOM_WIDTH, 0.1, ROOM_DEPTH),
      floorMat,
    );
    floor.position.y = -0.05;
    this.root.add(floor);

    // Ceiling
    const ceiling = new Mesh(
      new BoxGeometry(ROOM_WIDTH, 0.1, ROOM_DEPTH),
      stoneDarkMat,
    );
    ceiling.position.y = WALL_HEIGHT + 0.05;
    this.root.add(ceiling);

    // Walls — back, left, right, and front (with entrance gap)
    const halfW = ROOM_WIDTH / 2;
    const halfD = ROOM_DEPTH / 2;

    // Back wall (solid)
    this.root.add(this.makeWall(ROOM_WIDTH, WALL_HEIGHT, WALL_THICKNESS, stoneMat, 0, WALL_HEIGHT / 2, -halfD));

    // Left wall (solid)
    this.root.add(this.makeWall(WALL_THICKNESS, WALL_HEIGHT, ROOM_DEPTH, stoneMat, -halfW, WALL_HEIGHT / 2, 0));

    // Right wall (solid)
    this.root.add(this.makeWall(WALL_THICKNESS, WALL_HEIGHT, ROOM_DEPTH, stoneMat, halfW, WALL_HEIGHT / 2, 0));

    // Front wall — two segments with a 3-unit entrance gap in the centre
    const frontGap = 3;
    const frontSegWidth = (ROOM_WIDTH - frontGap) / 2;
    this.root.add(this.makeWall(frontSegWidth, WALL_HEIGHT, WALL_THICKNESS, stoneMat,
      -(frontGap / 2 + frontSegWidth / 2), WALL_HEIGHT / 2, halfD));
    this.root.add(this.makeWall(frontSegWidth, WALL_HEIGHT, WALL_THICKNESS, stoneMat,
      frontGap / 2 + frontSegWidth / 2, WALL_HEIGHT / 2, halfD));

    // Battlements (merlons) along the top of each wall
    this.addBattlements(ROOM_WIDTH, WALL_THICKNESS, stoneMat, 0, -halfD, "x");
    this.addBattlements(ROOM_DEPTH, WALL_THICKNESS, stoneMat, -halfW, 0, "z");
    this.addBattlements(ROOM_DEPTH, WALL_THICKNESS, stoneMat, halfW, 0, "z");

    // Four corner towers
    const towerPositions: Array<[number, number]> = [
      [-halfW, -halfD],
      [halfW, -halfD],
      [-halfW, halfD],
      [halfW, halfD],
    ];
    for (const [tx, tz] of towerPositions) {
      this.root.add(this.makeTower(tx, tz, stoneMat, roofMat));
    }

    // Torches (point lights) near each corner for atmosphere
    const torchPositions: Array<[number, number]> = [
      [-halfW + 1.5, -halfD + 1.5],
      [halfW - 1.5, -halfD + 1.5],
      [-halfW + 1.5, halfD - 1.5],
      [halfW - 1.5, halfD - 1.5],
    ];
    for (const [tx, tz] of torchPositions) {
      const torch = new PointLight(TORCH_COLOR, 2.5, 12, 1.8);
      torch.position.set(tx, WALL_HEIGHT - 1.2, tz);
      this.root.add(torch);

      // Small visible torch mesh
      const torchMesh = new Mesh(
        new CylinderGeometry(0.06, 0.08, 0.4, 8),
        new MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 }),
      );
      torchMesh.position.set(tx, WALL_HEIGHT - 1.2, tz);
      this.root.add(torchMesh);

      const flame = new Mesh(
        new ConeGeometry(0.12, 0.25, 8),
        new MeshStandardMaterial({
          color: TORCH_COLOR,
          emissive: TORCH_COLOR,
          emissiveIntensity: 0.8,
          roughness: 0.5,
        }),
      );
      flame.position.set(tx, WALL_HEIGHT - 0.95, tz);
      this.root.add(flame);
    }
  }

  private makeWall(
    w: number, h: number, d: number,
    material: MeshStandardMaterial,
    x: number, y: number, z: number,
  ): Mesh {
    const wall = new Mesh(new BoxGeometry(w, h, d), material);
    wall.position.set(x, y, z);
    return wall;
  }

  private addBattlements(
    length: number,
    thickness: number,
    material: MeshStandardMaterial,
    centerX: number,
    centerZ: number,
    axis: "x" | "z",
  ): void {
    const merlonSize = MERLON_WIDTH + MERLON_GAP;
    const count = Math.floor((length - MERLON_GAP) / merlonSize);
    const totalSpan = count * merlonSize - MERLON_GAP;
    const start = -totalSpan / 2 + MERLON_WIDTH / 2;

    for (let i = 0; i < count; i++) {
      const offset = start + i * merlonSize;
      const merlon = new Mesh(
        new BoxGeometry(MERLON_WIDTH, MERLON_HEIGHT, thickness),
        material,
      );
      if (axis === "x") {
        merlon.position.set(centerX + offset, WALL_HEIGHT + MERLON_HEIGHT / 2, centerZ);
      } else {
        merlon.position.set(centerX, WALL_HEIGHT + MERLON_HEIGHT / 2, centerZ + offset);
      }
      this.root.add(merlon);
    }
  }

  private makeTower(
    x: number, z: number,
    stoneMat: MeshStandardMaterial,
    roofMat: MeshStandardMaterial,
  ): Group {
    const tower = new Group();

    const body = new Mesh(
      new CylinderGeometry(TOWER_RADIUS, TOWER_RADIUS, TOWER_HEIGHT, 16),
      stoneMat,
    );
    body.position.y = TOWER_HEIGHT / 2;
    tower.add(body);

    const roof = new Mesh(
      new ConeGeometry(TOWER_RADIUS + 0.2, 2.2, 16),
      roofMat,
    );
    roof.position.y = TOWER_HEIGHT + 1.1;
    tower.add(roof);

    tower.position.set(x, 0, z);
    return tower;
  }

  // ── Network ─────────────────────────────────────────────────

  private connectNetwork(): void {
    socket.on("gameChanged", data => {
      if (data?.gameId === "python-puzzle-1") {
        this.enter();
      }
    });

    socket.on("returnToClassroom", data => {
      this.returnToClassroom(data?.returnReason ?? "instructor_return");
    });

    socket.on("modeChanged", data => {
      if (data?.mode === "Classroom Mode" && this.active) {
        this.returnToClassroom("instructor_return");
      }
    });

    socket.on("returnAllToClassroomNow", data => {
      if (this.active) {
        this.returnToClassroom(data?.returnReason ?? "instructor_return");
      }
    });

    socket.on("allStudentsReturnedToClass", () => {
      if (this.active) {
        this.returnToClassroom("instructor_return");
      }
    });
  }
}
