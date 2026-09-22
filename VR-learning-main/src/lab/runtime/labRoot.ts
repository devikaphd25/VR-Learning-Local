/** Stores the current lab scene root so independent lab systems can attach objects safely. */
import type { Object3D } from "three";

let labRoot: Object3D | null = null;

export function setLabRoot(root: Object3D): void {
  labRoot = root;
}

export function attachToLabRoot(object: Object3D): void {
  labRoot?.add(object);
}
