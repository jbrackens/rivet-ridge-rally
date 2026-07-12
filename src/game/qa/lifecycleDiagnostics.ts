export const LIFECYCLE_RESOURCES = [
  "gameEngines",
  "editorScenes",
  "webglContexts",
  "engineRenderLoops",
  "editorRenderLoops",
  "inputListenerGroups",
  "contextLossListeners",
  "visibilityListenerGroups",
  "pausePollLoops",
  "audioContexts",
  "audioIntervals",
  "pausedAudioManagers",
] as const;

export type LifecycleResource = typeof LIFECYCLE_RESOURCES[number];

export interface LifecycleDiagnostics {
  active: Record<LifecycleResource, number>;
  started: Record<LifecycleResource, number>;
  stopped: Record<LifecycleResource, number>;
  events: {
    inputSuspensions: number;
  };
  gauges: {
    heldInputs: number;
  };
}

function emptyResourceCounts(): Record<LifecycleResource, number> {
  return {
    gameEngines: 0,
    editorScenes: 0,
    webglContexts: 0,
    engineRenderLoops: 0,
    editorRenderLoops: 0,
    inputListenerGroups: 0,
    contextLossListeners: 0,
    visibilityListenerGroups: 0,
    pausePollLoops: 0,
    audioContexts: 0,
    audioIntervals: 0,
    pausedAudioManagers: 0,
  };
}

const enabled = import.meta.env.VITE_QA_MODE === "1";
const active = emptyResourceCounts();
const started = emptyResourceCounts();
const stopped = emptyResourceCounts();
const events = { inputSuspensions: 0 };
const gauges = { heldInputs: 0 };
const diagnostics: LifecycleDiagnostics = { active, started, stopped, events, gauges };
const observedWebglContexts = new WeakSet<object>();

export function startLifecycleResource(resource: LifecycleResource): void {
  if (!enabled) return;
  active[resource] += 1;
  started[resource] += 1;
}

export function stopLifecycleResource(resource: LifecycleResource): void {
  if (!enabled) return;
  active[resource] = Math.max(0, active[resource] - 1);
  stopped[resource] += 1;
}

export function observeWebglContext(context: object): void {
  if (!enabled || observedWebglContexts.has(context)) return;
  observedWebglContexts.add(context);
  startLifecycleResource("webglContexts");
}

export function releaseWebglContext(context: object): void {
  if (!enabled || !observedWebglContexts.delete(context)) return;
  stopLifecycleResource("webglContexts");
}

export function recordInputSuspension(): void {
  if (enabled) events.inputSuspensions += 1;
}

export function setHeldInputCount(count: number): void {
  if (enabled) gauges.heldInputs = Math.max(0, count);
}

export function getLifecycleDiagnostics(): LifecycleDiagnostics {
  // QA callers cross a browser serialization boundary, which snapshots these
  // stable records without making this hot poll helper allocate wide spreads.
  return diagnostics;
}
