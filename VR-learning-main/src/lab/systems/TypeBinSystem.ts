/** Creates and styles the four destination bins used to classify Python values. */
import { BoxGeometry, createSystem, Group, Hovered, Interactable, Mesh, MeshStandardMaterial, } from "@iwsdk/core";
import { TypeBin } from "../components/gameComponents.js";
import { PYTHON_TYPES, type PythonTypeId } from "../data/lessonOne.js";
import { TYPE_CUE_COLORS, UMES_MAROON } from "../state/gameState.js";
import { BIN_POSITIONS } from "../state/layout.js";
import { centerXZGroundY, getModelOrNull } from "../visuals/modelBinding.js";
import { attachToLabRoot } from "../runtime/labRoot.js";
const GLOW_DURATION_MS = 600;
const BIN_MODEL_KEYS: Record<PythonTypeId, string> = {
    int: "intBinModel",
    float: "floatBinModel",
    bool: "boolBinModel",
    str: "strBinModel",
};
export class TypeBinSystem extends createSystem({
    bins: { required: [TypeBin] },
}) {
    private materials = new Map<number, MeshStandardMaterial>();
    private glowUntil = new Map<number, number>();
    init() {
        for (const typeId of PYTHON_TYPES) {
            const [x, y, z] = BIN_POSITIONS[typeId];
            const cue = TYPE_CUE_COLORS[typeId];
            const group = new Group();
            const bin = this.world.createTransformEntity(group);
            attachToLabRoot(group);
            bin.addComponent(TypeBin, { typeId, glow: "none" });
            bin.addComponent(Interactable);
            group.position.set(x, y, z);
            const model = getModelOrNull(BIN_MODEL_KEYS[typeId]);
            if (model) {
                centerXZGroundY(model);
                group.add(model);
                let glowMaterial: MeshStandardMaterial | null = null;
                model.traverse((child) => {
                    if (glowMaterial)
                        return;
                    if (child instanceof Mesh) {
                        const mats = Array.isArray(child.material)
                            ? child.material
                            : [child.material];
                        for (const mat of mats) {
                            if (mat instanceof MeshStandardMaterial) {
                                glowMaterial = mat;
                                return;
                            }
                        }
                    }
                });
                if (glowMaterial) {
                    this.materials.set(bin.index, glowMaterial);
                }
            }
            else {
                const trayMaterial = new MeshStandardMaterial({
                    color: cue,
                    roughness: 0.7,
                });
                const tray = new Mesh(new BoxGeometry(0.16, 0.02, 0.16), trayMaterial);
                tray.position.y = 0.015;
                const rim = new Mesh(new BoxGeometry(0.17, 0.005, 0.17), new MeshStandardMaterial({ color: UMES_MAROON, roughness: 0.7 }));
                rim.position.y = 0.0025;
                group.add(tray, rim);
                this.materials.set(bin.index, trayMaterial);
            }
        }
    }
    update() {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        for (const bin of this.queries.bins.entities) {
            const mat = this.materials.get(bin.index);
            if (!mat)
                continue;
            const glow = bin.getValue(TypeBin, "glow") ?? "none";
            let end = this.glowUntil.get(bin.index) ?? 0;
            if (glow !== "none" && end === 0) {
                end = now + GLOW_DURATION_MS;
                this.glowUntil.set(bin.index, end);
            }
            if (end > 0 && now >= end) {
                bin.setValue(TypeBin, "glow", "none");
                this.glowUntil.delete(bin.index);
                end = 0;
            }
            if (end > 0) {
                mat.emissive.setHex(glow === "correct" ? 0x2f6f4f : 0x9a1f1f);
                mat.emissiveIntensity = 0.9;
            }
            else if (bin.hasComponent(Hovered)) {
                mat.emissive.setHex(0x444444);
                mat.emissiveIntensity = 0.4;
            }
            else {
                mat.emissiveIntensity = 0;
            }
        }
    }
}
