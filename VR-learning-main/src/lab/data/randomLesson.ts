/** Generates a balanced randomized Python-type card deck for each lab attempt. */
import type { PythonTypeId, TypeCardData } from "./lessonOne.js";
const PYTHON_TYPE_IDS: PythonTypeId[] = ["int", "float", "bool", "str"];
const DEFAULT_DECK_SIZE = 12;
const SMALL_SIZE_TYPE_PRIORITY: PythonTypeId[] = ["int", "str", "float", "bool"];
const INT_POOL: string[] = [
    "1",
    "0",
    "2",
    "3",
    "4",
    "5",
    "7",
    "9",
    "10",
    "12",
    "25",
    "42",
    "100",
    "256",
];
const FLOAT_POOL: string[] = [
    "3.0",
    "0.0",
    "1.0",
    "2.0",
    "10.0",
    "100.0",
    "2.5",
    "3.14",
    "1.5",
    "0.5",
    "9.99",
    "7.25",
    "0.1",
];
const BOOL_POOL: string[] = ["True", "False"];
const STR_POOL: string[] = [
    '"3"',
    '"False"',
    '"True"',
    '"hello"',
    '"UMES"',
    '"42"',
    '"3.0"',
    '"0"',
    '"1"',
    '"world"',
    '"Python"',
    '"yes"',
];
const EDGE_INT_ZERO = "0";
const EDGE_INT_ONE = "1";
const EDGE_FLOAT_DOT_ZERO = "3.0";
const EDGE_STR_NUMBER = '"3"';
const EDGE_STR_BOOL_POOL: string[] = ['"False"', '"True"'];
function randomInt(maxExclusive: number): number {
    return Math.floor(Math.random() * maxExclusive);
}
function pickRandom<T>(items: readonly T[]): T {
    return items[randomInt(items.length)];
}
function shuffle<T>(items: T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
    }
    return out;
}
function makeConsoleOutput(displayValue: string, type: PythonTypeId): string {
    return `type(${displayValue})\n<class '${type}'>`;
}
function makeHints(displayValue: string, type: PythonTypeId): string[] {
    switch (type) {
        case "int":
            return [
                "Look for a decimal point or quotes.",
                "Whole numbers with no decimal point are int.",
                `type(${displayValue}) == int`,
            ];
        case "float":
            return [
                "Look for a decimal point.",
                "Numbers with a decimal point are float.",
                `type(${displayValue}) == float`,
            ];
        case "bool":
            return [
                "This value is used for yes or no logic.",
                "Python Boolean values are True and False.",
                `type(${displayValue}) == bool`,
            ];
        case "str":
            return [
                "Look for quotation marks.",
                "Values inside quotes are strings.",
                `type(${displayValue}) == str`,
            ];
    }
}
function makeExplanation(displayValue: string, type: PythonTypeId): string {
    switch (type) {
        case "int":
            if (displayValue === "1") {
                return "1 is a whole number with no decimal point, so its type is int. It is not bool — bool(1) is True, but 1 itself is int.";
            }
            if (displayValue === "0") {
                return "0 is a whole number with no decimal point, so its type is int. It is not bool — bool(0) is False, but 0 itself is int.";
            }
            return `${displayValue} is a whole number with no decimal point, so its type is int.`;
        case "float":
            if (displayValue.includes(".0")) {
                return `${displayValue} has a decimal point, so even though it is a whole value its type is float.`;
            }
            return `${displayValue} has a decimal point, so its type is float.`;
        case "bool":
            return `${displayValue} is a Python Boolean value.`;
        case "str": {
            const content = displayValue.slice(1, -1);
            if (content === "True" || content === "False") {
                return `Boolean words inside quotes are also strings. ${displayValue} is text, not the Boolean value.`;
            }
            if (/^-?\d+(\.\d+)?$/.test(content)) {
                return `Numbers inside quotes are also strings. ${displayValue} is text, not a number.`;
            }
            return "Values inside quotes are strings.";
        }
    }
}
function slugify(displayValue: string): string {
    return displayValue.replace(/[^a-zA-Z0-9]/g, "");
}
type CardSpec = {
    displayValue: string;
    expectedType: PythonTypeId;
};
function pickIntCards(count: number): string[] {
    const out: string[] = [];
    for (const anchor of [EDGE_INT_ONE, EDGE_INT_ZERO]) {
        if (out.length >= count)
            break;
        out.push(anchor);
    }
    const available = shuffle(INT_POOL.filter((v) => !out.includes(v)));
    for (const v of available) {
        if (out.length >= count)
            break;
        out.push(v);
    }
    return out;
}
function pickFloatCards(count: number): string[] {
    const out: string[] = [];
    if (count >= 1)
        out.push(EDGE_FLOAT_DOT_ZERO);
    const available = shuffle(FLOAT_POOL.filter((v) => !out.includes(v)));
    for (const v of available) {
        if (out.length >= count)
            break;
        out.push(v);
    }
    return out;
}
function pickStrCards(count: number): string[] {
    const out: string[] = [];
    for (const anchor of [EDGE_STR_NUMBER, pickRandom(EDGE_STR_BOOL_POOL)]) {
        if (out.length >= count)
            break;
        out.push(anchor);
    }
    const available = shuffle(STR_POOL.filter((v) => !out.includes(v)));
    for (const v of available) {
        if (out.length >= count)
            break;
        out.push(v);
    }
    return out;
}
function pickBoolCards(count: number): string[] {
    const out: string[] = [];
    let next = pickRandom(BOOL_POOL);
    for (let i = 0; i < count; i++) {
        out.push(next);
        next = next === "True" ? "False" : "True";
    }
    return out;
}
function pickCardsForType(type: PythonTypeId, count: number): string[] {
    switch (type) {
        case "int":
            return pickIntCards(count);
        case "float":
            return pickFloatCards(count);
        case "bool":
            return pickBoolCards(count);
        case "str":
            return pickStrCards(count);
    }
}
function balancedTargets(size: number): Record<PythonTypeId, number> {
    const targets: Record<PythonTypeId, number> = {
        int: 0,
        float: 0,
        bool: 0,
        str: 0,
    };
    if (size < PYTHON_TYPE_IDS.length) {
        for (let i = 0; i < size; i++) {
            targets[SMALL_SIZE_TYPE_PRIORITY[i]] = 1;
        }
        return targets;
    }
    const base = Math.floor(size / PYTHON_TYPE_IDS.length);
    const extra = size % PYTHON_TYPE_IDS.length;
    for (const type of PYTHON_TYPE_IDS)
        targets[type] = base;
    for (const type of shuffle(PYTHON_TYPE_IDS.slice()).slice(0, extra)) {
        targets[type] += 1;
    }
    return targets;
}
function hasAdjacentIdenticalBool(specs: CardSpec[]): boolean {
    for (let i = 1; i < specs.length; i++) {
        const prev = specs[i - 1];
        const cur = specs[i];
        if (prev.expectedType === "bool" &&
            cur.expectedType === "bool" &&
            prev.displayValue === cur.displayValue) {
            return true;
        }
    }
    return false;
}
function shuffledWithoutAdjacentIdenticalBool(specs: CardSpec[]): CardSpec[] {
    for (let attempt = 0; attempt < 24; attempt++) {
        const shuffled = shuffle(specs);
        if (!hasAdjacentIdenticalBool(shuffled))
            return shuffled;
    }
    return shuffle(specs);
}
function buildCards(specs: CardSpec[]): TypeCardData[] {
    const occurrences = new Map<string, number>();
    return specs.map((spec) => {
        const key = `${spec.expectedType}|${slugify(spec.displayValue)}`;
        const occurrence = (occurrences.get(key) ?? 0) + 1;
        occurrences.set(key, occurrence);
        const id = `${spec.expectedType}-${slugify(spec.displayValue)}-${occurrence}`;
        return {
            id,
            displayValue: spec.displayValue,
            expectedType: spec.expectedType,
            explanation: makeExplanation(spec.displayValue, spec.expectedType),
            hints: makeHints(spec.displayValue, spec.expectedType),
            consoleOutput: makeConsoleOutput(spec.displayValue, spec.expectedType),
        };
    });
}
export function generateLessonDeck(size: number = DEFAULT_DECK_SIZE): TypeCardData[] {
    const n = Math.max(0, Math.floor(size));
    const targets = balancedTargets(n);
    const specs: CardSpec[] = [];
    for (const type of PYTHON_TYPE_IDS) {
        for (const displayValue of pickCardsForType(type, targets[type])) {
            specs.push({ displayValue, expectedType: type });
        }
    }
    const ordered = shuffledWithoutAdjacentIdenticalBool(specs);
    return buildCards(ordered);
}
