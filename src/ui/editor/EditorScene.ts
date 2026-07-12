import * as THREE from "three";

import { EDITOR_MODULE_BY_ID, type EditorModuleDefinition } from "../../game/editor/modules";
import type { CustomTrackModule } from "../../game/persistence/database";
import {
  observeWebglContext,
  releaseWebglContext,
  startLifecycleResource,
  stopLifecycleResource,
} from "../../game/qa/lifecycleDiagnostics";

const LANE_X = [-4.5, -1.5, 1.5, 4.5] as const;
const TRACK_START_Z = 18;
const TRACK_END_Z = -244;

type VisualState = "normal" | "selected" | "preview";

interface ModuleMaterials {
  readonly dirt: THREE.MeshStandardMaterial;
  readonly darkDirt: THREE.MeshStandardMaterial;
  readonly timber: THREE.MeshStandardMaterial;
  readonly cream: THREE.MeshStandardMaterial;
  readonly green: THREE.MeshStandardMaterial;
  readonly mud: THREE.MeshStandardMaterial;
  readonly hazard: THREE.MeshStandardMaterial;
  readonly cyan: THREE.MeshStandardMaterial;
  readonly dark: THREE.MeshStandardMaterial;
  readonly metal: THREE.MeshStandardMaterial;
  readonly white: THREE.MeshStandardMaterial;
  readonly yellow: THREE.MeshStandardMaterial;
}

type VectorTuple = readonly [number, number, number];
type ProfilePoint = readonly [z: number, height: number];

