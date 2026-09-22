/** Loads, normalizes, and binds lab GLB models/animations with fallback geometry. */
import { type AnimationClip, AssetManager, Box3, Mesh, MeshStandardMaterial, Object3D, Vector3, } from "@iwsdk/core";
const warnedKeys = new Set<string>();
function warnOnce(key: string, cause: unknown): void {
    if (warnedKeys.has(key))
        return;
    warnedKeys.add(key);
    console.warn(`[PythonTypeLab] model '${key}' unavailable — using placeholder`, cause);
}
function isFiniteBox(box: Box3): boolean {
    return (Number.isFinite(box.min.x) &&
        Number.isFinite(box.min.y) &&
        Number.isFinite(box.min.z) &&
        Number.isFinite(box.max.x) &&
        Number.isFinite(box.max.y) &&
        Number.isFinite(box.max.z));
}
export function getModelOrNull(key: string): Object3D | null {
    try {
        const result = AssetManager.getGLTF(key);
        const scene = result?.scene;
        if (!scene) {
            warnOnce(key, null);
            return null;
        }
        let hasMeshGeometry = false;
        scene.traverse((child) => {
            if (child instanceof Mesh && child.geometry) {
                hasMeshGeometry = true;
            }
        });
        if (!hasMeshGeometry) {
            warnOnce(key, "scene contains no mesh geometry");
            return null;
        }
        scene.updateMatrixWorld(true);
        const box = new Box3().setFromObject(scene);
        if (box.isEmpty() || !isFiniteBox(box)) {
            warnOnce(key, "scene bounds are empty or non-finite");
            return null;
        }
        return scene;
    }
    catch (cause) {
        warnOnce(key, cause);
        return null;
    }
}
export interface DispenserGLTF {
    scene: Object3D;
    clip: AnimationClip;
    ejectObj: Object3D;
    landingObj: Object3D;
    bodyObj: Object3D;
}
export interface AnimatedButtonGLTF {
    scene: Object3D;
    clip: AnimationClip;
    capObj: Object3D;
}
export function getAnimatedButtonGLTF(key: string, clipName: string, capName: string): AnimatedButtonGLTF | null {
    try {
        const result = AssetManager.getGLTF(key);
        const scene = result?.scene;
        if (!scene) {
            warnOnce(key, null);
            return null;
        }
        let hasMeshGeometry = false;
        scene.traverse((child) => {
            if (child instanceof Mesh && child.geometry)
                hasMeshGeometry = true;
        });
        scene.updateMatrixWorld(true);
        const box = new Box3().setFromObject(scene);
        if (!hasMeshGeometry || box.isEmpty() || !isFiniteBox(box)) {
            warnOnce(key, "scene has no usable mesh bounds");
            return null;
        }
        const clip = result?.animations?.find((candidate) => candidate.name === clipName) ??
            null;
        const capObj = scene.getObjectByName(capName);
        if (!clip || !capObj) {
            warnOnce(key, "required button clip or cap node is missing");
            return null;
        }
        return { scene, clip, capObj };
    }
    catch (cause) {
        warnOnce(key, cause);
        return null;
    }
}
export function getDispenserGLTF(): DispenserGLTF | null {
    const key = "dispenserModel";
    try {
        const result = AssetManager.getGLTF(key);
        const scene = result?.scene;
        if (!scene) {
            warnOnce(key, null);
            return null;
        }
        let hasMeshGeometry = false;
        scene.traverse((child) => {
            if (child instanceof Mesh && child.geometry) {
                hasMeshGeometry = true;
            }
        });
        if (!hasMeshGeometry) {
            warnOnce(key, "scene contains no mesh geometry");
            return null;
        }
        scene.updateMatrixWorld(true);
        const box = new Box3().setFromObject(scene);
        if (box.isEmpty() || !isFiniteBox(box)) {
            warnOnce(key, "scene bounds are empty or non-finite");
            return null;
        }
        const clip = result?.animations?.find((c) => c.name === "Dispense") ?? null;
        if (!clip) {
            warnOnce(key, "animation clip 'Dispense' not found");
            return null;
        }
        const root = scene.getObjectByName("CardDispenserRoot");
        const ejectObj = scene.getObjectByName("EjectCard");
        const landingObj = scene.getObjectByName("CardLanding");
        const doorObj = scene.getObjectByName("DispenserDoor");
        const bodyObj = scene.getObjectByName("Dispenser");
        if (!root || !ejectObj || !landingObj || !doorObj || !bodyObj) {
            warnOnce(key, "missing required dispenser node(s)");
            return null;
        }
        return { scene, clip, ejectObj, landingObj, bodyObj };
    }
    catch (cause) {
        warnOnce(key, cause);
        return null;
    }
}
export function alignFloorToY0(model: Object3D): void {
    model.updateMatrixWorld(true);
    const box = new Box3().setFromObject(model);
    model.position.y -= box.min.y;
}
export function scaleToHeightAndGround(model: Object3D, targetHeight: number): void {
    model.updateMatrixWorld(true);
    const size = new Vector3();
    new Box3().setFromObject(model).getSize(size);
    if (size.y > 1e-6 && Number.isFinite(targetHeight) && targetHeight > 0) {
        model.scale.multiplyScalar(targetHeight / size.y);
    }
    centerXZGroundY(model);
}
export function centerXZGroundY(model: Object3D): void {
    model.updateMatrixWorld(true);
    const box = new Box3().setFromObject(model);
    const center = new Vector3();
    box.getCenter(center);
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;
}
export function centerOnOrigin(model: Object3D): void {
    model.updateMatrixWorld(true);
    const center = new Vector3();
    new Box3().setFromObject(model).getCenter(center);
    model.position.sub(center);
}
export function normalizeAnimatedButton(model: Object3D, localBottomY: number): void {
    model.updateMatrixWorld(true);
    const box = new Box3().setFromObject(model);
    const center = new Vector3();
    box.getCenter(center);
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y += localBottomY - box.min.y;
    model.updateMatrixWorld(true);
}
export function isolateButtonCapMaterial(capObj: Object3D): MeshStandardMaterial | null {
    let first: MeshStandardMaterial | null = null;
    capObj.traverse((child) => {
        if (!(child instanceof Mesh))
            return;
        if (Array.isArray(child.material)) {
            child.material = child.material.map((material) => {
                const clone = material.clone();
                if (!first && clone instanceof MeshStandardMaterial)
                    first = clone;
                return clone;
            });
            return;
        }
        const clone = child.material.clone();
        child.material = clone;
        if (!first && clone instanceof MeshStandardMaterial)
            first = clone;
    });
    return first;
}
