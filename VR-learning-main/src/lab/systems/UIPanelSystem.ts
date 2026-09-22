/** Mirrors reactive lab score, streak, progress, and feedback state into UIKit text. */
import { createSystem, eq, PanelDocument, PanelUI, type UIKitDocument, } from "@iwsdk/core";
import { getActiveDeckLength, getCardIndexSignal, getFeedbackSignal, getLessonStateSignal, getScoreSignal, getStreakSignal, } from "../state/gameState.js";
import { setTextSafe } from "./uiText.js";
export class UIPanelSystem extends createSystem({
    lessonPanels: {
        required: [PanelUI, PanelDocument],
        where: [eq(PanelUI, "config", "./ui/lessonPanel.json")],
    },
    scorePanels: {
        required: [PanelUI, PanelDocument],
        where: [eq(PanelUI, "config", "./ui/scorePanel.json")],
    },
    feedbackPanels: {
        required: [PanelUI, PanelDocument],
        where: [eq(PanelUI, "config", "./ui/feedbackPanel.json")],
    },
}) {
    private scoreDoc: UIKitDocument | null = null;
    private feedbackDoc: UIKitDocument | null = null;
    private lessonDoc: UIKitDocument | null = null;
    init() {
        this.queries.scorePanels.subscribe("qualify", (entity) => {
            this.scoreDoc = PanelDocument.data.document[entity.index] as UIKitDocument;
            this.refreshScorePanel();
        });
        this.queries.feedbackPanels.subscribe("qualify", (entity) => {
            this.feedbackDoc = PanelDocument.data.document[entity.index] as UIKitDocument;
            this.refreshFeedbackPanel();
        });
        this.queries.lessonPanels.subscribe("qualify", (entity) => {
            this.lessonDoc = PanelDocument.data.document[entity.index] as UIKitDocument;
            this.refreshLessonPanel();
        });
        this.cleanupFuncs.push(getScoreSignal().subscribe(() => this.refreshScorePanel()));
        this.cleanupFuncs.push(getStreakSignal().subscribe(() => this.refreshScorePanel()));
        this.cleanupFuncs.push(getCardIndexSignal().subscribe(() => this.refreshScorePanel()));
        this.cleanupFuncs.push(getLessonStateSignal().subscribe(() => {
            this.refreshScorePanel();
            this.refreshLessonPanel();
        }));
        this.cleanupFuncs.push(getFeedbackSignal().subscribe(() => this.refreshFeedbackPanel()));
    }
    private refreshScorePanel(): void {
        if (!this.scoreDoc)
            return;
        const score = getScoreSignal().peek();
        const streak = getStreakSignal().peek();
        const cardIndex = getCardIndexSignal().peek();
        const state = getLessonStateSignal().peek();
        setTextSafe(this.scoreDoc, "score", `Score: ${score}`);
        setTextSafe(this.scoreDoc, "streak", `Streak: ${streak}`);
        const total = getActiveDeckLength();
        if (state === "complete") {
            setTextSafe(this.scoreDoc, "card", "Lesson Complete");
        }
        else if (total === 0) {
            setTextSafe(this.scoreDoc, "card", " ");
        }
        else {
            const n = Math.min(cardIndex + 1, total);
            setTextSafe(this.scoreDoc, "card", `Card: ${n} / ${total}`);
        }
    }
    private refreshFeedbackPanel(): void {
        if (!this.feedbackDoc)
            return;
        const f = getFeedbackSignal().peek();
        setTextSafe(this.feedbackDoc, "status", f.status || " ");
        setTextSafe(this.feedbackDoc, "hint", f.hint || " ");
        setTextSafe(this.feedbackDoc, "console", f.console || " ");
    }
    private refreshLessonPanel(): void {
        if (!this.lessonDoc)
            return;
        const state = getLessonStateSignal().peek();
        if (state === "complete") {
            const score = getScoreSignal().peek();
            const total = getActiveDeckLength();
            setTextSafe(this.lessonDoc, "summary", `Lesson complete! Final score: ${score} / ${total}`);
        }
        else {
            setTextSafe(this.lessonDoc, "summary", " ");
        }
    }
}
