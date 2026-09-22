/**
 * Lightweight transition into the Mission Review/debrief environment.
 * Goal: darken the classroom, reveal the Earth portal and decorative avatars,
 * close the portal, then invoke the environment-swap callback. It uses only
 * client-side Three.js/IWSDK visuals and does not query the database.
 */
import {
  BoxGeometry,
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3
} from "three";

/**
 * Lightweight, comfort-first doorway transition for the Mission Review room.
 * The viewer never moves; only six simple meshes animate in front of them.
 */
export class DebriefDoorTransition {
  private readonly root = new Group();
  private readonly leftDoor: Mesh;
  private readonly rightDoor: Mesh;
  private readonly doorway = new Group();
  private readonly apertureCover: Mesh;
  private readonly shimmerGroup = new Group();
  private readonly avatarGroup = new Group();
  private readonly glowMaterials: MeshBasicMaterial[] = [];
  private readonly avatarStarts: Vector3[] = [];
  private readonly avatarTargets: Vector3[] = [];
  private readonly shimmerStarts: Vector3[] = [];
  private readonly shimmerTargets: Vector3[] = [];
  private earthTexture?: Texture;
  private readonly earthTextureReady: Promise<void>;
  private astronautTexture?: Texture;
  private activeViewer?: Object3D;
  private readonly viewerPosition = new Vector3();
  private readonly viewerForward = new Vector3();
  private playing = false;

