/**
 * Python Jigsaw Puzzle system for the castle environment.
 *
 * Creates grabbable code-line blocks, a slotted board at the centre, control
 * buttons (indent / dedent / reset / exit / submit), a soldier holding an
 * instructions board, a feedback panel, and a gold-coin celebration animation.
 * The player grabs blocks via raycast, drops them into board slots, adjusts
 * indentation, and submits to validate the assembled Python program.
 */
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DistanceGrabbable,
  DoubleSide,
  Grabbed,
  Group,
  Hovered,
  Mesh,
  MeshStandardMaterial,
  MovementMode,
  PanelDocument,
  PanelUI,
  PlaneGeometry,
  Pressed,
  RayInteractable,
  SphereGeometry,
  type UIKitDocument,
  Vector3,
  createSystem,
  type Entity,
} from "@iwsdk/core";
import { ExtrudeGeometry, Shape } from "three";

import { JigsawBlock, JigsawButton } from "./jigsawComponents.js";
import { PUZZLE_LINES, SHUFFLED_ORDER, EXPECTED_OUTPUT } from "./puzzleData.js";
import { attachToCastleRoot } from "./castleRoot.js";
import { setTextSafe } from "../../lab/systems/uiText.js";
import { runPython } from "./pythonRunner.js";

// ── Layout ────────────────────────────────────────────────────
// Mounted on the front wall (inner face at z ≈ +4.8), rotated 180° to face the player at -z.
const S = 1.1; // global scale factor for the entire puzzle assembly
const BOARD_CENTER: [number, number, number] = [0, 1.4, 4.8];
const BOARD_WIDTH = 1.4 * S;
const BOARD_HEIGHT = 1.0 * S;
const SLOT_HEIGHT = 0.14 * S;
const NUM_SLOTS = 7;

const BLOCK_WIDTH = 1.1 * S;
const BLOCK_HEIGHT = 0.11 * S;
const BLOCK_THICKNESS = 0.03 * S;
const INDENT_SHIFT = 0.15 * S;
const TAB_RADIUS = BLOCK_HEIGHT * 0.35;

/**
 * Builds a jigsaw-piece-shaped geometry: a rounded rectangle with a tab
 * (protrusion) on the top edge and a blank (indentation) on the bottom edge
 * so stacked blocks interlock like real puzzle pieces.
 */
function createJigsawBlockGeometry(
  width: number,
  height: number,
  depth: number,
): ExtrudeGeometry {
  const w = width / 2;
  const h = height / 2;
  const r = TAB_RADIUS;

  const shape = new Shape();
  shape.moveTo(-w, -h);

  // Bottom edge — blank (semicircular indentation into the piece)
  shape.lineTo(-r, -h);
  shape.absarc(0, -h, r, Math.PI, 0, true);
  shape.lineTo(w, -h);

  // Right edge
  shape.lineTo(w, h);

  // Top edge — tab (semicircular protrusion away from the piece)
  shape.lineTo(r, h);
  shape.absarc(0, h, r, 0, Math.PI, false);
  shape.lineTo(-w, h);

  // Left edge
  shape.lineTo(-w, -h);

  const geo = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.004 * S,
    bevelSize: 0.004 * S,
    bevelSegments: 2,
  });
  // Centre on z so the face panel position stays the same as with BoxGeometry.
  geo.translate(0, 0, -depth / 2);
  return geo;
}

const SHELF_X = 2.5 * S;
const SHELF_Z = 4.6; // slightly in front of the wall so blocks are grabbable

const BUTTON_X = -(BOARD_WIDTH / 2 + 0.22 * S); // right side of the board (player's right = -x)
const BUTTON_Z = BOARD_CENTER[2]; // mounted on wall, same plane as board
const BUTTON_SPACING = 0.24 * S; // vertical spacing
const BUTTON_SIZE = 0.14 * S;

const SOLDIER_X = -2.5 * S;
const SOLDIER_Z = 3.5 * S; // standing on the floor near the wall

// ── Colours ──────────────────────────────────────────────────
const BLOCK_COLOR = 0xd4a76a;
const BOARD_COLOR = 0x4a3b2a;
const SLOT_COLOR = 0x5a4a38;
const GOLD_COLOR = 0xffd700;
const ACTIVE_GLOW = 0xffd700;

