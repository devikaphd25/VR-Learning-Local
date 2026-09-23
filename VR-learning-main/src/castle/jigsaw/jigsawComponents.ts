/** ECS component definitions for the jigsaw puzzle blocks and buttons. */
import { createComponent, Types } from "@iwsdk/core";

export const JigsawBlock = createComponent("JigsawBlock", {
  lineId: { type: Types.String, default: "" },
  text: { type: Types.String, default: "" },
  slotIndex: { type: Types.Int32, default: -1 },
  indent: { type: Types.Int32, default: 0 },
  originalIndex: { type: Types.Int32, default: 0 },
  faceEntity: { type: Types.Entity, default: null },
});

export const JigsawButton = createComponent("JigsawButton", {
  buttonType: {
    type: Types.Enum,
    default: "indent",
    enum: {
      indent: "indent",
      dedent: "dedent",
      reset: "reset",
      exit: "exit",
      submit: "submit",
    },
  },
});
