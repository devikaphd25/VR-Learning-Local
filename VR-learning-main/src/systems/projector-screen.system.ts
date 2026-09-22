/**
 * Loads presentation media onto the classroom projector and follows the active
 * room slide stored by the classroom session service.
 */
import {
    createSystem,
    Group,
    Mesh,
    MeshStandardMaterial,
    Object3DEventMap
} from "@iwsdk/core";
import * as THREE from "three";
import {ProjectorScreenComponent} from "../components/projector-screen.component";
import { CLASSROOM_BOARD_CONTENT } from "../config/classroom-board-content";
import { CHALLENGE_2_ITEMS } from "../config/challenge-2-content";
import { socket } from "../network/socket";

type BoardChallengeResults = {
    rankings?: Array<{
        name?: string;
        placement?: number | null;
        wrongAnswers?: number;
        elapsedSeconds?: number;
    }>;
    commonErrors?: Array<{
        itemId?: string;
        itemName?: string;
        selectedCategory?: string;
        correctCategory?: string;
        count?: number;
    }>;
};

export class ProjectorScreenSystem extends createSystem({
    screen: { required: [ProjectorScreenComponent] }
}) {

    private screen: Mesh | undefined;
    private material: MeshStandardMaterial | undefined;
    private currentIndex: number = 0;
    private isInstructor: boolean = false; // ✅ Flag to check if user is instructor
    private joystickBusy = false;
    private boardCanvas?: HTMLCanvasElement;
    private boardTexture?: THREE.CanvasTexture;
    private boardOverlay?: THREE.Mesh;
    private onlineStudents = 0;
    private instructorOnline = false;
    private challengeResults?: BoardChallengeResults;
    private mistakeImages = new Map<string, HTMLImageElement>();

    private handleStudentList = (students: unknown[]): void => {
        const liveParticipants = Array.isArray(students)
            ? students as Array<{ role?: string; isDisconnected?: boolean }>
            : [];
        this.onlineStudents = liveParticipants.filter(
            participant =>
                participant.role === "student" &&
                !participant.isDisconnected
        ).length;
        this.instructorOnline = liveParticipants.some(
            participant =>
                participant.role === "instructor" &&
                !participant.isDisconnected
        );
        this.redrawBoardStatus();
    };

    private handleChallengeStart = (): void => {
        this.challengeResults = undefined;
        this.redrawBoardStatus();
    };

    private handleChallengeEnd = (payload: { finalResults?: unknown }): void => {
        if (!payload?.finalResults) return;
        this.challengeResults = payload.finalResults as BoardChallengeResults;
        this.redrawBoardStatus();
    };

    async init() {
        // ✅ Check if this user is the instructor
        // You can set this in index.ts
        this.isInstructor = (window as any).isInstructor || false;
        this.instructorOnline = false;
        console.log(`[ProjectorScreenSystem] isInstructor: ${this.isInstructor}`);

        socket.on("studentList", this.handleStudentList);
        socket.on("challenge2Started", this.handleChallengeStart);
        socket.on("challenge2StartedForInstructor", this.handleChallengeStart);
        socket.on("challenge2Ended", this.handleChallengeEnd);
        socket.emit("requestStudentList");
        this.cleanupFuncs.push(() => {
            socket.off("studentList", this.handleStudentList);
            socket.off("challenge2Started", this.handleChallengeStart);
            socket.off("challenge2StartedForInstructor", this.handleChallengeStart);
            socket.off("challenge2Ended", this.handleChallengeEnd);
            this.boardOverlay?.removeFromParent();
            this.boardOverlay?.geometry.dispose();
            (this.boardOverlay?.material as THREE.Material | undefined)?.dispose();
            this.boardTexture?.dispose();
        });

        this.queries.screen.subscribe("qualify", async (e) =>  {

            const scene = e.getValue(ProjectorScreenComponent, 'scene') as Group<Object3DEventMap>;
            if (!scene) return;

            this.screen = scene.getObjectByName("ProjectorScreen") as Mesh;
            if (!this.screen) {
                console.warn("[ProjectorScreenSystem] ProjectorScreen was not found.");
                return;
            }
            
            this.material = this.screen.material as MeshStandardMaterial;

            await this.loadSlide();
            this.createBoardStatusOverlay();
        })
    }

    /** Attach one transparent status canvas directly to the board mesh. */
    private createBoardStatusOverlay(): void {
        if (!this.screen || this.boardOverlay) return;
        const geometry = this.screen.geometry;
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox;
        if (!bounds) return;

        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const width = Math.max(size.x, 0.01);
        const height = Math.max(size.y, 0.01);
        this.boardCanvas = document.createElement("canvas");
        // Render the board UI at 2x its logical layout resolution. The former
        // 1024x512 canvas became soft when stretched across the large board in
        // a Quest headset, especially for the final-result text.
        this.boardCanvas.width = 2048;
        this.boardCanvas.height = 1024;
        this.boardTexture = new THREE.CanvasTexture(this.boardCanvas);
        this.boardTexture.colorSpace = THREE.SRGBColorSpace;
        this.boardTexture.anisotropy = 8;

        // Use most of the board, but keep unused canvas pixels transparent.
        // This gives the permanent class header and final results separate
        // regions instead of letting the results replace the header.
        const overlayWidth = width * 0.88;
        const overlayHeight = height * 0.88;
        this.boardOverlay = new THREE.Mesh(
            new THREE.PlaneGeometry(overlayWidth, overlayHeight),
            new THREE.MeshBasicMaterial({
                map: this.boardTexture,
                transparent: true,
                depthWrite: false,
                toneMapped: false,
                side: THREE.DoubleSide,
            })
        );
        this.boardOverlay.name = "ClassroomBoardStatus";
        // The classroom audience sits on the screen's negative-Z side (the
        // same direction used by the annotation laser). Put the canvas just
        // in front of that face so the screen depth buffer cannot hide it.
        this.boardOverlay.position.set(
            center.x,
            center.y,
            bounds.min.z - 0.012
        );
        // We view the negative-Z face of the classroom board. Turn the plane
        // around so its texture is read normally rather than as a reflection.
        this.boardOverlay.rotation.y = Math.PI;
        // Draw the transparent board overlay before UIKit's floating panels.
        // A positive renderOrder painted board text over the challenge UI.
        this.boardOverlay.renderOrder = -1;
        this.boardOverlay.raycast = () => undefined;
        this.boardOverlay.visible =
            !Boolean((window as any).isPresentationOpen) &&
            !Boolean((window as any).isStudentResultOpen);
        this.screen.add(this.boardOverlay);
        this.redrawBoardStatus();
    }

    /** Draw course identity at top center and live classroom status below it. */
    private redrawBoardStatus(): void {
        if (!this.boardCanvas || !this.boardTexture) return;
        const context = this.boardCanvas.getContext("2d");
        if (!context) return;
        const content = CLASSROOM_BOARD_CONTENT;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, this.boardCanvas.width, this.boardCanvas.height);
        // Drawing methods retain their readable 1024x512 logical coordinates.
        context.setTransform(2, 0, 0, 2, 0, 0);
        this.drawPersistentHeader(context);
        if (this.challengeResults) this.drawChallengeResults(context);
        this.boardTexture.needsUpdate = true;
    }

    /** This first row remains visible before, during, and after a challenge. */
    private drawPersistentHeader(context: CanvasRenderingContext2D): void {
        const content = CLASSROOM_BOARD_CONTENT;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = "#ffffff";
        context.font = "700 38px Arial, sans-serif";
        context.fillText(content.courseName, 512, 28);
        context.fillStyle = "#67e8f9";
        context.font = "600 24px Arial, sans-serif";
        context.fillText(content.weekLabel, 512, 65);

        context.fillStyle = "rgba(15, 23, 42, 0.86)";
        context.beginPath();
        context.roundRect(225, 84, 574, 48, 16);
        context.fill();
        context.font = "600 19px Arial, sans-serif";
        context.beginPath();
        context.arc(253, 108, 7, 0, Math.PI * 2);
        context.fillStyle = "#22d3ee";
        context.fill();
        context.fillStyle = "#cbd5e1";
        context.fillText(
            `${content.studentsLabel}: ${this.onlineStudents}`,
            370,
            108
        );
        context.beginPath();
        context.arc(574, 108, 7, 0, Math.PI * 2);
        context.fillStyle = this.instructorOnline ? "#22c55e" : "#ef4444";
        context.fill();
        context.fillStyle = this.instructorOnline ? "#86efac" : "#fca5a5";
        context.fillText(
            content.instructorLabel,
            670,
            108
        );
    }

    /** Draw final winners and general class mistakes on the projector board. */
    private drawChallengeResults(context: CanvasRenderingContext2D): void {
        const rankings = (this.challengeResults?.rankings ?? [])
            .filter(result => Number(result.placement) > 0)
            .sort((left, right) =>
                Number(left.placement) - Number(right.placement)
            )
            .slice(0, 3);
        const errors = (this.challengeResults?.commonErrors ?? []).slice(0, 5);

        context.textBaseline = "middle";
        context.textAlign = "center";
        context.fillStyle = "rgba(5, 15, 35, 0.94)";
        context.beginPath();
        context.roundRect(18, 145, 988, 355, 25);
        context.fill();
        context.fillStyle = "#67e8f9";
        context.font = "700 34px Arial, sans-serif";
        context.fillText("CHALLENGE 2 RESULTS", 512, 172);

        context.textAlign = "left";
        context.fillStyle = "#fcd34d";
        context.font = "700 25px Arial, sans-serif";
        context.fillText("WINNERS", 62, 212);
        context.fillStyle = "#ffffff";
        context.font = "600 22px Arial, sans-serif";
        if (rankings.length === 0) {
            context.fillText("No ranking awarded", 62, 258);
        } else {
            rankings.forEach((result, index) => {
                const y = 258 + index * 67;
                const suffix = result.placement === 1
                    ? "1st"
                    : result.placement === 2
                        ? "2nd"
                        : "3rd";
                context.fillStyle = index === 0 ? "#fde047" : "#ffffff";
                context.fillText(
                    `${suffix}  ${result.name ?? "Student"}`,
                    62,
                    y
                );
                context.font = "600 22px Arial, sans-serif";
            });
        }

        context.fillStyle = "rgba(148, 163, 184, 0.35)";
        context.fillRect(490, 202, 2, 270);
        context.fillStyle = "#fca5a5";
        context.font = "700 25px Arial, sans-serif";
        context.fillText("COMMON MISTAKES", 530, 212);
        if (errors.length === 0) {
            context.fillStyle = "#86efac";
            context.font = "600 21px Arial, sans-serif";
            context.fillText("No common mistakes", 530, 258);
            return;
        }

        errors.forEach((error, index) => {
            const y = 236 + index * 49;
            const image = this.getMistakeImage(error.itemId ?? "");
            if (image?.complete && image.naturalWidth > 0) {
                context.drawImage(image, 530, y, 40, 40);
            } else {
                context.fillStyle = "#334155";
                context.fillRect(530, y, 40, 40);
            }
            context.fillStyle = "#ffffff";
            context.font = "700 17px Arial, sans-serif";
            context.fillText(error.itemName ?? "Device", 582, y + 5);
            context.fillStyle = "#fca5a5";
            context.font = "600 14px Arial, sans-serif";
            context.fillText(
                `Wrong: ${String(error.selectedCategory ?? "").toUpperCase()} (${Number(error.count) || 0})`,
                582,
                y + 20
            );
            context.fillStyle = "#86efac";
            context.fillText(
                `Correct: ${String(error.correctCategory ?? "").toUpperCase()}`,
                582,
                y + 35
            );
        });
    }

    /** Load and cache the existing 2D Challenge 2 device image. */
    private getMistakeImage(itemId: string): HTMLImageElement | undefined {
        if (!itemId) return undefined;
        const cached = this.mistakeImages.get(itemId);
        if (cached) return cached;
        const item = CHALLENGE_2_ITEMS.find(entry => entry.id === itemId);
        if (!item?.imagePath) return undefined;
        const image = new Image();
        image.onload = () => this.redrawBoardStatus();
        image.src = item.imagePath;
        this.mistakeImages.set(itemId, image);
        return image;
    }

    private async loadSlide() {
        if (!this.material) return

        // Presentation files are intentionally disabled. Release any texture
        // embedded on the projector and leave a lightweight dark OFF screen.
        const previousMap = this.material.map;
        const previousEmissiveMap = this.material.emissiveMap;
        this.material.map = null;
        this.material.emissiveMap = null;
        if (previousMap) previousMap.dispose();
        if (previousEmissiveMap && previousEmissiveMap !== previousMap) {
            previousEmissiveMap.dispose();
        }
        this.material.color.setHex(0x080b10);
        this.material.emissive.setHex(0x000000);
        this.material.roughness = 0.82;
        this.material.metalness = 0.05;
        this.material.needsUpdate = true
    }

    update() {}

    private async next() {
        await this.loadSlide();
    }

    private async previous() {
        await this.loadSlide();
    }

    // ✅ Method to broadcast slide change to all connected clients
    private broadcastSlideChange(): void {
        if (this.isInstructor) {
            console.log(`[ProjectorScreenSystem] Broadcasting slide ${this.currentIndex}`);
            socket.emit('slideChanged', { index: this.currentIndex });
        }
    }
}
