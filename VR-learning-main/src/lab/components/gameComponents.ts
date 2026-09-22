/** ECS component definitions for lab cards, bins, dispenser, and control buttons. */
import { createComponent, Types } from "@iwsdk/core";
export const TypeCard = createComponent("TypeCard", {
    cardId: { type: Types.String, default: "" },
    displayValue: { type: Types.String, default: "" },
    expectedType: {
        type: Types.Enum,
        default: "int",
        enum: { int: "int", float: "float", bool: "bool", str: "str" },
    },
    state: {
        type: Types.Enum,
        default: "hidden",
        enum: {
            hidden: "hidden",
            held: "held",
            revealed: "revealed",
            submitted: "submitted",
            correct: "correct",
            wrong: "wrong",
            completed: "completed",
        },
    },
    wrongAttempts: { type: Types.Int32, default: 0 },
    deckIndex: { type: Types.Int32, default: 0 },
    faceEntity: { type: Types.Entity, default: null },
});
export const TypeBin = createComponent("TypeBin", {
    typeId: {
        type: Types.Enum,
        default: "int",
        enum: { int: "int", float: "float", bool: "bool", str: "str" },
    },
    glow: {
        type: Types.Enum,
        default: "none",
        enum: { none: "none", correct: "correct", wrong: "wrong" },
    },
});
export const ResetButton = createComponent("ResetButton", {});
export const CardDispenser = createComponent("CardDispenser", {});
export const NewCardButton = createComponent("NewCardButton", {});
