/** Animates the dispenser and creates the next Python value card on request. */
import { type AnimationAction, type AnimationClip, AnimationMixer, AudioSource, AudioUtils, Box3, BoxGeometry, createSystem, type Entity, Group, Hovered, Interactable, LoopOnce, Mesh, MeshStandardMaterial, type Object3D, PanelUI, PlaybackMode, Pressed, Quaternion, Vector3, VisibilityState, } from "@iwsdk/core";
import { CardDispenser, NewCardButton } from "../components/gameComponents.js";
import { getCardIndexSignal, getDispenseStateSignal, getLessonStateSignal, getResetEpochSignal, UMES_MAROON, } from "../state/gameState.js";
import { DISPENSER_BODY_ROW_POSITION, DISPENSER_LANDING_Y, DISPENSER_ROOT_YAW, NEW_CARD_BUTTON_POSITION, } from "../state/layout.js";
import { requestSpawnCard } from "./LessonSystem.js";
import { getAnimatedButtonGLTF, getDispenserGLTF, isolateButtonCapMaterial, normalizeAnimatedButton, } from "../visuals/modelBinding.js";
import { attachToLabRoot } from "../runtime/labRoot.js";
const BUTTON_ENABLED_COLOR = UMES_MAROON;
const BUTTON_DISABLED_COLOR = 0x6b6b6b;
const BUTTON_LOCAL_BOTTOM_Y = -0.025;
interface MixerFinishedEvent {
    action: AnimationAction;
}
export class CardDispenserSystem extends createSystem({
    dispenser: { required: [CardDispenser] },
    newCardButton: { required: [NewCardButton] },
    pressed: { required: [NewCardButton, Pressed] },
}) {
    private dispenserAvailable = false;
    private mixer: AnimationMixer | null = null;
    private action: AnimationAction | null = null;
    private clip: AnimationClip | null = null;
    private ejectObj: Object3D | null = null;
    private landingObj: Object3D | null = null;
    private dispenserScene: Object3D | null = null;
    private buttonMaterial: MeshStandardMaterial | null = null;
    private buttonEnabledColor = BUTTON_ENABLED_COLOR;
    private buttonDisabledColor = BUTTON_DISABLED_COLOR;
    private buttonMixer: AnimationMixer | null = null;
    private buttonAction: AnimationAction | null = null;
    private buttonClip: AnimationClip | null = null;
    private buttonModelRoot: Object3D | null = null;
    private buttonAnimating = false;
    private dispenserEntity: Entity | null = null;
    private dispenserAudioEntity: Entity | null = null;
    private buttonEntity: Entity | null = null;
    private labelEntity: Entity | null = null;
    private generation = 0;
    private activeGeneration = 0;
    private lastResetEpoch = 0;
    private tmpPos!: Vector3;
    private tmpQuat!: Quaternion;
    private tmpScale!: Vector3;
    private warnedHandoff = false;
    private warnedFallbackSpawn = false;
    private onButtonFinished = (event: MixerFinishedEvent): void => {
        if (event.action === this.buttonAction)
            this.buttonAnimating = false;
    };
    init() {
        this.tmpPos = new Vector3();
        this.tmpQuat = new Quaternion();
        this.tmpScale = new Vector3();
        this.createNewCardButton();
        const g = getDispenserGLTF();
        if (g) {
            this.buildDispenser(g);
        }
        else {
            this.dispenserAvailable = false;
        }
        this.lastResetEpoch = getResetEpochSignal().peek();
        this.cleanupFuncs.push(getResetEpochSignal().subscribe((v) => {
            if (v === this.lastResetEpoch)
                return;
            this.lastResetEpoch = v;
            this.handleReset();
        }));
        this.cleanupFuncs.push(this.world.visibilityState.subscribe((state) => {
            if ((state === VisibilityState.Hidden ||
                state === VisibilityState.VisibleBlurred) &&
                getDispenseStateSignal().peek() === "dispensing") {
                this.handleReset();
            }
        }));
        this.queries.pressed.subscribe("qualify", () => this.onPress());
        this.cleanupFuncs.push(() => this.teardown());
    }
    update(delta: number): void {
        if (getDispenseStateSignal().peek() === "dispensing" && this.mixer) {
            this.mixer.update(delta);
        }
        if (this.buttonAnimating && this.buttonMixer) {
            this.buttonMixer.update(delta);
        }
        this.updateButtonVisual();
    }
    private createNewCardButton(): void {
        const group = new Group();
        const authored = getAnimatedButtonGLTF("newCardButtonModel", "NewCardPress", "new-card-button-cap");
        if (authored) {
            normalizeAnimatedButton(authored.scene, BUTTON_LOCAL_BOTTOM_Y);
            group.add(authored.scene);
            this.buttonMaterial = isolateButtonCapMaterial(authored.capObj);
            if (this.buttonMaterial) {
                this.buttonEnabledColor = this.buttonMaterial.color.getHex();
                this.buttonDisabledColor = this.buttonMaterial.color
                    .clone()
                    .multiplyScalar(0.45)
                    .getHex();
            }
            this.buttonMixer = new AnimationMixer(authored.scene);
            this.buttonAction = this.buttonMixer.clipAction(authored.clip);
            this.buttonAction.setLoop(LoopOnce, 1);
            this.buttonAction.clampWhenFinished = true;
            this.buttonMixer.addEventListener("finished", this.onButtonFinished);
            this.buttonClip = authored.clip;
            this.buttonModelRoot = authored.scene;
            this.buttonAction.reset().play();
            this.buttonMixer.update(0);
            this.buttonAction.stop();
        }
        else {
            const buttonMaterial = new MeshStandardMaterial({
                color: BUTTON_ENABLED_COLOR,
                roughness: 0.6,
            });
            const button = new Mesh(new BoxGeometry(0.08, 0.03, 0.08), buttonMaterial);
            group.add(button);
            const base = new Mesh(new BoxGeometry(0.1, 0.01, 0.1), new MeshStandardMaterial({ color: 0x3a1418, roughness: 0.8 }));
            base.position.y = -0.02;
            group.add(base);
            this.buttonMaterial = buttonMaterial;
            this.buttonEnabledColor = BUTTON_ENABLED_COLOR;
            this.buttonDisabledColor = BUTTON_DISABLED_COLOR;
        }
        const entity = this.world.createTransformEntity(group);
        attachToLabRoot(group);
        entity.addComponent(NewCardButton);
        entity.addComponent(Interactable);
        group.position.set(NEW_CARD_BUTTON_POSITION[0], NEW_CARD_BUTTON_POSITION[1], NEW_CARD_BUTTON_POSITION[2]);
        this.buttonEntity = entity;
        if (!authored) {
            const label = this.world.createTransformEntity(undefined, {
                parent: entity,
            });
            label.addComponent(PanelUI, {
                config: "./ui/newCardButton.json",
                maxWidth: 0.14,
                maxHeight: 0.05,
            });
            label.object3D!.position.set(0, 0.11, 0);
            this.labelEntity = label;
        }
    }
    private updateButtonVisual(): void {
        if (!this.buttonMaterial)
            return;
        const enabled = getLessonStateSignal().peek() === "playing" &&
            getDispenseStateSignal().peek() === "idle";
        let hot = false;
        for (const entity of this.queries.newCardButton.entities) {
            if (entity.hasComponent(Pressed) || entity.hasComponent(Hovered)) {
                hot = true;
                break;
            }
        }
        if (!enabled) {
            this.buttonMaterial.color.setHex(this.buttonDisabledColor);
            this.buttonMaterial.emissive.setHex(0x000000);
            this.buttonMaterial.emissiveIntensity = 0;
            return;
        }
        this.buttonMaterial.color.setHex(this.buttonEnabledColor);
        this.buttonMaterial.emissive.setHex(hot ? 0x553333 : 0x000000);
        this.buttonMaterial.emissiveIntensity = hot ? 0.5 : 0;
    }
    private playButtonPressAnimation(): void {
        if (!this.buttonAction)
            return;
        this.buttonAction.stop();
        this.buttonAction.reset();
        this.buttonAction.play();
        this.buttonAnimating = true;
    }
    private resetButtonPressAnimation(): void {
        if (!this.buttonAction || !this.buttonMixer)
            return;
        this.buttonAction.reset();
        this.buttonAction.play();
        this.buttonMixer.update(0);
        this.buttonAction.stop();
        this.buttonAnimating = false;
    }
    private buildDispenser(g: {
        scene: Object3D;
        clip: AnimationClip;
        ejectObj: Object3D;
        landingObj: Object3D;
        bodyObj: Object3D;
    }): void {
        const entity = this.world.createTransformEntity(g.scene);
        attachToLabRoot(g.scene);
        entity.addComponent(CardDispenser);
        g.scene.rotation.y = DISPENSER_ROOT_YAW;
        g.scene.updateMatrixWorld(true);
        g.landingObj.getWorldPosition(this.tmpPos);
        g.scene.position.y += DISPENSER_LANDING_Y - this.tmpPos.y;
        g.scene.updateMatrixWorld(true);
        const bodyBounds = new Box3().setFromObject(g.bodyObj);
        bodyBounds.getCenter(this.tmpPos);
        g.scene.position.x += DISPENSER_BODY_ROW_POSITION[0] - this.tmpPos.x;
        g.scene.position.z += DISPENSER_BODY_ROW_POSITION[1] - this.tmpPos.z;
        g.scene.updateMatrixWorld(true);
        this.mixer = new AnimationMixer(g.scene);
        this.action = this.mixer.clipAction(g.clip);
        this.action.setLoop(LoopOnce, 1);
        this.action.clampWhenFinished = true;
        this.mixer.addEventListener("finished", this.onFinished);
        this.clip = g.clip;
        this.ejectObj = g.ejectObj;
        this.landingObj = g.landingObj;
        this.dispenserScene = g.scene;
        this.dispenserEntity = entity;
        this.dispenserAvailable = true;
        this.resetDispenserPose();
        const audioEntity = this.world
            .createTransformEntity()
            .addComponent(AudioSource, {
            src: "/audio/card-dispenser.wav",
            volume: 0.8,
            loop: false,
            positional: true,
            refDistance: 0.8,
            rolloffFactor: 1,
            maxDistance: 5,
            playbackMode: PlaybackMode.Restart,
            maxInstances: 1,
        });
        audioEntity.object3D!.position.set(DISPENSER_BODY_ROW_POSITION[0], DISPENSER_LANDING_Y + 0.05, DISPENSER_BODY_ROW_POSITION[1]);
        this.dispenserAudioEntity = audioEntity;
    }
    private onPress(): void {
        if (getLessonStateSignal().peek() !== "playing")
            return;
        if (getDispenseStateSignal().peek() !== "idle")
            return;
        this.playButtonPressAnimation();
        if (this.dispenserAvailable && this.mixer && this.action && this.ejectObj) {
            this.generation++;
            this.activeGeneration = this.generation;
            getDispenseStateSignal().value = "dispensing";
            this.ejectObj.visible = true;
            this.action.stop();
            this.action.reset();
            if (this.dispenserAudioEntity) {
                AudioUtils.play(this.dispenserAudioEntity);
            }
            this.action.play();
            return;
        }
        getDispenseStateSignal().value = "dispensing";
        const ok = requestSpawnCard(getCardIndexSignal().peek());
        if (ok) {
            getDispenseStateSignal().value = "cardActive";
        }
        else {
            if (!this.warnedFallbackSpawn) {
                this.warnedFallbackSpawn = true;
                console.warn("[PythonTypeLab] Fallback New Card spawn failed — returning to idle.");
            }
            getDispenseStateSignal().value = "idle";
        }
    }
    private onFinished = (event: MixerFinishedEvent): void => {
        if (event.action !== this.action)
            return;
        if (getDispenseStateSignal().peek() !== "dispensing")
            return;
        if (this.activeGeneration !== this.generation)
            return;
        if (!this.ejectObj)
            return;
        this.ejectObj.updateWorldMatrix(true, false);
        this.ejectObj.matrixWorld.decompose(this.tmpPos, this.tmpQuat, this.tmpScale);
        const ok = requestSpawnCard(getCardIndexSignal().peek(), {
            position: this.tmpPos,
            quaternion: this.tmpQuat,
        });
        if (ok) {
            this.ejectObj.visible = false;
            getDispenseStateSignal().value = "cardActive";
            return;
        }
        if (!this.warnedHandoff) {
            this.warnedHandoff = true;
            console.warn("[PythonTypeLab] Card handoff spawn failed — resetting dispenser.");
        }
        this.resetDispenserPose();
        getDispenseStateSignal().value = "idle";
    };
    private handleReset(): void {
        this.generation++;
        this.resetButtonPressAnimation();
        this.resetDispenserPose();
        getDispenseStateSignal().value = "idle";
    }
    private resetDispenserPose(): void {
        if (this.dispenserAudioEntity) {
            AudioUtils.stop(this.dispenserAudioEntity);
        }
        if (this.action && this.mixer) {
            this.action.reset();
            this.action.play();
            this.mixer.update(0);
            this.action.stop();
        }
        if (this.ejectObj)
            this.ejectObj.visible = false;
    }
    private teardown(): void {
        if (this.buttonMixer) {
            this.buttonMixer.removeEventListener("finished", this.onButtonFinished);
            this.buttonMixer.stopAllAction();
            if (this.buttonClip)
                this.buttonMixer.uncacheClip(this.buttonClip);
            if (this.buttonModelRoot) {
                this.buttonMixer.uncacheRoot(this.buttonModelRoot);
            }
        }
        if (this.dispenserAudioEntity) {
            AudioUtils.stop(this.dispenserAudioEntity);
        }
        if (this.mixer) {
            this.mixer.removeEventListener("finished", this.onFinished);
            this.mixer.stopAllAction();
            if (this.clip)
                this.mixer.uncacheClip(this.clip);
            if (this.dispenserScene)
                this.mixer.uncacheRoot(this.dispenserScene);
        }
        this.labelEntity?.dispose();
        this.buttonEntity?.dispose();
        this.dispenserAudioEntity?.dispose();
        this.dispenserEntity?.dispose();
        this.mixer = null;
        this.action = null;
        this.ejectObj = null;
        this.landingObj = null;
        this.dispenserScene = null;
        this.dispenserAudioEntity = null;
        this.buttonMaterial = null;
        this.buttonMixer = null;
        this.buttonAction = null;
        this.buttonClip = null;
        this.buttonModelRoot = null;
        this.buttonAnimating = false;
    }
}
