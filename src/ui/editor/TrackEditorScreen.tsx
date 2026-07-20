import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { useAppStore, type EditorSessionState } from "../../app/store";
import { EDITOR_MODULE_BY_ID, EDITOR_MODULES, type EditorModuleCategory, type EditorModuleDefinition } from "../../game/editor/modules";
import { EXAMPLE_TRACKS } from "../../game/editor/examples";
import {
  CUSTOM_TRACK_MODULE_LIMIT,
  CUSTOM_TRACK_NAME_MAX_CHARS,
  CUSTOM_TRACK_ROUTE_LIMIT,
  validateCustomTrack,
  validateCustomTrackPlacement,
} from "../../game/editor/validation";
import {
  CUSTOM_TRACK_ROUTE_ANCHOR_ELEVATION_LIMIT,
  CUSTOM_TRACK_ROUTE_ANCHOR_LATERAL_LIMIT,
  deleteCustomTrack,
  deleteCustomTrackRecovery,
  exportCustomTrack,
  exportCustomTrackRecovery,
  importCustomTrack,
  listCustomTracks,
  MAX_CUSTOM_TRACK_FILE_BYTES,
  saveCustomTrack,
  type CustomTrackData,
  type CustomTrackModule,
  type CustomTrackRecovery,
} from "../../game/persistence/database";
import { EditorScene, type EditorPlacementPreview } from "./EditorScene";
import { RallyIcon } from "../icons/RallyIcon";

const HISTORY_LIMIT = 50;
const INITIAL_ROUTE_VIEW_POSITION = 62;
const ROUTE_TURN_MIN = -CUSTOM_TRACK_ROUTE_ANCHOR_LATERAL_LIMIT;
const ROUTE_TURN_MAX = CUSTOM_TRACK_ROUTE_ANCHOR_LATERAL_LIMIT;
const ROUTE_RISE_MIN = 0;
const ROUTE_RISE_MAX = CUSTOM_TRACK_ROUTE_ANCHOR_ELEVATION_LIMIT;
const NOW = () => Date.now();

function containDialogFocus(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab") return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
  )).filter((control) => !control.hidden && control.getAttribute("aria-hidden") !== "true");
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function boundedNumber(value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : 0;
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function authoredRouteRange(track: CustomTrackData): readonly [number, number] {
  const start = track.modules.find((module) => module.moduleId === "start-grid");
  const finish = track.modules.find((module) => module.moduleId === "finish-arch");
  if (start && finish && finish.gridPosition > start.gridPosition) {
    return [start.gridPosition, finish.gridPosition];
  }
  const furthestPlacement = track.modules.reduce(
    (maximum, module) => Math.max(maximum, module.gridPosition),
    0,
  );
  return [0, Math.min(
    CUSTOM_TRACK_ROUTE_LIMIT,
    Math.max(240, furthestPlacement + 48),
  )];
}

function createDraft(): CustomTrackData {
  const createdAt = NOW();
  return {
    schemaVersion: 2,
    id: crypto.randomUUID(),
    name: "Canyon Workshop",
    laps: 2,
    difficultyEstimate: 2,
    modules: [
      { id: crypto.randomUUID(), moduleId: "start-grid", lane: 0, gridPosition: 0, rotation: 0, height: 0 },
      {
        id: crypto.randomUUID(),
        moduleId: "checkpoint",
        lane: 0,
        gridPosition: 48,
        rotation: 0,
        height: 0,
        routeAnchor: { lateralOffset: -3, elevation: 2 },
      },
      { id: crypto.randomUUID(), moduleId: "finish-arch", lane: 0, gridPosition: 96, rotation: 0, height: 0 },
    ],
    createdAt,
    updatedAt: createdAt,
  };
}

const CATEGORIES: readonly EditorModuleCategory[] = ["track", "jumps", "terrain", "hazards", "race"];

interface EditorConfirmation {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
}

function CategoryGlyph({ category }: { category: EditorModuleCategory }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (category === "track") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 21c0-5 10-5 10-10S9 6 9 3M13 21c0-3 7-4 7-10S15 4 15 3" {...common} /></svg>;
  }
  if (category === "jumps") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h4l8-10h6M5 18h16M15 8v10" {...common} /><path d="m17 5 2-2 2 2" {...common} /></svg>;
  }
  if (category === "terrain") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m2.5 19 5.8-8 3.4 4 3.6-7 6.2 11Z" {...common} /><path d="m14.2 10.2 1.3 1.5 1.4-1.4M5.8 16.3h4.8" {...common} /></svg>;
  }
  if (category === "hazards") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v10H4zM6.5 17v3M17.5 17v3M7 7l4 10M13 7l4 10" {...common} /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V3M7 4h11l-2.5 4L18 12H7" {...common} /><path d="M8 5.5h3v3H8zm3 3h3v3h-3zm3-3h3v3h-3z" fill="currentColor" stroke="none" /></svg>;
}

function StepperIcon({ kind }: { kind: "left" | "right" | "up" | "down" | "rotate-left" | "rotate-right" }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2.25,
  };
  if (kind === "left" || kind === "right") {
    const scale = kind === "left" ? -1 : 1;
    return (
      <svg className="stepper-icon" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `scaleX(${scale})` }}>
        <path d="M7 12h9" {...common} />
        <path d="m13 7 5 5-5 5" {...common} />
      </svg>
    );
  }
  if (kind === "up" || kind === "down") {
    const scale = kind === "down" ? -1 : 1;
    return (
      <svg className="stepper-icon" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `scaleY(${scale})` }}>
        <path d="M12 18V8" {...common} />
        <path d="m7 11 5-5 5 5" {...common} />
        <path d="M7 20h10" {...common} />
      </svg>
    );
  }
  const scale = kind === "rotate-left" ? -1 : 1;
  return (
    <svg className="stepper-icon" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `scaleX(${scale})` }}>
      <path d="M7.5 9.2A6.1 6.1 0 1 1 6 13.2" {...common} />
      <path d="M7.5 9.2H3.8V5.5" {...common} />
      <path d="M12 9.2v4.1l3 1.8" {...common} />
    </svg>
  );
}

