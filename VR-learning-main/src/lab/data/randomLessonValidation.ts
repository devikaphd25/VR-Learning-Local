/** Development validation helpers that test randomized decks for size and type coverage. */
import { generateLessonDeck } from "./randomLesson.js";
import type { PythonTypeId, TypeCardData } from "./lessonOne.js";
export type ValidationResult = {
    passed: number;
    total: number;
    ok: boolean;
    failures: string[];
};
function classifyValueType(displayValue: string): PythonTypeId | "unknown" {
    if (displayValue.length >= 2 && displayValue.startsWith('"') && displayValue.endsWith('"')) {
        return "str";
    }
    if (displayValue === "True" || displayValue === "False") {
        return "bool";
    }
    if (displayValue.includes(".")) {
        return "float";
    }
    if (/^-?\d+$/.test(displayValue)) {
        return "int";
    }
    return "unknown";
}
function validateSingleDeck(deck: TypeCardData[], sampleIndex: number): string[] {
    const failures: string[] = [];
    if (deck.length !== 12) {
        failures.push(`length=${deck.length} (expected 12)`);
    }
    const present = new Set(deck.map((c) => c.expectedType));
    for (const t of ["int", "float", "bool", "str"] as const) {
        if (!present.has(t))
            failures.push(`missing type coverage: ${t}`);
    }
    deck.forEach((c, i) => {
        const cls = classifyValueType(c.displayValue);
        if (cls !== c.expectedType) {
            failures.push(`card[${i}] ${c.displayValue} classifies as ${cls} but expectedType is ${c.expectedType}`);
        }
    });
    const hasIntOne = deck.some((c) => c.expectedType === "int" && c.displayValue === "1");
    const hasIntZero = deck.some((c) => c.expectedType === "int" && c.displayValue === "0");
    const hasDotZeroFloat = deck.some((c) => c.expectedType === "float" && /\.0$/.test(c.displayValue));
    const hasStrThree = deck.some((c) => c.expectedType === "str" && c.displayValue === '"3"');
    const hasQuotedBoolStr = deck.some((c) => c.expectedType === "str" &&
        (c.displayValue === '"False"' || c.displayValue === '"True"'));
    if (!hasIntOne)
        failures.push("missing edge case: 1 as int");
    if (!hasIntZero)
        failures.push("missing edge case: 0 as int");
    if (!hasDotZeroFloat)
        failures.push("missing edge case: a .0 float (e.g. 3.0)");
    if (!hasStrThree)
        failures.push('missing edge case: "3" as str');
    if (!hasQuotedBoolStr)
        failures.push("missing edge case: quoted Boolean string as str");
    const ids = deck.map((c) => c.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (duplicates.length > 0) {
        failures.push(`duplicate ids: ${[...new Set(duplicates)].join(", ")}`);
    }
    return failures.map((f) => `Deck #${sampleIndex}: ${f}`);
}
export function validateGeneratedDeckSamples(sampleCount = 100): ValidationResult {
    const allFailures: string[] = [];
    let passed = 0;
    for (let s = 0; s < sampleCount; s++) {
        const deck = generateLessonDeck(12);
        const failures = validateSingleDeck(deck, s);
        if (failures.length === 0) {
            passed += 1;
        }
        else {
            allFailures.push(...failures);
        }
    }
    const ok = passed === sampleCount && allFailures.length === 0;
    console.log(`[randomLessonValidation] ${passed}/${sampleCount} decks passed` +
        (ok ? "" : " — FAILURES:"));
    if (!ok) {
        console.log(allFailures.join("\n"));
    }
    return { passed, total: sampleCount, ok, failures: allFailures };
}
if (import.meta.env.DEV) {
    (window as unknown as {
        validateGeneratedDeckSamples?: typeof validateGeneratedDeckSamples;
    }).validateGeneratedDeckSamples =
        validateGeneratedDeckSamples;
}
