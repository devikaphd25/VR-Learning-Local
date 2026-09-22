/**
 * Central reactive state for one local lab attempt.
 * Systems read/write these signals; multiplayer progress is emitted separately
 * to the server, which persists the final result in Supabase.
 */
import { type Entity, type World } from "@iwsdk/core";
import { signal, type Signal } from "@preact/signals-core";
import type { PythonTypeId, TypeCardData } from "../data/lessonOne.js";
export type LessonState = "idle" | "playing" | "complete";
export type DispenseState = "idle" | "dispensing" | "cardActive" | "complete";
export type GameCommand = "none" | "start" | "reset" | "complete";
export type FeedbackState = {
    status: string;
    hint: string;
    console: string;
};
export const EMPTY_FEEDBACK: FeedbackState = {
    status: "",
    hint: "",
    console: "",
};
export const UMES_MAROON = 0x7a1f2b;
export const UMES_CREAM = 0xf5f0e6;
export const TYPE_CUE_COLORS: Record<PythonTypeId, number> = {
    int: 0x2f6f4f,
    float: 0x2f5b8f,
    bool: 0x8f5b2f,
    str: 0x6f2f6f,
};
let scoreSignal: Signal<number>;
let streakSignal: Signal<number>;
let cardIndexSignal: Signal<number>;
let lessonStateSignal: Signal<LessonState>;
let gameCommandSignal: Signal<GameCommand>;
let feedbackSignal: Signal<FeedbackState>;
let dispenseStateSignal: Signal<DispenseState>;
let resetEpochSignal: Signal<number>;
let correctAnswersSignal: Signal<number>;
let wrongAnswersSignal: Signal<number>;
let correctAudioEntity: Entity | undefined;
let wrongAudioEntity: Entity | undefined;
let activeDeck: TypeCardData[] = [];
export function installGameState(world: World): void {
    scoreSignal = signal(0);
    streakSignal = signal(0);
    cardIndexSignal = signal(0);
    lessonStateSignal = signal<LessonState>("idle");
    gameCommandSignal = signal<GameCommand>("none");
    feedbackSignal = signal<FeedbackState>({ ...EMPTY_FEEDBACK });
    dispenseStateSignal = signal<DispenseState>("idle");
    resetEpochSignal = signal(0);
    correctAnswersSignal = signal(0);
    wrongAnswersSignal = signal(0);
    activeDeck = [];
    world.globals.score = scoreSignal;
    world.globals.streak = streakSignal;
    world.globals.cardIndex = cardIndexSignal;
    world.globals.lessonState = lessonStateSignal;
    world.globals.gameCommand = gameCommandSignal;
    world.globals.feedback = feedbackSignal;
    world.globals.dispenseState = dispenseStateSignal;
    world.globals.resetEpoch = resetEpochSignal;
    world.globals.correctAnswers = correctAnswersSignal;
    world.globals.wrongAnswers = wrongAnswersSignal;
    world.globals.correctAudioEntity = undefined;
    world.globals.wrongAudioEntity = undefined;
}
export function setCorrectAudioEntity(entity: Entity): void {
    correctAudioEntity = entity;
}
export function getCorrectAudioEntity(): Entity | undefined {
    return correctAudioEntity;
}
export function setWrongAudioEntity(entity: Entity): void {
    wrongAudioEntity = entity;
}
export function getWrongAudioEntity(): Entity | undefined {
    return wrongAudioEntity;
}
export function setActiveDeck(deck: TypeCardData[]): void {
    activeDeck = deck;
}
export function getActiveDeck(): TypeCardData[] {
    return activeDeck;
}
export function getActiveDeckLength(): number {
    return activeDeck.length;
}
export function playSilentCue(): void {
}
export function getScoreSignal(): Signal<number> {
    return scoreSignal;
}
export function getStreakSignal(): Signal<number> {
    return streakSignal;
}
export function getCardIndexSignal(): Signal<number> {
    return cardIndexSignal;
}
export function getLessonStateSignal(): Signal<LessonState> {
    return lessonStateSignal;
}
export function getGameCommandSignal(): Signal<GameCommand> {
    return gameCommandSignal;
}
export function getFeedbackSignal(): Signal<FeedbackState> {
    return feedbackSignal;
}
export function getDispenseStateSignal(): Signal<DispenseState> {
    return dispenseStateSignal;
}
export function getResetEpochSignal(): Signal<number> {
    return resetEpochSignal;
}
export function getCorrectAnswersSignal(): Signal<number> {
    return correctAnswersSignal;
}
export function getWrongAnswersSignal(): Signal<number> {
    return wrongAnswersSignal;
}
export function addCorrect(): void {
    scoreSignal.value = scoreSignal.value + 1;
    streakSignal.value = streakSignal.value + 1;
    correctAnswersSignal.value = correctAnswersSignal.value + 1;
}
export function addWrong(): void {
    scoreSignal.value = Math.max(0, scoreSignal.value - 1);
    streakSignal.value = 0;
    wrongAnswersSignal.value = wrongAnswersSignal.value + 1;
}
export function clearFeedback(): void {
    feedbackSignal.value = { ...EMPTY_FEEDBACK };
}
export function setFeedback(next: FeedbackState): void {
    feedbackSignal.value = next;
}
export function requestCommand(cmd: GameCommand): void {
    if (cmd === "reset") {
        resetEpochSignal.value = resetEpochSignal.value + 1;
        gameCommandSignal.value = "reset";
        return;
    }
    if (gameCommandSignal.value === "none") {
        gameCommandSignal.value = cmd;
    }
}
