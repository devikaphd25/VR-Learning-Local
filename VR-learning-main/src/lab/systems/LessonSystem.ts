/** Starts/resets a lesson, builds its deck, spawns cards, and reports live progress. */
import { AudioUtils, Box3, BoxGeometry, createSystem, DoubleSide, Group, Interactable, Mesh, MeshStandardMaterial, OneHandGrabbable, PanelDocument, PanelUI, PlaneGeometry, Quaternion, type UIKitDocument, Vector3, } from "@iwsdk/core";
import { TypeCard } from "../components/gameComponents.js";
import { setTextSafe } from "./uiText.js";
import { generateLessonDeck } from "../data/randomLesson.js";
import { clearFeedback, getActiveDeck, getCorrectAnswersSignal, getCorrectAudioEntity, getCardIndexSignal, getDispenseStateSignal, getGameCommandSignal, getLessonStateSignal, getScoreSignal, getStreakSignal, getWrongAnswersSignal, playSilentCue, setActiveDeck, UMES_MAROON, } from "../state/gameState.js";
import { CARD_HEIGHT, CARD_THICKNESS, CARD_WIDTH, FACE_DOWN_ROTATION_X, FACE_DOWN_ROTATION_Y, FACE_DOWN_ROTATION_Z, SPAWN_POSITION, } from "../state/layout.js";
import { centerOnOrigin, getModelOrNull } from "../visuals/modelBinding.js";
import { attachToLabRoot } from "../runtime/labRoot.js";
const CARD_FACE_GAP = 0.0001;
export interface SpawnTarget {
    position: {
        x: number;
        y: number;
        z: number;
    };
    quaternion: {
        x: number;
        y: number;
        z: number;
        w: number;
    };
}
type SpawnHandler = (deckIndex: number, target?: SpawnTarget) => boolean;
let spawnHandler: SpawnHandler | null = null;
export function installSpawnHandler(fn: SpawnHandler): void {
    spawnHandler = fn;
}
export function clearSpawnHandler(fn: SpawnHandler): void {
    if (spawnHandler === fn)
        spawnHandler = null;
}
export function requestSpawnCard(deckIndex: number, target?: SpawnTarget): boolean {
    return spawnHandler ? spawnHandler(deckIndex, target) : false;
}
export class LessonSystem extends createSystem({
    cards: { required: [TypeCard] },
}) {
    private clearedFaces = new Set<number>();
    private boundSpawnHandler: SpawnHandler = (deckIndex, target) => this.spawnCard(deckIndex, target);
    init() {
        installSpawnHandler(this.boundSpawnHandler);
        this.cleanupFuncs.push(() => clearSpawnHandler(this.boundSpawnHandler));
        this.cleanupFuncs.push(getGameCommandSignal().subscribe((cmd) => {
            if (cmd === "none")
                return;
            this.handleCommand(cmd);
            const current = getGameCommandSignal().peek();
            if (current === cmd) {
                getGameCommandSignal().value = "none";
            }
        }));
    }
    update(): void {
        for (const card of this.queries.cards.entities) {
            const state = card.getValue(TypeCard, "state");
            if (state !== "hidden" && state !== "held")
                continue;
            const face = card.getValue(TypeCard, "faceEntity");
            if (!face || this.clearedFaces.has(face.index))
                continue;
            const doc = PanelDocument.data.document[face.index] as UIKitDocument | undefined;
            if (!doc)
                continue;
            if (setTextSafe(doc, "value", "")) {
                this.clearedFaces.add(face.index);
            }
        }
    }
    private handleCommand(cmd: string): void {
        switch (cmd) {
            case "start":
                this.startLesson();
                break;
            case "reset":
                this.resetLesson();
                break;
            case "complete":
                this.completeLesson();
                break;
            default:
                break;
        }
    }
    private startLesson(): void {
        if (getLessonStateSignal().peek() !== "idle")
            return;
        clearFeedback();
        setActiveDeck(generateLessonDeck());
        getCardIndexSignal().value = 0;
        getLessonStateSignal().value = "playing";
        getDispenseStateSignal().value = "idle";
        playSilentCue();
    }
    private resetLesson(): void {
        this.disposeAllCards();
        clearFeedback();
        getScoreSignal().value = 0;
        getStreakSignal().value = 0;
        getCorrectAnswersSignal().value = 0;
        getWrongAnswersSignal().value = 0;
        getCardIndexSignal().value = 0;
        setActiveDeck(generateLessonDeck());
        getLessonStateSignal().value = "playing";
        getDispenseStateSignal().value = "idle";
        playSilentCue();
    }
    private completeLesson(): void {
        getLessonStateSignal().value = "complete";
        const audio = getCorrectAudioEntity();
        if (audio)
            AudioUtils.play(audio);
    }
    private disposeAllCards(): void {
        for (const card of this.queries.cards.entities) {
            const face = card.getValue(TypeCard, "faceEntity");
            if (face) {
                this.clearedFaces.delete(face.index);
                face.dispose();
            }
            card.dispose();
        }
    }
    private spawnCard(deckIndex: number, target?: SpawnTarget): boolean {
        const data = getActiveDeck()[deckIndex];
        if (!data) {
            console.warn("[PythonTypeLab] No active deck card at index", deckIndex, "— skipping spawn (fail safe).");
            return false;
        }
        if (typeof data.displayValue !== "string" || data.displayValue.length === 0) {
            console.warn("[PythonTypeLab] Invalid card display value:", data.displayValue);
        }
        const group = new Group();
        let faceWidth = CARD_WIDTH;
        let faceHeight = CARD_HEIGHT;
        let faceZ = CARD_THICKNESS / 2 + CARD_FACE_GAP;
        let cardVisualLocalQuaternion: Quaternion | null = null;
        const bodyMaterial = new MeshStandardMaterial({
            color: 0x2a0f12,
            roughness: 0.85,
        });
        const body = new Mesh(new BoxGeometry(CARD_WIDTH, CARD_HEIGHT, CARD_THICKNESS), bodyMaterial);
        group.add(body);
        const cardModel = getModelOrNull("cardModel");
        if (cardModel) {
            centerOnOrigin(cardModel);
            cardModel.updateMatrixWorld(true);
            const cardBounds = new Box3().setFromObject(cardModel);
            const cardSize = cardBounds.getSize(new Vector3());
            faceWidth = cardSize.x;
            faceHeight = cardSize.y;
            faceZ = cardBounds.max.z + CARD_FACE_GAP;
            const visualNode = cardModel.getObjectByProperty("isMesh", true);
            if (visualNode) {
                cardVisualLocalQuaternion = new Quaternion();
                visualNode.getWorldQuaternion(cardVisualLocalQuaternion);
            }
            group.add(cardModel);
            bodyMaterial.colorWrite = false;
            bodyMaterial.depthWrite = false;
        }
        else {
            bodyMaterial.color.setHex(0xf5f0e6);
            const back = new Mesh(new PlaneGeometry(CARD_WIDTH * 0.96, CARD_HEIGHT * 0.96), new MeshStandardMaterial({
                color: UMES_MAROON,
                roughness: 0.7,
                side: DoubleSide,
            }));
            back.position.z = -CARD_THICKNESS / 2 - 0.004;
            back.rotation.y = Math.PI;
            group.add(back);
        }
        const card = this.world.createTransformEntity(group);
        attachToLabRoot(group);
        card.addComponent(TypeCard, {
            cardId: data.id,
            displayValue: data.displayValue,
            expectedType: data.expectedType,
            state: "hidden",
            wrongAttempts: 0,
            deckIndex,
            faceEntity: null,
        });
        card.addComponent(Interactable);
        card.addComponent(OneHandGrabbable, { rotate: true, translate: true });
        const face = this.world.createTransformEntity(undefined, {
            parent: card,
        });
        face.addComponent(PanelUI, {
            config: "./ui/cardFace.json",
            maxWidth: faceWidth,
            maxHeight: faceHeight,
        });
        face.object3D!.position.set(0, 0, faceZ);
        face.object3D!.rotation.y = 0;
        card.setValue(TypeCard, "faceEntity", face);
        console.log("[PythonTypeLab] Spawned card:", {
            id: data.id,
            displayValue: data.displayValue,
            faceEntity: face.index,
        });
        if (target) {
            group.position.set(target.position.x, target.position.y, target.position.z);
            if (cardModel && cardVisualLocalQuaternion) {
                const q = new Quaternion(target.quaternion.x, target.quaternion.y, target.quaternion.z, target.quaternion.w);
                cardVisualLocalQuaternion.invert();
                group.quaternion.copy(q).multiply(cardVisualLocalQuaternion);
            }
            else {
                group.rotation.set(FACE_DOWN_ROTATION_X, FACE_DOWN_ROTATION_Y, FACE_DOWN_ROTATION_Z);
            }
        }
        else {
            group.position.set(SPAWN_POSITION[0], SPAWN_POSITION[1], SPAWN_POSITION[2]);
            group.rotation.set(FACE_DOWN_ROTATION_X, FACE_DOWN_ROTATION_Y, FACE_DOWN_ROTATION_Z);
        }
        console.log("[PythonTypeLab] Card spawn:", {
            handoff: !!target,
            displayValue: data.displayValue,
        });
        return true;
    }
}
