/** Static Python type definitions and fallback lesson-card content. */
export type PythonTypeId = "int" | "float" | "bool" | "str";
export type TypeCardData = {
    id: string;
    displayValue: string;
    expectedType: PythonTypeId;
    explanation: string;
    hints: string[];
    consoleOutput: string;
};
export const PYTHON_TYPES: PythonTypeId[] = ["int", "float", "bool", "str"];
export const lessonOneCards: TypeCardData[] = [
    {
        id: "card-int-3",
        displayValue: "3",
        expectedType: "int",
        explanation: "3 is a whole number with no decimal point, so its type is int.",
        hints: [
            "Look for a decimal point or quotes.",
            "Whole numbers with no decimal point are int.",
            "type(3) == int",
        ],
        consoleOutput: "type(3)\n<class 'int'>",
    },
    {
        id: "card-int-8",
        displayValue: "8",
        expectedType: "int",
        explanation: "8 is a whole number with no decimal point, so its type is int.",
        hints: [
            "Look for a decimal point or quotes.",
            "Whole numbers with no decimal point are int.",
            "type(8) == int",
        ],
        consoleOutput: "type(8)\n<class 'int'>",
    },
    {
        id: "card-float-34",
        displayValue: "3.4",
        expectedType: "float",
        explanation: "3.4 has a decimal point, so its type is float.",
        hints: [
            "Look for a decimal point.",
            "Decimal numbers belong to float.",
            "type(3.4) == float",
        ],
        consoleOutput: "type(3.4)\n<class 'float'>",
    },
    {
        id: "card-float-30",
        displayValue: "3.0",
        expectedType: "float",
        explanation: "3.0 still has a decimal point, so even though it is a whole value its type is float.",
        hints: [
            "Look for a decimal point.",
            "The decimal form still means float.",
            "type(3.0) == float",
        ],
        consoleOutput: "type(3.0)\n<class 'float'>",
    },
    {
        id: "card-bool-true",
        displayValue: "True",
        expectedType: "bool",
        explanation: "True is a Python Boolean value.",
        hints: [
            "This value is used for yes or no logic.",
            "Python Boolean values are True and False.",
            "type(True) == bool",
        ],
        consoleOutput: "type(True)\n<class 'bool'>",
    },
    {
        id: "card-bool-false",
        displayValue: "False",
        expectedType: "bool",
        explanation: "False is a Python Boolean value.",
        hints: [
            "This value is used for yes or no logic.",
            "Python Boolean values are True and False.",
            "type(False) == bool",
        ],
        consoleOutput: "type(False)\n<class 'bool'>",
    },
    {
        id: "card-str-hello",
        displayValue: '"hello"',
        expectedType: "str",
        explanation: 'Values inside quotes are strings.',
        hints: [
            "Look for quotation marks.",
            "Quoted text belongs to str.",
            'type("hello") == str',
        ],
        consoleOutput: 'type("hello")\n<class \'str\'>',
    },
    {
        id: "card-str-umes",
        displayValue: '"UMES"',
        expectedType: "str",
        explanation: 'Values inside quotes are strings.',
        hints: [
            "Look for quotation marks.",
            "Quoted text belongs to str.",
            'type("UMES") == str',
        ],
        consoleOutput: 'type("UMES")\n<class \'str\'>',
    },
    {
        id: "card-int-1",
        displayValue: "1",
        expectedType: "int",
        explanation: "1 is a whole number. It is not bool. bool(1) is True, but 1 itself is int.",
        hints: [
            "This is a whole number.",
            "1 is not the same as True.",
            "type(1) == int",
        ],
        consoleOutput: "type(1)\n<class 'int'>",
    },
    {
        id: "card-int-0",
        displayValue: "0",
        expectedType: "int",
        explanation: "0 is a whole number. It is not bool. bool(0) is False, but 0 itself is int.",
        hints: [
            "This is a whole number.",
            "0 is not the same as False.",
            "type(0) == int",
        ],
        consoleOutput: "type(0)\n<class 'int'>",
    },
    {
        id: "card-str-3",
        displayValue: '"3"',
        expectedType: "str",
        explanation: 'Numbers inside quotes are also strings. "3" is text, not the number 3.',
        hints: [
            "Look for quotation marks.",
            "Values inside quotes are strings.",
            'type("3") == str',
        ],
        consoleOutput: 'type("3")\n<class \'str\'>',
    },
    {
        id: "card-str-false",
        displayValue: '"False"',
        expectedType: "str",
        explanation: 'Boolean words inside quotes are also strings. "False" is text, not the Boolean False.',
        hints: [
            "Look for quotation marks.",
            "Values inside quotes are strings.",
            'type("False") == str',
        ],
        consoleOutput: 'type("False")\n<class \'str\'>',
    },
];
