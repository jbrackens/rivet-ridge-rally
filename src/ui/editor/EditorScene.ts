import * as THREE from "three";

import { getTrack } from "../../game/content/tracks";
import { EDITOR_MODULE_BY_ID, type EditorModuleDefinition } from "../../game/editor/modules";
import {
  CUSTOM_TRACK_PRESENTATION_FALLBACK_LENGTH,
  customTrackToPresentationDefinition,
} from "../../game/editor/toTrackDefinition";
import {
  CUSTOM_TRACK_MODULE_LIMIT,
  CUSTOM_TRACK_ROUTE_LIMIT,
  validateCustomTrackPlacement,
} from "../../game/editor/validation";
import {
  CoursePresentationRoute,
  createCourseRibbonGeometry,
  type CoursePresentationOrientation,
} from "../../game/engine/CoursePresentationRoute";
import type { CustomTrackData, CustomTrackModule } from "../../game/persistence/database";
import {
  observeWebglContext,
  releaseWebglContext,
  startLifecycleResource,
  stopLifecycleResource,
} from "../../game/qa/lifecycleDiagnostics";

const LANE_X = [-4.5, -1.5, 1.5, 4.5] as const;
const INITIAL_ROUTE_VIEW_POSITION = 62;
const PREVIEW_PLACEMENT_ID = "__editor-placement-preview__";
const EDITOR_ROUTE_HALF_WIDTH = 7.5;
const EDITOR_ROUTE_PICK_HALF_WIDTH = 7.8;
const EDITOR_SCENERY_HALF_WIDTH = 34;
const EDITOR_EXTENSION_LOOK_BEHIND = 120;
const EDITOR_EXTENSION_LOOK_AHEAD = 240;
const EDITOR_EXTENSION_REBUILD_MARGIN = 54;
const EDITOR_PICK_LAYER = 1;
const EDITOR_ROUTE_CAMERA_RADIUS = 42;
const EDITOR_ROUTE_CAMERA_HEIGHT = 31;
const EDITOR_ROUTE_CAMERA_MIN_RADIUS = 22;
const EDITOR_ROUTE_CAMERA_MAX_RADIUS = 62;

type VisualState = "normal" | "selected" | "preview";

