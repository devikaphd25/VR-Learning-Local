/** Detects card drops into type bins, scores the answer, and advances the activity. */
import { AudioUtils, createSystem, type Entity, Grabbed, Vector3, } from "@iwsdk/core";
import { TypeBin, TypeCard } from "../components/gameComponents.js";
import { addCorrect, addWrong, getActiveDeck, getActiveDeckLength, getCorrectAudioEntity, getCardIndexSignal, getDispenseStateSignal, getWrongAudioEntity, requestCommand, setFeedback, } from "../state/gameState.js";
import { DROP_RADIUS, DROP_Y_MAX, DROP_Y_MIN, FACE_DOWN_ROTATION_X, FACE_DOWN_ROTATION_Y, FACE_DOWN_ROTATION_Z, SPAWN_POSITION, } from "../state/layout.js";
export class DropSystem extends createSystem({
    heldCards: { required: [TypeCard, Grabbed] },
    bins: { required: [TypeBin] },
}) {
    private cardPos!: Vector3;
    private binPos!: Vector3;
    init() {
        this.cardPos = new Vector3();
        this.binPos = new Vector3();
        this.queries.heldCards.subscribe("disqualify", (card) => {
            this.handleRelease(card);
        });
    }
    private handleRelease(card: Entity): void {
        card.object3D!.getWorldPosition(this.cardPos);
        if (this.cardPos.y < DROP_Y_MIN || this.cardPos.y > DROP_Y_MAX) {
            this.returnCardToSpawn(card);
            return;
        }
        let bestBin: Entity | null = null;
        let bestDist = Infinity;
        for (const bin of this.queries.bins.entities) {
            bin.object3D!.getWorldPosition(this.binPos);
            const dx = this.cardPos.x - this.binPos.x;
            const dz = this.cardPos.z - this.binPos.z;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d < bestDist) {
                bestDist = d;
                bestBin = bin;
            }
        }
        if (!bestBin || bestDist > DROP_RADIUS) {
            this.returnCardToSpawn(card);
            return;
        }
        const expected = card.getValue(TypeCard, "expectedType");
        const binType = bestBin.getValue(TypeBin, "typeId");
        if (expected === binType) {
            this.handleCorrect(card, bestBin);
        }
        else {
            this.handleWrong(card, bestBin);
        }
    }
    private handleCorrect(card: Entity, bin: Entity): void {
        const deckIndex = card.getValue(TypeCard, "deckIndex") ?? 0;
        const data = getActiveDeck()[deckIndex];
        addCorrect();
        bin.setValue(TypeBin, "glow", "correct");
        setFeedback({
            status: "Correct!",
            hint: data ? data.explanation : "Correct!",
            console: data ? data.consoleOutput : "",
        });
        const wrongAudio = getWrongAudioEntity();
        if (wrongAudio)
            AudioUtils.stop(wrongAudio);
        const correctAudio = getCorrectAudioEntity();
        if (correctAudio)
            AudioUtils.play(correctAudio);
        card.setValue(TypeCard, "state", "completed");
        const face = card.getValue(TypeCard, "faceEntity");
        if (face)
            face.dispose();
        card.dispose();
        const nextIndex = deckIndex + 1;
        if (nextIndex < getActiveDeckLength()) {
            getCardIndexSignal().value = nextIndex;
            getDispenseStateSignal().value = "idle";
        }
        else {
            getDispenseStateSignal().value = "complete";
            requestCommand("complete");
        }
    }
    private handleWrong(card: Entity, bin: Entity): void {
        const attempts = (card.getValue(TypeCard, "wrongAttempts") ?? 0) + 1;
        card.setValue(TypeCard, "wrongAttempts", attempts);
        const deckIndex = card.getValue(TypeCard, "deckIndex") ?? 0;
        const data = getActiveDeck()[deckIndex];
        const selectedType =
            bin.getValue(TypeBin, "typeId");
        const hintIndex = data
            ? Math.min(attempts - 1, data.hints.length - 1)
            : 0;
        addWrong();
        bin.setValue(TypeBin, "glow", "wrong");
        const correctAudio = getCorrectAudioEntity();
        if (correctAudio)
            AudioUtils.stop(correctAudio);
        const wrongAudio = getWrongAudioEntity();
        if (wrongAudio)
            AudioUtils.play(wrongAudio);
        setFeedback({
            status: "Incorrect. Try again.",
            hint: data ? data.hints[hintIndex] : "Try again.",
            console: "",
        });

        const reportMistake =
            (window as any).reportLabMistake as
                ((mistake: {
                    cardId: string;
                    question: string;
                    selectedType: string;
                    correctType: string;
                    attempt: number;
                }) => void) | undefined;

        reportMistake?.({
            cardId:
                card.getValue(TypeCard, "cardId") ?? "",
            question:
                card.getValue(TypeCard, "displayValue") ?? "",
            selectedType:
                selectedType ?? "",
            correctType:
                card.getValue(TypeCard, "expectedType") ?? "",
            attempt: attempts,
        });

        this.returnCardToSpawn(card);
    }
    private returnCardToSpawn(card: Entity): void {
        card.setValue(TypeCard, "state", "hidden");
        const obj = card.object3D!;
        obj.position.set(SPAWN_POSITION[0], SPAWN_POSITION[1], SPAWN_POSITION[2]);
        obj.rotation.set(FACE_DOWN_ROTATION_X, FACE_DOWN_ROTATION_Y, FACE_DOWN_ROTATION_Z);
    }
}
