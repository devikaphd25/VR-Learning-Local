/** ECS state for the single grabbable device shown during Challenge 2. */
import { createComponent, Types } from "@iwsdk/core";

export const Challenge2Device = createComponent("Challenge2Device", {
  itemIndex: { type: Types.Int32, default: 0 },
  expectedCategory: {
    type: Types.Enum,
    default: "input",
    enum: {
      input: "input",
      output: "output",
      both: "both",
      storage: "storage"
    }
  }
});
