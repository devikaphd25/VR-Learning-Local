/**
 * Lesson 2 - Challenge 2 content.
 *
 * Practice 2 source: "Predict: devices in & out" from the lesson deck.
 * This file intentionally keeps Challenge 2 separate from the existing
 * Quick Challenge implementation so its UI and interaction can be added
 * without changing Challenge 1 behavior.
 */

export type Challenge2Category = "input" | "output" | "both" | "storage";

export type Challenge2Item = {
  id: string;
  name: string;
  imagePath?: string;
  modelPath?: string;
  modelRotationY?: number;
  category: Challenge2Category;
  feedback: string;
};

export const CHALLENGE_2_TITLE = "Predict: Devices In & Out";

export const CHALLENGE_2_PROMPT =
  "Classify each device as input, output, both, or storage.";

export const CHALLENGE_2_ITEMS: readonly Challenge2Item[] = [
  {
    id: "webcam",
    name: "Webcam",
    modelPath: "/models/challenge-2/webcam.glb",
    imagePath: "/textures/quiz/challenge-2-items/webcam.png",
    category: "input",
    feedback: "A webcam sends captured images and video into the computer."
  },
  {
    id: "projector",
    name: "Projector",
    modelPath: "/models/challenge-2/projector.glb",
    imagePath: "/textures/quiz/challenge-2-items/projector.png",
    category: "output",
    feedback: "A projector displays information from the computer."
  },
  {
    id: "computer",
    name: "Computer",
    modelPath: "/models/challenge-2/computer.glb",
    imagePath: "/textures/quiz/challenge-2-items/touchscreen.png",
    category: "both",
    feedback:
      "A computer receives input and produces output for the user."
  },
  {
    id: "usb-flash-drive",
    name: "USB Flash Drive",
    modelPath: "/models/challenge-2/usb-flash-drive.glb",
    imagePath: "/textures/quiz/challenge-2-items/usb-flash-drive.png",
    // The source GLB's long axis is Z, which points end-on at the browser
    // camera. Rotate it sideways so the complete flash drive is visible.
    modelRotationY: Math.PI / 2,
    category: "storage",
    feedback:
      "A USB flash drive stores data; it is not classified as an input or output device."
  },
  {
    id: "microphone",
    name: "Microphone",
    modelPath: "/models/challenge-2/microphone.glb",
    imagePath: "/textures/quiz/challenge-2-items/microphone.png",
    category: "input",
    feedback: "A microphone sends recorded sound into the computer."
  }
] as const;
