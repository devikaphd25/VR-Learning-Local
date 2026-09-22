/**
 * Hardcoded Lesson 1 Five Parts true/false items.
 * Demo content is local so the classroom can run without quiz_questions rows.
 */
export const TRUE_FALSE_OPTIONS = ["True", "False"] as const;
export const FIVE_PARTS_DURATION_SECONDS = 300;

export const FIVE_PARTS_TRUE_FALSE_QUESTIONS = [
  {
    prompt: "RAM keeps its contents when the power is off.",
    correctIndex: 1,
  },
  {
    prompt: "The CPU is the fastest component in the system.",
    correctIndex: 0,
  },
  {
    prompt: "A program runs directly from the hard drive.",
    correctIndex: 1,
  },
  {
    prompt: "An SSD is an example of secondary storage.",
    correctIndex: 0,
  },
  {
    prompt: "'Loading...' means copying storage -> RAM.",
    correctIndex: 0,
  },
] as const;

export const FIVE_PARTS_CHALLENGE_TYPE = "five-parts";
