/** Shared 3D positions, rotations, sizes, and interaction thresholds for the lab. */
import type { PythonTypeId } from "../data/lessonOne.js";
export const TABLE_POSITION: [
    number,
    number,
    number
] = [0, 0.72, -0.65];
export const TABLE_FLOOR_POSITION: [
    number,
    number,
    number
] = [0, 0, -0.65];
export const TABLE_WIDTH = 1.8;
export const TABLE_DEPTH = 1.1;
export const TABLE_THICKNESS = 0.04;
export const TABLE_TOP_Y = TABLE_POSITION[1] + TABLE_THICKNESS / 2;
export const SPAWN_POSITION: [
    number,
    number,
    number
] = [0, TABLE_TOP_Y + 0.005, -0.45];
export const FACE_DOWN_ROTATION_X = Math.PI / 2;
export const FACE_DOWN_ROTATION_Y = 0;
export const FACE_DOWN_ROTATION_Z = 0;
export const CARD_WIDTH = 0.11;
export const CARD_HEIGHT = 0.15;
export const CARD_THICKNESS = 0.006;
export const BIN_POSITIONS: Record<PythonTypeId, [
    number,
    number,
    number
]> = {
    int: [-0.56, TABLE_TOP_Y, -0.73],
    float: [-0.31, TABLE_TOP_Y, -0.73],
    bool: [0.31, TABLE_TOP_Y, -0.73],
    str: [0.56, TABLE_TOP_Y, -0.73],
};
export const DROP_RADIUS = 0.14;
export const DROP_Y_MIN = 0.72;
export const DROP_Y_MAX = 0.95;
export const DISPENSER_BODY_ROW_POSITION: [
    number,
    number
] = [0, -0.73];
export const DISPENSER_LANDING_Y = TABLE_TOP_Y + 0.005;
export const DISPENSER_ROOT_YAW = 0;
export const NEW_CARD_BUTTON_POSITION: [
    number,
    number,
    number
] = [
    -0.28,
    0.765,
    -0.4,
];
export const REVEAL_DOT_THRESHOLD = 0.5;
export const REVEAL_UP_THRESHOLD = 0.5;