function ModuleThumbnail({ module }: { module: EditorModuleDefinition }) {
  const isCurve = module.id.includes("curve") || module.id.includes("bank");
  const isMud = module.id.includes("mud");
  const isGrass = module.id === "grass-cut";
  const isCooling = module.id.includes("cooling");
  const isBarrier = module.id.includes("barrier");
  const isStart = module.id === "start-grid";
  const isFinish = module.id === "finish-arch";

  return (
    <svg className={`module-art module-art-${module.category}`} data-module={module.id} viewBox="0 0 96 64" aria-hidden="true">
      <ellipse className="thumbnail-shadow" cx="49" cy="55" rx="38" ry="6" />
      {module.category === "track" ? <>
        <path className="thumbnail-dirt" d={isCurve ? "M10 53C23 31 43 17 82 13l7 18C57 34 41 44 31 58Z" : "M11 51 55 12l31 12-43 36Z"} />
        {isCurve ? <><path className="thumbnail-lane" d="M22 53C35 34 50 26 84 22" /><path className="thumbnail-lane" d="M32 57C43 41 57 34 87 31" /></> : <><path className="thumbnail-lane" d="m24 51 43-34" /><path className="thumbnail-lane" d="m35 57 43-35" /></>}
        {module.id.includes("bank") ? <path className="thumbnail-bank" d="M10 53C23 31 43 17 82 13l3 8C53 25 34 39 24 57Z" /> : null}
      </> : null}
      {module.category === "jumps" ? <>
        <path className="thumbnail-deck" d="m8 50 35-29 42 11-34 26Z" />
        <path className="thumbnail-ramp" d={module.id === "ramp-tabletop" ? "m14 48 22-22 27 7 17 13-23-6-18 15Z" : "m13 49 39-33 30 13-30 29Z"} />
        {module.id === "jump-double" || module.id === "jump-chain" ? <path className="thumbnail-ramp thumbnail-ramp-back" d="m47 48 22-18 17 7-21 17Z" /> : null}
        {module.id === "jump-chain" ? <path className="thumbnail-ramp thumbnail-ramp-mid" d="m31 51 17-15 14 6-17 14Z" /> : null}
        <path className="thumbnail-arrow" d="m43 40 8-7 7 2-8 7m-5 3 8-7 7 2-8 7" />
      </> : null}
      {module.category === "terrain" ? <>
        <path className="thumbnail-dirt" d="m8 49 39-31 41 13-39 29Z" />
        {isMud ? <><ellipse className="thumbnail-mud" cx="45" cy="39" rx={module.id === "mud-wide" ? 25 : 17} ry="9" /><path className="thumbnail-mud-shine" d="M30 38c8-5 20-5 29-1" /></> : null}
        {isGrass ? <><path className="thumbnail-grass" d="M19 52 45 21l39 12-35 26Z" /><path className="thumbnail-grass-lines" d="m24 48 4-9 1 8 6-12-1 14m22 4 4-10 1 8 5-12" /></> : null}
        {!isMud && !isGrass ? <>{[0, 1, 2].slice(0, module.id === "bump-single" ? 1 : 3).map((index) => <path key={index} className="thumbnail-bump" d={`M${20 + index * 17} ${48 - index * 3}q8-13 16 0Z`} />)}</> : null}
      </> : null}
      {module.category === "hazards" ? <>
        <path className="thumbnail-dirt" d="m8 50 39-30 41 12-39 28Z" />
        {isCooling ? <><path className="thumbnail-cooling-glow" d="M25 49V30l8-9h29l9 9v19" /><path className="thumbnail-cooling" d="M25 49V30l8-9h29l9 9v19M35 47V33l4-4h18l4 4v14" /></> : null}
        {isBarrier ? <><path className="thumbnail-barrier" d="m21 43 40-17 16 7-41 18Z" /><path className="thumbnail-barrier-stripe" d="m32 38 8 9m8-16 8 9m8-15 8 9" />{module.id === "barrier-offset" ? <path className="thumbnail-barrier thumbnail-barrier-back" d="m13 33 31-13 12 5-31 14Z" /> : null}</> : null}
      </> : null}
      {module.category === "race" ? <>
        <path className="thumbnail-dirt" d="m8 51 40-32 41 12-40 29Z" />
        {isStart ? <><path className="thumbnail-grid" d="m22 45 38-17 17 5-39 18Z" /><path className="thumbnail-grid-lines" d="m30 42 16 5m-6-10 16 5m-6-10 17 5M38 38l8-4m1 11 8-4m2-12 8-4" /></> : null}
        {!isStart ? <><path className="thumbnail-race-post" d="M22 49V26M74 47V24" /><path className={isFinish ? "thumbnail-checks" : "thumbnail-banner"} d="m22 26 52-2v10l-52 2Z" />{isFinish ? <path className="thumbnail-check-lines" d="m28 26 8 9m8-10 8 9m8-9 8 9M22 31l52-2" /> : null}</> : null}
      </> : null}
    </svg>
  );
}

