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
  DoubleSide,
  Grabbed,
  Group,
  Hovered,
  Interactable,
  Mesh,
  MeshStandardMaterial,
  OneHandGrabbable,
  PanelDocument,
  PanelUI,
  PlaneGeometry,
  Pressed,
  SphereGeometry,
  type UIKitDocument,
  Vector3,
  createSystem,
  type Entity,
} from "@iwsdk/core";
import { ExtrudeGeometry, Shape } from "three";

import { JigsawBlock, JigsawButton } from "./jigsawComponents.js";
import { PUZZLE_LINES, SHUFFLED_ORDER } from "./puzzleData.js";
import { attachToCastleRoot } from "./castleRoot.js";
import { setTextSafe } from "../../lab/systems/uiText.js";

// ── Layout ────────────────────────────────────────────────────
// Mounted on the front wall (inner face at z ≈ +4.8), rotated 180° to face the player at -z.
const BOARD_CENTER: [number, number, number] = [0, 1.4, 4.8];
const BOARD_WIDTH = 1.4;
const BOARD_HEIGHT = 1.0;
const SLOT_HEIGHT = 0.14;
const NUM_SLOTS = 7;

const BLOCK_WIDTH = 1.1;
const BLOCK_HEIGHT = 0.11;
const BLOCK_THICKNESS = 0.03;
const INDENT_SHIFT = 0.15;
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
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 2,
  });
  // Centre on z so the face panel position stays the same as with BoxGeometry.
  geo.translate(0, 0, -depth / 2);
  return geo;
}

const SHELF_X = 2.5;
const SHELF_Z = 4.6; // slightly in front of the wall so blocks are grabbable

const BUTTON_Y = 0.6;
const BUTTON_Z = 4.7; // mounted on wall, below the board
const BUTTON_SPACING = 0.28;
const BUTTON_SIZE = 0.1;