const BUTTON_CONFIGS: {
  type: "indent" | "dedent" | "reset" | "exit" | "submit";
  label: string;
  color: number;
}[] = [
  { type: "indent", label: "Indent", color: 0x2f5b8f },
  { type: "dedent", label: "Dedent", color: 0x2f8f8f },
  { type: "reset", label: "Reset", color: 0xd97706 },
  { type: "exit", label: "Exit", color: 0x991b1b },
  { type: "submit", label: "Submit", color: 0x2f6f4f },
];

export class JigsawPuzzleSystem extends createSystem({
  blocks: { required: [JigsawBlock] },
  buttons: { required: [JigsawButton] },
  pressed: { required: [JigsawButton, Pressed] },
  heldBlocks: { required: [JigsawBlock, Grabbed] },
}) {
  private slotPositions: Vector3[] = [];
  private homePositions: Map<number, [number, number, number]> = new Map();
  private activeBlockOriginalIndex = -1;
  private blockEntities: Map<number, Entity> = new Map();
  private blockMaterials: Map<number, MeshStandardMaterial> = new Map();
  private feedbackEntity: Entity | null = null;
  private feedbackEntityIndex = -1;
  private feedbackDoc: UIKitDocument | null = null;
  private pendingFeedback: { title: string; body: string } | null = null;
  private pendingBlockText: Map<number, string> = new Map();
  private pendingButtonLabels: Map<number, string> = new Map();
  private coins: { mesh: Mesh; velocity: Vector3; life: number }[] = [];
  private coinAnimation = false;
  private tmpVec = new Vector3();

  // ── Lifecycle ──────────────────────────────────────────────

  init() {
    this.tmpVec = new Vector3();

    const startY =
      BOARD_CENTER[1] + BOARD_HEIGHT / 2 - SLOT_HEIGHT / 2;
    for (let i = 0; i < NUM_SLOTS; i++) {
      this.slotPositions.push(
        new Vector3(
          BOARD_CENTER[0],
          startY - i * SLOT_HEIGHT,
          BOARD_CENTER[2],
        ),
      );
    }

    for (let i = 0; i < NUM_SLOTS; i++) {
      const origIdx = SHUFFLED_ORDER[i];
      this.homePositions.set(origIdx, [
        SHELF_X,
        startY - i * SLOT_HEIGHT,
        SHELF_Z,
      ]);
    }

    this.buildBoard();
    this.createBlocks();
    this.createButtons();
    this.createSoldier();
    this.createFeedbackPanel();

    // Clear slot assignment when a block is grabbed off the board.
    this.queries.heldBlocks.subscribe("qualify", (block) => {
      const slot = block.getValue(JigsawBlock, "slotIndex") ?? -1;
      if (slot >= 0) {
        block.setValue(JigsawBlock, "slotIndex", -1);
      }
    });

    // Handle block release — snap to nearest slot or return home.
    this.queries.heldBlocks.subscribe("disqualify", (block) => {
      try {
        this.handleBlockRelease(block);
      } catch (err) {
        console.error("[Jigsaw] Block release error (non-fatal):", err);
      }
    });

    // Handle button presses.
    this.queries.pressed.subscribe("qualify", (button) => {
      try {
        this.handleButtonPress(button);
      } catch (err) {
        console.error("[Jigsaw] Button press error (non-fatal):", err);
      }
    });

    this.cleanupFuncs.push(() => this.teardown());
  }

  update(delta: number) {
    try {
      this.updateInner(delta);
    } catch (err) {
      console.error("[Jigsaw] Update error (non-fatal):", err);
    }
  }

  private updateInner(delta: number): void {
    // Apply pending text updates once PanelUI documents are ready.
    const docs = PanelDocument.data?.document;
    if (docs) {
      for (const [faceIndex, text] of this.pendingBlockText) {
        const doc = docs[faceIndex] as UIKitDocument | undefined;
        if (doc) {
          setTextSafe(doc, "code", text);
          this.pendingBlockText.delete(faceIndex);
        }
      }

      for (const [labelIndex, label] of this.pendingButtonLabels) {
        const doc = docs[labelIndex] as UIKitDocument | undefined;
        if (doc) {
          setTextSafe(doc, "label", label);
          this.pendingButtonLabels.delete(labelIndex);
        }
      }

      if (this.feedbackEntityIndex >= 0 && !this.feedbackDoc) {
        const doc = docs[this.feedbackEntityIndex] as
          | UIKitDocument
          | undefined;
        if (doc) {
          this.feedbackDoc = doc;
        }
      }
    }

    if (this.feedbackDoc && this.pendingFeedback) {
      setTextSafe(
        this.feedbackDoc,
        "feedback-title",
        this.pendingFeedback.title,
      );
      setTextSafe(
        this.feedbackDoc,
        "feedback-body",
        this.pendingFeedback.body,
      );
      this.pendingFeedback = null;
    }

    if (!(window as any).isCastleActive) return;

    if (this.coinAnimation) {
      this.updateCoins(delta);
    }

    this.updateActiveBlockHighlight();
  }

  // ── Board ──────────────────────────────────────────────────

  private buildBoard(): void {
    const boardGroup = new Group();

    const boardMat = new MeshStandardMaterial({
      color: BOARD_COLOR,
      roughness: 0.9,
    });
    const board = new Mesh(
      new BoxGeometry(BOARD_WIDTH, BOARD_HEIGHT, 0.04 * S),
      boardMat,
    );
    board.position.z = 0.02 * S;
    boardGroup.add(board);

    boardGroup.position.set(
      BOARD_CENTER[0],
      BOARD_CENTER[1],
      BOARD_CENTER[2],
    );
    attachToCastleRoot(boardGroup);
  }

  // ── Blocks ────────────────────────────────────────────────

  private createBlocks(): void {
    for (let i = 0; i < NUM_SLOTS; i++) {
      const origIdx = SHUFFLED_ORDER[i];
      const line = PUZZLE_LINES[origIdx];

      const group = new Group();

      const bodyMat = new MeshStandardMaterial({
        color: BLOCK_COLOR,
        roughness: 0.8,
      });
      const body = new Mesh(
        createJigsawBlockGeometry(BLOCK_WIDTH, BLOCK_HEIGHT, BLOCK_THICKNESS),
        bodyMat,
      );
      group.add(body);

      const block = this.world.createTransformEntity(group);
      attachToCastleRoot(group);
      block.addComponent(JigsawBlock, {
        lineId: line.id,
        text: line.text,
        slotIndex: -1,
        indent: 0,
        originalIndex: origIdx,
        faceEntity: null,
      });
      block.addComponent(RayInteractable);
      block.addComponent(DistanceGrabbable, {
        rotate: false,
        translate: true,
        movementMode: MovementMode.MoveFromTarget,
        returnToOrigin: false,
        detachOnGrab: false,
      });

      const face = this.world.createTransformEntity(undefined, {
        parent: block,
      });
      face.addComponent(PanelUI, {
        config: "./ui/jigsaw-block.json",
        maxWidth: BLOCK_WIDTH,
        maxHeight: BLOCK_HEIGHT,
      });
      // Offset must clear the ExtrudeGeometry bevel (0.004) so the panel
      // sits outside the opaque block mesh and is visible to the player.
      face.object3D!.position.set(
        0,
        0,
        -(BLOCK_THICKNESS / 2 + 0.006 * S),
      );
      face.object3D!.rotation.y = Math.PI;
      block.setValue(JigsawBlock, "faceEntity", face);

      const home = this.homePositions.get(origIdx)!;
      group.position.set(home[0], home[1], home[2]);

      this.blockEntities.set(origIdx, block);
      this.blockMaterials.set(origIdx, bodyMat);
      this.setBlockText(block);
    }
  }

  // ── Buttons ───────────────────────────────────────────────

  private createButtons(): void {
    // Buttons stacked vertically on the right side of the board, centred on
    // the board's vertical centre.
    const startY =
      BOARD_CENTER[1] +
      ((BUTTON_CONFIGS.length - 1) * BUTTON_SPACING) / 2;

    for (let i = 0; i < BUTTON_CONFIGS.length; i++) {
      const config = BUTTON_CONFIGS[i];
      const group = new Group();

      const buttonMat = new MeshStandardMaterial({
        color: config.color,
        roughness: 0.6,
        emissive: config.color,
        emissiveIntensity: 0.15,
      });
      // Wider-than-tall button so the label text fits clearly on its face.
      const button = new Mesh(
        new BoxGeometry(
          BUTTON_SIZE * 1.8,
          BUTTON_SIZE * 0.55,
          BUTTON_SIZE * 0.7,
        ),
        buttonMat,
      );
      group.add(button);

      const base = new Mesh(
        new BoxGeometry(
          BUTTON_SIZE * 2.0,
          BUTTON_SIZE * 0.12,
          BUTTON_SIZE * 0.9,
        ),
        new MeshStandardMaterial({
          color: 0x3a3a3a,
          roughness: 0.8,
        }),
      );
      base.position.y = -BUTTON_SIZE * 0.34;
      group.add(base);

      const entity = this.world.createTransformEntity(group);
      attachToCastleRoot(group);
      entity.addComponent(JigsawButton, {
        buttonType: config.type,
      });
      entity.addComponent(RayInteractable);

      group.position.set(
        BUTTON_X,
        startY - i * BUTTON_SPACING,
        BUTTON_Z,
      );

      // Label sits on the front face of the button, facing the player.
      const label = this.world.createTransformEntity(undefined, {
        parent: entity,
      });
      label.addComponent(PanelUI, {
        config: "./ui/jigsaw-button.json",
        maxWidth: BUTTON_SIZE * 2.2,
        maxHeight: BUTTON_SIZE * 0.7,
      });
      label.object3D!.position.set(0, 0, -BUTTON_SIZE * 0.38);
      label.object3D!.rotation.y = Math.PI;
      this.pendingButtonLabels.set(label.index, config.label);
    }
  }

  // ── Soldier with instructions board ───────────────────────

  private createSoldier(): void {
    const soldier = new Group();

    const armorMat = new MeshStandardMaterial({
      color: 0x6b6b6b,
      roughness: 0.6,
      metalness: 0.4,
    });
    const skinMat = new MeshStandardMaterial({
      color: 0xd4a76a,
      roughness: 0.8,
    });
    const darkMat = new MeshStandardMaterial({
      color: 0x4a4a4a,
      roughness: 0.8,
    });

    // Torso
    const torso = new Mesh(
      new CylinderGeometry(0.25 * S, 0.3 * S, 0.8 * S, 12),
      armorMat,
    );
    torso.position.y = 1.0 * S;
    soldier.add(torso);

    // Head
    const head = new Mesh(
      new SphereGeometry(0.15 * S, 12, 12),
      skinMat,
    );
    head.position.set(0, 1.55 * S, -0.05 * S);
    soldier.add(head);

    // Helmet
    const helmet = new Mesh(
      new ConeGeometry(0.18 * S, 0.2 * S, 12),
      armorMat,
    );
    helmet.position.set(0, 1.72 * S, -0.05 * S);
    soldier.add(helmet);

    // Left arm — extended forward to hold the board
    const leftArm = new Mesh(
      new CylinderGeometry(0.06 * S, 0.06 * S, 0.6 * S, 8),
      armorMat,
    );
    leftArm.position.set(-0.25 * S, 1.2 * S, -0.25 * S);
    leftArm.rotation.x = Math.PI / 3;
    soldier.add(leftArm);

    // Right arm
    const rightArm = new Mesh(
      new CylinderGeometry(0.06 * S, 0.06 * S, 0.5 * S, 8),
      armorMat,
    );
    rightArm.position.set(0.3 * S, 1.1 * S, 0);
    rightArm.rotation.z = -Math.PI / 6;
    soldier.add(rightArm);

    // Legs
    const leftLeg = new Mesh(
      new CylinderGeometry(0.08 * S, 0.08 * S, 0.6 * S, 8),
      darkMat,
    );
    leftLeg.position.set(-0.12 * S, 0.3 * S, 0);
    soldier.add(leftLeg);
    const rightLeg = new Mesh(
      new CylinderGeometry(0.08 * S, 0.08 * S, 0.6 * S, 8),
      darkMat,
    );
    rightLeg.position.set(0.12 * S, 0.3 * S, 0);
    soldier.add(rightLeg);

    soldier.position.set(SOLDIER_X, 0, SOLDIER_Z);
    soldier.lookAt(0, 1.3 * S, -1.0);
    attachToCastleRoot(soldier);

    // Standalone instructions board — positioned between the soldier and the
    // player, facing the player directly (not parented to the soldier, so the
    // lookAt rotation on the soldier doesn't interfere).
    const boardBacking = new Mesh(
      new BoxGeometry(0.75 * S, 1.0 * S, 0.03 * S),
      new MeshStandardMaterial({
        color: 0xf5f0e6,
        roughness: 0.9,
        side: DoubleSide,
      }),
    );
    // Place toward the player from the soldier, at chest height.
    const boardX = SOLDIER_X + 0.3 * S;
    const boardZ = SOLDIER_Z - 0.6 * S;
    boardBacking.position.set(boardX, 1.3 * S, boardZ);
    // Face the player at (0, ~1.3, -1.0)
    boardBacking.lookAt(0, 1.3 * S, -1.0);
    attachToCastleRoot(boardBacking);

    const instructionsEntity = this.world.createTransformEntity();
    instructionsEntity.addComponent(PanelUI, {
      config: "./ui/jigsaw-instructions.json",
      maxWidth: 0.6875 * S,
      maxHeight: 0.9375 * S,
    });
    instructionsEntity.object3D!.position.set(boardX, 1.3 * S, boardZ - 0.02 * S);
    // PanelUI text faces +z by default; rotate to face the player.
    instructionsEntity.object3D!.rotation.y = Math.atan2(
      0 - boardX,
      -1.0 - boardZ,
    );
    attachToCastleRoot(instructionsEntity.object3D!);
  }

  // ── Feedback panel ────────────────────────────────────────

  private createFeedbackPanel(): void {
    const entity = this.world.createTransformEntity();
    entity.addComponent(PanelUI, {
      config: "./ui/jigsaw-feedback.json",
      maxWidth: 1.2 * S,
      maxHeight: 0.6 * S,
    });
    entity.object3D!.position.set(0, 2.3 * S, 4.8);
    entity.object3D!.rotation.y = Math.PI;
    attachToCastleRoot(entity.object3D!);
    this.feedbackEntity = entity;
    this.feedbackEntityIndex = entity.index;
  }

  // ── Block release handling ────────────────────────────────

  private handleBlockRelease(block: Entity): void {
    const obj = block.object3D!;
    obj.getWorldPosition(this.tmpVec);

    // The board is a flat vertical wall at BOARD_CENTER[z]. DistanceGrabbable
    // may release the block slightly in front of the wall, so use a generous
    // z tolerance instead of a tight 3D distance from the board centre.
    const dz = Math.abs(this.tmpVec.z - BOARD_CENTER[2]);
    if (dz > 1.0) {
      this.returnBlockHome(block);
      return;
    }

    // Check that the block is within the board's x-y bounds (with margin).
    const dx = this.tmpVec.x - BOARD_CENTER[0];
    const dy = this.tmpVec.y - BOARD_CENTER[1];
    if (
      Math.abs(dx) > BOARD_WIDTH / 2 + 0.15 * S ||
      Math.abs(dy) > BOARD_HEIGHT / 2 + 0.15 * S
    ) {
      this.returnBlockHome(block);
      return;
    }

    // All slots share the same x (board centre), so find the nearest slot
    // by y position only.  If the block is anywhere on the board, snap it.
    let nearestSlot = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < NUM_SLOTS; i++) {
      const sdy = Math.abs(this.tmpVec.y - this.slotPositions[i].y);
      if (sdy < nearestDist) {
        nearestDist = sdy;
        nearestSlot = i;
      }
    }

    const occupyingBlock = this.findBlockInSlot(nearestSlot);
    if (occupyingBlock && occupyingBlock !== block) {
      this.returnBlockHome(occupyingBlock);
    }

    this.placeBlockInSlot(block, nearestSlot);
    this.activeBlockOriginalIndex = block.getValue(
      JigsawBlock,
      "originalIndex",
    ) ?? -1;
  }

  // ── Button press handling ─────────────────────────────────

  private handleButtonPress(button: Entity): void {
    const buttonType = button.getValue(JigsawButton, "buttonType");

    switch (buttonType) {
      case "indent":
        this.handleIndent(1);
        break;
      case "dedent":
        this.handleIndent(-1);
        break;
      case "reset":
        this.handleReset();
        break;
      case "exit":
        this.handleExit();
        break;
      case "submit":
        this.handleSubmit();
        break;
    }
  }

  private handleIndent(direction: number): void {
    let targetBlock: Entity | null = null;

    // Prefer the block the player is currently pointing at.
    for (const block of this.queries.blocks.entities) {
      if (
        block.hasComponent(Hovered) &&
        (block.getValue(JigsawBlock, "slotIndex") ?? -1) >= 0
      ) {
        targetBlock = block;
        break;
      }
    }

    // Fall back to the most recently placed block.
    if (
      !targetBlock &&
      this.activeBlockOriginalIndex >= 0
    ) {
      targetBlock =
        this.blockEntities.get(this.activeBlockOriginalIndex) ?? null;
    }

    if (!targetBlock) return;

    const slot = targetBlock.getValue(JigsawBlock, "slotIndex") ?? -1;
    if (slot < 0) return;

    let indent = targetBlock.getValue(JigsawBlock, "indent") ?? 0;
    indent = Math.max(0, Math.min(2, indent + direction));
    targetBlock.setValue(JigsawBlock, "indent", indent);

    const pos = this.slotPositions[slot];
    targetBlock.object3D!.position.set(
      pos.x - indent * INDENT_SHIFT,
      pos.y,
      pos.z,
    );
    targetBlock.object3D!.updateMatrixWorld(true);
    this.setBlockText(targetBlock);
  }

  private handleReset(): void {
    for (const block of this.queries.blocks.entities) {
      this.returnBlockHome(block);
    }
    this.activeBlockOriginalIndex = -1;
    this.showFeedback(
      "Reset",
      "All blocks returned to the shelf.\nTry again!",
    );
  }

  private handleExit(): void {
    window.dispatchEvent(new CustomEvent("castleExitRequested"));
  }

  private handleSubmit(): void {
    const slots: { text: string; indent: number }[] = [];
    for (let i = 0; i < NUM_SLOTS; i++) {
      const block = this.findBlockInSlot(i);
      if (!block) {
        this.showFeedback(
          "Error",
          "SyntaxError: incomplete input\n\nNot all code blocks are placed on the board.",
        );
        return;
      }
      slots.push({
        text: block.getValue(JigsawBlock, "text") ?? "",
        indent: block.getValue(JigsawBlock, "indent") ?? 0,
      });
    }

    // Assemble the Python source from the placed blocks.
    const code = slots
      .map((s) => "    ".repeat(s.indent) + s.text)
      .join("\n");

    this.showFeedback("Running…", "Executing your Python code…");
    void this.executePython(code);
  }

  private async executePython(code: string): Promise<void> {
    const result = await runPython(code);

    if (result.success) {
      if (result.output.trim() === EXPECTED_OUTPUT.trim()) {
        this.showFeedback(
          "Success!",
          `Correct! The code runs successfully.\n\nOutput:\n${result.output.trim()}`,
        );
        this.showGoldCoins();
      } else {
        this.showFeedback(
          "Wrong Output",
          `The code runs but produces the wrong output.\n\nYour output:\n${result.output.trim()}\n\nExpected:\n${EXPECTED_OUTPUT.trim()}`,
        );
      }
    } else {
      this.showFeedback("Error", result.error);
    }
  }

  // ── Feedback ──────────────────────────────────────────────

  private showFeedback(title: string, body: string): void {
    this.pendingFeedback = { title, body };
  }

  // ── Gold coin animation ───────────────────────────────────

  private showGoldCoins(): void {
    this.coinAnimation = true;
    const coinGeo = new CylinderGeometry(0.03 * S, 0.03 * S, 0.008 * S, 12);
    const coinMat = new MeshStandardMaterial({
      color: GOLD_COLOR,
      emissive: GOLD_COLOR,
      emissiveIntensity: 0.4,
      metalness: 0.9,
      roughness: 0.2,
      transparent: true,
    });

    for (let i = 0; i < 40; i++) {
      const coin = new Mesh(coinGeo, coinMat);
      coin.position.set(
        BOARD_CENTER[0] + (Math.random() - 0.5) * 0.3 * S,
        BOARD_CENTER[1],
        BOARD_CENTER[2] + (Math.random() - 0.5) * 0.3 * S,
      );
      const velocity = new Vector3(
        (Math.random() - 0.5) * 2,
        2 + Math.random() * 2,
        (Math.random() - 0.5) * 2,
      );
      this.coins.push({ mesh: coin, velocity, life: 1.0 });
      attachToCastleRoot(coin);
    }
  }

  private updateCoins(delta: number): void {
    const gravity = -5;
    let allDead = true;

    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      coin.life -= delta * 0.5;

      if (coin.life <= 0) {
        coin.mesh.parent?.remove(coin.mesh);
        this.coins.splice(i, 1);
        continue;
      }

      allDead = false;
      coin.velocity.y += gravity * delta;
      coin.mesh.position.x += coin.velocity.x * delta;
      coin.mesh.position.y += coin.velocity.y * delta;
      coin.mesh.position.z += coin.velocity.z * delta;
      coin.mesh.rotation.x += delta * 5;
      coin.mesh.rotation.z += delta * 3;

      const mat = coin.mesh.material as MeshStandardMaterial;
      mat.opacity = Math.max(0, coin.life);
    }

    if (allDead) {
      this.coinAnimation = false;
    }
  }

  // ── Active block highlighting ─────────────────────────────

  private updateActiveBlockHighlight(): void {
    for (const [origIdx, mat] of this.blockMaterials) {
      const isActive = origIdx === this.activeBlockOriginalIndex;
      mat.emissive.setHex(isActive ? ACTIVE_GLOW : 0x000000);
      mat.emissiveIntensity = isActive ? 0.3 : 0;
    }
  }

  // ── Helpers ───────────────────────────────────────────────

  private setBlockText(block: Entity): void {
    const text = block.getValue(JigsawBlock, "text") ?? "";
    const indent = block.getValue(JigsawBlock, "indent") ?? 0;
    const indentedText = "    ".repeat(indent) + text;

    const face = block.getValue(JigsawBlock, "faceEntity");
    if (!face) return;

    const docs = PanelDocument.data?.document;
    if (!docs) return;

    const doc = docs[face.index] as UIKitDocument | undefined;
    if (!doc) {
      this.pendingBlockText.set(face.index, indentedText);
      return;
    }

    setTextSafe(doc, "code", indentedText);
  }

  private placeBlockInSlot(block: Entity, slot: number): void {
    block.setValue(JigsawBlock, "slotIndex", slot);
    const indent = block.getValue(JigsawBlock, "indent") ?? 0;
    const pos = this.slotPositions[slot];
    block.object3D!.position.set(
      pos.x - indent * INDENT_SHIFT,
      pos.y,
      pos.z,
    );
    block.object3D!.rotation.set(0, 0, 0);
    block.object3D!.updateMatrixWorld(true);
    this.setBlockText(block);
  }

  private returnBlockHome(block: Entity): void {
    block.setValue(JigsawBlock, "slotIndex", -1);
    block.setValue(JigsawBlock, "indent", 0);
    const origIdx = block.getValue(JigsawBlock, "originalIndex") ?? 0;
    const home = this.homePositions.get(origIdx)!;
    block.object3D!.position.set(home[0], home[1], home[2]);
    block.object3D!.rotation.set(0, 0, 0);
    block.object3D!.updateMatrixWorld(true);
    this.setBlockText(block);
  }

  private findBlockInSlot(slot: number): Entity | null {
    for (const block of this.queries.blocks.entities) {
      if (block.getValue(JigsawBlock, "slotIndex") === slot) {
        return block;
      }
    }
    return null;
  }

  // ── Teardown ──────────────────────────────────────────────

  private teardown(): void {
    for (const block of this.queries.blocks.entities) {
      const face = block.getValue(JigsawBlock, "faceEntity");
      if (face) face.dispose();
      block.dispose();
    }
    for (const button of this.queries.buttons.entities) {
      button.dispose();
    }
    this.feedbackEntity?.dispose();
    for (const coin of this.coins) {
      coin.mesh.parent?.remove(coin.mesh);
    }
    this.coins = [];
    this.blockEntities.clear();
    this.blockMaterials.clear();
    this.pendingBlockText.clear();
    this.pendingButtonLabels.clear();
  }
}
