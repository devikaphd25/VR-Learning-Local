/** Reveals a grabbed card's value when the learner rotates it into the reveal pose. */
import { AudioSource, AudioUtils, createSystem, type Entity, Grabbed, InputComponent, PanelDocument, PlaybackMode, type UIKitDocument, Vector3, } from "@iwsdk/core";
import { TypeCard } from "../components/gameComponents.js";
import { REVEAL_DOT_THRESHOLD, REVEAL_UP_THRESHOLD } from "../state/layout.js";
import { setTextSafe } from "./uiText.js";
export class FlipRevealSystem extends createSystem({
    heldCards: { required: [TypeCard, Grabbed] },
}) {
    private frontNormal!: Vector3;
    private cardPos!: Vector3;
    private headPos!: Vector3;
    private toHead!: Vector3;
    private pendingReveals = new Map<number, string>();
    private flipAudioEntity: Entity | null = null;
    init() {
        this.frontNormal = new Vector3();
        this.cardPos = new Vector3();
        this.headPos = new Vector3();
        this.toHead = new Vector3();
        this.flipAudioEntity = this.world
            .createTransformEntity()
            .addComponent(AudioSource, {
            src: "/audio/card-flip.wav",
            volume: 0.75,
            positional: false,
            maxInstances: 1,
            playbackMode: PlaybackMode.Restart,
        });
        this.cleanupFuncs.push(() => {
            if (!this.flipAudioEntity)
                return;
            AudioUtils.stop(this.flipAudioEntity);
            this.flipAudioEntity.dispose();
            this.flipAudioEntity = null;
        });
        this.queries.heldCards.subscribe("qualify", (card) => {
            const state = card.getValue(TypeCard, "state");
            if (state === "hidden") {
                card.setValue(TypeCard, "state", "held");
            }
        });
    }
    update() {
        if (this.queries.heldCards.entities.size === 0 &&
            this.pendingReveals.size > 0) {
            this.pendingReveals.clear();
        }
        for (const card of this.queries.heldCards.entities) {
            if (this.pendingReveals.has(card.index)) {
                this.applyReveal(card);
            }
        }
        for (const card of this.queries.heldCards.entities) {
            const state = card.getValue(TypeCard, "state");
            if (state !== "hidden" && state !== "held")
                continue;
            if (this.pendingReveals.has(card.index))
                continue;
            if (this.shouldReveal(card)) {
                this.requestReveal(card);
            }
        }
    }
    private shouldReveal(card: Entity): boolean {
        const obj = card.object3D!;
        obj.getWorldDirection(this.frontNormal);
        if (this.frontNormal.y > REVEAL_UP_THRESHOLD) {
            return true;
        }
        obj.getWorldPosition(this.cardPos);
        this.player.head.getWorldPosition(this.headPos);
        this.toHead.subVectors(this.headPos, this.cardPos);
        if (this.toHead.lengthSq() > 0.0001) {
            this.toHead.normalize();
            if (this.frontNormal.dot(this.toHead) > REVEAL_DOT_THRESHOLD) {
                return true;
            }
        }
        const left = this.input.xr.gamepads.left;
        const right = this.input.xr.gamepads.right;
        return !!(left?.getButtonDown(InputComponent.Trigger) ||
            right?.getButtonDown(InputComponent.Trigger));
    }
    private requestReveal(card: Entity): void {
        this.pendingReveals.set(card.index, card.index.toString());
        console.log("[PythonTypeLab] Reveal requested:", {
            displayValue: card.getValue(TypeCard, "displayValue"),
            state: card.getValue(TypeCard, "state"),
        });
        this.applyReveal(card);
    }
    private applyReveal(card: Entity): void {
        if (!this.pendingReveals.has(card.index))
            return;
        const value = card.getValue(TypeCard, "displayValue");
        if (typeof value !== "string" || value.length === 0) {
            console.warn("[PythonTypeLab] Invalid card display value:", value);
            this.pendingReveals.delete(card.index);
            return;
        }
        const face = card.getValue(TypeCard, "faceEntity");
        if (!face)
            return;
        const doc = PanelDocument.data.document[face.index] as UIKitDocument | undefined;
        if (!doc) {
            console.warn("[PythonTypeLab] Card face document not ready");
            return;
        }
        const written = setTextSafe(doc, "value", value);
        if (!written) {
            console.warn("[PythonTypeLab] Card value text element missing");
            return;
        }
        card.setValue(TypeCard, "state", "revealed");
        this.pendingReveals.delete(card.index);
        console.log("[PythonTypeLab] Card value rendered:", value);
        if (this.flipAudioEntity) {
            AudioUtils.play(this.flipAudioEntity);
        }
    }
}