const SOLDIER_X = -2.5;
const SOLDIER_Z = 3.5; // standing on the floor near the wall

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
      this.handleBlockRelease(block);
    });

    // Handle button presses.
    this.queries.pressed.subscribe("qualify", (button) => {
      this.handleButtonPress(button);
    });

    this.cleanupFuncs.push(() => this.teardown());
  }

  update(delta: number) {
    // Apply pending text updates once PanelUI documents are ready.
    for (const [faceIndex, text] of this.pendingBlockText) {
      const doc = PanelDocument.data.document[faceIndex] as
        | UIKitDocument
        | undefined;
      if (doc) {
        setTextSafe(doc, "code", text);
        this.pendingBlockText.delete(faceIndex);
      }
    }

    for (const [labelIndex, label] of this.pendingButtonLabels) {
      const doc = PanelDocument.data.document[labelIndex] as
        | UIKitDocument
        | undefined;
      if (doc) {
        setTextSafe(doc, "label", label);
        this.pendingButtonLabels.delete(labelIndex);
      }
    }

    if (this.feedbackEntityIndex >= 0 && !this.feedbackDoc) {
      const doc = PanelDocument.data.document[
        this.feedbackEntityIndex
      ] as UIKitDocument | undefined;
      if (doc) {
        this.feedbackDoc = doc;
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
      new BoxGeometry(BOARD_WIDTH, BOARD_HEIGHT, 0.04),
      boardMat,
    );
    board.position.z = 0.02;
    boardGroup.add(board);

    // Slot markers — thin lighter strips showing where blocks go.
    const slotMat = new MeshStandardMaterial({
      color: SLOT_COLOR,
      roughness: 0.85,
      side: DoubleSide,
    });
    for (let i = 0; i < NUM_SLOTS; i++) {
      const slotMarker = new Mesh(
        new PlaneGeometry(BLOCK_WIDTH + 0.06, SLOT_HEIGHT - 0.02),
        slotMat,
      );
      slotMarker.position.set(
        this.slotPositions[i].x,
        this.slotPositions[i].y,
        -0.001,
      );
      boardGroup.add(slotMarker);
    }

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
      block.addComponent(Interactable);
      block.addComponent(OneHandGrabbable, {
        rotate: false,
        translate: true,
      });

      const face = this.world.createTransformEntity(undefined, {
        parent: block,
      });
      face.addComponent(PanelUI, {
        config: "./ui/jigsaw-block.json",
        maxWidth: BLOCK_WIDTH,
        maxHeight: BLOCK_HEIGHT,
      });
      face.object3D!.position.set(
        0,
        0,
        -(BLOCK_THICKNESS / 2 + 0.001),
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
    const startX =
      -((BUTTON_CONFIGS.length - 1) * BUTTON_SPACING) / 2;

    for (let i = 0; i < BUTTON_CONFIGS.length; i++) {
      const config = BUTTON_CONFIGS[i];
      const group = new Group();

      const buttonMat = new MeshStandardMaterial({
        color: config.color,
        roughness: 0.6,
        emissive: config.color,
        emissiveIntensity: 0.1,
      });
      const button = new Mesh(
        new BoxGeometry(BUTTON_SIZE, BUTTON_SIZE * 0.4, BUTTON_SIZE),
        buttonMat,
      );
      group.add(button);

      const base = new Mesh(
        new BoxGeometry(
          BUTTON_SIZE * 1.2,
          BUTTON_SIZE * 0.1,
          BUTTON_SIZE * 1.2,
        ),
        new MeshStandardMaterial({
          color: 0x3a3a3a,
          roughness: 0.8,
        }),
      );
      base.position.y = -BUTTON_SIZE * 0.25;
      group.add(base);

      const entity = this.world.createTransformEntity(group);
      attachToCastleRoot(group);
      entity.addComponent(JigsawButton, {
        buttonType: config.type,
      });
      entity.addComponent(Interactable);

      group.position.set(
        startX + i * BUTTON_SPACING,
        BUTTON_Y,
        BUTTON_Z,
      );

      const label = this.world.createTransformEntity(undefined, {
        parent: entity,
      });
      label.addComponent(PanelUI, {
        config: "./ui/jigsaw-button.json",
        maxWidth: BUTTON_SIZE * 1.5,
        maxHeight: BUTTON_SIZE * 0.5,
      });
      label.object3D!.position.set(0, BUTTON_SIZE * 0.35, 0);
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
    const boardMat = new MeshStandardMaterial({
      color: 0xf5f0e6,
      roughness: 0.9,
      side: DoubleSide,
    });

    // Torso
    const torso = new Mesh(
      new CylinderGeometry(0.25, 0.3, 0.8, 12),
      armorMat,
    );
    torso.position.y = 1.0;
    soldier.add(torso);

    // Head
    const head = new Mesh(
      new SphereGeometry(0.15, 12, 12),
      skinMat,
    );
    head.position.set(0, 1.55, -0.05);
    soldier.add(head);

    // Helmet
    const helmet = new Mesh(
      new ConeGeometry(0.18, 0.2, 12),
      armorMat,
    );
    helmet.position.set(0, 1.72, -0.05);
    soldier.add(helmet);

    // Left arm — extended forward to hold the board
    const leftArm = new Mesh(
      new CylinderGeometry(0.06, 0.06, 0.6, 8),
      armorMat,
    );
    leftArm.position.set(-0.25, 1.2, -0.25);
    leftArm.rotation.x = Math.PI / 3;
    soldier.add(leftArm);

    // Right arm
    const rightArm = new Mesh(
      new CylinderGeometry(0.06, 0.06, 0.5, 8),
      armorMat,
    );
    rightArm.position.set(0.3, 1.1, 0);
    rightArm.rotation.z = -Math.PI / 6;
    soldier.add(rightArm);

    // Legs
    const leftLeg = new Mesh(
      new CylinderGeometry(0.08, 0.08, 0.6, 8),
      darkMat,
    );
    leftLeg.position.set(-0.12, 0.3, 0);
    soldier.add(leftLeg);
    const rightLeg = new Mesh(
      new CylinderGeometry(0.08, 0.08, 0.6, 8),
      darkMat,
    );
    rightLeg.position.set(0.12, 0.3, 0);
    soldier.add(rightLeg);

    // Instructions board backing (in front of the soldier, facing the player)
    const boardBacking = new Mesh(
      new BoxGeometry(0.6, 0.8, 0.03),
      boardMat,
    );
    boardBacking.position.set(0, 1.3, -0.45);
    soldier.add(boardBacking);

    // Instructions text panel
    const instructionsEntity = this.world.createTransformEntity();
    instructionsEntity.addComponent(PanelUI, {
      config: "./ui/jigsaw-instructions.json",
      maxWidth: 0.55,
      maxHeight: 0.75,
    });
    instructionsEntity.object3D!.position.set(0, 1.3, -0.47);
    instructionsEntity.object3D!.rotation.y = Math.PI;
    soldier.add(instructionsEntity.object3D!);

    soldier.position.set(SOLDIER_X, 0, SOLDIER_Z);
    soldier.lookAt(0, 1.3, -1.0);
    attachToCastleRoot(soldier);
  }

  // ── Feedback panel ────────────────────────────────────────

  private createFeedbackPanel(): void {
    const entity = this.world.createTransformEntity();
    entity.addComponent(PanelUI, {
      config: "./ui/jigsaw-feedback.json",
      maxWidth: 1.2,
      maxHeight: 0.6,
    });
    entity.object3D!.position.set(0, 2.3, 4.8);
    entity.object3D!.rotation.y = Math.PI;
    attachToCastleRoot(entity.object3D!);
    this.feedbackEntity = entity;
    this.feedbackEntityIndex = entity.index;
  }

  // ── Block release handling ────────────────────────────────

  private handleBlockRelease(block: Entity): void {
    const obj = block.object3D!;
    obj.getWorldPosition(this.tmpVec);

    const dx = this.tmpVec.x - BOARD_CENTER[0];
    const dz = this.tmpVec.z - BOARD_CENTER[2];
    const distToBoard = Math.sqrt(dx * dx + dz * dz);

    if (distToBoard > 0.8) {
      this.returnBlockHome(block);
      return;
    }

    let nearestSlot = -1;
    let nearestDist = Infinity;
    for (let i = 0; i < NUM_SLOTS; i++) {
      const sdx = this.tmpVec.x - this.slotPositions[i].x;
      const sdy = this.tmpVec.y - this.slotPositions[i].y;
      const sdz = this.tmpVec.z - this.slotPositions[i].z;
      const d = Math.sqrt(sdx * sdx + sdy * sdy + sdz * sdz);
      if (d < nearestDist) {
        nearestDist = d;
        nearestSlot = i;
      }
    }

    if (nearestSlot < 0 || nearestDist > 0.25) {
      this.returnBlockHome(block);
      return;
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
      pos.x + indent * INDENT_SHIFT,
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

    const result = this.validateCode(slots);
    if (result.correct) {
      this.showFeedback(
        "Success!",
        "Correct! The code runs successfully.\n\nOutput:\n52\n50\n51\n47\nTotal: 200\nAverage: 50.0",
      );
      this.showGoldCoins();
    } else {
      this.showFeedback("Error", result.error);
    }
  }

  // ── Code validation ───────────────────────────────────────

  private validateCode(
    slots: { text: string; indent: number }[],
  ): { correct: boolean; error: string } {
    const correctTexts = PUZZLE_LINES.map((l) => l.text);
    const correctIndents = PUZZLE_LINES.map((l) => l.correctIndent);

    // Check order first.
    for (let i = 0; i < NUM_SLOTS; i++) {
      if (slots[i].text !== correctTexts[i]) {
        // Generate a relevant Python error.
        if (
          slots[i].text.includes("total = total + lap") &&
          i < 3
        ) {
          return {
            correct: false,
            error: `NameError: name 'lap' is not defined\n\nLine ${i + 1}: ${slots[i].text}`,
          };
        }
        if (
          slots[i].text.startsWith("print(") &&
          i < 3
        ) {
          return {
            correct: false,
            error: `NameError: name not defined\n\nLine ${i + 1}: ${slots[i].text}`,
          };
        }
        return {
          correct: false,
          error: `SyntaxError: invalid syntax\n\nLine ${i + 1}: ${slots[i].text}`,
        };
      }
    }

    // Check indentation.
    for (let i = 0; i < NUM_SLOTS; i++) {
      if (slots[i].indent !== correctIndents[i]) {
        if (correctIndents[i] === 1 && slots[i].indent === 0) {
          return {
            correct: false,
            error: `IndentationError: expected an indented block\n\nLine ${i + 1}: ${slots[i].text}`,
          };
        }
        return {
          correct: false,
          error: `IndentationError: unexpected indent\n\nLine ${i + 1}: ${slots[i].text}`,
        };
      }
    }

    return { correct: true, error: "" };
  }

  // ── Feedback ──────────────────────────────────────────────

  private showFeedback(title: string, body: string): void {
    this.pendingFeedback = { title, body };
  }

  // ── Gold coin animation ───────────────────────────────────

  private showGoldCoins(): void {
    this.coinAnimation = true;
    const coinGeo = new CylinderGeometry(0.03, 0.03, 0.008, 12);
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
        BOARD_CENTER[0] + (Math.random() - 0.5) * 0.3,
        BOARD_CENTER[1],
        BOARD_CENTER[2] + (Math.random() - 0.5) * 0.3,
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

    const doc = PanelDocument.data.document[face.index] as
      | UIKitDocument
      | undefined;
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
      pos.x + indent * INDENT_SHIFT,
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