export class EditorScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly webglContext: WebGLRenderingContext;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 500);
  private readonly modules = new THREE.Group();
  private readonly preview = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly resizeObserver: ResizeObserver;
  private animationFrame = 0;
  private orbit = -0.36;
  private radius = 54;
  private dragging = false;
  private dragX = 0;
  private dragStartX = 0;
  private hasDragged = false;
  private disposed = false;
  private onPlace: (lane: 0 | 1 | 2 | 3, gridPosition: number) => void = () => undefined;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.webglContext = this.renderer.getContext();
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(0x79bac8);
    this.scene.fog = new THREE.Fog(0xaeb69a, 86, 164);
    this.scene.add(this.modules, this.preview);
    this.buildGround();
    this.updateCamera();
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(canvas);
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointermove", this.pointerMove);
    canvas.addEventListener("pointerup", this.pointerUp);
    canvas.addEventListener("pointercancel", this.pointerCancel);
    canvas.addEventListener("wheel", this.wheel, { passive: false });
    this.animationFrame = requestAnimationFrame(this.frame);
    startLifecycleResource("editorScenes");
    observeWebglContext(this.webglContext);
    startLifecycleResource("editorRenderLoops");
  }

  setPlacementHandler(handler: (lane: 0 | 1 | 2 | 3, gridPosition: number) => void): void {
    this.onPlace = handler;
  }

  update(placements: CustomTrackModule[], selectedId: string | null, previewModuleId: string): void {
    this.clearGroup(this.modules);
    for (const placement of placements) {
      const definition = EDITOR_MODULE_BY_ID.get(placement.moduleId);
      if (!definition) continue;
      const state: VisualState = placement.id === selectedId ? "selected" : "normal";
      const visual = this.createModuleVisual(definition, state);
      visual.position.set(
        LANE_X[placement.lane] + (definition.laneSpan - 1) * 1.5,
        0.06 + placement.height,
        -placement.gridPosition,
      );
      visual.rotation.y = THREE.MathUtils.degToRad(placement.rotation);
      visual.userData.placementId = placement.id;
      this.modules.add(visual);
    }
    this.updatePreview(previewModuleId, 1, this.nextGridPosition(placements));
  }

  captureThumbnail(): string {
    this.renderer.render(this.scene, this.camera);
    // Safari may fall back to PNG when WebP canvas encoding is unavailable.
    // Downsample first so that fallback remains inside the validated 300 KB
    // embedded-thumbnail budget on every supported browser.
    const thumbnail = document.createElement("canvas");
    thumbnail.width = 320;
    thumbnail.height = 180;
    const context = thumbnail.getContext("2d");
    if (!context) return this.canvas.toDataURL("image/jpeg", 0.68);
    context.drawImage(this.canvas, 0, 0, thumbnail.width, thumbnail.height);
    const webp = thumbnail.toDataURL("image/webp", 0.68);
    return webp.length <= 280_000 ? webp : thumbnail.toDataURL("image/jpeg", 0.68);
  }

  dispose(): void {
    if (this.disposed) return;
    const shouldReleaseWebglContext = !this.canvas.isConnected;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.canvas.removeEventListener("pointermove", this.pointerMove);
    this.canvas.removeEventListener("pointerup", this.pointerUp);
    this.canvas.removeEventListener("pointercancel", this.pointerCancel);
    this.canvas.removeEventListener("wheel", this.wheel);
    this.clearGroup(this.scene);
    this.renderer.dispose();
    if (shouldReleaseWebglContext) {
      this.renderer.forceContextLoss();
      releaseWebglContext(this.webglContext);
    }
    stopLifecycleResource("editorRenderLoops");
    stopLifecycleResource("editorScenes");
  }

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    this.preview.position.y = Math.sin(now * 0.004) * 0.07;
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.frame);
  };

  private buildGround(): void {
    const hemisphere = new THREE.HemisphereLight(0xe7f8ff, 0x4f3027, 1.7);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight(0xffe2b1, 4.7);
    key.position.set(-35, 52, 30);
    key.castShadow = true;
    key.shadow.mapSize.set(1536, 1536);
    key.shadow.bias = -0.00025;
    const shadowCamera = key.shadow.camera;
    shadowCamera.left = -74;
    shadowCamera.right = 74;
    shadowCamera.top = 92;
    shadowCamera.bottom = -92;
    shadowCamera.near = 1;
    shadowCamera.far = 180;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x78c6e7, 0.8);
    fill.position.set(34, 22, -56);
    this.scene.add(fill);

    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x7b4733, roughness: 1, flatShading: true });
    this.addMesh(this.scene, new THREE.BoxGeometry(58, 4.2, 286), baseMaterial, [0, -2.18, -111], [0, 0, 0], true, true);

    const sandMaterial = new THREE.MeshStandardMaterial({ color: 0xb96c43, roughness: 1, flatShading: true });
    this.addMesh(this.scene, new THREE.PlaneGeometry(116, 360), sandMaterial, [0, -4.25, -111], [-Math.PI / 2, 0, 0], false, true);

    const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x4f7d41, roughness: 1, flatShading: true });
    this.addMesh(this.scene, new THREE.BoxGeometry(54, 0.34, 282), grassMaterial, [0, -0.16, -111], [0, 0, 0], false, true);

    const shoulderMaterial = new THREE.MeshStandardMaterial({ color: 0xc38952, roughness: 1, flatShading: true });
    for (const x of [-8.15, 8.15]) {
      this.addMesh(this.scene, new THREE.BoxGeometry(1.3, 0.24, 272), shoulderMaterial, [x, 0.02, -111], [0, 0, 0], false, true);
    }

    const dirtMaterial = new THREE.MeshStandardMaterial({ color: 0x9f5937, roughness: 0.98, flatShading: true });
    this.addMesh(this.scene, new THREE.BoxGeometry(15, 0.22, 270), dirtMaterial, [0, 0.04, -111], [0, 0, 0], false, true);

    this.buildSnapGrid();
    this.buildShoulderBlocks();
    this.buildWorkshop();
    this.buildDioramaScenery();
  }

  private buildSnapGrid(): void {
    const snapPositions: number[] = [];
    for (let z = TRACK_START_Z; z >= TRACK_END_Z; z -= 2) {
      snapPositions.push(-7.3, 0.19, z, 7.3, 0.19, z);
    }
    const snapGeometry = new THREE.BufferGeometry();
    snapGeometry.setAttribute("position", new THREE.Float32BufferAttribute(snapPositions, 3));
    const snapMaterial = new THREE.LineBasicMaterial({ color: 0xffe0a1, transparent: true, opacity: 0.17 });
    this.scene.add(new THREE.LineSegments(snapGeometry, snapMaterial));

    const laneMaterial = new THREE.MeshStandardMaterial({ color: 0xffe6ad, roughness: 0.8, emissive: 0x3a2411, emissiveIntensity: 0.08 });
    for (const x of [-6, -3, 0, 3, 6]) {
      this.addMesh(this.scene, new THREE.BoxGeometry(0.075, 0.045, 268), laneMaterial, [x, 0.19, -111], [0, 0, 0], false, true);
    }

    const majorPositions: number[] = [];
    for (let z = 16; z >= -240; z -= 12) {
      majorPositions.push(-7.5, 0.205, z, 7.5, 0.205, z);
    }
    const majorGeometry = new THREE.BufferGeometry();
    majorGeometry.setAttribute("position", new THREE.Float32BufferAttribute(majorPositions, 3));
    const majorMaterial = new THREE.LineBasicMaterial({ color: 0xfff0c5, transparent: true, opacity: 0.4 });
    this.scene.add(new THREE.LineSegments(majorGeometry, majorMaterial));
  }

  private buildShoulderBlocks(): void {
    const red = new THREE.MeshStandardMaterial({ color: 0xd4473f, roughness: 0.72, flatShading: true });
    const cream = new THREE.MeshStandardMaterial({ color: 0xffe2ad, roughness: 0.78, flatShading: true });
    for (let index = 0; index < 13; index += 1) {
      const z = 10 - index * 21;
      for (const x of [-8.45, 8.45]) {
        const material = (index + (x > 0 ? 1 : 0)) % 2 === 0 ? red : cream;
        this.addMesh(this.scene, new THREE.BoxGeometry(0.82, 0.68, 6.8), material, [x, 0.36, z], [0, 0, 0], true, true);
      }
    }
  }

  private buildWorkshop(): void {
    const group = new THREE.Group();
    group.position.set(-20.2, 0.2, -68);
    this.scene.add(group);

    const walls = new THREE.MeshStandardMaterial({ color: 0x31566a, roughness: 0.78, flatShading: true });
    const trim = new THREE.MeshStandardMaterial({ color: 0xe3a744, roughness: 0.66, flatShading: true });
    const roof = new THREE.MeshStandardMaterial({ color: 0x263b4a, roughness: 0.52, metalness: 0.24, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x172b36, roughness: 0.7, flatShading: true });
    const glass = new THREE.MeshStandardMaterial({ color: 0x7cd6dc, emissive: 0x164b56, emissiveIntensity: 0.28, roughness: 0.28 });

    this.addMesh(group, new THREE.BoxGeometry(9.2, 4.8, 7.6), walls, [0, 2.4, 0], [0, 0, 0], true, true);
    this.addMesh(group, new THREE.BoxGeometry(10.1, 0.52, 8.45), roof, [0, 5.02, 0], [0, 0, -0.03], true, true);
    this.addMesh(group, new THREE.BoxGeometry(2.6, 3.3, 0.18), dark, [1.9, 1.68, 3.9], [0, 0, 0], false, true);
    for (const x of [-2.8, -0.9]) {
      this.addMesh(group, new THREE.BoxGeometry(1.25, 1.3, 0.2), glass, [x, 3.1, 3.91], [0, 0, 0], false, true);
    }
    this.addMesh(group, new THREE.BoxGeometry(3.8, 0.22, 1.6), trim, [-1.5, 5.34, -0.2], [-0.1, 0, 0], true, true);
    this.addMesh(group, new THREE.BoxGeometry(3.8, 0.22, 1.6), trim.clone(), [2.5, 5.34, -0.2], [-0.1, 0, 0], true, true);

    const crateMaterial = new THREE.MeshStandardMaterial({ color: 0xb16b35, roughness: 0.9, flatShading: true });
    for (const [x, z, scale] of [[-5.4, 2.4, 1], [-4.7, 0.7, 0.78], [5.2, 1.8, 0.9]] as const) {
      this.addMesh(group, new THREE.BoxGeometry(1.4 * scale, 1.4 * scale, 1.4 * scale), crateMaterial, [x, 0.7 * scale, z], [0, 0.2, 0], true, true);
    }

    const machine = new THREE.Group();
    machine.position.set(19, 0.35, -77);
    this.scene.add(machine);
    const machineYellow = new THREE.MeshStandardMaterial({ color: 0xe3a332, roughness: 0.62, flatShading: true });
    const tire = new THREE.MeshStandardMaterial({ color: 0x1d2525, roughness: 0.95, flatShading: true });
    this.addMesh(machine, new THREE.BoxGeometry(4.8, 1.8, 3), machineYellow, [0, 1.55, 0], [0, 0.15, 0], true, true);
    this.addMesh(machine, new THREE.BoxGeometry(2.8, 1.7, 2.2), dark, [-0.4, 3.05, 0], [0, 0.15, 0], true, true);
    for (const x of [-1.55, 1.55]) {
      for (const z of [-1.45, 1.45]) {
        this.addMesh(machine, new THREE.CylinderGeometry(0.78, 0.78, 0.5, 12), tire, [x, 0.76, z], [0, 0, Math.PI / 2], true, true);
      }
    }
    this.addMesh(machine, new THREE.BoxGeometry(3.8, 0.45, 1.2), machineYellow, [3.2, 0.85, 0], [0, 0.15, -0.18], true, true);
  }

  private buildDioramaScenery(): void {
    const treeLocations = [
      [-22, 5, 1.05], [22, -4, 0.9], [-23, -24, 0.85], [22, -42, 1.1],
      [-22, -100, 1.15], [23, -118, 0.88], [-23, -150, 1.02], [22, -176, 1.16],
      [-22, -205, 0.9], [23, -231, 1.05],
    ] as const;
    treeLocations.forEach(([x, z, scale]) => this.addTree(x, z, scale));

    const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x9a553d, roughness: 0.96, flatShading: true });
    const rockLocations = [
      [-17, -13, 1.2], [19, -22, 0.9], [-17, -47, 0.7], [18, -92, 1.1],
      [-19, -126, 0.9], [17, -145, 0.65], [-18, -188, 1.15], [19, -216, 0.8],
    ] as const;
    rockLocations.forEach(([x, z, scale], index) => {
      this.addMesh(
        this.scene,
        new THREE.DodecahedronGeometry(1.65 * scale, 0),
        rockMaterial,
        [x, 0.75 * scale, z],
        [0.2, index * 0.63, 0.14],
        true,
        true,
      );
    });

    const mesaLocations = [
      [-27, -18, 0.95], [27, -50, 0.82], [-27, -134, 1.08], [27, -205, 0.92],
    ] as const;
    mesaLocations.forEach(([x, z, scale], index) => this.addCanyonMesa(x, z, scale, index * 0.38));

    const cactusMaterial = new THREE.MeshStandardMaterial({ color: 0x3d7b4b, roughness: 0.92, flatShading: true });
    for (const [x, z, rotation] of [[17.8, -14, 0.2], [-18.5, -113, -0.25], [18.2, -186, 0.14]] as const) {
      this.addMesh(this.scene, new THREE.CylinderGeometry(0.25, 0.34, 2.7, 7), cactusMaterial, [x, 1.35, z], [0, rotation, 0], true, true);
      this.addMesh(this.scene, new THREE.CylinderGeometry(0.14, 0.18, 1.15, 7), cactusMaterial, [x + 0.48, 1.45, z], [0, 0, Math.PI / 2], true, true);
    }

    this.addFestivalBanner(-34, 0xec5549);
    this.addFestivalBanner(-168, 0x27bfd0);
  }

  private addCanyonMesa(x: number, z: number, scale: number, rotation: number): void {
    const group = new THREE.Group();
    group.position.set(x, -0.1, z);
    group.rotation.y = rotation;
    group.scale.setScalar(scale);
    this.scene.add(group);
    const sandstone = new THREE.MeshStandardMaterial({ color: 0xa9563e, roughness: 0.98, flatShading: true });
    const sunFace = new THREE.MeshStandardMaterial({ color: 0xc96f4b, roughness: 0.96, flatShading: true });
    this.addMesh(group, new THREE.CylinderGeometry(4.5, 5.4, 3.2, 7), sandstone, [0, 1.6, 0], [0, 0.16, 0], true, true);
    this.addMesh(group, new THREE.CylinderGeometry(3.25, 4.2, 3, 7), sunFace, [0.35, 4.68, -0.2], [0, -0.12, 0], true, true);
    this.addMesh(group, new THREE.CylinderGeometry(2.1, 3, 2.4, 7), sandstone.clone(), [0.1, 7.35, -0.1], [0, 0.24, 0], true, true);
  }

  private addTree(x: number, z: number, scale: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.scale.setScalar(scale);
    this.scene.add(group);
    const trunk = new THREE.MeshStandardMaterial({ color: 0x65412c, roughness: 1, flatShading: true });
    const needles = new THREE.MeshStandardMaterial({ color: 0x3f6f42, roughness: 0.96, flatShading: true });
    this.addMesh(group, new THREE.CylinderGeometry(0.36, 0.52, 3.1, 7), trunk, [0, 1.55, 0], [0, 0, 0], true, true);
    this.addMesh(group, new THREE.ConeGeometry(2.2, 4.2, 8), needles, [0, 3.4, 0], [0, 0.18, 0], true, true);
    this.addMesh(group, new THREE.ConeGeometry(1.75, 3.7, 8), needles, [0, 5.35, 0], [0, -0.12, 0], true, true);
    this.addMesh(group, new THREE.ConeGeometry(1.22, 3.2, 8), needles, [0, 7.05, 0], [0, 0.08, 0], true, true);
  }

  private addFestivalBanner(z: number, color: number): void {
    const pole = new THREE.MeshStandardMaterial({ color: 0x334a52, roughness: 0.48, metalness: 0.38, flatShading: true });
    const banner = new THREE.MeshStandardMaterial({ color, roughness: 0.72, flatShading: true, side: THREE.DoubleSide });
    for (const x of [-9.8, 9.8]) {
      this.addMesh(this.scene, new THREE.CylinderGeometry(0.12, 0.16, 4.8, 8), pole, [x, 2.4, z], [0, 0, 0], true, true);
      this.addMesh(this.scene, new THREE.BoxGeometry(2.6, 1.15, 0.12), banner, [x + (x < 0 ? 1.3 : -1.3), 3.9, z], [0, 0, 0], true, true);
    }
  }

  private updatePreview(moduleId: string, lane: 0 | 1 | 2 | 3, gridPosition: number): void {
    this.clearGroup(this.preview);
    const definition = EDITOR_MODULE_BY_ID.get(moduleId);
    if (!definition) return;

    const visual = this.createModuleVisual(definition, "preview");
    visual.position.set(LANE_X[lane] + (definition.laneSpan - 1) * 1.5, 0.13, -gridPosition);
    this.preview.add(visual);

    const width = Math.max(2.45, definition.laneSpan * 2.75);
    const length = Math.max(2, definition.length * 0.22);
    const footprint = new THREE.BoxGeometry(width + 0.38, 0.22, length + 0.38);
    const edges = new THREE.EdgesGeometry(footprint);
    footprint.dispose();
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xaaffff, transparent: true, opacity: 0.92 });
    const outline = new THREE.LineSegments(edges, lineMaterial);
    outline.position.copy(visual.position);
    outline.position.y = 0.17;
    this.preview.add(outline);

    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xd7ffff, transparent: true, opacity: 0.9 });
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.92, 4), markerMaterial);
    marker.position.set(visual.position.x, 3.4, visual.position.z);
    marker.rotation.z = Math.PI;
    this.preview.add(marker);
  }

  private createModuleVisual(definition: EditorModuleDefinition, state: VisualState): THREE.Group {
    const group = new THREE.Group();
    const materials = this.createModuleMaterials(state);
    group.userData.disposableMaterials = Object.values(materials);
    const width = Math.max(2.45, definition.laneSpan * 2.75);
    const length = Math.max(2, definition.length * 0.22);

    switch (definition.id) {
      case "straight-short":
      case "straight-long":
        this.buildStraight(group, width, length, definition.laneSpan, materials, state);
        break;
      case "curve-left":
      case "curve-right":
        this.buildCurve(group, width, length, definition.id === "curve-left" ? -1 : 1, 0, materials, state);
        break;
      case "bank-left":
      case "bank-right":
        this.buildCurve(group, width, length, definition.id === "bank-left" ? -1 : 1, 0.85, materials, state);
        break;
      case "ramp-small":
        this.buildRamp(group, width, length, 1.05, "wedge", materials, state);
        break;
      case "ramp-medium":
        this.buildRamp(group, width, length, 1.75, "wedge", materials, state);
        break;
      case "ramp-large":
        this.buildRamp(group, width, length, 2.65, "wedge", materials, state);
        break;
      case "ramp-tabletop":
        this.buildRamp(group, width, length, 1.55, "tabletop", materials, state);
        break;
      case "jump-double":
        this.buildDoubleJump(group, width, length, materials, state);
        break;
      case "jump-chain":
        this.buildJumpChain(group, width, length, materials, state);
        break;
      case "sky-kicker":
        this.buildSkyKicker(group, width, length, materials, state);
        break;
      case "bump-single":
        this.buildBumpRow(group, width, length, 1, materials, state);
        break;
      case "bump-row":
        this.buildBumpRow(group, width, length, 4, materials, state);
        break;
      case "mud-short":
      case "mud-wide":
        this.buildMud(group, width, length, definition.id === "mud-wide", materials, state);
        break;
      case "grass-cut":
        this.buildGrassCut(group, width, length, materials, state);
        break;
      case "barrier-short":
        this.buildBarrier(group, width, length, false, materials, state);
        break;
      case "barrier-offset":
        this.buildBarrier(group, width, length, true, materials, state);
        break;
      case "cooling-single":
      case "cooling-wide":
        this.buildCoolingGate(group, width, length, definition.laneSpan, materials, state);
        break;
      case "start-grid":
        this.buildStartGrid(group, width, length, materials, state);
        break;
      case "checkpoint":
        this.buildCheckpoint(group, width, length, materials, state);
        break;
      case "finish-arch":
        this.buildFinishArch(group, width, length, materials, state);
        break;
      default:
        this.buildStraight(group, width, length, definition.laneSpan, materials, state);
    }

    if (state === "selected") this.addSelectionFrame(group, width, length);
    return group;
  }

  private buildStraight(
    group: THREE.Group,
    width: number,
    length: number,
    laneSpan: number,
    materials: ModuleMaterials,
    state: VisualState,
  ): void {
    this.addBox(group, [width, 0.28, length], materials.dirt, [0, 0.14, 0]);
    this.addBox(group, [0.28, 0.38, length], materials.darkDirt, [-width / 2 + 0.14, 0.19, 0]);
    this.addBox(group, [0.28, 0.38, length], materials.darkDirt, [width / 2 - 0.14, 0.19, 0]);
    this.addLaneMarks(group, width, length, laneSpan, materials.cream, 0.3, state);
  }

  private buildCurve(
    group: THREE.Group,
    width: number,
    length: number,
    direction: -1 | 1,
    bank: number,
    materials: ModuleMaterials,
    state: VisualState,
  ): void {
    const surface = this.createCurvedStripGeometry(width, length, direction, bank);
    this.addMesh(group, surface, materials.dirt, [0, 0.12, 0], [0, 0, 0], true, true);
    this.addCurvedLaneLines(group, width, length, direction, bank, materials.cream, state);

    const railX = direction < 0 ? width * 0.47 : -width * 0.47;
    for (let index = 0; index < 5; index += 1) {
      const z = -length / 2 + (index + 0.5) * (length / 5);
      this.addBox(group, [0.42, 0.62 + bank * 0.5, length / 6], materials.hazard, [railX, 0.32 + bank * 0.22, z]);
    }
  }

  private buildRamp(
    group: THREE.Group,
    width: number,
    length: number,
    height: number,
    kind: "wedge" | "tabletop",
    materials: ModuleMaterials,
    state: VisualState,
  ): void {
    const profile: ProfilePoint[] = kind === "tabletop"
      ? [[-length / 2, 0], [-length * 0.22, height], [length * 0.22, height], [length / 2, 0]]
      : [[-length / 2, height], [length / 2, 0]];
    this.addMesh(group, this.createProfileGeometry(width, profile), materials.timber, [0, 0.04, 0], [0, 0, 0], true, true);
    this.addRampPlanks(group, width, length, height, kind, materials, state);
    for (const x of [-width / 2 + 0.2, width / 2 - 0.2]) {
      this.addBox(group, [0.3, Math.max(0.5, height * 0.68), 0.34], materials.darkDirt, [x, Math.max(0.25, height * 0.34), -length * 0.28]);
    }
    this.addRampChevron(group, Math.min(width * 0.44, 1.55), Math.max(0.5, height * 0.7), -length * 0.16, materials.cream);
  }

  private buildDoubleJump(group: THREE.Group, width: number, length: number, materials: ModuleMaterials, state: VisualState): void {
    const jumpLength = length * 0.32;
    for (const z of [-length * 0.3, length * 0.3]) {
      const profile: ProfilePoint[] = [[-jumpLength / 2, 0], [0, 1.45], [jumpLength / 2, 0]];
      this.addMesh(group, this.createProfileGeometry(width, profile), materials.timber, [0, 0.04, z], [0, 0, 0], true, true);
      this.addBox(group, [width * 0.88, 0.07, 0.14], materials.cream, [0, 1.04, z]);
    }
    this.addBox(group, [width, 0.12, length], materials.darkDirt, [0, 0.06, 0], [0, 0, 0], false, true);
    if (state !== "preview") this.addBox(group, [width * 0.72, 0.08, length * 0.18], materials.hazard, [0, 0.13, 0]);
  }

  private buildJumpChain(group: THREE.Group, width: number, length: number, materials: ModuleMaterials, state: VisualState): void {
    const jumpLength = length * 0.23;
    for (let index = 0; index < 3; index += 1) {
      const z = -length * 0.31 + index * length * 0.31;
      const height = 0.9 + index * 0.28;
      const profile: ProfilePoint[] = [[-jumpLength / 2, 0], [0, height], [jumpLength / 2, 0]];
      this.addMesh(group, this.createProfileGeometry(width, profile), materials.timber, [0, 0.04, z], [0, 0, 0], true, true);
      this.addBox(group, [width * 0.78, 0.065, 0.13], materials.cream, [0, height + 0.07, z]);
    }
    if (state !== "preview") {
      this.addBox(group, [0.22, 0.34, length], materials.darkDirt, [-width / 2 + 0.12, 0.17, 0]);
      this.addBox(group, [0.22, 0.34, length], materials.darkDirt, [width / 2 - 0.12, 0.17, 0]);
    }
  }

  private buildSkyKicker(group: THREE.Group, width: number, length: number, materials: ModuleMaterials, state: VisualState): void {
    this.buildRamp(group, width, length, 3.8, "wedge", materials, state);
    for (const x of [-width / 2 - 0.26, width / 2 + 0.26]) {
      this.addBox(group, [0.42, 3.8, 0.58], materials.cyan, [x, 1.9, -length * 0.3]);
      this.addBox(group, [0.75, 0.32, 0.92], materials.yellow, [x, 3.95, -length * 0.3]);
    }
    this.addBox(group, [width + 1.25, 0.38, 0.46], materials.cyan, [0, 4.25, -length * 0.3]);
  }

  private buildBumpRow(
    group: THREE.Group,
    width: number,
    length: number,
    count: number,
    materials: ModuleMaterials,
    state: VisualState,
  ): void {
    const bumpLength = length / count;
    for (let index = 0; index < count; index += 1) {
      const z = -length / 2 + bumpLength * (index + 0.5);
      const height = count === 1 ? 0.68 : 0.52 + (index % 2) * 0.12;
      const profile: ProfilePoint[] = [];
      for (let step = 0; step <= 6; step += 1) {
        const ratio = step / 6;
        profile.push([-bumpLength / 2 + ratio * bumpLength, Math.sin(ratio * Math.PI) * height]);
      }
      this.addMesh(group, this.createProfileGeometry(width, profile), materials.dirt, [0, 0.04, z], [0, 0, 0], true, true);
    }
    if (state !== "preview") this.addBox(group, [width, 0.12, length], materials.darkDirt, [0, 0.06, 0], [0, 0, 0], false, true);
  }

  private buildMud(
    group: THREE.Group,
    width: number,
    length: number,
    wide: boolean,
    materials: ModuleMaterials,
    state: VisualState,
  ): void {
    this.addMesh(
      group,
      new THREE.CircleGeometry(1, 18),
      materials.mud,
      [0, 0.14, 0],
      [-Math.PI / 2, 0, 0],
      false,
      true,
    ).scale.set(width * 0.47, length * 0.46, 1);
    if (state !== "preview") {
      const ripple = new THREE.Mesh(
        new THREE.TorusGeometry(0.48, 0.055, 6, 14),
        materials.darkDirt,
      );
      ripple.position.set(wide ? -width * 0.2 : 0.1, 0.18, -length * 0.12);
      ripple.rotation.x = Math.PI / 2;
      ripple.scale.set(1.4, 0.65, 1);
      ripple.castShadow = false;
      group.add(ripple);
      this.addMesh(group, new THREE.SphereGeometry(0.18, 8, 5), materials.cream, [width * 0.18, 0.18, length * 0.16], [0, 0, 0], false, false).scale.y = 0.25;
    }
  }

  private buildGrassCut(group: THREE.Group, width: number, length: number, materials: ModuleMaterials, state: VisualState): void {
    this.addBox(group, [width, 0.2, length], materials.green, [0, 0.1, 0]);
    if (state === "preview") return;
    const tuftPositions = [-0.34, 0, 0.34];
    tuftPositions.forEach((ratio, index) => {
      const x = index % 2 === 0 ? -width * 0.2 : width * 0.2;
      this.addMesh(group, new THREE.ConeGeometry(0.22, 0.72, 5), materials.green, [x, 0.48, length * ratio], [0, index * 0.7, 0], true, true);
    });
  }

  private buildBarrier(
    group: THREE.Group,
    width: number,
    length: number,
    offset: boolean,
    materials: ModuleMaterials,
    state: VisualState,
  ): void {
    const addBlocker = (x: number, z: number, blockWidth: number): void => {
      this.addBox(group, [blockWidth, 0.82, 0.72], materials.white, [x, 0.41, z]);
      const stripeCount = Math.max(2, Math.round(blockWidth / 0.7));
      for (let index = 0; index < stripeCount; index += 1) {
        const stripeX = x - blockWidth / 2 + (index + 0.5) * (blockWidth / stripeCount);
        this.addBox(group, [blockWidth / stripeCount * 0.72, 0.5, 0.12], materials.hazard, [stripeX, 0.48, z + 0.42], [0, 0, -0.32]);
      }
    };
    if (offset) {
      addBlocker(-width * 0.22, -length * 0.27, width * 0.52);
      addBlocker(width * 0.22, length * 0.27, width * 0.52);
      if (state !== "preview") this.addBox(group, [0.1, 0.08, length], materials.hazard, [0, 0.1, 0]);
    } else {
      addBlocker(0, 0, width * 0.92);
    }
  }

  private buildCoolingGate(
    group: THREE.Group,
    width: number,
    length: number,
    laneSpan: number,
    materials: ModuleMaterials,
    state: VisualState,
  ): void {
    this.addBox(group, [width, 0.16, length], materials.cyan, [0, 0.08, 0]);
    const height = 3.2;
    for (const x of [-width / 2 + 0.22, width / 2 - 0.22]) {
      this.addBox(group, [0.44, height, 0.66], materials.cyan, [x, height / 2, 0]);
      this.addBox(group, [0.74, 0.42, 0.9], materials.dark, [x, 0.22, 0]);
    }
    this.addBox(group, [width, 0.48, 0.72], materials.cyan, [0, height, 0]);
    if (state !== "preview") {
      for (let index = 0; index < laneSpan; index += 1) {
        const x = laneSpan === 1 ? 0 : -width * 0.24 + index * width * 0.48;
        const fan = new THREE.Group();
        fan.position.set(x, height, 0.42);
        group.add(fan);
        this.addMesh(fan, new THREE.TorusGeometry(0.42, 0.09, 7, 14), materials.dark, [0, 0, 0], [Math.PI / 2, 0, 0], false, true);
        for (let blade = 0; blade < 4; blade += 1) {
          this.addBox(fan, [0.11, 0.56, 0.08], materials.white, [0, 0, 0], [0, 0, blade * Math.PI / 2 + 0.35], false, true);
        }
      }
    }
  }

  private buildStartGrid(group: THREE.Group, width: number, length: number, materials: ModuleMaterials, state: VisualState): void {
    this.buildStraight(group, width, length, 4, materials, state);
    const plateColors = [materials.hazard, materials.yellow, materials.cyan, materials.white];
    for (let index = 0; index < 4; index += 1) {
      const x = -width / 2 + (index + 0.5) * (width / 4);
      this.addBox(group, [width / 4 - 0.18, 0.08, 1.25], plateColors[index] ?? materials.white, [x, 0.36, length * 0.24]);
    }
    this.addArch(group, width, 3.65, materials.dark, materials.hazard);
    if (state !== "preview") {
      for (let index = 0; index < 5; index += 1) {
        this.addMesh(group, new THREE.SphereGeometry(0.15, 8, 6), index < 3 ? materials.yellow : materials.hazard, [-0.62 + index * 0.31, 3.65, 0.42], [0, 0, 0], false, true);
      }
    }
  }

  private buildCheckpoint(group: THREE.Group, width: number, length: number, materials: ModuleMaterials, state: VisualState): void {
    this.addBox(group, [width, 0.12, length], materials.dirt, [0, 0.06, 0]);
    this.addArch(group, width, 3.25, materials.dark, materials.yellow);
    this.addBox(group, [width * 0.58, 0.62, 0.24], materials.yellow, [0, 3.28, 0.18]);
    if (state !== "preview") {
      for (let index = 0; index < 3; index += 1) {
        this.addBox(group, [0.52, 0.28, 0.12], materials.dark, [-0.62 + index * 0.62, 3.28, 0.34], [0, 0, index % 2 === 0 ? 0.18 : -0.18]);
      }
    }
  }

  private buildFinishArch(group: THREE.Group, width: number, length: number, materials: ModuleMaterials, state: VisualState): void {
    this.buildStraight(group, width, length, 4, materials, state);
    this.addArch(group, width, 3.8, materials.dark, materials.white);
    const tileWidth = width / 10;
    for (let index = 0; index < 10; index += 1) {
      const material = index % 2 === 0 ? materials.white : materials.dark;
      this.addBox(group, [tileWidth + 0.02, 0.48, 0.24], material, [-width / 2 + tileWidth * (index + 0.5), 3.8, 0.38]);
    }
    if (state !== "preview") {
      for (const x of [-width / 2 + 0.7, width / 2 - 0.7]) {
        this.addBox(group, [0.8, 1.15, 0.1], materials.hazard, [x, 2.85, 0.42], [0, 0, x < 0 ? -0.1 : 0.1]);
      }
    }
  }

  private addArch(group: THREE.Group, width: number, height: number, structure: THREE.Material, accent: THREE.Material): void {
    for (const x of [-width / 2 + 0.22, width / 2 - 0.22]) {
      this.addBox(group, [0.44, height, 0.52], structure, [x, height / 2, 0]);
      this.addBox(group, [0.72, 0.32, 0.82], accent, [x, 0.16, 0]);
    }
    this.addBox(group, [width, 0.42, 0.52], structure, [0, height, 0]);
  }

  private addRampPlanks(
    group: THREE.Group,
    width: number,
    length: number,
    height: number,
    kind: "wedge" | "tabletop",
    materials: ModuleMaterials,
    state: VisualState,
  ): void {
    if (state === "preview") return;
    for (let index = 1; index <= 5; index += 1) {
      const ratio = index / 6;
      const z = -length / 2 + ratio * length;
      let y = height * (1 - ratio);
      if (kind === "tabletop") {
        y = ratio < 0.28 ? height * (ratio / 0.28) : ratio > 0.72 ? height * ((1 - ratio) / 0.28) : height;
      }
      this.addBox(group, [width * 0.91, 0.07, 0.11], materials.darkDirt, [0, y + 0.1, z]);
    }
  }

  private addRampChevron(group: THREE.Group, size: number, y: number, z: number, material: THREE.Material): void {
    this.addBox(group, [size, 0.07, 0.18], material, [-size * 0.24, y, z], [0, Math.PI * 0.22, 0], false, true);
    this.addBox(group, [size, 0.07, 0.18], material, [size * 0.24, y, z], [0, -Math.PI * 0.22, 0], false, true);
  }

  private addLaneMarks(
    group: THREE.Group,
    width: number,
    length: number,
    laneSpan: number,
    material: THREE.Material,
    y: number,
    state: VisualState,
  ): void {
    for (let index = 1; index < laneSpan; index += 1) {
      const x = -width / 2 + (width / laneSpan) * index;
      if (state === "preview") {
        this.addBox(group, [0.08, 0.035, length * 0.82], material, [x, y, 0], [0, 0, 0], false, true);
        continue;
      }
      const dashLength = Math.min(0.75, length / 5);
      for (let z = -length / 2 + dashLength; z < length / 2; z += dashLength * 2) {
        this.addBox(group, [0.08, 0.035, dashLength], material, [x, y, z], [0, 0, 0], false, true);
      }
    }
  }

  private addCurvedLaneLines(
    group: THREE.Group,
    width: number,
    length: number,
    direction: -1 | 1,
    bank: number,
    material: THREE.MeshStandardMaterial,
    state: VisualState,
  ): void {
    const lineMaterial = new THREE.LineBasicMaterial({
      color: material.color,
      transparent: state === "preview",
      opacity: state === "preview" ? 0.62 : 0.82,
    });
    for (let lane = 1; lane < 4; lane += 1) {
      const offset = -width / 2 + lane * (width / 4);
      const points = this.curvePoints(length, direction, offset, bank).map((point) => new THREE.Vector3(point.x, point.y + 0.31, point.z));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      group.add(new THREE.Line(geometry, lineMaterial));
    }
  }

  private addSelectionFrame(group: THREE.Group, width: number, length: number): void {
    const box = new THREE.BoxGeometry(width + 0.5, 0.34, length + 0.5);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffdf56, transparent: true, opacity: 0.96 }));
    line.position.y = 0.22;
    group.add(line);
    for (const x of [-width / 2 - 0.25, width / 2 + 0.25]) {
      for (const z of [-length / 2 - 0.25, length / 2 + 0.25]) {
        this.addMesh(group, new THREE.CylinderGeometry(0.1, 0.1, 0.7, 7), new THREE.MeshBasicMaterial({ color: 0xffdf56 }), [x, 0.35, z], [0, 0, 0], false, false);
      }
    }
  }

  private createProfileGeometry(width: number, profile: readonly ProfilePoint[]): THREE.BufferGeometry {
    const positions: number[] = [];
    for (const [z, height] of profile) {
      positions.push(-width / 2, height, z, width / 2, height, z, -width / 2, 0, z, width / 2, 0, z);
    }
    const indices: number[] = [];
    for (let index = 0; index < profile.length - 1; index += 1) {
      const start = index * 4;
      const next = start + 4;
      indices.push(start, start + 1, next, next, start + 1, next + 1);
      indices.push(start + 2, next + 2, start, start, next + 2, next);
      indices.push(start + 1, start + 3, next + 1, next + 1, start + 3, next + 3);
      indices.push(start + 2, start + 3, next + 2, next + 2, start + 3, next + 3);
    }
    const first = 0;
    const last = (profile.length - 1) * 4;
    indices.push(first, first + 2, first + 1, first + 1, first + 2, first + 3);
    indices.push(last, last + 1, last + 2, last + 1, last + 3, last + 2);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private createCurvedStripGeometry(width: number, length: number, direction: -1 | 1, bank: number): THREE.BufferGeometry {
    const points = this.curvePoints(length, direction, 0, bank);
    const positions: number[] = [];
    points.forEach((point) => {
      const theta = point.theta;
      const normalX = Math.cos(theta);
      const normalZ = -direction * Math.sin(theta);
      const leftHeight = bank > 0 && direction > 0 ? bank : 0;
      const rightHeight = bank > 0 && direction < 0 ? bank : 0;
      positions.push(
        point.x + normalX * width / 2,
        point.y + leftHeight,
        point.z + normalZ * width / 2,
        point.x - normalX * width / 2,
        point.y + rightHeight,
        point.z - normalZ * width / 2,
      );
    });
    const indices: number[] = [];
    for (let index = 0; index < points.length - 1; index += 1) {
      const left = index * 2;
      const nextLeft = left + 2;
      indices.push(left, left + 1, nextLeft, nextLeft, left + 1, nextLeft + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private curvePoints(length: number, direction: -1 | 1, offset: number, bank: number): Array<{ x: number; y: number; z: number; theta: number }> {
    const angle = 0.56;
    const radius = length / angle;
    const points: Array<{ x: number; y: number; z: number; theta: number }> = [];
    for (let index = 0; index <= 10; index += 1) {
      const theta = -angle / 2 + (index / 10) * angle;
      const normalX = Math.cos(theta);
      const normalZ = -direction * Math.sin(theta);
      const bankRatio = widthRatio(offset, 7);
      points.push({
        x: direction * radius * (1 - Math.cos(theta)) + normalX * offset,
        y: bank > 0 ? Math.abs(bankRatio) * bank * 0.55 : 0,
        z: radius * Math.sin(theta) + normalZ * offset,
        theta,
      });
    }
    return points;
  }

  private createModuleMaterials(state: VisualState): ModuleMaterials {
    return {
      dirt: this.createMaterial(0xb86f3f, state, 0.92),
      darkDirt: this.createMaterial(0x70402e, state, 0.94),
      timber: this.createMaterial(0xc2864b, state, 0.8),
      cream: this.createMaterial(0xffe1a0, state, 0.74),
      green: this.createMaterial(0x5f8d4c, state, 0.96),
      mud: this.createMaterial(0x4e342d, state, 0.75),
      hazard: this.createMaterial(0xea5144, state, 0.66),
      cyan: this.createMaterial(0x21c9d3, state, 0.44),
      dark: this.createMaterial(0x173544, state, 0.52),
      metal: this.createMaterial(0x81979a, state, 0.36, 0.32),
      white: this.createMaterial(0xf7edcf, state, 0.68),
      yellow: this.createMaterial(0xffc53d, state, 0.58),
    };
  }

  private createMaterial(color: number, state: VisualState, roughness: number, metalness = 0): THREE.MeshStandardMaterial {
    const selectedColor = new THREE.Color(color);
    if (state === "selected") selectedColor.lerp(new THREE.Color(0xffd64c), 0.3);
    const preview = state === "preview";
    return new THREE.MeshStandardMaterial({
      color: preview ? 0x38e7e1 : selectedColor,
      emissive: preview ? 0x087d82 : state === "selected" ? 0x5e3b00 : 0x000000,
      emissiveIntensity: preview ? 0.72 : state === "selected" ? 0.26 : 0,
      roughness,
      metalness: preview ? 0 : metalness,
      flatShading: true,
      transparent: preview,
      opacity: preview ? 0.42 : 1,
      depthWrite: !preview,
      side: preview ? THREE.DoubleSide : THREE.FrontSide,
    });
  }

  private addBox(
    parent: THREE.Object3D,
    size: VectorTuple,
    material: THREE.Material,
    position: VectorTuple,
    rotation: VectorTuple = [0, 0, 0],
    castShadow = true,
    receiveShadow = true,
  ): THREE.Mesh {
    return this.addMesh(parent, new THREE.BoxGeometry(...size), material, position, rotation, castShadow, receiveShadow);
  }

  private addMesh(
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: VectorTuple,
    rotation: VectorTuple,
    castShadow: boolean,
    receiveShadow: boolean,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    parent.add(mesh);
    return mesh;
  }

  private nextGridPosition(placements: CustomTrackModule[]): number {
    return placements.reduce((maximum, placement) => Math.max(maximum, placement.gridPosition), 0) + 12;
  }

  private readonly resize = (): void => {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  private updateCamera(): void {
    const targetZ = -62;
    this.camera.position.set(Math.sin(this.orbit) * this.radius, 40, targetZ + Math.cos(this.orbit) * this.radius);
    this.camera.lookAt(0, 0, targetZ);
  }

  private readonly pointerDown = (event: PointerEvent): void => {
    this.dragging = true;
    this.dragX = event.clientX;
    this.dragStartX = event.clientX;
    this.hasDragged = false;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    const delta = event.clientX - this.dragX;
    if (Math.abs(delta) > 2) {
      this.hasDragged = true;
      this.orbit += delta * 0.006;
      this.dragX = event.clientX;
      this.updateCamera();
    }
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    if (!this.dragging) return;
    const moved = this.hasDragged || Math.abs(event.clientX - this.dragStartX) > 4;
    this.dragging = false;
    if (!moved) this.placeAtPointer(event);
  };

  private readonly pointerCancel = (): void => {
    this.dragging = false;
    this.hasDragged = false;
  };

  private readonly wheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.radius = Math.max(26, Math.min(72, this.radius + event.deltaY * 0.025));
    this.updateCamera();
  };

  private placeAtPointer(event: PointerEvent): void {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return;
    const lane = LANE_X.reduce((best, x, index) => Math.abs(hit.x - x) < Math.abs(hit.x - LANE_X[best]) ? index as 0 | 1 | 2 | 3 : best, 0 as 0 | 1 | 2 | 3);
    const gridPosition = Math.max(0, Math.min(240, Math.round(-hit.z / 2) * 2));
    this.onPlace(lane, gridPosition);
  }

  private clearGroup(group: THREE.Object3D): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    while (group.children.length) {
      const child = group.children[0];
      if (!child) continue;
      group.remove(child);
      child.traverse((object) => {
        const ownedMaterials = object.userData.disposableMaterials;
        if (Array.isArray(ownedMaterials)) {
          ownedMaterials.forEach((material: unknown) => {
            if (material instanceof THREE.Material) materials.add(material);
          });
        }
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
          geometries.add(object.geometry);
          const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
          objectMaterials.forEach((material) => materials.add(material));
        }
      });
    }
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  }
}

function widthRatio(value: number, halfWidth: number): number {
  return Math.max(-1, Math.min(1, value / halfWidth));
}
