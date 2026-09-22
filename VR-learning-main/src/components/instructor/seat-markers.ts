/** Creates lightweight 3D labels that show occupied seat names to instructors. */

import {
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  Object3D,
  Vector3
} from "@iwsdk/core";

import { socket } from "../../network/socket";

function isLocalStudent(studentId: string): boolean {
  return !(window as any).isInstructor && studentId === socket.id;
}

interface Student {
  id: string;
  name?: string;
  seat: string;
  mode: string;
  isDemo?: boolean;
}

// Store markers by student ID
const markers = new Map<string, Sprite>();
let playerRef: any = null;
let stagePosition = new Vector3(0, 0, 0);
let isFacingStage = false;
let markersSuppressed = false;
let markersForcedVisible = false;
let markerTheme: "default" | "astronaut" = "default";
const FACING_THRESHOLD = 0.5;

const astronautImage = new Image();
astronautImage.src = "./images/markers/astronaut-seat-marker.png";
astronautImage.onload = () => {
  if (markerTheme === "astronaut") refreshAllMarkerTextures();
};

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, width, height, radius);
  else ctx.rect(x, y, width, height);
  ctx.fill();
}

function createTexture(name: string, mode: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;

  const ctx = canvas.getContext("2d")!;

  ctx.clearRect(0, 0, 512, 512);

  const color =
    mode === "Presentation Mode"
      ? "#22c55e"
      : "#2196f3";

  if (markerTheme === "astronaut") {
    if (astronautImage.complete && astronautImage.naturalWidth > 0) {
      ctx.drawImage(astronautImage, 126, 10, 260, 260);
    }

    // A simple holographic base provides position without adding geometry.
    ctx.strokeStyle = "rgba(34, 211, 238, 0.9)";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.ellipse(256, 275, 102, 25, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(103, 232, 249, 0.45)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(256, 275, 72, 16, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Original lightweight classroom avatar.
    ctx.beginPath();
    ctx.arc(256, 150, 90, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 12;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = "#555";
    ctx.beginPath();
    ctx.arc(256, 140, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(256, 205, 55, Math.PI, 0);
    ctx.fill();
  }

  // name box
  ctx.fillStyle = "#111827";
  roundedRect(ctx, 100, 315, 312, 76, 20);
  if (markerTheme === "astronaut") {
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#22d3ee";
    ctx.stroke();
  }

  ctx.fillStyle = "white";
  ctx.font = "bold 34px Arial";
  ctx.textAlign = "center";

  // ✅ Show actual name (not ID)
  const displayName = name.length > 8 ? name.substring(0, 8) + "..." : name;
  ctx.fillText(displayName, 256, 363);

  return new CanvasTexture(canvas);
}

function refreshAllMarkerTextures(): void {
  markers.forEach(marker => {
    const material = marker.material as SpriteMaterial;
    material.map?.dispose();
    material.map = createTexture(
      String(marker.userData.displayName ?? "Student"),
      String(marker.userData.mode ?? "Classroom Mode")
    );
    material.needsUpdate = true;
  });
}

export function setSeatMarkerTheme(theme: "default" | "astronaut"): void {
  if (markerTheme === theme) return;
  markerTheme = theme;
  refreshAllMarkerTextures();
  console.log(`[SeatMarkers] Theme changed to ${theme}`);
}

// ==========================================
// Check if player is facing the stage
// ==========================================
function checkPlayerFacingStage(): boolean {
  if (!playerRef) return true;

  try {
    const forward = new Vector3(0, 0, -1);
    forward.applyQuaternion(playerRef.quaternion);

    const playerPos = new Vector3();
    playerRef.getWorldPosition(playerPos);

    // Use the classroom's real instructor/stage anchor instead of assuming
    // the stage is at the world origin.
    const toStage = stagePosition.clone().sub(playerPos);
    toStage.y = 0;
    toStage.normalize();

    const dot = forward.dot(toStage);

    return dot > FACING_THRESHOLD;
  } catch (e) {
    return true;
  }
}

// ==========================================
// Update all marker visibility
// ==========================================
export function updateMarkerVisibility(player: any) {
  playerRef = player;
  isFacingStage = checkPlayerFacingStage();
  const isInstructor = Boolean((window as any).isInstructor);

  markers.forEach((marker, studentId) => {
    marker.visible =
      !((window as any).isLabActive) && !isLocalStudent(studentId) &&
      !markersSuppressed &&
      (
        markersForcedVisible ||
        !isInstructor ||
        isFacingStage
      );
  });
}

// ==========================================
// Update seat markers
// ==========================================
export function updateSeatMarkers(
  students: Student[],
  scene: Object3D,
  classroom: Object3D
) {
  console.log("[SeatMarkers] Updating markers for", students.length, "students");

  // ✅ Filter out demo students and students without seats
  const realStudents = students.filter(s =>
    !s.isDemo && s.seat && s.seat !== "Not selected" && !isLocalStudent(s.id)
  );

  console.log("[SeatMarkers] Real students with seats:", realStudents.length);

  const stageAnchor = classroom.getObjectByName("InstructorAvatar_Anchor");
  if (stageAnchor) stageAnchor.getWorldPosition(stagePosition);

  // Get current student IDs
  const currentStudentIds = realStudents.map(s => s.id);

  // Remove markers for students no longer in the list
  const toRemove: string[] = [];
  markers.forEach((marker, id) => {
    if (!currentStudentIds.includes(id)) {
      scene.remove(marker);
      if (marker.material) {
        if (marker.material.map) {
          marker.material.map.dispose();
        }
        marker.material.dispose();
      }
      toRemove.push(id);
    }
  });
  toRemove.forEach(id => markers.delete(id));

  // Update or create markers
  realStudents.forEach(student => {
    // ✅ Use the actual student name (from server)
    const displayName = student.name || student.id.substring(0, 6);

    console.log(`[SeatMarkers] Creating marker for ${displayName} at ${student.seat}`);

    const seat = classroom.getObjectByName(student.seat);
    if (!seat) {
      console.warn(`[SeatMarkers] Seat not found: ${student.seat}`);
      return;
    }

    const pos = new Vector3();
    seat.getWorldPosition(pos);

    let marker = markers.get(student.id);

    if (!marker) {
      const texture = createTexture(displayName, student.mode);

      marker = new Sprite(
        new SpriteMaterial({
          map: texture,
          transparent: true,
          depthTest: false,  // ✅ Always render on top
        })
      );

      marker.scale.set(0.65, 0.65, 0.65);
      marker.userData.studentId = student.id;
      marker.userData.displayName = displayName;
      marker.userData.mode = student.mode;

      // ✅ Start visible by default
      marker.visible =
        !markersSuppressed &&
        (
          markersForcedVisible ||
          !(window as any).isInstructor ||
          isFacingStage
        );

      scene.add(marker);
      markers.set(student.id, marker);

      console.log(`[SeatMarkers] ✅ Created marker for ${displayName}`);
    }

    marker.userData.displayName = displayName;
    marker.userData.mode = student.mode;

    marker.position.set(
      pos.x,
      pos.y + 0.75,
      pos.z
    );
  });

  // Update visibility based on player facing
  if (playerRef) {
    updateMarkerVisibility(playerRef);
  }
}

// ==========================================
// Force show/hide markers (for debugging)
// ==========================================
export function showAllMarkers() {
  markersSuppressed = false;
  markers.forEach((marker, studentId) => {
    marker.visible = !((window as any).isLabActive) && !isLocalStudent(studentId);
  });
  console.log("[SeatMarkers] All markers forced visible");
}

/**
 * Lightweight Mission Review arrival animation. The existing 2D sprites are
 * offset briefly and glide back to their assigned seats; no new models or
 * textures are loaded.
 */
export function animateSeatMarkersArrival(durationMs = 1400): Promise<void> {
  const arrivals = Array.from(markers.values())
    .filter(marker => !isLocalStudent(String(marker.userData.studentId)))
    .map((marker, index) => {
    if (!marker.userData.classroomMarkerPosition) {
      marker.userData.classroomMarkerPosition = marker.position.clone();
      marker.userData.classroomMarkerScale = marker.scale.clone();
    }
    const side = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2) % 8;
    return {
      marker,
      start: new Vector3(side * (0.55 + row * 0.08), 1.25 + (row % 3) * 0.18, 4.9),
      destination: new Vector3(side * 6.35, 1.15 + row * 0.5, 5.7),
      destinationScale: marker.scale.clone()
    };
  });

  if (arrivals.length === 0) return Promise.resolve();

  arrivals.forEach(({ marker, start, destinationScale }) => {
    marker.visible = !((window as any).isLabActive) && !isLocalStudent(String(marker.userData.studentId));
    marker.position.copy(start);
    marker.scale.copy(destinationScale).multiplyScalar(0.72);
  });

  return new Promise(resolve => {
    const startedAt = performance.now();
    const frame = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);

      arrivals.forEach(({ marker, start, destination, destinationScale }) => {
        marker.position.lerpVectors(start, destination, eased);
        marker.scale.copy(destinationScale).multiplyScalar(0.72 + eased * 0.28);
      });

      if (progress < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

export function restoreSeatMarkersAfterDebrief(): void {
  markers.forEach(marker => {
    const position = marker.userData.classroomMarkerPosition as Vector3 | undefined;
    const scale = marker.userData.classroomMarkerScale as Vector3 | undefined;
    if (position) marker.position.copy(position);
    if (scale) marker.scale.copy(scale);
    delete marker.userData.classroomMarkerPosition;
    delete marker.userData.classroomMarkerScale;
  });
}

/**
 * Keep every marker visible across the per-frame classroom visibility loop.
 * Challenge mode uses this because students are no longer expected to face
 * the classroom stage while answering the question.
 */
export function setSeatMarkersForcedVisible(forced: boolean): void {
  markersForcedVisible = forced;

  if (forced) {
    markersSuppressed = false;
    markers.forEach((marker, studentId) => {
      marker.visible = !((window as any).isLabActive) && !isLocalStudent(studentId);
    });
  } else if (playerRef) {
    updateMarkerVisibility(playerRef);
  }

  console.log(
    `[SeatMarkers] Forced visibility: ${forced ? "on" : "off"}`
  );
}

export function hideAllMarkers() {
  // This is the menu's temporary per-frame hide. Do not set the persistent
  // presentation suppression flag, otherwise markers remain hidden after the
  // menu closes and the normal visibility loop resumes.
  markers.forEach((marker, studentId) => {
    marker.visible = false;
  });
}

export function setSeatMarkersSuppressed(suppressed: boolean) {
  markersSuppressed = suppressed;

  if (suppressed) {
    markers.forEach((marker, studentId) => {
      marker.visible = false;
    });
  } else if (playerRef) {
    updateMarkerVisibility(playerRef);
  } else {
    markers.forEach((marker, studentId) => {
      marker.visible = !((window as any).isLabActive) && !isLocalStudent(studentId);
    });
  }

  console.log(
    `[SeatMarkers] Presentation suppression: ${suppressed ? "on" : "off"}`
  );
}

// ==========================================
// Clear all markers
// ==========================================
export function clearAllSeatMarkers(scene: Object3D) {
  markers.forEach((marker, id) => {
    scene.remove(marker);
    if (marker.material) {
      if (marker.material.map) {
        marker.material.map.dispose();
      }
      marker.material.dispose();
    }
  });
  markers.clear();
  console.log("[SeatMarkers] All markers cleared");
}

// ==========================================
// Get marker count (for debugging)
// ==========================================
export function getMarkerCount(): number {
  return markers.size;
}