  constructor(private readonly scene: Scene) {
    this.root.name = "Debrief_Mission_Review_Door";
    this.root.visible = false;
    this.root.renderOrder = 90000;

    const doorMaterial = new MeshBasicMaterial({ color: 0x071426 });
    const glowMaterial = new MeshBasicMaterial({
      color: 0x35d9ff,
      transparent: true,
      opacity: 0.18,
      depthTest: false
    });
    const fadeMaterial = new MeshBasicMaterial({
      color: 0x020713,
      transparent: true,
      opacity: 0,
      depthTest: false,
      side: DoubleSide
    });
    this.glowMaterials.push(glowMaterial, fadeMaterial);

    const panelGeometry = new BoxGeometry(2.45, 4.25, 0.12);
    this.leftDoor = new Mesh(panelGeometry, doorMaterial);
    this.rightDoor = new Mesh(panelGeometry, doorMaterial.clone());
    this.leftDoor.position.x = -1.23;
    this.rightDoor.position.x = 1.23;

    const horizontalFrame = new BoxGeometry(5.35, 0.09, 0.16);
    const verticalFrame = new BoxGeometry(0.09, 4.55, 0.16);
    const top = new Mesh(horizontalFrame, glowMaterial);
    const bottom = new Mesh(horizontalFrame, glowMaterial);
    const left = new Mesh(verticalFrame, glowMaterial);
    const right = new Mesh(verticalFrame, glowMaterial);
    top.position.y = 2.25;
    bottom.position.y = -2.25;
    left.position.x = -2.65;
    right.position.x = 2.65;

    // Oversized plane darkens the whole headset view before the doorway is
    // introduced. It remains only one very cheap mesh.
    const fade = new Mesh(new PlaneGeometry(40, 24), fadeMaterial);
    fade.position.z = 0.18;
    fade.renderOrder = 89990;

    // A single Earth texture sits behind the opening. This is much cheaper
    // than loading a second 3D environment during the transition.
    this.earthTextureReady = new Promise(resolve => {
      this.earthTexture = new TextureLoader().load(
        "./textures/nasa/nasa-earth-galaxy-window-v3.png",
        texture => {
          texture.colorSpace = SRGBColorSpace;
          resolve();
        },
        undefined,
        error => {
          console.warn("[DebriefDoorTransition] Earth window texture unavailable", error);
          resolve();
        }
      );
      this.earthTexture.colorSpace = SRGBColorSpace;
    });
    const earthWindow = new Mesh(
      new CircleGeometry(2.22, 64),
      new MeshBasicMaterial({
        map: this.earthTexture,
        color: 0xffffff,
        transparent: true,
        opacity: 1,
        depthTest: false,
        side: DoubleSide
      })
    );
    earthWindow.position.z = -0.09;

    const apertureRing = new Mesh(
      new RingGeometry(2.22, 2.38, 64),
      new MeshBasicMaterial({
        color: 0x45e6ff,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        side: DoubleSide
      })
    );
    apertureRing.position.z = 0.015;
    this.apertureCover = new Mesh(
      new CircleGeometry(2.21, 64),
      new MeshBasicMaterial({ color: 0x020713, depthTest: false, side: DoubleSide })
    );
    this.apertureCover.position.z = 0.035;

    // Lightweight glowing motes appear with the Earth window. Sprites keep
    // the transition inexpensive enough for Quest while still giving it a
    // visible shimmer/flying-star effect.
    const shimmerMaterial = new SpriteMaterial({
      color: 0xbaf7ff,
      transparent: true,
      opacity: 0.9,
      depthTest: false
    });
    for (let index = 0; index < 32; index += 1) {
      const mote = new Sprite(shimmerMaterial.clone());
      const angle = (index / 32) * Math.PI * 2;
      const radius = 3.2 + (index % 5) * 0.42;
      const start = new Vector3(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius * 0.7,
        0.16 + (index % 3) * 0.03
      );
      const target = new Vector3(
        Math.cos(angle + 0.9) * 2.25,
        Math.sin(angle + 0.9) * 1.75,
        0.1
      );
      mote.position.copy(start);
      mote.scale.setScalar(0.035 + (index % 4) * 0.018);
      this.shimmerStarts.push(start);
      this.shimmerTargets.push(target);
      this.shimmerGroup.add(mote);
    }
    this.shimmerGroup.visible = false;

    // Exactly 24 cinematic astronauts are created once and reused. They are
    // decorative transition sprites, not connected-student representations.
    this.astronautTexture = new TextureLoader().load(
      "./images/markers/astronaut-seat-marker.png"
    );
    this.astronautTexture.colorSpace = SRGBColorSpace;
    const astronautMaterial = new SpriteMaterial({
      map: this.astronautTexture,
      transparent: true,
      depthTest: false,
      opacity: 0.98
    });
    for (let index = 0; index < 24; index += 1) {
      const avatar = new Sprite(astronautMaterial);
      const column = index % 6;
      const row = Math.floor(index / 6);
      const side = column < 3 ? -1 : 1;
      const lane = column % 3;
      const windowTarget = new Vector3(
        (column - 2.5) * 0.11,
        -1.25 + row * 0.2,
        0.02
      );
      const outsideStart = new Vector3(
        side * (3.35 + lane * 0.72),
        -1.65 + row * 1.05 + (lane % 2) * 0.28,
        0.42 + lane * 0.18
      );
      avatar.position.copy(outsideStart);
      avatar.scale.setScalar(0.52 + (index % 3) * 0.05);
      avatar.visible = false;
      this.avatarStarts.push(outsideStart);
      this.avatarTargets.push(windowTarget);
      this.avatarGroup.add(avatar);
    }
    this.avatarGroup.visible = false;

    // Circular space-station observation window. The old rectangular panels
    // remain allocated for compatibility but are not rendered.
    this.leftDoor.visible = false;
    this.rightDoor.visible = false;
    this.doorway.add(earthWindow, apertureRing, this.apertureCover);
    // A slightly wide observation window reads as a spacecraft oval while
    // retaining the inexpensive circular geometry.
    this.doorway.scale.set(1.28, 1, 1);
    this.doorway.visible = false;
    this.root.add(fade, this.doorway, this.shimmerGroup, this.avatarGroup);
    this.root.traverse(object => {
      object.renderOrder = 90000;
      object.frustumCulled = false;
    });
    // The fade is transparent, so it otherwise renders after the opaque Earth
    // and covers it with almost-black color. Keep every portal element in the
    // transparent queue and explicitly layer it above the dark fade.
    fade.renderOrder = 89990;
    earthWindow.renderOrder = 90010;
    apertureRing.renderOrder = 90020;
    this.apertureCover.renderOrder = 90030;
    this.shimmerGroup.traverse(object => {
      object.renderOrder = 90040;
    });
    this.avatarGroup.traverse(object => {
      object.renderOrder = 90050;
    });
    this.scene.add(this.root);
  }

