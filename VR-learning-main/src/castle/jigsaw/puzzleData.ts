/** Puzzle definition for the Python Jigsaw activity inside the castle. */

export interface JigsawLine {
  id: string;
  text: string;
  correctIndent: number;
  correctSlot: number;
}

export const PUZZLE_LINES: JigsawLine[] = [
  { id: "line1", text: "laps = [52, 50, 51, 47]", correctIndent: 0, correctSlot: 0 },
  { id: "line2", text: "total = 0", correctIndent: 0, correctSlot: 1 },
  { id: "line3", text: "for lap in laps:", correctIndent: 0, correctSlot: 2 },
  { id: "line4", text: "print(lap)", correctIndent: 1, correctSlot: 3 },
  { id: "line5", text: "total = total + lap", correctIndent: 1, correctSlot: 4 },
  { id: "line6", text: "print('Total:', total)", correctIndent: 0, correctSlot: 5 },
  { id: "line7", text: "print('Average:', total / len(laps))", correctIndent: 0, correctSlot: 6 },
];

export const EXPECTED_OUTPUT = "52\n50\n51\n47\nTotal: 200\nAverage: 50.0";

/** Fixed shuffle so the puzzle starts in the same scrambled order every time. */
export const SHUFFLED_ORDER = [6, 3, 0, 5, 1, 4, 2];
