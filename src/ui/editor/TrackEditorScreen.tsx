import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useAppStore, type EditorSessionState } from "../../app/store";
import { EDITOR_MODULE_BY_ID, EDITOR_MODULES, type EditorModuleCategory, type EditorModuleDefinition } from "../../game/editor/modules";
import { EXAMPLE_TRACKS } from "../../game/editor/examples";
import {
  CUSTOM_TRACK_MODULE_LIMIT,
  CUSTOM_TRACK_NAME_MAX_CHARS,
  CUSTOM_TRACK_ROUTE_LIMIT,
  validateCustomTrack,
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

const HISTORY_LIMIT = 50;
const INITIAL_ROUTE_VIEW_POSITION = 62;
const ROUTE_TURN_MIN = -CUSTOM_TRACK_ROUTE_ANCHOR_LATERAL_LIMIT;
const ROUTE_TURN_MAX = CUSTOM_TRACK_ROUTE_ANCHOR_LATERAL_LIMIT;
const ROUTE_RISE_MIN = 0;
const ROUTE_RISE_MAX = CUSTOM_TRACK_ROUTE_ANCHOR_ELEVATION_LIMIT;
const NOW = () => Date.now();

function boundedNumber(value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : 0;
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
  const initialSessionRef = useRef(useAppStore.getState().editorSession);
  const navigate = useAppStore((state) => state.navigate);
  const startCustomRace = useAppStore((state) => state.startCustomRace);
  const setEditorSession = useAppStore((state) => state.setEditorSession);
  const saveTestRideTrack = useAppStore((state) => state.saveTestRideTrack);
  const clearPendingTestRideSave = useAppStore((state) => state.clearPendingTestRideSave);
  const [track, setTrack] = useState<CustomTrackData>(() => structuredClone(initialSessionRef.current?.track ?? createDraft()));
  const [past, setPast] = useState<CustomTrackData[]>(() => structuredClone(initialSessionRef.current?.past ?? []));
  const [future, setFuture] = useState<CustomTrackData[]>(() => structuredClone(initialSessionRef.current?.future ?? []));
  const [category, setCategory] = useState<EditorModuleCategory>(() => initialSessionRef.current?.category ?? "jumps");
  const [selectedModuleId, setSelectedModuleId] = useState(() => {
    const restored = initialSessionRef.current?.selectedModuleId;
    return restored && EDITOR_MODULES.some((module) => module.id === restored) ? restored : "ramp-medium";
  });
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(() => {
    const restored = initialSessionRef.current?.selectedPlacementId;
    return restored && initialSessionRef.current?.track.modules.some((module) => module.id === restored)
      ? restored
      : null;
  });
  const [library, setLibrary] = useState<CustomTrackData[]>([]);
  const [recoveries, setRecoveries] = useState<CustomTrackRecovery[]>([]);
  const [placementPreview, setPlacementPreview] = useState<EditorPlacementPreview | null>(null);
  const [viewPosition, setViewPosition] = useState(() => (
    track.modules.find((module) => module.id === selectedPlacementId)?.gridPosition
      ?? INITIAL_ROUTE_VIEW_POSITION
  ));
  const [notice, setNotice] = useState("Autosave waits for a valid route.");
  const [showLibrary, setShowLibrary] = useState(false);
  const trackRef = useRef(track);
  const selectedModuleIdRef = useRef(selectedModuleId);
  const viewPositionRef = useRef(viewPosition);
  trackRef.current = track;
  selectedModuleIdRef.current = selectedModuleId;
  viewPositionRef.current = viewPosition;
  const validation = useMemo(() => validateCustomTrack(track), [track]);
  const routeRange = useMemo(() => authoredRouteRange(track), [track]);
  const selectedPlacement = track.modules.find((module) => module.id === selectedPlacementId) ?? null;
  const placedModules = useMemo(
    () => [...track.modules].sort((left, right) => left.gridPosition - right.gridPosition || left.lane - right.lane),
    [track.modules],
  );

  useLayoutEffect(() => {
    setEditorSession({ track, past, future, category, selectedModuleId, selectedPlacementId });
  }, [category, future, past, selectedModuleId, selectedPlacementId, setEditorSession, track]);

  useLayoutEffect(() => {
    if (selectedPlacementId && !selectedPlacement) setSelectedPlacementId(null);
  }, [selectedPlacement, selectedPlacementId]);

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
    sceneRef.current?.update(trackRef.current, selectedPlacementId, selectedModuleId);
  }, [selectedModuleId, selectedPlacementId, track.modules]);

  useEffect(() => {
    if (selectedPlacement) sceneRef.current?.focusRoutePosition(selectedPlacement.gridPosition);
  }, [selectedPlacement]);

  const undo = () => {
    const previous = past.at(-1);
    if (!previous) return;
    setFuture((items) => [structuredClone(track), ...items].slice(0, HISTORY_LIMIT));
    setPast((items) => items.slice(0, -1));
    setTrack(previous);
  };

  const redo = () => {
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
    if (!validation.valid) { setNotice(validation.errors[0] ?? "Fix validation errors before saving."); return false; }
    try {
      const saved = createTrackSnapshot();
      await saveCustomTrack(saved);
      clearPendingTestRideSave(saved.id);
      setTrack(saved);
      await refreshLibrary();
      setNotice("Track saved locally.");
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The track could not be saved. Check local storage and retry.");
      return false;
    }
  };

  const downloadExport = () => {
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
    if (recovery.key === null) return;
    if (!window.confirm("Remove this preserved recovery record? Download its package first if you may need it.")) return;
    try {
      await deleteCustomTrackRecovery(recovery.key);
      await refreshLibrary();
      setNotice("Recovery record removed from this device.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The recovery record could not be removed.");
    }
  };

  const focusRouteStart = () => {
    setViewPosition(INITIAL_ROUTE_VIEW_POSITION);
    sceneRef.current?.focusRoutePosition(INITIAL_ROUTE_VIEW_POSITION);
  };

  const importFile = async (file: File) => {
    if (file.size > MAX_CUSTOM_TRACK_FILE_BYTES) {
      setNotice("Track file exceeds the 1 MB safety limit.");
      return;
    }
    try {
      const imported = importCustomTrack(await file.text());
      const suffix = " Copy";
      const copyName = `${imported.name.slice(0, CUSTOM_TRACK_NAME_MAX_CHARS - suffix.length).trimEnd()}${suffix}`;
      setPast((items) => [...items, structuredClone(track)].slice(-HISTORY_LIMIT));
      setFuture([]);
      setTrack({ ...imported, id: crypto.randomUUID(), name: copyName, createdAt: NOW(), updatedAt: NOW() });
      setSelectedPlacementId(null);
      focusRouteStart();
      setNotice("Track imported as a safe local copy.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Track import failed.");
    }
  };

  const updateSelected = (patch: Partial<CustomTrackModule>) => {
    if (!selectedPlacement) return;
    commit((current) => ({ ...current, modules: current.modules.map((module) => module.id === selectedPlacement.id ? { ...module, ...patch } : module) }));
  };

  const deleteSelected = () => {
    if (!selectedPlacementId) return;
    commit((current) => ({ ...current, modules: current.modules.filter((module) => module.id !== selectedPlacementId) }));
    setSelectedPlacementId(null);
  };

  const duplicateSelected = () => {
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

  return (
    <main className="editor-screen">
      <h1 className="sr-only">Track Builder — {track.name}</h1>
      <header className="editor-toolbar">
        <button className="editor-home" onClick={() => navigate("title")} aria-label="Back to festival menu">← <span>Track Builder</span></button>
        <input aria-label="Track name" value={track.name} maxLength={CUSTOM_TRACK_NAME_MAX_CHARS} onChange={(event) => commit((current) => ({ ...current, name: event.target.value }))} />
        <button onClick={undo} disabled={past.length === 0} aria-label="Undo">↶</button>
        <button onClick={redo} disabled={future.length === 0} aria-label="Redo">↷</button>
        <span className="toolbar-spacer" />
        <button onClick={() => setShowLibrary((value) => !value)}>Library</button>
        <button onClick={() => void save()}>Save</button>
        <button className="test-ride" onClick={() => {
          if (!validation.valid) {
            setNotice(validation.errors[0] ?? "Fix validation errors before test riding.");
            return;
          }
          const snapshot = createTrackSnapshot();
          const session: EditorSessionState = structuredClone({
            track: snapshot,
            past,
            future,
            category,
            selectedModuleId,
            selectedPlacementId,
          });
          setEditorSession(session);
          void saveTestRideTrack(snapshot).catch(() => undefined);
          startCustomRace(snapshot);
        }}>Test Ride</button>
        <button onClick={downloadExport}>Export</button>
        <button onClick={() => fileRef.current?.click()}>Import</button>
        <input ref={fileRef} hidden type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
      </header>
      <div className="editor-workspace">
        <nav className="module-categories" aria-label="Module categories">
          {CATEGORIES.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}><CategoryGlyph category={item} /><span>{item}</span></button>)}
        </nav>
        <aside className="module-rail" aria-label={`${category} modules`}>
          {EDITOR_MODULES.filter((module) => module.category === category).map((module) => <button key={module.id} className={selectedModuleId === module.id ? "active" : ""} onClick={() => setSelectedModuleId(module.id)}><ModuleThumbnail module={module} /><strong>{module.name}</strong><small>{module.description}</small></button>)}
        </aside>
        <section className="editor-canvas-wrap">
          <canvas
            ref={canvasRef}
            aria-label="Interactive 3D track build camera. Click an existing module to select it, click an empty lane to place the chosen module, drag left or right to orbit, drag up or down to travel the route, use the wheel to zoom, Shift plus wheel to travel, or use Fit route to frame the complete authored course."
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
            <aside className="library-drawer">
              <header><h2>Local tracks</h2><button aria-label="Close local track library" onClick={() => setShowLibrary(false)}>×</button></header>
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
                      <button onClick={() => { void downloadRecovery(recovery); }}>Download recovery package</button>
                      {recovery.key === null ? null : (
                        <button onClick={() => { void removeRecovery(recovery); }}>Remove recovery record…</button>
                      )}
                    </div>
                  ))}
                </section>
              ) : null}
              {library.map((item) => (
                <article key={item.id}>
                  {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <span className="library-placeholder" />}
                  <div><strong>{item.name}</strong><small>{item.laps} laps · difficulty {item.difficultyEstimate}</small></div>
                  <button onClick={() => {
                    setPast((items) => [...items, structuredClone(track)].slice(-HISTORY_LIMIT));
                    setFuture([]);
                    setTrack(structuredClone(item));
                    setSelectedPlacementId(null);
                    focusRouteStart();
                    setShowLibrary(false);
                  }}>Open</button>
                  <button aria-label={`Delete ${item.name}`} onClick={() => { void deleteCustomTrack(item.id).then(refreshLibrary).catch(() => setNotice("The local track could not be deleted.")); }}>×</button>
                </article>
              ))}
            </aside>
          ) : null}
        </section>
        <aside className="editor-inspector">
          <h2>Placement</h2>
          <section className="inspector-group">
          <label className="placement-picker">Placed module
            <select
              aria-label="Placed module"
              value={selectedPlacementId ?? ""}
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
          </> : <p className="inspector-empty">Click a placed module to inspect it, or click the canvas to place the selected module.</p>}
          </section>
          <h2>Race</h2>
          <section className="inspector-group">
          <label>Laps <input type="number" min="1" max="9" value={track.laps} onChange={(event) => commit((current) => ({ ...current, laps: Math.max(1, Math.min(9, Number(event.target.value))) }))} /></label>
          <label>Difficulty <input type="range" min="1" max="5" value={track.difficultyEstimate} onChange={(event) => commit((current) => ({ ...current, difficultyEstimate: Number(event.target.value) }))} /><span>{track.difficultyEstimate} / 5</span></label>
          <button className="clear-track" onClick={() => { if (window.confirm("Clear every placed module? This can be undone.")) { commit((current) => ({ ...current, modules: [] })); setSelectedPlacementId(null); } }}>Clear all…</button>
          </section>
          <section className={`validation-panel ${validation.valid ? "valid" : "invalid"}`}><h3>{validation.valid ? "✓ Route complete" : "! Route needs work"}</h3>{validation.errors.map((error) => <p key={error}>{error}</p>)}{validation.warnings.map((warning) => <p key={warning} className="warning">{warning}</p>)}</section>
        </aside>
      </div>
      <footer className="editor-status"><strong className={validation.valid ? "status-valid" : "status-invalid"}>{validation.valid ? "✓ Route complete" : `! ${validation.errors.length} validation issue${validation.errors.length === 1 ? "" : "s"}`}</strong><span>{past.length} / 50 actions</span><span>{track.modules.length} modules</span><output aria-live="polite">{notice}</output></footer>
    </main>
  );
}