  async play(
    swapEnvironment: () => void | Promise<void>,
    viewer?: Object3D
  ): Promise<void> {
    if (this.playing) return;
    this.playing = true;
    // The Earth must be decoded before the dark transition starts. Without
    // this wait, Quest can display a black aperture while the astronauts fly
    // and only reveal the image near the end of the sequence.
    await this.earthTextureReady;
    this.activeViewer = viewer;
    this.anchorToViewer();
    this.root.visible = true;
    this.doorway.visible = false;
    this.leftDoor.position.x = -1.23;
    this.rightDoor.position.x = 1.23;
    this.apertureCover.scale.setScalar(1);
    this.shimmerGroup.visible = false;

    try {
      // 1. Let the classroom disappear by degrees before introducing any
      // doorway geometry.
      await this.animate(1300, progress => {
        const eased = progress * progress * (3 - 2 * progress);
        this.setFadeOpacity(0.985 * eased);
      });

      // 2. The cyan frame materializes against the dark room.
      this.doorway.visible = true;
      await this.animate(800, progress => {
        const shimmer = Math.sin(progress * Math.PI * 10) * 0.1;
        this.setGlowOpacity(Math.max(0.04, 0.08 + progress * 0.7 + shimmer));
        const pulse = 0.985 + Math.sin(progress * Math.PI * 8) * 0.015;
        this.doorway.scale.set(1.28 * pulse, pulse, 1);
      });

      // 3. Play a soft pressure-release and space-chime cue as the window
      // opens. It is synthesized, so it adds no audio download.
      this.playWindowRevealSound();
      this.shimmerGroup.visible = true;
      await this.animate(3000, progress => {
        const eased = progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        // Iris-like reveal: the dark circular cover contracts into the
        // center while the Earth becomes visible behind it.
        this.apertureCover.scale.setScalar(Math.max(0.001, 1 - eased));
        this.setFadeOpacity(0.985);
        this.animateShimmer(progress);
      });

      // Hold on the fully revealed Earth window before any astronauts move.
      // This gives headset users a clear visual beat between the sound/window
      // reveal and the avatar flight sequence.
      await this.animate(1500, progress => {
        this.apertureCover.scale.setScalar(0.001);
        const pulse = 1 + Math.sin(progress * Math.PI * 4) * 0.012;
        this.doorway.scale.set(1.28 * pulse, pulse, 1);
        this.setGlowOpacity(0.72 + Math.sin(progress * Math.PI * 4) * 0.08);
        // Keep the particles circulating around the revealed Earth window.
        this.animateShimmer((progress * 1.8) % 1);
      });

      // 4. Twenty-four decorative astronauts fly toward the Earth window in
      // staggered waves. The count is intentionally independent of students.
      this.avatarGroup.visible = true;
      this.avatarGroup.children.forEach(child => {
        child.visible = true;
      });
      await this.animate(9200, progress => {
        this.avatarGroup.children.forEach((child, index) => {
          const delay = (index % 8) * 0.055 + Math.floor(index / 8) * 0.08;
          const local = Math.max(0, Math.min(1, (progress - delay) / 0.55));
          const eased = 1 - Math.pow(1 - local, 3);
          const start = this.avatarStarts[index];
          const target = this.avatarTargets[index];
          if (!start || !target) return;
          child.position.lerpVectors(start, target, eased);
          child.rotation.z = (index % 2 === 0 ? -1 : 1) * eased * 0.24;
          const originalScale = 0.52 + (index % 3) * 0.05;
          child.scale.setScalar(originalScale * (1 - eased * 0.48));
        });
        this.animateShimmer((progress * 2.4) % 1);
      });
      this.avatarGroup.visible = false;
      this.shimmerGroup.visible = false;

      // 5. Close and remove the Earth window completely before changing to
      // the Mission Review scene. This prevents both scenes appearing at once.
      await this.animate(1100, progress => {
        const eased = progress * progress * (3 - 2 * progress);
        const remaining = Math.max(0.001, 1 - eased);
        this.doorway.scale.set(1.28 * remaining, remaining, 1);
        this.setGlowOpacity(0.72 * remaining);
        this.setFadeOpacity(0.985);
      });
      this.doorway.visible = false;

      // 6. The callback loads the Mission Review room and its debrief image.
      await swapEnvironment();

      // 7. Reveal the completed Mission Review room gently.
      await this.animate(1200, progress => {
        this.setFadeOpacity(0.985 * (1 - progress));
        this.setGlowOpacity(0.8 * (1 - progress));
      });
    } finally {
      this.root.visible = false;
      this.doorway.visible = false;
      this.shimmerGroup.visible = false;
      this.avatarGroup.visible = false;
      this.avatarGroup.children.forEach((child, index) => {
        const start = this.avatarStarts[index];
        if (start) child.position.copy(start);
        child.scale.setScalar(0.52 + (index % 3) * 0.05);
        child.rotation.z = 0;
        child.visible = false;
      });
      this.setFadeOpacity(0);
      this.setGlowOpacity(0.18);
      this.doorway.scale.set(1.28, 1, 1);
      this.activeViewer = undefined;
      this.playing = false;
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.root.traverse(object => {
      if (!(object instanceof Mesh) && !(object instanceof Sprite)) return;
      if (object instanceof Mesh) object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.forEach(material => material.dispose());
    });
    this.earthTexture?.dispose();
    this.astronautTexture?.dispose();
  }

  private animate(
    durationMs: number,
    update: (progress: number) => void
  ): Promise<void> {
    return new Promise(resolve => {
      const startedAt = performance.now();
      const frame = (): void => {
        const now = performance.now();
        const progress = Math.min(1, (now - startedAt) / durationMs);
        // Physical Quest sessions use a tracked origin that can differ from
        // the desktop emulator. Keeping the transition relative to the live
        // XR camera guarantees that the portal remains in front of the user.
        this.anchorToViewer();
        update(progress);
        // A physical Quest transfers animation ownership to WebXR. The
        // window requestAnimationFrame callback can then be throttled or
        // suspended even though the renderer's XR loop is still drawing.
        // Advancing this lightweight transition with a short timer keeps it
        // moving in desktop, emulator, and immersive-headset sessions.
        if (progress < 1) window.setTimeout(frame, 16);
        else resolve();
      };
      // Apply the initial state synchronously so the first darkening frame is
      // visible even on headsets that defer timers briefly during XR entry.
      this.anchorToViewer();
      update(0);
      window.setTimeout(frame, 16);
    });
  }

  private animateShimmer(progress: number): void {
    this.shimmerGroup.children.forEach((child, index) => {
      const start = this.shimmerStarts[index];
      const target = this.shimmerTargets[index];
      if (!start || !target) return;
      const staggered = (progress + (index % 8) * 0.075) % 1;
      const eased = staggered * staggered * (3 - 2 * staggered);
      child.position.lerpVectors(start, target, eased);
      const pulse = 0.65 + Math.sin((progress * 8 + index) * Math.PI) * 0.35;
      child.scale.setScalar((0.035 + (index % 4) * 0.018) * pulse);
      const material = (child as Sprite).material as SpriteMaterial;
      material.opacity = 0.45 + pulse * 0.5;
    });
  }

  private anchorToViewer(): void {
    if (!this.activeViewer) return;
    this.activeViewer.updateWorldMatrix(true, false);
    this.activeViewer.getWorldPosition(this.viewerPosition);
    this.activeViewer.getWorldQuaternion(this.root.quaternion);
    this.viewerForward
      .set(0, 0, -1)
      .applyQuaternion(this.root.quaternion)
      .normalize();
    this.root.position
      .copy(this.viewerPosition)
      .addScaledVector(this.viewerForward, 4.15);
  }

  private setGlowOpacity(opacity: number): void {
    const glow = this.glowMaterials[0];
    if (glow) glow.opacity = opacity;
  }

  private setFadeOpacity(opacity: number): void {
    const fade = this.glowMaterials[1];
    if (fade) fade.opacity = opacity;
  }

  /** Synthesized pressure release plus glassy chime; no audio asset required. */
  private playWindowRevealSound(): void {
    try {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return;
      const context = new AudioContextCtor();
      const master = context.createGain();
      master.gain.setValueAtTime(0.0001, context.currentTime);
      master.gain.exponentialRampToValueAtTime(0.1, context.currentTime + 0.1);
      master.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 3.4);
      master.connect(context.destination);

      const noiseBuffer = context.createBuffer(
        1,
        Math.floor(context.sampleRate * 1.7),
        context.sampleRate
      );
      const noiseData = noiseBuffer.getChannelData(0);
      for (let index = 0; index < noiseData.length; index += 1) {
        noiseData[index] = (Math.random() * 2 - 1) * (1 - index / noiseData.length);
      }
      const pressure = context.createBufferSource();
      pressure.buffer = noiseBuffer;
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(720, context.currentTime);
      filter.frequency.exponentialRampToValueAtTime(180, context.currentTime + 1.6);
      pressure.connect(filter);
      filter.connect(master);

      const chimeGain = context.createGain();
      chimeGain.gain.setValueAtTime(0.0001, context.currentTime + 0.55);
      chimeGain.gain.exponentialRampToValueAtTime(0.055, context.currentTime + 0.72);
      chimeGain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 3.2);
      chimeGain.connect(context.destination);
      [392, 587.33, 783.99].forEach((frequency, index) => {
        const chime = context.createOscillator();
        chime.type = "sine";
        chime.frequency.value = frequency;
        chime.connect(chimeGain);
        chime.start(context.currentTime + 0.55 + index * 0.08);
        chime.stop(context.currentTime + 3.25);
      });

      pressure.start();
      pressure.stop(context.currentTime + 1.7);
      window.setTimeout(() => void context.close(), 3500);
      if (context.state === "suspended") void context.resume();
    } catch (error) {
      console.warn("[DebriefDoorTransition] Audio cue unavailable", error);
    }
  }
}
