/** Stores the castle scene root so jigsaw systems can attach objects safely. */
import type { Object3D } from "three";

let castleRoot: Object3D | null = null;

export function setCastleRoot(root: Object3D): void {
  castleRoot = root;
}

export function attachToCastleRoot(object: Object3D): void {
  castleRoot?.add(object);
}
