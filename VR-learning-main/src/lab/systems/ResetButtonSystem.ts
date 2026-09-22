/** Handles reset-button interaction and requests a clean lab-attempt reset. */
import { type AnimationAction, type AnimationClip, AnimationMixer, BoxGeometry, createSystem, type Entity, Group, Hovered, Interactable, LoopOnce, Mesh, MeshStandardMaterial, type Object3D, Pressed, } from "@iwsdk/core";
import { ResetButton } from "../components/gameComponents.js";
import { requestCommand, UMES_MAROON } from "../state/gameState.js";
import { getAnimatedButtonGLTF, isolateButtonCapMaterial, normalizeAnimatedButton, } from "../visuals/modelBinding.js";
import { attachToLabRoot } from "../runtime/labRoot.js";
const RESET_BUTTON_POSITION: [
    number,
    number,
    number
] = [0.28, 0.765, -0.4];
const BUTTON_LOCAL_BOTTOM_Y = -0.025;
interface MixerFinishedEvent {
    action: AnimationAction;
}
export class ResetButtonSystem extends createSystem({
    resetButton: { required: [ResetButton] },
    pressed: { required: [ResetButton, Pressed] },
}) {
    private material: MeshStandardMaterial | null = null;
    private entity: Entity | null = null;
    private mixer: AnimationMixer | null = null;
    private action: AnimationAction | null = null;
    private clip: AnimationClip | null = null;
    private modelRoot: Object3D | null = null;
    private animating = false;
    private onFinished = (event: MixerFinishedEvent): void => {
        if (event.action === this.action)
            this.animating = false;
    };
    init() {
        const group = new Group();
        const authored = getAnimatedButtonGLTF("resetButtonModel", "ResetPress", "reset-button-cap");
        if (authored) {
            normalizeAnimatedButton(authored.scene, BUTTON_LOCAL_BOTTOM_Y);
            group.add(authored.scene);
            this.material = isolateButtonCapMaterial(authored.capObj);
            this.mixer = new AnimationMixer(authored.scene);
            this.action = this.mixer.clipAction(authored.clip);
            this.action.setLoop(LoopOnce, 1);
            this.action.clampWhenFinished = true;
            this.mixer.addEventListener("finished", this.onFinished);
            this.clip = authored.clip;
            this.modelRoot = authored.scene;
            this.action.reset().play();
            this.mixer.update(0);
            this.action.stop();
        }
        else {
            const buttonMaterial = new MeshStandardMaterial({
                color: UMES_MAROON,
                roughness: 0.6,
            });
            const button = new Mesh(new BoxGeometry(0.08, 0.03, 0.08), buttonMaterial);
            group.add(button);
            const base = new Mesh(new BoxGeometry(0.1, 0.01, 0.1), new MeshStandardMaterial({ color: 0x3a1418, roughness: 0.8 }));
            base.position.y = -0.02;
            group.add(base);
            this.material = buttonMaterial;
        }
        const entity = this.world.createTransformEntity(group);
        attachToLabRoot(group);
        entity.addComponent(ResetButton);
        entity.addComponent(Interactable);
        group.position.set(RESET_BUTTON_POSITION[0], RESET_BUTTON_POSITION[1], RESET_BUTTON_POSITION[2]);
        this.entity = entity;
        this.queries.pressed.subscribe("qualify", () => {
            this.playPressAnimation();
            requestCommand("reset");
        });
        this.cleanupFuncs.push(() => this.teardown());
    }
    update(delta: number) {
        if (this.animating && this.mixer)
            this.mixer.update(delta);
        if (!this.material)
            return;
        let pressed = false;
        for (const entity of this.queries.resetButton.entities) {
            if (entity.hasComponent(Pressed) || entity.hasComponent(Hovered)) {
                pressed = true;
                break;
            }
        }
        this.material.emissive.setHex(pressed ? 0x553333 : 0x000000);
        this.material.emissiveIntensity = pressed ? 0.5 : 0;
    }
    private playPressAnimation(): void {
        if (!this.action)
            return;
        this.action.stop();
        this.action.reset();
        this.action.play();
        this.animating = true;
    }
    private teardown(): void {
        if (this.mixer) {
            this.mixer.removeEventListener("finished", this.onFinished);
            this.mixer.stopAllAction();
            if (this.clip)
                this.mixer.uncacheClip(this.clip);
            if (this.modelRoot)
                this.mixer.uncacheRoot(this.modelRoot);
        }
        this.entity?.dispose();
        this.entity = null;
        this.mixer = null;
        this.action = null;
        this.clip = null;
        this.modelRoot = null;
        this.material = null;
        this.animating = false;
    }
}