export interface EditorPlacementPreview {
  readonly moduleName: string;
  readonly lane: 0 | 1 | 2 | 3;
  readonly gridPosition: number;
  readonly valid: boolean;
  readonly message: string;
}

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
  private readonly routeFoundation = new THREE.Group();
  private readonly routeScenery = new THREE.Group();
  private readonly courseSurface = new THREE.Group();
  private readonly routeExtensionSurface = new THREE.Group();
  private readonly modules = new THREE.Group();
  private readonly preview = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly routePosition = new THREE.Vector3();
  private readonly routeRotation = new THREE.Matrix4();
  private readonly routeRight = new THREE.Vector3();
  private readonly routeUp = new THREE.Vector3();
  private readonly routeBackward = new THREE.Vector3();
  private readonly routeBaseOverviewBounds = new THREE.Box3();
  private readonly routeOverviewBounds = new THREE.Box3();
  private readonly routeOverviewTarget = new THREE.Vector3();
  private readonly keyLight = new THREE.DirectionalLight(0xffe2b1, 4.7);
  private readonly resizeObserver: ResizeObserver;
  private animationFrame = 0;
  private orbit = -0.36;
  private routeRadius = EDITOR_ROUTE_CAMERA_RADIUS;
  private overviewRadius = 90;
  private overviewFitRadius = 90;
  private cameraMode: "route" | "overview" = "route";
  private cameraRoutePosition = INITIAL_ROUTE_VIEW_POSITION;
  private dragging = false;
  private dragX = 0;
  private dragY = 0;
  private dragStartX = 0;
  private dragStartY = 0;
  private hasDragged = false;
  private disposed = false;
  private currentTrack: CustomTrackData | null = null;
  private courseRoute: CoursePresentationRoute;
  private courseRouteOrigin = 0;
  private courseRouteLength = CUSTOM_TRACK_PRESENTATION_FALLBACK_LENGTH;
  private courseRouteSignature = "__uninitialized__";
  private moduleLayoutSignature = "__uninitialized__";
  private routePickSurface: THREE.Mesh | null = null;
  private routeExtensionPickSurface: THREE.Mesh | null = null;
  private routeExtensionStart = Number.NaN;
  private routeExtensionEnd = Number.NaN;
  private previewModuleId = "ramp-medium";
  private previewSignature = "none";
  private builderWorksitePropCount = 0;
  private onPlace: (lane: 0 | 1 | 2 | 3, gridPosition: number) => void = () => undefined;
  private onSelect: (placementId: string) => void = () => undefined;
  private onPreview: (preview: EditorPlacementPreview | null) => void = () => undefined;
  private onNavigate: (gridPosition: number) => void = () => undefined;

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
    this.courseRoute = this.createFallbackRoute();
    this.scene.add(
      this.routeFoundation,
      this.routeScenery,
      this.courseSurface,
      this.routeExtensionSurface,
      this.modules,
      this.preview,
    );
    this.buildGround();
    this.rebuildRouteEnvironment();
    this.raycaster.layers.enable(EDITOR_PICK_LAYER);
    this.updateCamera();
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(canvas);
    canvas.dataset.routeLimit = String(CUSTOM_TRACK_ROUTE_LIMIT);
    canvas.dataset.routeViewPosition = String(INITIAL_ROUTE_VIEW_POSITION);
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointermove", this.pointerMove);
    canvas.addEventListener("pointerup", this.pointerUp);
    canvas.addEventListener("pointercancel", this.pointerCancel);
    canvas.addEventListener("pointerleave", this.pointerLeave);
    canvas.addEventListener("wheel", this.wheel, { passive: false });
    this.animationFrame = requestAnimationFrame(this.frame);
    startLifecycleResource("editorScenes");
    observeWebglContext(this.webglContext);
    startLifecycleResource("editorRenderLoops");
  }

  setPlacementHandler(handler: (lane: 0 | 1 | 2 | 3, gridPosition: number) => void): void {
    this.onPlace = handler;
  }

  setSelectionHandler(handler: (placementId: string) => void): void {
    this.onSelect = handler;
  }

  setPreviewHandler(handler: (preview: EditorPlacementPreview | null) => void): void {
    this.onPreview = handler;
    handler(null);
  }

  setNavigationHandler(handler: (gridPosition: number) => void): void {
    this.onNavigate = handler;
  }

  focusRoutePosition(gridPosition: number): void {
    const boundedPosition = Math.round(THREE.MathUtils.clamp(
      gridPosition,
      0,
      CUSTOM_TRACK_ROUTE_LIMIT,
    ));
    this.cameraMode = "route";
    this.cameraRoutePosition = boundedPosition;
    this.updateRouteExtension(boundedPosition);
    this.canvas.dataset.routeViewMode = "position";
    this.canvas.dataset.routeViewPosition = String(boundedPosition);
    this.updateCamera();
    this.onNavigate(boundedPosition);
  }

  frameRoute(): void {
    if (this.routeOverviewBounds.isEmpty()) return;
    if (this.routeExtensionSurface.children.length > 0) this.clearRouteExtension();
    const sphere = this.routeOverviewBounds.getBoundingSphere(new THREE.Sphere());
    this.routeOverviewTarget.copy(sphere.center);
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(
      Math.tan(verticalFov / 2) * Math.max(0.01, this.camera.aspect),
    );
    const limitingFov = Math.min(verticalFov, horizontalFov);
    const fitDistance = sphere.radius / Math.max(0.01, Math.sin(limitingFov / 2));
    this.overviewFitRadius = THREE.MathUtils.clamp(
      Math.max(fitDistance * 1.12, 76),
      76,
      40_000,
    );
    this.overviewRadius = this.overviewFitRadius;
    this.cameraMode = "overview";
    this.canvas.dataset.routeViewMode = "overview";
    this.updateCamera();
  }

  update(track: CustomTrackData, selectedId: string | null, previewModuleId: string): void {
    this.currentTrack = track;
    this.previewModuleId = previewModuleId;
    const routeChanged = this.updateCourseSurface(track);
    const nextModuleLayoutSignature = this.createModuleLayoutSignature(track);
    const moduleLayoutChanged = nextModuleLayoutSignature !== this.moduleLayoutSignature;
    this.moduleLayoutSignature = nextModuleLayoutSignature;
    this.clearGroup(this.modules);
    for (const placement of track.modules) {
      const definition = EDITOR_MODULE_BY_ID.get(placement.moduleId);
      if (!definition) continue;
      const state: VisualState = placement.id === selectedId ? "selected" : "normal";
      const visual = this.createModuleVisual(definition, state);
      this.placeOnRoute(visual, placement, definition, 0.06, true);
      visual.userData.placementId = placement.id;
      this.modules.add(visual);
    }
    this.modules.updateMatrixWorld(true);
    this.refreshRouteOverviewBounds();
    if (this.cameraMode === "overview" && (routeChanged || moduleLayoutChanged)) {
      this.frameRoute();
    } else {
      if (this.cameraMode === "route") this.updateRouteExtension(this.cameraRoutePosition);
      this.updateCamera();
    }
    this.clearPreview();
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
    this.canvas.removeEventListener("pointerleave", this.pointerLeave);
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

  private createFallbackRoute(
    length = CUSTOM_TRACK_PRESENTATION_FALLBACK_LENGTH,
  ): CoursePresentationRoute {
    const base = getTrack("canyon-kickoff");
    return new CoursePresentationRoute({
      ...base,
      courseLength: length,
      obstacles: [],
    }, { identity: true });
  }

  private routeSignature(track: CustomTrackData): string {
    const markerSignature = track.modules
      .filter((module) => (
        module.moduleId === "start-grid"
        || module.moduleId === "checkpoint"
        || module.moduleId === "finish-arch"
      ))
      .map((module) => {
        const anchored = module as CustomTrackModule & {
          readonly routeAnchor?: { readonly lateralOffset: number; readonly elevation: number };
        };
        return [
          module.id,
          module.moduleId,
          module.gridPosition,
          anchored.routeAnchor?.lateralOffset ?? 0,
          anchored.routeAnchor?.elevation ?? 0,
        ].join(":");
      })
      .join("|");
    const start = track.modules.find((module) => module.moduleId === "start-grid");
    const finish = track.modules.find((module) => module.moduleId === "finish-arch");
    if (start && finish && finish.gridPosition > start.gridPosition) return markerSignature;
    const furthestPlacement = track.modules.reduce(
      (maximum, module) => Math.max(maximum, module.gridPosition),
      0,
    );
    return `${markerSignature}|fallback:${furthestPlacement}`;
  }

  private createModuleLayoutSignature(track: CustomTrackData): string {
    return track.modules.map((module) => [
      module.id,
      module.moduleId,
      module.lane,
      module.gridPosition,
      module.rotation,
      module.height,
    ].join(":")).join("|");
  }

  private updateCourseSurface(track: CustomTrackData): boolean {
    const signature = this.routeSignature(track);
    if (signature === this.courseRouteSignature) return false;
    this.courseRouteSignature = signature;

    const furthestPlacement = track.modules.reduce(
      (maximum, module) => Math.max(maximum, module.gridPosition),
      0,
    );
    const fallbackLength = THREE.MathUtils.clamp(
      Math.max(CUSTOM_TRACK_PRESENTATION_FALLBACK_LENGTH, furthestPlacement + 48),
      CUSTOM_TRACK_PRESENTATION_FALLBACK_LENGTH,
      CUSTOM_TRACK_ROUTE_LIMIT,
    );
    const definition = customTrackToPresentationDefinition(track, fallbackLength);
    const authoredStart = definition.authoredCourse?.start;
    const isFallback = authoredStart?.id === "editor-preview-start";
    this.courseRouteOrigin = isFallback ? 0 : authoredStart?.sourceGridPosition ?? 0;
    this.courseRoute = new CoursePresentationRoute(definition);
    this.courseRouteLength = definition.courseLength;

    this.clearGroup(this.courseSurface);
    this.clearRouteExtension();
    this.routePickSurface = null;
    this.courseSurface.position.set(0, 0, -this.courseRouteOrigin);
    this.buildCourseSurface();
    this.courseSurface.updateMatrixWorld(true);
    this.rebuildRouteEnvironment();
    this.canvas.dataset.courseRouteStyle = this.courseRoute.identity
      ? "authored-flat-v2"
      : "authored-centerline-v2";
    return true;
  }

  private buildCourseSurface(): void {
    const routeDetailScale = THREE.MathUtils.clamp(this.courseRouteLength / 3_600, 1, 6);
    const addRibbon = (
      left: number,
      right: number,
      yOffset: number,
      material: THREE.Material,
      segmentLength = 3,
      segmentVisible?: (segmentIndex: number) => boolean,
      uvRepeatLength = 30,
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(
        createCourseRibbonGeometry(this.courseRoute, {
          startProgress: 0,
          endProgress: this.courseRouteLength,
          left,
          right,
          yOffset,
          segmentLength,
          uvRepeatLength,
          ...(segmentVisible
            ? { segmentVisible: (segmentIndex: number) => segmentVisible(segmentIndex) }
            : {}),
        }),
        material,
      );
      mesh.receiveShadow = true;
      this.courseSurface.add(mesh);
      return mesh;
    };

    addRibbon(
      -13,
      13,
      -0.34,
      new THREE.MeshStandardMaterial({ color: 0x4f7d41, roughness: 1, flatShading: true }),
      4 * routeDetailScale,
    );
    addRibbon(
      -8.35,
      8.35,
      -0.08,
      new THREE.MeshStandardMaterial({ color: 0xc38952, roughness: 1, flatShading: true }),
      3 * routeDetailScale,
    );
    addRibbon(
      -EDITOR_ROUTE_HALF_WIDTH,
      EDITOR_ROUTE_HALF_WIDTH,
      0.04,
      new THREE.MeshStandardMaterial({ color: 0x9f5937, roughness: 0.98, flatShading: true }),
      2 * routeDetailScale,
    );

    const edgeMaterials = [
      new THREE.MeshStandardMaterial({ color: 0xd4473f, roughness: 0.72, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0xffe2ad, roughness: 0.78, flatShading: true }),
    ] as const;
    for (const [materialIndex, material] of edgeMaterials.entries()) {
      const visible = (index: number): boolean => index % 2 === materialIndex;
      addRibbon(-8.35, -7.82, 0.14, material, 6 * routeDetailScale, visible);
      addRibbon(7.82, 8.35, 0.14, material.clone(), 6 * routeDetailScale, visible);
    }

    const laneMaterial = new THREE.MeshStandardMaterial({
      color: 0xffe6ad,
      roughness: 0.8,
      emissive: 0x3a2411,
      emissiveIntensity: 0.08,
    });
    for (const lateral of [-6, -3, 0, 3, 6]) {
      addRibbon(
        lateral - 0.045,
        lateral + 0.045,
        0.12,
        laneMaterial,
        3 * routeDetailScale,
      );
    }

    const majorPositions: number[] = [];
    const left = new THREE.Vector3();
    const right = new THREE.Vector3();
    const markerSpacing = Math.max(12, this.courseRouteLength / 512);
    for (let progress = 0; progress <= this.courseRouteLength; progress += markerSpacing) {
      this.courseRoute.sample(progress, -EDITOR_ROUTE_HALF_WIDTH, 0.15, left);
      this.courseRoute.sample(progress, EDITOR_ROUTE_HALF_WIDTH, 0.15, right);
      majorPositions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    }
    const majorGeometry = new THREE.BufferGeometry();
    majorGeometry.setAttribute("position", new THREE.Float32BufferAttribute(majorPositions, 3));
    const majorMaterial = new THREE.LineBasicMaterial({
      color: 0xfff0c5,
      transparent: true,
      opacity: 0.38,
    });
    this.courseSurface.add(new THREE.LineSegments(majorGeometry, majorMaterial));

    const pickMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    pickMaterial.colorWrite = false;
    this.routePickSurface = addRibbon(
      -EDITOR_ROUTE_PICK_HALF_WIDTH,
      EDITOR_ROUTE_PICK_HALF_WIDTH,
      0.32,
      pickMaterial,
      8 * routeDetailScale,
      undefined,
      1,
    );
    this.routePickSurface.receiveShadow = false;
    this.routePickSurface.layers.set(EDITOR_PICK_LAYER);
    this.routePickSurface.userData.gridOffset = this.courseRouteOrigin;
  }

  private clearRouteExtension(): void {
    this.clearGroup(this.routeExtensionSurface);
    this.routeExtensionPickSurface = null;
    this.routeExtensionStart = Number.NaN;
    this.routeExtensionEnd = Number.NaN;
    delete this.canvas.dataset.routeGuideRange;
  }

  private updateRouteExtension(gridPosition: number): void {
    const routeStart = THREE.MathUtils.clamp(this.courseRouteOrigin, 0, CUSTOM_TRACK_ROUTE_LIMIT);
    const routeEnd = THREE.MathUtils.clamp(
      this.courseRouteOrigin + this.courseRouteLength,
      0,
      CUSTOM_TRACK_ROUTE_LIMIT,
    );
    if (gridPosition >= routeStart && gridPosition <= routeEnd) {
      if (this.routeExtensionSurface.children.length > 0) this.clearRouteExtension();
      return;
    }

    const beforeRoute = gridPosition < routeStart;
    if (Number.isFinite(this.routeExtensionStart) && Number.isFinite(this.routeExtensionEnd)) {
      const safeStart = beforeRoute && this.routeExtensionStart > 0
        ? this.routeExtensionStart + EDITOR_EXTENSION_REBUILD_MARGIN
        : this.routeExtensionStart;
      const safeEnd = !beforeRoute && this.routeExtensionEnd < CUSTOM_TRACK_ROUTE_LIMIT
        ? this.routeExtensionEnd - EDITOR_EXTENSION_REBUILD_MARGIN
        : this.routeExtensionEnd;
      if (gridPosition >= safeStart && gridPosition <= safeEnd) return;
    }

    const start = beforeRoute
      ? Math.max(0, gridPosition - EDITOR_EXTENSION_LOOK_AHEAD)
      : Math.max(routeEnd, gridPosition - EDITOR_EXTENSION_LOOK_BEHIND);
    const end = beforeRoute
      ? Math.min(routeStart, gridPosition + EDITOR_EXTENSION_LOOK_BEHIND)
      : Math.min(CUSTOM_TRACK_ROUTE_LIMIT, gridPosition + EDITOR_EXTENSION_LOOK_AHEAD);
    if (end - start < 1) {
      this.clearRouteExtension();
      return;
    }
    this.buildRouteExtension(start, end);
  }

  private buildRouteExtension(start: number, end: number): void {
    this.clearRouteExtension();
    this.routeExtensionStart = start;
    this.routeExtensionEnd = end;

    const addRibbon = (
      left: number,
      right: number,
      yOffset: number,
      material: THREE.Material,
      segmentLength: number,
      uvRepeatLength = 30,
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(
        this.createEditorRibbonGeometry(
          start,
          end,
          left,
          right,
          yOffset,
          segmentLength,
          uvRepeatLength,
        ),
        material,
      );
      mesh.receiveShadow = true;
      this.routeExtensionSurface.add(mesh);
      return mesh;
    };

    addRibbon(
      -13,
      13,
      -0.34,
      new THREE.MeshStandardMaterial({ color: 0x4f7d41, roughness: 1, flatShading: true }),
      12,
    );
    addRibbon(
      -8.35,
      8.35,
      -0.08,
      new THREE.MeshStandardMaterial({ color: 0xc38952, roughness: 1, flatShading: true }),
      8,
    );
    addRibbon(
      -EDITOR_ROUTE_HALF_WIDTH,
      EDITOR_ROUTE_HALF_WIDTH,
      0.04,
      new THREE.MeshStandardMaterial({ color: 0x9f5937, roughness: 0.98, flatShading: true }),
      5,
    );
    addRibbon(
      -8.35,
      -7.82,
      0.14,
      new THREE.MeshStandardMaterial({ color: 0xd4473f, roughness: 0.72, flatShading: true }),
      8,
    );
    addRibbon(
      7.82,
      8.35,
      0.14,
      new THREE.MeshStandardMaterial({ color: 0xffe2ad, roughness: 0.78, flatShading: true }),
      8,
    );

    const laneMaterial = new THREE.MeshStandardMaterial({
      color: 0xffe6ad,
      roughness: 0.8,
      emissive: 0x3a2411,
      emissiveIntensity: 0.08,
    });
    for (const lateral of [-6, -3, 0, 3, 6]) {
      addRibbon(lateral - 0.045, lateral + 0.045, 0.12, laneMaterial, 6);
    }

    const pickMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    pickMaterial.colorWrite = false;
    this.routeExtensionPickSurface = addRibbon(
      -EDITOR_ROUTE_PICK_HALF_WIDTH,
      EDITOR_ROUTE_PICK_HALF_WIDTH,
      0.32,
      pickMaterial,
      8,
      1,
    );
    this.routeExtensionPickSurface.receiveShadow = false;
    this.routeExtensionPickSurface.layers.set(EDITOR_PICK_LAYER);
    this.routeExtensionPickSurface.userData.gridOffset = 0;
    this.routeExtensionSurface.updateMatrixWorld(true);
    this.canvas.dataset.routeGuideRange = `${Math.round(start)}-${Math.round(end)}`;
  }

  private createEditorRibbonGeometry(
    startGridPosition: number,
    endGridPosition: number,
    left: number,
    right: number,
    yOffset: number,
    segmentLength: number,
    uvRepeatLength: number,
  ): THREE.BufferGeometry {
    const length = endGridPosition - startGridPosition;
    const segmentCount = Math.max(1, Math.ceil(length / segmentLength));
    const actualSegmentLength = length / segmentCount;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const startLeft = new THREE.Vector3();
    const startRight = new THREE.Vector3();
    const endLeft = new THREE.Vector3();
    const endRight = new THREE.Vector3();

    for (let index = 0; index < segmentCount; index += 1) {
      const segmentStart = startGridPosition + index * actualSegmentLength;
      const segmentEnd = index === segmentCount - 1
        ? endGridPosition
        : segmentStart + actualSegmentLength;
      const startOrientation = this.sampleEditorRoute(segmentStart, left, yOffset, startLeft);
      const startUp = [
        startOrientation.upX,
        startOrientation.upY,
        startOrientation.upZ,
      ] as const;
      this.sampleEditorRoute(segmentStart, right, yOffset, startRight);
      const endOrientation = this.sampleEditorRoute(segmentEnd, left, yOffset, endLeft);
      const endUp = [
        endOrientation.upX,
        endOrientation.upY,
        endOrientation.upZ,
      ] as const;
      this.sampleEditorRoute(segmentEnd, right, yOffset, endRight);
      const vertexOffset = positions.length / 3;

      positions.push(
        startLeft.x, startLeft.y, startLeft.z,
        startRight.x, startRight.y, startRight.z,
        endLeft.x, endLeft.y, endLeft.z,
        endRight.x, endRight.y, endRight.z,
      );
      normals.push(...startUp, ...startUp, ...endUp, ...endUp);
      uvs.push(
        0, segmentStart / uvRepeatLength,
        1, segmentStart / uvRepeatLength,
        0, segmentEnd / uvRepeatLength,
        1, segmentEnd / uvRepeatLength,
      );
      indices.push(
        vertexOffset, vertexOffset + 1, vertexOffset + 3,
        vertexOffset, vertexOffset + 3, vertexOffset + 2,
      );
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.name = "editor-route-extension-ribbon";
    geometry.userData.presentationOnly = true;
    return geometry;
  }

  private sampleEditorRoute(
    gridPosition: number,
    lateral: number,
    elevation: number,
    outPosition: THREE.Vector3,
  ): CoursePresentationOrientation {
    const localProgress = gridPosition - this.courseRouteOrigin;
    const clampedProgress = THREE.MathUtils.clamp(localProgress, 0, this.courseRouteLength);
    const orientation = this.courseRoute.sample(
      clampedProgress,
      lateral,
      elevation,
      outPosition,
    );
    if (localProgress !== clampedProgress) {
      const extension = localProgress - clampedProgress;
      outPosition.x += orientation.forwardX * extension;
      outPosition.y += orientation.forwardY * extension;
      outPosition.z += orientation.forwardZ * extension;
    }
    outPosition.z -= this.courseRouteOrigin;
    return orientation;
  }

  private setRouteOrientation(
    object: THREE.Object3D,
    orientation: CoursePresentationOrientation,
    localRotationDegrees = 0,
  ): void {
    this.routeRight.set(orientation.rightX, orientation.rightY, orientation.rightZ);
    this.routeUp.set(orientation.upX, orientation.upY, orientation.upZ);
    this.routeBackward.set(
      -orientation.forwardX,
      -orientation.forwardY,
      -orientation.forwardZ,
    );
    this.routeRotation.makeBasis(this.routeRight, this.routeUp, this.routeBackward);
    object.quaternion.setFromRotationMatrix(this.routeRotation);
    if (localRotationDegrees !== 0) {
      object.rotateY(THREE.MathUtils.degToRad(localRotationDegrees));
    }
  }

  private placeOnRoute(
    object: THREE.Object3D,
    placement: CustomTrackModule,
    definition: EditorModuleDefinition,
    baseElevation: number,
    applySavedRotation: boolean,
  ): void {
    const lateral = LANE_X[placement.lane] + (definition.laneSpan - 1) * 1.5;
    const orientation = this.sampleEditorRoute(
      placement.gridPosition,
      lateral,
      baseElevation + placement.height,
      this.routePosition,
    );
    object.position.copy(this.routePosition);
    this.setRouteOrientation(
      object,
      orientation,
      applySavedRotation ? placement.rotation : 0,
    );
  }

  private buildGround(): void {
    const hemisphere = new THREE.HemisphereLight(0xe7f8ff, 0x4f3027, 1.7);
    this.scene.add(hemisphere);

    this.keyLight.position.set(-35, 52, 30);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1536, 1536);
    this.keyLight.shadow.bias = -0.00025;
    const shadowCamera = this.keyLight.shadow.camera;
    shadowCamera.left = -74;
    shadowCamera.right = 74;
    shadowCamera.top = 92;
    shadowCamera.bottom = -92;
    shadowCamera.near = 1;
    shadowCamera.far = 180;
    this.scene.add(this.keyLight, this.keyLight.target);

    const fill = new THREE.DirectionalLight(0x78c6e7, 0.8);
    fill.position.set(34, 22, -56);
    this.scene.add(fill);
  }

  private rebuildRouteEnvironment(): void {
    this.clearGroup(this.routeFoundation);
    this.clearGroup(this.routeScenery);
    this.routeOverviewBounds.makeEmpty();

    const sampleCount = THREE.MathUtils.clamp(
      Math.ceil(this.courseRouteLength / 8),
      16,
      512,
    );
    const sample = new THREE.Vector3();
    for (let index = 0; index <= sampleCount; index += 1) {
      const gridPosition = this.courseRouteOrigin + (index / sampleCount) * this.courseRouteLength;
      for (const lateral of [-EDITOR_SCENERY_HALF_WIDTH, EDITOR_SCENERY_HALF_WIDTH]) {
        this.sampleEditorRoute(gridPosition, lateral, 0, sample);
        this.routeOverviewBounds.expandByPoint(sample);
      }
    }

    const routeSize = this.routeOverviewBounds.getSize(new THREE.Vector3());
    const routeCenter = this.routeOverviewBounds.getCenter(new THREE.Vector3());
    const foundationWidth = Math.max(78, routeSize.x + 22);
    const foundationDepth = Math.max(92, routeSize.z + 22);
    const lowerMaterial = new THREE.MeshStandardMaterial({
      color: 0x703d31,
      roughness: 1,
      flatShading: true,
    });
    const topMaterial = new THREE.MeshStandardMaterial({
      color: 0xb96c43,
      roughness: 1,
      flatShading: true,
    });
    this.addMesh(
      this.routeFoundation,
      new THREE.BoxGeometry(foundationWidth + 5, 3.8, foundationDepth + 5),
      lowerMaterial,
      [routeCenter.x, -3.55, routeCenter.z],
      [0, 0, 0],
      true,
      true,
    );
    this.addMesh(
      this.routeFoundation,
      new THREE.BoxGeometry(foundationWidth, 1.1, foundationDepth),
      topMaterial,
      [routeCenter.x, -1.05, routeCenter.z],
      [0, 0, 0],
      true,
      true,
    );
    this.routeOverviewBounds.expandByPoint(new THREE.Vector3(
      routeCenter.x - foundationWidth / 2,
      -5.45,
      routeCenter.z - foundationDepth / 2,
    ));
    this.routeOverviewBounds.expandByPoint(new THREE.Vector3(
      routeCenter.x + foundationWidth / 2,
      Math.max(12, this.routeOverviewBounds.max.y + 8),
      routeCenter.z + foundationDepth / 2,
    ));

    this.buildWorkshop();
    this.buildDioramaScenery();

    this.routeFoundation.updateMatrixWorld(true);
    this.routeScenery.updateMatrixWorld(true);
    this.courseSurface.updateMatrixWorld(true);
    this.routeBaseOverviewBounds.makeEmpty();
    if (this.routeFoundation.children.length > 0) {
      this.routeBaseOverviewBounds.union(new THREE.Box3().setFromObject(this.routeFoundation));
    }
    if (this.routeScenery.children.length > 0) {
      this.routeBaseOverviewBounds.union(new THREE.Box3().setFromObject(this.routeScenery));
    }
    if (this.courseSurface.children.length > 0) {
      this.routeBaseOverviewBounds.union(new THREE.Box3().setFromObject(this.courseSurface));
    }
    this.routeOverviewBounds.copy(this.routeBaseOverviewBounds);
  }

  private refreshRouteOverviewBounds(): void {
    this.routeOverviewBounds.copy(this.routeBaseOverviewBounds);
    if (this.modules.children.length > 0) {
      this.routeOverviewBounds.union(new THREE.Box3().setFromObject(this.modules));
    }
  }

  private buildWorkshop(): void {
    const group = new THREE.Group();

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
    this.placeSceneryOnRoute(group, 0.27, -22, 0.2, -8);

    const machine = new THREE.Group();
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
    this.placeSceneryOnRoute(machine, 0.34, 21, 0.35, 10);
  }

  private buildDioramaScenery(): void {
    this.builderWorksitePropCount = 0;
    const treeCount = Math.min(44, Math.max(10, Math.ceil(this.courseRouteLength / 30)));
    for (let index = 0; index < treeCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const lateral = side * (21 + (index % 4) * 0.9);
      const ratio = (index + 0.35) / treeCount;
      const scale = 0.86 + (index % 5) * 0.07;
      this.addTree(lateral, ratio, scale);
    }

    const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x9a553d, roughness: 0.96, flatShading: true });
    const rockCount = Math.min(28, Math.max(8, Math.ceil(this.courseRouteLength / 42)));
    for (let index = 0; index < rockCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const scale = 0.7 + (index % 4) * 0.14;
      const rock = new THREE.Group();
      this.addMesh(
        rock,
        new THREE.DodecahedronGeometry(1.65 * scale, 0),
        rockMaterial,
        [0, 0.75 * scale, 0],
        [0.2, index * 0.63, 0.14],
        true,
        true,
      );
      this.placeSceneryOnRoute(
        rock,
        (index + 0.72) / rockCount,
        side * (17 + (index % 3) * 0.8),
      );
    }

    const mesaCount = Math.min(10, Math.max(4, Math.ceil(this.courseRouteLength / 220)));
    for (let index = 0; index < mesaCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      this.addCanyonMesa(
        side * (27 + (index % 2) * 0.8),
        (index + 0.5) / mesaCount,
        0.82 + (index % 3) * 0.12,
        index * 0.38,
      );
    }

    const cactusMaterial = new THREE.MeshStandardMaterial({ color: 0x3d7b4b, roughness: 0.92, flatShading: true });
    const cactusCount = Math.min(12, Math.max(3, Math.ceil(this.courseRouteLength / 180)));
    for (let index = 0; index < cactusCount; index += 1) {
      const cactus = new THREE.Group();
      const rotation = index % 2 === 0 ? 0.2 : -0.25;
      this.addMesh(cactus, new THREE.CylinderGeometry(0.25, 0.34, 2.7, 7), cactusMaterial, [0, 1.35, 0], [0, rotation, 0], true, true);
      this.addMesh(cactus, new THREE.CylinderGeometry(0.14, 0.18, 1.15, 7), cactusMaterial, [0.48, 1.45, 0], [0, 0, Math.PI / 2], true, true);
      this.placeSceneryOnRoute(
        cactus,
        (index + 0.62) / cactusCount,
        (index % 2 === 0 ? 1 : -1) * 18.2,
      );
    }

    this.addFestivalBanner(0.14, 0xec5549);
    this.addFestivalBanner(0.72, 0x27bfd0);
    this.addBuilderWorksiteScenery();
    this.canvas.dataset.builderWorksiteStyle = "route-following-prop-clusters-v1";
    this.canvas.dataset.builderWorksitePropCount = String(this.builderWorksitePropCount);
  }

  private addBuilderWorksiteScenery(): void {
    this.addMarshalPlatform(0.18, -15.5, 0.78);
    this.addMarshalPlatform(0.58, 16.2, 0.72);
    this.addTireStackCluster(0.24, 18.5, 5);
    this.addTireStackCluster(0.47, -18.8, 4);
    this.addConeLine(0.36, -12.6, 6, 0xec5549);
    this.addConeLine(0.68, 12.8, 5, 0xf3c545);
    this.addCrateAndToolCluster(0.31, -19.6, 0.9);
    this.addCrateAndToolCluster(0.76, 19.8, 1.05);
  }

  private addMarshalPlatform(routeRatio: number, lateral: number, scale: number): void {
    const group = new THREE.Group();
    group.scale.setScalar(scale);
    const timber = new THREE.MeshStandardMaterial({ color: 0x6f4630, roughness: 0.94, flatShading: true });
    const cream = new THREE.MeshStandardMaterial({ color: 0xf4e4ba, roughness: 0.82, flatShading: true });
    const teal = new THREE.MeshStandardMaterial({ color: 0x22c7d2, roughness: 0.72, flatShading: true });
    const vest = new THREE.MeshStandardMaterial({ color: 0xf4b53f, roughness: 0.78, flatShading: true });
    for (const x of [-1.65, 1.65]) {
      for (const z of [-1.25, 1.25]) {
        this.addMesh(group, new THREE.CylinderGeometry(0.12, 0.16, 2.65, 6), timber, [x, 1.32, z], [0, 0, 0], true, true);
        this.builderWorksitePropCount += 1;
      }
    }
    this.addMesh(group, new THREE.BoxGeometry(4.25, 0.28, 3.1), timber, [0, 2.75, 0], [0, 0, 0], true, true);
    this.addMesh(group, new THREE.BoxGeometry(4.45, 0.16, 0.16), cream, [0, 3.28, -1.55], [0, 0, 0], true, true);
    this.addMesh(group, new THREE.BoxGeometry(0.16, 0.16, 3.15), cream, [-2.18, 3.28, 0], [0, 0, 0], true, true);
    this.addMesh(group, new THREE.CylinderGeometry(0.28, 0.36, 0.62, 8), vest, [-0.62, 3.22, 0.1], [0, 0, 0], true, true);
    this.addMesh(group, new THREE.SphereGeometry(0.22, 8, 6), cream, [-0.62, 3.66, 0.1], [0, 0, 0], false, true);
    this.addMesh(group, new THREE.BoxGeometry(1.6, 0.9, 0.08), teal, [1.0, 3.55, -1.62], [0, 0, 0.05], true, true);
    this.builderWorksitePropCount += 6;
    this.placeSceneryOnRoute(group, routeRatio, lateral, 0, lateral < 0 ? -8 : 8);
  }

  private addTireStackCluster(routeRatio: number, lateral: number, tireCount: number): void {
    const group = new THREE.Group();
    const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x151d20, roughness: 0.96, flatShading: true });
    const hubMaterial = new THREE.MeshStandardMaterial({ color: 0x6b7f85, roughness: 0.62, metalness: 0.16, flatShading: true });
    for (let index = 0; index < tireCount; index += 1) {
      const x = (index % 3) * 0.92 - 0.92;
      const z = Math.floor(index / 3) * 0.82 - 0.42;
      const y = 0.32 + (index % 2) * 0.32;
      this.addMesh(group, new THREE.TorusGeometry(0.38, 0.12, 7, 14), tireMaterial, [x, y, z], [Math.PI / 2, 0, index * 0.2], true, true);
      this.addMesh(group, new THREE.CylinderGeometry(0.16, 0.16, 0.06, 8), hubMaterial, [x, y, z], [Math.PI / 2, 0, 0], false, true);
      this.builderWorksitePropCount += 1;
    }
    this.placeSceneryOnRoute(group, routeRatio, lateral, 0.05, lateral < 0 ? -16 : 16);
  }

  private addConeLine(routeRatio: number, lateral: number, coneCount: number, color: number): void {
    const group = new THREE.Group();
    const coneMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.82, flatShading: true });
    const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xf8f1dd, roughness: 0.78, flatShading: true });
    for (let index = 0; index < coneCount; index += 1) {
      const z = (index - (coneCount - 1) / 2) * 1.35;
      this.addMesh(group, new THREE.ConeGeometry(0.32, 0.9, 6), coneMaterial, [0, 0.45, z], [0, index * 0.4, 0], true, true);
      this.addMesh(group, new THREE.BoxGeometry(0.46, 0.08, 0.46), stripeMaterial, [0, 0.6, z], [0, index * 0.4, 0], false, true);
      this.builderWorksitePropCount += 1;
    }
    this.placeSceneryOnRoute(group, routeRatio, lateral, 0, lateral < 0 ? 10 : -10);
  }

  private addCrateAndToolCluster(routeRatio: number, lateral: number, scale: number): void {
    const group = new THREE.Group();
    group.scale.setScalar(scale);
    const crate = new THREE.MeshStandardMaterial({ color: 0xb36a35, roughness: 0.9, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1e2c32, roughness: 0.78, flatShading: true });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8fa2a5, roughness: 0.56, metalness: 0.24, flatShading: true });
    const coral = new THREE.MeshStandardMaterial({ color: 0xec5549, roughness: 0.78, flatShading: true });
    const cratePositions: readonly VectorTuple[] = [[-0.75, 0.36, -0.2], [0.24, 0.34, 0.34], [0.84, 0.72, -0.44]];
    for (const position of cratePositions) {
      this.addMesh(group, new THREE.BoxGeometry(0.86, 0.72, 0.78), crate, position, [0, 0.24, 0], true, true);
      this.builderWorksitePropCount += 1;
    }
    this.addMesh(group, new THREE.BoxGeometry(2.35, 0.2, 0.7), dark, [0.2, 1.28, 0.95], [0, 0.12, 0], true, true);
    this.addMesh(group, new THREE.CylinderGeometry(0.12, 0.12, 1.2, 7), metal, [-0.72, 1.84, 0.95], [0, 0, Math.PI / 2], true, true);
    this.addMesh(group, new THREE.CylinderGeometry(0.12, 0.12, 1.2, 7), metal, [0.78, 1.84, 0.95], [0, 0, Math.PI / 2], true, true);
    this.addMesh(group, new THREE.BoxGeometry(1.4, 0.12, 0.12), coral, [0.18, 1.98, 0.95], [0, 0.4, 0], true, true);
    this.builderWorksitePropCount += 4;
    this.placeSceneryOnRoute(group, routeRatio, lateral, 0.02, lateral < 0 ? -14 : 14);
  }

  private addCanyonMesa(lateral: number, routeRatio: number, scale: number, rotation: number): void {
    const group = new THREE.Group();
    group.scale.setScalar(scale);
    const sandstone = new THREE.MeshStandardMaterial({ color: 0xa9563e, roughness: 0.98, flatShading: true });
    const sunFace = new THREE.MeshStandardMaterial({ color: 0xc96f4b, roughness: 0.96, flatShading: true });
    this.addMesh(group, new THREE.CylinderGeometry(4.5, 5.4, 3.2, 7), sandstone, [0, 1.6, 0], [0, 0.16, 0], true, true);
    this.addMesh(group, new THREE.CylinderGeometry(3.25, 4.2, 3, 7), sunFace, [0.35, 4.68, -0.2], [0, -0.12, 0], true, true);
    this.addMesh(group, new THREE.CylinderGeometry(2.1, 3, 2.4, 7), sandstone.clone(), [0.1, 7.35, -0.1], [0, 0.24, 0], true, true);
    this.placeSceneryOnRoute(group, routeRatio, lateral, -0.1, THREE.MathUtils.radToDeg(rotation));
  }

  private addTree(lateral: number, routeRatio: number, scale: number): void {
    const group = new THREE.Group();
    group.scale.setScalar(scale);
    const trunk = new THREE.MeshStandardMaterial({ color: 0x65412c, roughness: 1, flatShading: true });
    const needles = new THREE.MeshStandardMaterial({ color: 0x3f6f42, roughness: 0.96, flatShading: true });
    this.addMesh(group, new THREE.CylinderGeometry(0.36, 0.52, 3.1, 7), trunk, [0, 1.55, 0], [0, 0, 0], true, true);
    this.addMesh(group, new THREE.ConeGeometry(2.2, 4.2, 8), needles, [0, 3.4, 0], [0, 0.18, 0], true, true);
    this.addMesh(group, new THREE.ConeGeometry(1.75, 3.7, 8), needles, [0, 5.35, 0], [0, -0.12, 0], true, true);
    this.addMesh(group, new THREE.ConeGeometry(1.22, 3.2, 8), needles, [0, 7.05, 0], [0, 0.08, 0], true, true);
    this.placeSceneryOnRoute(group, routeRatio, lateral);
  }

  private addFestivalBanner(routeRatio: number, color: number): void {
    const group = new THREE.Group();
    const pole = new THREE.MeshStandardMaterial({ color: 0x334a52, roughness: 0.48, metalness: 0.38, flatShading: true });
    const banner = new THREE.MeshStandardMaterial({ color, roughness: 0.72, flatShading: true, side: THREE.DoubleSide });
    for (const x of [-9.8, 9.8]) {
      this.addMesh(group, new THREE.CylinderGeometry(0.12, 0.16, 4.8, 8), pole, [x, 2.4, 0], [0, 0, 0], true, true);
      this.addMesh(group, new THREE.BoxGeometry(2.6, 1.15, 0.12), banner, [x + (x < 0 ? 1.3 : -1.3), 3.9, 0], [0, 0, 0], true, true);
    }
    this.placeSceneryOnRoute(group, routeRatio, 0);
  }

  private placeSceneryOnRoute(
    object: THREE.Object3D,
    routeRatio: number,
    lateral: number,
    elevation = 0,
    localRotationDegrees = 0,
  ): void {
    const gridPosition = this.courseRouteOrigin
      + THREE.MathUtils.clamp(routeRatio, 0, 1) * this.courseRouteLength;
    const orientation = this.sampleEditorRoute(
      gridPosition,
      lateral,
      elevation,
      this.routePosition,
    );
    object.position.copy(this.routePosition);
    this.setRouteOrientation(object, orientation, localRotationDegrees);
    this.routeScenery.add(object);
  }

  private updatePreview(module: CustomTrackModule): void {
    this.clearGroup(this.preview);
    const definition = EDITOR_MODULE_BY_ID.get(module.moduleId);
    const track = this.currentTrack;
    if (!definition || !track) {
      this.publishPreview(null);
      return;
    }
    const validation = validateCustomTrackPlacement(track, module);

    const visual = this.createModuleVisual(definition, "preview");
    this.placeOnRoute(visual, module, definition, 0.13, true);
    this.preview.add(visual);

    const baseWidth = Math.max(2.45, definition.laneSpan * 2.75);
    const baseLength = Math.max(2, definition.length * 0.22);
    const sideways = module.rotation === 90 || module.rotation === 270;
    const width = sideways ? baseLength : baseWidth;
    const length = sideways ? baseWidth : baseLength;
    const footprint = new THREE.BoxGeometry(width + 0.38, 0.22, length + 0.38);
    const edges = new THREE.EdgesGeometry(footprint);
    footprint.dispose();
    const feedbackColor = validation.valid ? 0xaaffff : 0xff6b5c;
    const lineMaterial = new THREE.LineBasicMaterial({ color: feedbackColor, transparent: true, opacity: 0.96 });
    const outline = new THREE.LineSegments(edges, lineMaterial);
    this.placeOnRoute(outline, module, definition, 0.17, false);
    this.preview.add(outline);

    const markerMaterial = new THREE.MeshBasicMaterial({ color: feedbackColor, transparent: true, opacity: 0.96 });
    const markerPosition = new THREE.Vector3();
    this.sampleEditorRoute(
      module.gridPosition,
      LANE_X[module.lane] + (definition.laneSpan - 1) * 1.5,
      module.height + 3.4,
      markerPosition,
    );
    if (validation.valid) {
      const marker = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.92, 4), markerMaterial);
      marker.position.copy(markerPosition);
      marker.rotation.z = Math.PI;
      this.preview.add(marker);
    } else {
      const marker = new THREE.Group();
      marker.position.copy(markerPosition);
      for (const rotation of [-Math.PI / 4, Math.PI / 4]) {
        const stroke = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.15, 0.16), markerMaterial);
        stroke.rotation.z = rotation;
        marker.add(stroke);
      }
      this.preview.add(marker);
    }

    this.publishPreview({
      moduleName: definition.name,
      lane: module.lane,
      gridPosition: module.gridPosition,
      valid: validation.valid,
      message: validation.valid
        ? `Lane ${module.lane + 1} · ${module.gridPosition} m · click to place.`
        : validation.errors[0] ?? "This placement needs adjustment.",
    });
  }

  private clearPreview(): void {
    this.clearGroup(this.preview);
    this.publishPreview(null);
  }

  private publishPreview(preview: EditorPlacementPreview | null): void {
    const signature = preview
      ? `${preview.moduleName}:${preview.lane}:${preview.gridPosition}:${preview.valid}:${preview.message}`
      : "none";
    if (signature === this.previewSignature) return;
    this.previewSignature = signature;
    this.onPreview(preview);
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

  private readonly resize = (): void => {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.cameraMode === "overview") this.frameRoute();
  };

  private updateCamera(): void {
    const target = new THREE.Vector3();
    if (this.cameraMode === "overview") {
      target.copy(this.routeOverviewTarget);
      const horizontalDistance = this.overviewRadius * 0.68;
      this.camera.position.set(
        target.x + Math.sin(this.orbit) * horizontalDistance,
        target.y + this.overviewRadius * 0.74,
        target.z + Math.cos(this.orbit) * horizontalDistance,
      );
      this.camera.far = Math.max(500, this.overviewRadius * 3.4);
      if (this.scene.fog instanceof THREE.Fog) {
        this.scene.fog.near = Math.max(86, this.overviewRadius * 0.76);
        this.scene.fog.far = Math.max(164, this.overviewRadius * 1.9);
      }
    } else {
      const orientation = this.sampleEditorRoute(
        this.cameraRoutePosition,
        0,
        0,
        target,
      );
      const orbitSide = Math.sin(this.orbit) * this.routeRadius;
      const orbitTrail = Math.cos(this.orbit) * this.routeRadius;
      this.camera.position.set(
        target.x + orientation.rightX * orbitSide - orientation.forwardX * orbitTrail,
        target.y + EDITOR_ROUTE_CAMERA_HEIGHT,
        target.z + orientation.rightZ * orbitSide - orientation.forwardZ * orbitTrail,
      );
      this.camera.far = 500;
      this.canvas.dataset.routeViewMode = "position";
      this.canvas.dataset.editorCameraStyle = "closer-route-diorama-v1";
      this.canvas.dataset.editorRouteCameraRadius = String(Math.round(this.routeRadius));
      if (this.scene.fog instanceof THREE.Fog) {
        this.scene.fog.near = 86;
        this.scene.fog.far = 164;
      }
    }
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    this.keyLight.target.position.copy(target);
    this.keyLight.position.set(target.x - 35, target.y + 52, target.z + 30);
    this.keyLight.target.updateMatrixWorld(true);
    this.keyLight.updateMatrixWorld(true);
  }

  private readonly pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.dragging = true;
    this.dragX = event.clientX;
    this.dragY = event.clientY;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.hasDragged = false;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    if (!this.dragging) {
      this.updatePointerPreview(event);
      return;
    }
    const deltaX = event.clientX - this.dragX;
    const deltaY = event.clientY - this.dragY;
    if (Math.hypot(event.clientX - this.dragStartX, event.clientY - this.dragStartY) > 4) {
      this.hasDragged = true;
    }
    if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
      this.orbit += deltaX * 0.006;
      if (Math.abs(deltaY) > 0.5) {
        this.focusRoutePosition(this.cameraRoutePosition - deltaY * 0.9);
      } else {
        this.updateCamera();
      }
      this.clearPreview();
    }
    this.dragX = event.clientX;
    this.dragY = event.clientY;
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    if (!this.dragging) return;
    const moved = this.hasDragged || Math.hypot(
      event.clientX - this.dragStartX,
      event.clientY - this.dragStartY,
    ) > 4;
    this.dragging = false;
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    if (moved) {
      this.updatePointerPreview(event);
      return;
    }
    this.selectOrPlaceAtPointer(event);
  };

  private readonly pointerCancel = (): void => {
    this.dragging = false;
    this.hasDragged = false;
    this.clearPreview();
  };

  private readonly pointerLeave = (): void => {
    if (!this.dragging) this.clearPreview();
  };

  private readonly wheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.clearPreview();
    if (event.shiftKey) {
      this.focusRoutePosition(this.cameraRoutePosition + event.deltaY * 0.25);
      return;
    }
    const minimumRadius = this.cameraMode === "overview"
      ? this.overviewFitRadius * 0.52
      : EDITOR_ROUTE_CAMERA_MIN_RADIUS;
    const maximumRadius = this.cameraMode === "overview"
      ? this.overviewFitRadius * 2.4
      : EDITOR_ROUTE_CAMERA_MAX_RADIUS;
    if (this.cameraMode === "overview") {
      this.overviewRadius = THREE.MathUtils.clamp(
        this.overviewRadius + event.deltaY * 0.08,
        minimumRadius,
        maximumRadius,
      );
    } else {
      this.routeRadius = THREE.MathUtils.clamp(
        this.routeRadius + event.deltaY * 0.025,
        minimumRadius,
        maximumRadius,
      );
    }
    this.updateCamera();
  };

  private setRaycasterFromPointer(event: PointerEvent): boolean {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return false;
    this.pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return true;
  }

  private placementIdAtPointer(event: PointerEvent): string | null {
    if (!this.setRaycasterFromPointer(event)) return null;
    this.modules.updateMatrixWorld(true);
    const intersections = this.raycaster.intersectObjects(this.modules.children, true);
    for (const intersection of intersections) {
      let target: THREE.Object3D | null = intersection.object;
      while (target && target !== this.modules) {
        if (typeof target.userData.placementId === "string") return target.userData.placementId;
        target = target.parent;
      }
    }
    return null;
  }

  private placementCandidateAtPointer(event: PointerEvent): CustomTrackModule | null {
    if (!this.currentTrack || !EDITOR_MODULE_BY_ID.has(this.previewModuleId)) return null;
    if (!this.setRaycasterFromPointer(event)) return null;
    const routePickSurfaces = [this.routePickSurface, this.routeExtensionPickSurface]
      .filter((surface): surface is THREE.Mesh => surface !== null);
    if (routePickSurfaces.length > 0) {
      this.courseSurface.updateMatrixWorld(true);
      this.routeExtensionSurface.updateMatrixWorld(true);
      const intersection = this.raycaster.intersectObjects(routePickSurfaces, false)[0];
      if (intersection?.uv) {
        const localLateral = THREE.MathUtils.lerp(
          -EDITOR_ROUTE_PICK_HALF_WIDTH,
          EDITOR_ROUTE_PICK_HALF_WIDTH,
          intersection.uv.x,
        );
        const lane = LANE_X.reduce(
          (best, x, index) => (
            Math.abs(localLateral - x) < Math.abs(localLateral - LANE_X[best])
              ? index as 0 | 1 | 2 | 3
              : best
          ),
          0 as 0 | 1 | 2 | 3,
        );
        const gridOffset = typeof intersection.object.userData.gridOffset === "number"
          ? intersection.object.userData.gridOffset
          : 0;
        const gridPosition = THREE.MathUtils.clamp(
          Math.round((gridOffset + intersection.uv.y) / 2) * 2,
          0,
          CUSTOM_TRACK_ROUTE_LIMIT,
        );
        return {
          id: PREVIEW_PLACEMENT_ID,
          moduleId: this.previewModuleId,
          lane,
          gridPosition,
          rotation: 0,
          height: 0,
        };
      }
      return null;
    }
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    const lane = LANE_X.reduce((best, x, index) => Math.abs(hit.x - x) < Math.abs(hit.x - LANE_X[best]) ? index as 0 | 1 | 2 | 3 : best, 0 as 0 | 1 | 2 | 3);
    const gridPosition = THREE.MathUtils.clamp(
      Math.round(-hit.z / 2) * 2,
      0,
      CUSTOM_TRACK_ROUTE_LIMIT,
    );
    return {
      id: PREVIEW_PLACEMENT_ID,
      moduleId: this.previewModuleId,
      lane,
      gridPosition,
      rotation: 0,
      height: 0,
    };
  }

  private updatePointerPreview(event: PointerEvent): void {
    if (this.placementIdAtPointer(event)) {
      this.clearPreview();
      return;
    }
    const candidate = this.placementCandidateAtPointer(event);
    if (candidate) this.updatePreview(candidate);
    else this.clearPreview();
  }

  private selectOrPlaceAtPointer(event: PointerEvent): void {
    const placementId = this.placementIdAtPointer(event);
    if (placementId) {
      this.clearPreview();
      this.onSelect(placementId);
      const placement = this.currentTrack?.modules.find((module) => module.id === placementId);
      if (placement) this.focusRoutePosition(placement.gridPosition);
      return;
    }
    const candidate = this.placementCandidateAtPointer(event);
    if (!candidate) return;
    if (this.currentTrack && this.currentTrack.modules.length >= CUSTOM_TRACK_MODULE_LIMIT) {
      this.updatePreview(candidate);
      return;
    }
    if (this.currentTrack && !validateCustomTrackPlacement(this.currentTrack, candidate).valid) {
      this.updatePreview(candidate);
      return;
    }
    this.onPlace(candidate.lane, candidate.gridPosition);
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