export function TrackEditorScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<EditorScene | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const libraryDrawerRef = useRef<HTMLElement>(null);
  const libraryTriggerRef = useRef<HTMLButtonElement>(null);
  const libraryReturnFocusRef = useRef<HTMLElement | null>(null);
  const confirmationConfirmRef = useRef<HTMLButtonElement>(null);
  const confirmationReturnFocusRef = useRef<HTMLElement | null>(null);
  const wasLibraryOpenRef = useRef(false);
  const [initialSession] = useState(() => useAppStore.getState().editorSession);
  const navigate = useAppStore((state) => state.navigate);
  const startCustomRace = useAppStore((state) => state.startCustomRace);
  const setEditorSession = useAppStore((state) => state.setEditorSession);
  const saveTestRideTrack = useAppStore((state) => state.saveTestRideTrack);
  const clearPendingTestRideSave = useAppStore((state) => state.clearPendingTestRideSave);
  const [track, setTrack] = useState<CustomTrackData>(() => structuredClone(initialSession?.track ?? createDraft()));
  const [persistedBase, setPersistedBase] = useState<CustomTrackData | null>(() => (
    structuredClone(initialSession?.persistedBase ?? null)
  ));
  const [past, setPast] = useState<CustomTrackData[]>(() => structuredClone(initialSession?.past ?? []));
  const [future, setFuture] = useState<CustomTrackData[]>(() => structuredClone(initialSession?.future ?? []));
  const [category, setCategory] = useState<EditorModuleCategory>(() => initialSession?.category ?? "jumps");
  const [selectedModuleId, setSelectedModuleId] = useState(() => {
    const restored = initialSession?.selectedModuleId;
    return restored && EDITOR_MODULES.some((module) => module.id === restored) ? restored : "ramp-medium";
  });
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(() => {
    const restored = initialSession?.selectedPlacementId;
    return restored && initialSession?.track.modules.some((module) => module.id === restored)
      ? restored
      : null;
  });
  const [library, setLibrary] = useState<CustomTrackData[]>([]);
  const [recoveries, setRecoveries] = useState<CustomTrackRecovery[]>([]);
  const [placementPreview, setPlacementPreview] = useState<EditorPlacementPreview | null>(null);
  const [placementLane, setPlacementLane] = useState<0 | 1 | 2 | 3>(0);
  const [viewPosition, setViewPosition] = useState(() => (
    track.modules.find((module) => module.id === selectedPlacementId)?.gridPosition
      ?? INITIAL_ROUTE_VIEW_POSITION
  ));
  const [notice, setNotice] = useState("Autosave waits for a valid route.");
  const [showLibrary, setShowLibrary] = useState(false);
  const [saveInFlight, setSaveInFlight] = useState(false);
  const [confirmation, setConfirmation] = useState<EditorConfirmation | null>(null);
  const saveInFlightRef = useRef(false);
  const trackRef = useRef(track);
  const persistedBaseRef = useRef(persistedBase);
  const selectedModuleIdRef = useRef(selectedModuleId);
  const viewPositionRef = useRef(viewPosition);
  const validation = useMemo(() => validateCustomTrack(track), [track]);
  const routeRange = useMemo(() => authoredRouteRange(track), [track]);
  const selectedPlacement = track.modules.find((module) => module.id === selectedPlacementId) ?? null;
  const resolvedSelectedPlacementId = selectedPlacement?.id ?? null;
  const placedModules = useMemo(
    () => [...track.modules].sort((left, right) => left.gridPosition - right.gridPosition || left.lane - right.lane),
    [track.modules],
  );
  const editorControlsLocked = saveInFlight || confirmation !== null;
  const restoreConfirmationFocus = () => {
    window.requestAnimationFrame(() => {
      const target = confirmationReturnFocusRef.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
      confirmationReturnFocusRef.current = null;
    });
  };
  const requestConfirmation = (nextConfirmation: EditorConfirmation) => {
    const activeElement = document.activeElement;
    confirmationReturnFocusRef.current = activeElement instanceof HTMLElement
      ? activeElement
      : null;
    setConfirmation(nextConfirmation);
  };
  const cancelConfirmation = () => {
    setConfirmation(null);
    restoreConfirmationFocus();
  };
  const confirmPendingAction = () => {
    const pending = confirmation;
    if (!pending || saveInFlightRef.current) return;
    setConfirmation(null);
    restoreConfirmationFocus();
    void Promise.resolve(pending.onConfirm());
  };

  useLayoutEffect(() => {
    trackRef.current = track;
    persistedBaseRef.current = persistedBase;
    selectedModuleIdRef.current = selectedModuleId;
    viewPositionRef.current = viewPosition;
  }, [persistedBase, selectedModuleId, track, viewPosition]);

  useLayoutEffect(() => {
    setEditorSession({
      track,
      persistedBase,
      past,
      future,
      category,
      selectedModuleId,
      selectedPlacementId: resolvedSelectedPlacementId,
    });
  }, [category, future, past, persistedBase, resolvedSelectedPlacementId, selectedModuleId, setEditorSession, track]);

  useLayoutEffect(() => {
    const wasOpen = wasLibraryOpenRef.current;
    if (showLibrary && !wasOpen) {
      libraryDrawerRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    } else if (!showLibrary && wasOpen) {
      const returnTarget = libraryReturnFocusRef.current;
      if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
      else libraryTriggerRef.current?.focus({ preventScroll: true });
      libraryReturnFocusRef.current = null;
    }
    wasLibraryOpenRef.current = showLibrary;
  }, [showLibrary]);

  useLayoutEffect(() => {
    if (!confirmation) return;
    confirmationConfirmRef.current?.focus({ preventScroll: true });
  }, [confirmation]);

  const refreshLibrary = useCallback(async () => {
    try {
      let localTracks = await listCustomTracks();
      if (localTracks.tracks.length === 0) {
        try {
          await Promise.all(EXAMPLE_TRACKS.map((example) => saveCustomTrack({ ...example, modules: example.modules.map((module) => ({ ...module })) })));
          localTracks = await listCustomTracks();
        } catch {
          setNotice("Example tracks could not be restored, but any recovered local data remains available below.");
        }
      }
      setLibrary(localTracks.tracks);
      setRecoveries(localTracks.recoveries);
      if (localTracks.recoveries.length > 0) {
        setNotice(`${localTracks.recoveries.length} damaged local track ${localTracks.recoveries.length === 1 ? "record is" : "records are"} preserved for recovery.`);
      }
    } catch {
      setLibrary([]);
      setRecoveries([]);
      setNotice("Local track storage is unavailable. Editing and test rides still work this session.");
    }
  }, []);

  const commit = useCallback((update: (current: CustomTrackData) => CustomTrackData) => {
    if (saveInFlightRef.current) return;
    setTrack((current) => {
      setPast((history) => [...history.slice(-(HISTORY_LIMIT - 1)), structuredClone(current)]);
      setFuture([]);
      return { ...update(current), updatedAt: NOW() };
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshLibrary(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshLibrary]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new EditorScene(canvas);
    sceneRef.current = scene;
    scene.setPlacementHandler((lane, gridPosition) => {
      if (saveInFlightRef.current) return;
      const placement: CustomTrackModule = { id: crypto.randomUUID(), moduleId: selectedModuleIdRef.current, lane, gridPosition, rotation: 0, height: 0 };
      commit((current) => ({ ...current, modules: [...current.modules, placement] }));
      setSelectedPlacementId(placement.id);
    });
    scene.setSelectionHandler(setSelectedPlacementId);
    scene.setPreviewHandler(setPlacementPreview);
    scene.setNavigationHandler(setViewPosition);
    scene.focusRoutePosition(viewPositionRef.current);
    return () => { scene.dispose(); sceneRef.current = null; };
  }, [commit]);

  useEffect(() => {
    sceneRef.current?.update(trackRef.current, resolvedSelectedPlacementId, selectedModuleId);
  }, [resolvedSelectedPlacementId, selectedModuleId, track.modules]);

  useEffect(() => {
    if (selectedPlacement) sceneRef.current?.focusRoutePosition(selectedPlacement.gridPosition);
  }, [selectedPlacement]);

  const undo = () => {
    if (saveInFlightRef.current) return;
    const previous = past.at(-1);
    if (!previous) return;
    setFuture((items) => [structuredClone(track), ...items].slice(0, HISTORY_LIMIT));
    setPast((items) => items.slice(0, -1));
    setTrack(previous);
  };

  const redo = () => {
    if (saveInFlightRef.current) return;
    const next = future[0];
    if (!next) return;
    setPast((items) => [...items, structuredClone(track)].slice(-HISTORY_LIMIT));
    setFuture((items) => items.slice(1));
    setTrack(next);
  };

  const createTrackSnapshot = (): CustomTrackData => {
    const thumbnail = sceneRef.current?.captureThumbnail();
    const draft = structuredClone(track);
    return thumbnail
      ? { ...draft, thumbnail, updatedAt: NOW() }
      : { ...draft, updatedAt: NOW() };
  };

  const save = async () => {
    if (saveInFlightRef.current) return false;
    if (!validation.valid) { setNotice(validation.errors[0] ?? "Fix validation errors before saving."); return false; }
    saveInFlightRef.current = true;
    setSaveInFlight(true);
    setNotice("Saving this draft to the device…");
    try {
      const saved = createTrackSnapshot();
      const result = await saveCustomTrack(saved, persistedBase);
      clearPendingTestRideSave(saved.id);
      setTrack(result.track);
      setPersistedBase(structuredClone(result.track));
      if (result.conflictCopy) {
        setPast([]);
        setFuture([]);
      }
      await refreshLibrary();
      setNotice(result.conflictCopy
        ? `A newer saved version was preserved. Your draft was saved as “${result.track.name}”.`
        : "Track saved locally.");
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The track could not be saved. Check local storage and retry.");
      return false;
    } finally {
      saveInFlightRef.current = false;
      setSaveInFlight(false);
    }
  };

  const startTestRide = async () => {
    if (saveInFlightRef.current) return;
    if (!validation.valid) {
      setNotice(validation.errors[0] ?? "Fix validation errors before test riding.");
      return;
    }
    saveInFlightRef.current = true;
    setSaveInFlight(true);
    setNotice("Saving the exact Test Ride draft…");
    const snapshot = createTrackSnapshot();
    const session: EditorSessionState = structuredClone({
      track: snapshot,
      persistedBase,
      past,
      future,
      category,
      selectedModuleId,
      selectedPlacementId: resolvedSelectedPlacementId,
    });
    setEditorSession(session);
    try {
      startCustomRace(await saveTestRideTrack(snapshot, persistedBase));
    } catch {
      startCustomRace(snapshot);
    } finally {
      saveInFlightRef.current = false;
      setSaveInFlight(false);
    }
  };

  const downloadExport = () => {
    if (saveInFlightRef.current) return;
    if (!validation.valid) { setNotice(validation.errors[0] ?? "Fix validation errors before export."); return; }
    try {
      const blob = new Blob([exportCustomTrack(track)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${track.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.rrr-track.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      clearPendingTestRideSave(track.id);
      setNotice("Safe JSON export created.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Track export failed.");
    }
  };

  const downloadRecovery = async (recovery: CustomTrackRecovery) => {
    try {
      const blob = new Blob([await exportCustomTrackRecovery(recovery)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const safeName = recovery.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "recovered-track";
      anchor.href = url;
      anchor.download = `${safeName}.recovery.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("Portable recovery package downloaded. The preserved local record was not changed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Recovered track data could not be downloaded.");
    }
  };

  const removeRecovery = async (recovery: CustomTrackRecovery) => {
    if (saveInFlightRef.current) return;
    if (recovery.key === null) return;
    requestConfirmation({
      title: "Remove recovery record?",
      message: "Download its package first if you may need it. Removing this preserved local record cannot be undone.",
      confirmLabel: "Remove record",
      onConfirm: async () => {
        if (saveInFlightRef.current || recovery.key === null) return;
        saveInFlightRef.current = true;
        setSaveInFlight(true);
        setNotice("Removing the selected recovery record…");
        try {
          await deleteCustomTrackRecovery(recovery.key);
          await refreshLibrary();
          setNotice("Recovery record removed from this device.");
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "The recovery record could not be removed.");
        } finally {
          saveInFlightRef.current = false;
          setSaveInFlight(false);
        }
      },
    });
  };

  const removeSavedTrack = async (savedTrack: CustomTrackData) => {
    if (saveInFlightRef.current) return;
    requestConfirmation({
      title: `Delete “${savedTrack.name}”?`,
      message: "Delete this custom track from this device? Export it first if you may need it. This cannot be undone.",
      confirmLabel: "Delete track",
      onConfirm: async () => {
        if (saveInFlightRef.current) return;
        saveInFlightRef.current = true;
        setSaveInFlight(true);
        setNotice(`Removing “${savedTrack.name}” from this device…`);
        try {
          const result = await deleteCustomTrack(savedTrack.id, savedTrack);
          await refreshLibrary();
          if (result.conflict) {
            setNotice(`“${savedTrack.name}” changed in another tab and was not deleted. Review the refreshed copy first.`);
            return;
          }
          if (!result.deleted) {
            setNotice(`“${savedTrack.name}” was already removed in another tab.`);
            return;
          }
          if (
            trackRef.current.id === savedTrack.id
            && persistedBaseRef.current?.id === savedTrack.id
          ) setPersistedBase(null);
          setNotice(`“${savedTrack.name}” was removed from this device. Any open editor draft was not changed.`);
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "The local track could not be deleted.");
        } finally {
          saveInFlightRef.current = false;
          setSaveInFlight(false);
        }
      },
    });
  };

  const focusRouteStart = () => {
    setViewPosition(INITIAL_ROUTE_VIEW_POSITION);
    sceneRef.current?.focusRoutePosition(INITIAL_ROUTE_VIEW_POSITION);
  };

  const importFile = async (file: File) => {
    if (saveInFlightRef.current) return;
    if (file.size > MAX_CUSTOM_TRACK_FILE_BYTES) {
      setNotice("Track file exceeds the 1 MB safety limit.");
      return;
    }
    saveInFlightRef.current = true;
    setSaveInFlight(true);
    setNotice("Reading and validating the selected track…");
    try {
      const imported = importCustomTrack(await file.text());
      const suffix = " Copy";
      const copyName = `${imported.name.slice(0, CUSTOM_TRACK_NAME_MAX_CHARS - suffix.length).trimEnd()}${suffix}`;
      setPast([]);
      setFuture([]);
      setTrack({ ...imported, id: crypto.randomUUID(), name: copyName, createdAt: NOW(), updatedAt: NOW() });
      setPersistedBase(null);
      setSelectedPlacementId(null);
      focusRouteStart();
      setNotice("Track imported as a safe local copy.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Track import failed.");
    } finally {
      saveInFlightRef.current = false;
      setSaveInFlight(false);
    }
  };

  const updateSelected = (patch: Partial<CustomTrackModule>) => {
    if (saveInFlightRef.current) return;
    if (!selectedPlacement) return;
    commit((current) => ({ ...current, modules: current.modules.map((module) => module.id === selectedPlacement.id ? { ...module, ...patch } : module) }));
  };

  const nudgeSelectedLane = (delta: -1 | 1) => {
    if (!selectedPlacement) return;
    updateSelected({ lane: clampNumber(selectedPlacement.lane + delta, 0, 3) as 0 | 1 | 2 | 3 });
  };

  const rotateSelected = (delta: -90 | 90) => {
    if (!selectedPlacement) return;
    const rotations = [0, 90, 180, 270] as const;
    const currentIndex = Math.max(0, rotations.indexOf(selectedPlacement.rotation));
    const nextIndex = (currentIndex + (delta > 0 ? 1 : -1) + rotations.length) % rotations.length;
    updateSelected({ rotation: rotations[nextIndex] ?? 0 });
  };

  const nudgeSelectedHeight = (delta: -0.5 | 0.5) => {
    if (!selectedPlacement) return;
    updateSelected({ height: clampNumber(Number((selectedPlacement.height + delta).toFixed(1)), -4, 40) });
  };

  const nudgeLaps = (delta: -1 | 1) => {
    commit((current) => ({ ...current, laps: clampNumber(current.laps + delta, 1, 9) }));
  };

  const deleteSelected = () => {
    if (saveInFlightRef.current) return;
    if (!resolvedSelectedPlacementId) return;
    commit((current) => ({ ...current, modules: current.modules.filter((module) => module.id !== resolvedSelectedPlacementId) }));
    setSelectedPlacementId(null);
  };

  const duplicateSelected = () => {
    if (saveInFlightRef.current) return;
    if (!selectedPlacement) return;
    if (track.modules.length >= CUSTOM_TRACK_MODULE_LIMIT) {
      setNotice(`The track has reached the ${CUSTOM_TRACK_MODULE_LIMIT}-module safety limit.`);
      return;
    }
    const duplicate = {
      ...selectedPlacement,
      id: crypto.randomUUID(),
      gridPosition: Math.min(CUSTOM_TRACK_ROUTE_LIMIT, selectedPlacement.gridPosition + 12),
    };
    commit((current) => ({ ...current, modules: [...current.modules, duplicate] }));
    setSelectedPlacementId(duplicate.id);
  };

  const placeSelectedAtRouteView = () => {
    if (saveInFlightRef.current) return;
    const gridPosition = Math.max(0, Math.min(
      CUSTOM_TRACK_ROUTE_LIMIT,
      Math.round(viewPosition / 2) * 2,
    ));
    const placement: CustomTrackModule = {
      id: crypto.randomUUID(),
      moduleId: selectedModuleId,
      lane: placementLane,
      gridPosition,
      rotation: 0,
      height: 0,
    };
    const placementValidation = validateCustomTrackPlacement(track, placement);
    if (!placementValidation.valid) {
      setNotice(placementValidation.errors[0] ?? "This module cannot be placed at the selected route view.");
      return;
    }
    commit((current) => ({ ...current, modules: [...current.modules, placement] }));
    setSelectedPlacementId(placement.id);
    setNotice(`${EDITOR_MODULE_BY_ID.get(selectedModuleId)?.name ?? selectedModuleId} placed in lane ${placementLane + 1} at ${gridPosition} m.`);
  };

  const requestClearTrack = () => {
    if (saveInFlightRef.current) return;
    requestConfirmation({
      title: "Clear every placed module?",
      message: "This removes every module from the current editor draft. It can be undone with the editor undo stack.",
      confirmLabel: "Clear all",
      onConfirm: () => {
        commit((current) => ({ ...current, modules: [] }));
        setSelectedPlacementId(null);
        setNotice("All placed modules were cleared. Use Undo to restore them.");
      },
    });
  };

  return (
    <main className={`editor-screen${saveInFlight ? " saving" : ""}`} aria-busy={saveInFlight}>
      <h1 className="sr-only">Track Builder — {track.name}</h1>
      <header className="editor-toolbar" inert={confirmation !== null} aria-hidden={confirmation !== null ? true : undefined}>
        <button className="editor-home" onClick={() => navigate("title")} aria-label="Back to festival menu" disabled={saveInFlight}><RallyIcon kind="back" /> <span>Track Builder</span></button>
        <input aria-label="Track name" value={track.name} maxLength={CUSTOM_TRACK_NAME_MAX_CHARS} disabled={saveInFlight} onChange={(event) => commit((current) => ({ ...current, name: event.target.value }))} />
        <button onClick={undo} disabled={saveInFlight || past.length === 0} aria-label="Undo"><RallyIcon kind="undo" /></button>
        <button onClick={redo} disabled={saveInFlight || future.length === 0} aria-label="Redo"><RallyIcon kind="redo" /></button>
        <span className="toolbar-spacer" />
        <button
          ref={libraryTriggerRef}
          disabled={saveInFlight}
          aria-haspopup="dialog"
          aria-expanded={showLibrary}
          aria-controls="local-track-library"
          onClick={() => {
            if (!showLibrary) {
              const activeElement = document.activeElement;
              libraryReturnFocusRef.current = activeElement instanceof HTMLElement
                ? activeElement
                : libraryTriggerRef.current;
            }
            setShowLibrary((value) => !value);
          }}
        >Library</button>
        <button disabled={saveInFlight} onClick={() => void save()}>{saveInFlight ? "Working…" : "Save"}</button>
        <button className="test-ride" disabled={saveInFlight} onClick={() => { void startTestRide(); }}>Test Ride</button>
        <button disabled={saveInFlight} onClick={downloadExport}>Export</button>
        <button disabled={saveInFlight} onClick={() => fileRef.current?.click()}>Import</button>
        <input ref={fileRef} hidden type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
      </header>
      <div className="editor-workspace" inert={editorControlsLocked} aria-hidden={confirmation !== null ? true : undefined}>
        <nav className="module-categories" aria-label="Module categories">
          {CATEGORIES.map((item) => (
            <button
              key={item}
              className={category === item ? "active" : ""}
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
            >
              <CategoryGlyph category={item} /><span>{item}</span>
            </button>
          ))}
        </nav>
        <aside className="module-rail" aria-label={`${category} modules`}>
          {EDITOR_MODULES.filter((module) => module.category === category).map((module) => (
            <button
              key={module.id}
              className={selectedModuleId === module.id ? "active" : ""}
              aria-pressed={selectedModuleId === module.id}
              onClick={() => setSelectedModuleId(module.id)}
            >
              <ModuleThumbnail module={module} /><strong>{module.name}</strong><small>{module.description}</small>
            </button>
          ))}
        </aside>
        <section className="editor-canvas-wrap">
          <canvas
            ref={canvasRef}
            aria-label="Interactive 3D track build camera. Click an existing module to select it, click an empty lane to place the chosen module, drag left or right to orbit, drag up or down to travel the route, use the wheel to zoom, Shift plus wheel to travel, or use Fit route to frame the complete authored course. Keyboard placement controls are available in the Placement inspector."
            aria-describedby="editor-keyboard-placement-help"
          />
          {placementPreview ? (
            <div
              className={`editor-placement-preview ${placementPreview.valid ? "valid" : "invalid"}`}
              role="status"
              aria-live="polite"
            >
              <strong>{placementPreview.valid ? "✓ Valid placement" : "! Invalid placement"}</strong>
              <span>{placementPreview.moduleName} · {placementPreview.message}</span>
            </div>
          ) : null}
          <div className="editor-route-navigation">
            <label htmlFor="editor-route-view">Route view</label>
            <input
              id="editor-route-view"
              aria-label="Route view position"
              type="range"
              min="0"
              max={CUSTOM_TRACK_ROUTE_LIMIT}
              step="1"
              value={viewPosition}
              onChange={(event) => sceneRef.current?.focusRoutePosition(Number(event.target.value))}
            />
            <button type="button" onClick={() => sceneRef.current?.frameRoute()}>Fit route</button>
            <output htmlFor="editor-route-view">
              View {viewPosition.toLocaleString()} m / {CUSTOM_TRACK_ROUTE_LIMIT.toLocaleString()} m
              {" · "}Authored {routeRange[0].toLocaleString()}–{routeRange[1].toLocaleString()} m
            </output>
          </div>
          <div className="editor-help"><kbd>Click</kbd> Select / place <kbd>Drag ↔</kbd> Orbit <kbd>Drag ↕</kbd> Travel <kbd>Wheel</kbd> Zoom <kbd>Fit route</kbd> Overview</div>
          {showLibrary ? (
            /* aria-modal promises the background is unavailable — make that true for
               pointer users too: the backdrop blocks clicks and closes the drawer. */
            <div
              className="library-drawer-backdrop"
              aria-hidden="true"
              onClick={() => { if (!saveInFlight) setShowLibrary(false); }}
            />
          ) : null}
          {showLibrary ? (
            <aside
              ref={libraryDrawerRef}
              id="local-track-library"
              className="library-drawer"
              role="dialog"
              aria-modal="true"
              aria-labelledby="local-track-library-heading"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!saveInFlight) setShowLibrary(false);
                  return;
                }
                containDialogFocus(event);
              }}
            >
              <header><h2 id="local-track-library-heading">Local tracks</h2><button aria-label="Close local track library" disabled={saveInFlight} onClick={() => setShowLibrary(false)}><RallyIcon kind="close" /></button></header>
              {recoveries.length > 0 ? (
                <section className="recovery-list" aria-label="Recovered track data">
                  <h3>! Recovered track data</h3>
                  <p>{recoveries.length} damaged track {recoveries.length === 1 ? "record is" : "records are"} preserved below. Download the portable recovery package before removing any local data.</p>
                  {recoveries.map((recovery, index) => (
                    <div className="recovery-card" key={`${recovery.key ?? "session"}-${recovery.createdAt}-${index}`}>
                      <div>
                        <strong>{recovery.name}</strong>
                        <small>{recovery.quarantined ? "Preserved in local quarantine" : "Not preserved in storage — download now"}</small>
                        <p>{recovery.reason}</p>
                      </div>
                      <button disabled={saveInFlight} onClick={() => { void downloadRecovery(recovery); }}>Download recovery package</button>
                      {recovery.key === null ? null : (
                        <button disabled={saveInFlight} onClick={() => { void removeRecovery(recovery); }}>Remove recovery record…</button>
                      )}
                    </div>
                  ))}
                </section>
              ) : null}
              {library.map((item) => (
                <article key={item.id}>
                  {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <span className="library-placeholder" />}
                  <div><strong>{item.name}</strong><small>{item.laps} laps · difficulty {item.difficultyEstimate}</small></div>
                  <button disabled={saveInFlight} onClick={() => {
                    setPast([]);
                    setFuture([]);
                    setTrack(structuredClone(item));
                    setPersistedBase(structuredClone(item));
                    setSelectedPlacementId(null);
                    focusRouteStart();
                    setShowLibrary(false);
                  }}>Open</button>
                  <button disabled={saveInFlight} aria-label={`Delete ${item.name}…`} onClick={() => { void removeSavedTrack(item); }}>Delete…</button>
                </article>
              ))}
            </aside>
          ) : null}
        </section>
        <aside className="editor-inspector">
          <h2>Placement</h2>
          <section className="inspector-group">
          <div className="keyboard-placement" role="group" aria-labelledby="editor-keyboard-placement-title">
            <strong id="editor-keyboard-placement-title">Keyboard placement</strong>
            <p id="editor-keyboard-placement-help">Choose a module, set Route view with its slider, choose a lane, then place it without using the 3D canvas.</p>
            <label>New module lane
              <select
                aria-label="New module lane"
                value={placementLane}
                onChange={(event) => setPlacementLane(Number(event.target.value) as 0 | 1 | 2 | 3)}
              >
                <option value={0}>Lane 1</option>
                <option value={1}>Lane 2</option>
                <option value={2}>Lane 3</option>
                <option value={3}>Lane 4</option>
              </select>
            </label>
            <button type="button" onClick={placeSelectedAtRouteView}>Place selected module at route view</button>
          </div>
          <label className="placement-picker">Placed module
            <select
              aria-label="Placed module"
              value={resolvedSelectedPlacementId ?? ""}
              onChange={(event) => setSelectedPlacementId(event.target.value || null)}
            >
              <option value="">Select a module…</option>
              {placedModules.map((module) => (
                <option key={module.id} value={module.id}>
                  {EDITOR_MODULE_BY_ID.get(module.moduleId)?.name ?? module.moduleId} · lane {module.lane + 1} · {module.gridPosition} m
                </option>
              ))}
            </select>
          </label>
          {selectedPlacement ? <>
            <div className="inspector-stepper" role="group" aria-label="Lane stepper">
              <span>Lane</span>
              <button type="button" aria-label="Move selected module left one lane" onClick={() => nudgeSelectedLane(-1)} disabled={selectedPlacement.lane <= 0}><StepperIcon kind="left" /></button>
              <output aria-label="Selected module lane">Lane {selectedPlacement.lane + 1}</output>
              <button type="button" aria-label="Move selected module right one lane" onClick={() => nudgeSelectedLane(1)} disabled={selectedPlacement.lane >= 3}><StepperIcon kind="right" /></button>
            </div>
            <div className="inspector-lane-map" aria-hidden="true">
              {[0, 1, 2, 3].map((lane) => (
                <span key={lane} className={selectedPlacement.lane === lane ? "active" : undefined}>{lane + 1}</span>
              ))}
            </div>
            <div className="inspector-stepper" role="group" aria-label="Rotation stepper">
              <span>Rotation</span>
              <button type="button" aria-label="Rotate selected module counterclockwise" onClick={() => rotateSelected(-90)}><StepperIcon kind="rotate-left" /></button>
              <output aria-label="Selected module rotation">{selectedPlacement.rotation}°</output>
              <button type="button" aria-label="Rotate selected module clockwise" onClick={() => rotateSelected(90)}><StepperIcon kind="rotate-right" /></button>
            </div>
            <div className="inspector-stepper" role="group" aria-label="Height stepper">
              <span>Height</span>
              <button type="button" aria-label="Lower selected module height" onClick={() => nudgeSelectedHeight(-0.5)} disabled={selectedPlacement.height <= -4}><StepperIcon kind="down" /></button>
              <output aria-label="Selected module height">{selectedPlacement.height} m</output>
              <button type="button" aria-label="Raise selected module height" onClick={() => nudgeSelectedHeight(0.5)} disabled={selectedPlacement.height >= 40}><StepperIcon kind="up" /></button>
            </div>
            <label>Lane <input type="number" min="1" max="4" value={selectedPlacement.lane + 1} onChange={(event) => updateSelected({ lane: Math.max(0, Math.min(3, Number(event.target.value) - 1)) as 0 | 1 | 2 | 3 })} /></label>
            <label>Position <input type="number" min="0" max={CUSTOM_TRACK_ROUTE_LIMIT} step="2" value={selectedPlacement.gridPosition} onChange={(event) => updateSelected({ gridPosition: Math.max(0, Math.min(CUSTOM_TRACK_ROUTE_LIMIT, Number(event.target.value))) })} /></label>
            <label>Rotation <select value={selectedPlacement.rotation} onChange={(event) => updateSelected({ rotation: Number(event.target.value) as 0 | 90 | 180 | 270 })}><option>0</option><option>90</option><option>180</option><option>270</option></select></label>
            <label>Height <input type="number" min="-4" max="40" step="0.5" value={selectedPlacement.height} onChange={(event) => updateSelected({ height: Number(event.target.value) })} /></label>
            {selectedPlacement.moduleId === "checkpoint" ? <>
              <label>Route turn <input
                type="number"
                min={ROUTE_TURN_MIN}
                max={ROUTE_TURN_MAX}
                step="0.5"
                value={selectedPlacement.routeAnchor?.lateralOffset ?? 0}
                onChange={(event) => updateSelected({
                  routeAnchor: {
                    lateralOffset: boundedNumber(event.target.value, ROUTE_TURN_MIN, ROUTE_TURN_MAX),
                    elevation: selectedPlacement.routeAnchor?.elevation ?? 0,
                  },
                })}
              /></label>
              <label>Route rise <input
                type="number"
                min={ROUTE_RISE_MIN}
                max={ROUTE_RISE_MAX}
                step="0.5"
                value={selectedPlacement.routeAnchor?.elevation ?? 0}
                onChange={(event) => updateSelected({
                  routeAnchor: {
                    lateralOffset: selectedPlacement.routeAnchor?.lateralOffset ?? 0,
                    elevation: boundedNumber(event.target.value, ROUTE_RISE_MIN, ROUTE_RISE_MAX),
                  },
                })}
              /></label>
            </> : null}
            <div className="inspector-actions"><button onClick={duplicateSelected}>Duplicate</button><button onClick={deleteSelected}>Delete</button></div>
          </> : <p className="inspector-empty">Choose a lane and use the Place button above, or click the canvas to place the selected module.</p>}
          </section>
          <h2>Race</h2>
          <section className="inspector-group">
          <div className="inspector-stepper" role="group" aria-label="Lap count stepper">
            <span>Laps</span>
            <button type="button" aria-label="Decrease laps" onClick={() => nudgeLaps(-1)} disabled={track.laps <= 1}><StepperIcon kind="left" /></button>
            <output aria-label="Track lap count">{track.laps} {track.laps === 1 ? "lap" : "laps"}</output>
            <button type="button" aria-label="Increase laps" onClick={() => nudgeLaps(1)} disabled={track.laps >= 9}><StepperIcon kind="right" /></button>
          </div>
          <label>Laps <input type="number" min="1" max="9" value={track.laps} onChange={(event) => commit((current) => ({ ...current, laps: Math.max(1, Math.min(9, Number(event.target.value))) }))} /></label>
          <label>Difficulty <input type="range" min="1" max="5" value={track.difficultyEstimate} onChange={(event) => commit((current) => ({ ...current, difficultyEstimate: Number(event.target.value) }))} /><span>{track.difficultyEstimate} / 5</span></label>
          <button className="clear-track" onClick={requestClearTrack}>Clear all…</button>
          </section>
          <section className={`validation-panel ${validation.valid ? "valid" : "invalid"}`}><h3>{validation.valid ? "✓ Route complete" : "! Route needs work"}</h3>{validation.errors.map((error) => <p key={error}>{error}</p>)}{validation.warnings.map((warning) => <p key={warning} className="warning">{warning}</p>)}</section>
        </aside>
      </div>
      <footer className="editor-status" inert={confirmation !== null} aria-hidden={confirmation !== null ? true : undefined}><strong className={validation.valid ? "status-valid" : "status-invalid"}>{validation.valid ? "✓ Route complete" : `! ${validation.errors.length} validation issue${validation.errors.length === 1 ? "" : "s"}`}</strong><span>{past.length} / 50 actions</span><span>{track.modules.length} modules</span><output aria-live="polite">{notice}</output></footer>
      {confirmation ? (
        <div className="editor-confirm-backdrop">
          <section
            className="editor-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="editor-confirm-title"
            aria-describedby="editor-confirm-message"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                cancelConfirmation();
                return;
              }
              containDialogFocus(event);
            }}
          >
            <span>Track Builder confirmation</span>
            <h2 id="editor-confirm-title">{confirmation.title}</h2>
            <p id="editor-confirm-message">{confirmation.message}</p>
            <div className="editor-confirm-actions">
              <button type="button" onClick={cancelConfirmation}>Cancel</button>
              <button
                ref={confirmationConfirmRef}
                type="button"
                className="danger"
                onClick={confirmPendingAction}
              >
                {confirmation.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
