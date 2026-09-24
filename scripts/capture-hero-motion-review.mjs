import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { chromium } from "playwright";

const repoRoot = resolve(import.meta.dirname, "..");
const visualReviewRoot = resolve(repoRoot, "artifacts/visual-review");
const DEFAULT_BASE_URL = "http://127.0.0.1:4174/";
const DEFAULT_OUTPUT_DIRECTORY = "artifacts/visual-review/hero-motion-action-states-v3";
const DESKTOP_VIEWPORT = Object.freeze({ width: 1_280, height: 720 });
const PORTRAIT_VIEWPORT = Object.freeze({ width: 390, height: 844 });
const EXPECTED_TRACK_ID = "canyon-kickoff";
const EXPECTED_MODE = "practice";
const EXPECTED_COURSE_LENGTH = 1_260;
const FIRST_CANYON_RAMP_DISTANCE = 195;
const FIRST_CANYON_RAMP_APPROACH_DISTANCE = 186;
const FORCED_FALLBACK_ASSET_PATH = "/assets/3d/hero-bike-rider.glb";
const TOUCH_POINTERS = Object.freeze({ ride: 41, pitchUp: 42 });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArguments(argumentsList) {
  const parsed = {
    baseURL: DEFAULT_BASE_URL,
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
    headed: false,
    help: false,
    selfTest: false,
  };
  for (const argument of argumentsList) {
    if (argument === "--headed") {
      parsed.headed = true;
      continue;
    }
    if (argument === "--help") {
      parsed.help = true;
      continue;
    }
    if (argument === "--self-test") {
      parsed.selfTest = true;
      continue;
    }
    if (argument.startsWith("--base-url=")) {
      parsed.baseURL = argument.slice("--base-url=".length);
      continue;
    }
    if (argument.startsWith("--output-dir=")) {
      parsed.outputDirectory = argument.slice("--output-dir=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

function validatedConfiguration(parsed) {
  const baseURL = new URL(parsed.baseURL);
  assert(baseURL.protocol === "http:" || baseURL.protocol === "https:", (
    "--base-url must use http or https."
  ));
  assert(!baseURL.username && !baseURL.password, "--base-url must not contain credentials.");
  assert(baseURL.pathname === "/" && !baseURL.search && !baseURL.hash, (
    "--base-url must be an origin URL with a root path and no query or fragment."
  ));
  assert(
    /^artifacts\/visual-review\/[a-z0-9][a-z0-9._-]*$/u.test(parsed.outputDirectory),
    "--output-dir must be a direct child of artifacts/visual-review/.",
  );
  const outputRoot = resolve(repoRoot, parsed.outputDirectory);
  assert(dirname(outputRoot) === visualReviewRoot, (
    "--output-dir resolved outside artifacts/visual-review/."
  ));
  return {
    ...parsed,
    baseURL,
    outputRoot,
  };
}

function printHelp() {
  console.log(`Usage: node scripts/capture-hero-motion-review.mjs [options]

Captures a muted, technical action-state matrix through the public UI flow:
/ -> Skip training -> Ride -> Practice. The server must already be running.

Options:
  --base-url=URL       Root URL for an existing passive-instrumentation QA build
                       (default ${DEFAULT_BASE_URL})
  --output-dir=PATH    New direct child of artifacts/visual-review/
                       (default ${DEFAULT_OUTPUT_DIRECTORY})
  --headed             Run visible Chromium (headless is the default)
  --self-test          Run pure state-predicate/catalog checks; do not open a browser
  --help               Show this help

The QA build is used only for data-player-motion-snapshot. The harness does not
call QA APIs, alter race state, relocate the bike, freeze simulation, or inject
an action state. Existing output directories are never overwritten.`);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function isReadyKeyboard(snapshot) {
  return snapshot.asset === "ready"
    && snapshot.fallbackReason === null
    && snapshot.activeBikeName === "RRR_BikeVisual"
    && snapshot.inputDevice === "keyboard";
}

const STATE_DEFINITIONS = Object.freeze([
  {
    stateId: "neutral",
    predicate: "authored asset; grounded neutral action; stationary; normal motion; keyboard input",
    matches: (snapshot) => isReadyKeyboard(snapshot)
      && snapshot.phase === "grounded"
      && snapshot.actionState === "neutral"
      && snapshot.speed <= 0.25
      && snapshot.reducedMotion === false,
  },
  {
    stateId: "tuck",
    predicate: "authored asset; grounded tuck action at speed; normal motion; keyboard input",
    matches: (snapshot) => isReadyKeyboard(snapshot)
      && snapshot.phase === "grounded"
      && snapshot.actionState === "tuck"
      && snapshot.speed >= 8
      && snapshot.reducedMotion === false,
  },
  {
    stateId: "lean-left",
    predicate: "authored asset; grounded lean-left action and measured left steering roll",
    matches: (snapshot) => isReadyKeyboard(snapshot)
      && snapshot.phase === "grounded"
      && snapshot.actionState === "lean-left"
      && snapshot.steeringDirection === "left"
      && snapshot.steeringRoll > 0.04,
  },
  {
    stateId: "lean-right",
    predicate: "authored asset; grounded lean-right action and measured right steering roll",
    matches: (snapshot) => isReadyKeyboard(snapshot)
      && snapshot.phase === "grounded"
      && snapshot.actionState === "lean-right"
      && snapshot.steeringDirection === "right"
      && snapshot.steeringRoll < -0.04,
  },
  {
    stateId: "wheelie",
    predicate: "authored asset; grounded wheelie action with physics wheelie active and amplified presentation pitch; keyboard input",
    matches: (snapshot) => isReadyKeyboard(snapshot)
      && snapshot.phase === "grounded"
      && snapshot.actionState === "wheelie"
      && snapshot.wheelie === true
      && snapshot.pitch >= 0.28
      && snapshot.presentationPitch >= 0.36,
  },
  {
    stateId: "airborne-up",
    predicate: "authored asset; airborne-up action visibly above the ground with amplified positive presentation pitch",
    matches: (snapshot) => isReadyKeyboard(snapshot)
      && snapshot.phase === "airborne"
      && snapshot.actionState === "airborne-up"
      && snapshot.height > 0.2
      && snapshot.pitch > 0.12
      && snapshot.presentationPitch > 0.22,
  },
  {
    stateId: "airborne-down",
    predicate: "authored asset; airborne-down action visibly above the ground with amplified negative presentation pitch",
    matches: (snapshot) => isReadyKeyboard(snapshot)
      && snapshot.phase === "airborne"
      && snapshot.actionState === "airborne-down"
      && snapshot.height > 0.2
      && snapshot.pitch < -0.12
      && snapshot.presentationPitch < -0.22,
  },
  {
    stateId: "airborne-neutral",
    predicate: "authored asset; airborne-neutral action visibly above the ground with level presentation pitch",
    matches: (snapshot) => isReadyKeyboard(snapshot)
      && snapshot.phase === "airborne"
      && snapshot.actionState === "airborne-neutral"
      && snapshot.height > 0.2
      && Math.abs(snapshot.pitch) <= 0.12
      && Math.abs(snapshot.presentationPitch) <= 0.06,
  },
  {
    stateId: "landing",
    predicate: "authored asset; grounded landing action with a visible clean or rough landing compression pulse",
    matches: (snapshot) => isReadyKeyboard(snapshot)
      && snapshot.phase === "grounded"
      && snapshot.actionState === "landing"
      && (snapshot.lastLanding === "clean" || snapshot.lastLanding === "rough")
      && snapshot.landingCompression >= 0.16
      && snapshot.presentationPitch <= -0.02
      && snapshot.riderRoot.positionZ <= -0.035
      && snapshot.suspensionCompression.front > snapshot.suspensionCompression.rear * 3,
  },
  {
    stateId: "crash",
    predicate: "authored asset; stable crash action from a public-control wheelie timeout",
    matches: (snapshot) => isReadyKeyboard(snapshot)
      && snapshot.phase === "crashed"
      && snapshot.actionState === "crash"
      && snapshot.crashCause === "wheelie-timeout"
      && snapshot.recoveryProgress <= 0.01,
  },
  {
    stateId: "recovery-hold",
    predicate: "authored asset; distinct recovery-hold action while a real keyboard recovery hold is in progress",
    matches: (snapshot) => isReadyKeyboard(snapshot)
      && snapshot.phase === "crashed"
      && snapshot.actionState === "recovery-hold"
      && snapshot.crashCause === "wheelie-timeout"
      && snapshot.recoveryProgress >= 0.35
      && snapshot.recoveryProgress <= 0.75,
  },
  {
    stateId: "recovering-transition",
    predicate: "authored asset; real recovering physics phase and blended recovery action",
    matches: (snapshot) => isReadyKeyboard(snapshot)
      && snapshot.phase === "recovering"
      && snapshot.actionState === "recovery"
      && snapshot.crashCause === null
      && snapshot.recoveryProgress >= 0.35
      && snapshot.recoveryProgress <= 0.9,
  },
  {
    stateId: "reduced-motion",
    predicate: "authored asset; grounded reduced-motion action after changing the public setting",
    matches: (snapshot) => isReadyKeyboard(snapshot)
      && snapshot.phase === "grounded"
      && snapshot.actionState === "reduced-motion"
      && snapshot.reducedMotion === true,
  },
  {
    stateId: "portrait-touch-wheelie",
    predicate: "authored asset; portrait run; grounded wheelie action driven by public touch controls",
    matches: (snapshot) => snapshot.asset === "ready"
      && snapshot.fallbackReason === null
      && snapshot.activeBikeName === "RRR_BikeVisual"
      && snapshot.inputDevice === "touch"
      && snapshot.phase === "grounded"
      && snapshot.actionState === "wheelie"
      && snapshot.wheelie === true
      && snapshot.pitch >= 0.28
      && snapshot.presentationPitch >= 0.36,
  },
  {
    stateId: "forced-fallback",
    predicate: "forced authored-GLB request failure; complete procedural fallback driving in tuck",
    matches: (snapshot) => snapshot.asset === "fallback"
      && snapshot.fallbackReason === "load-failed"
      && snapshot.activeBikeName === "procedural-bike-fallback"
      && snapshot.inputDevice === "keyboard"
      && snapshot.phase === "grounded"
      && snapshot.actionState === "tuck"
      && snapshot.speed >= 8,
  },
]);

const STATE_BY_ID = new Map(STATE_DEFINITIONS.map((definition) => [
  definition.stateId,
  definition,
]));

function baseFixture() {
  return {
    asset: "ready",
    fallbackReason: null,
    trackId: EXPECTED_TRACK_ID,
    mode: EXPECTED_MODE,
    courseLength: EXPECTED_COURSE_LENGTH,
    phase: "grounded",
    speed: 0,
    pitch: 0,
    presentationPitch: 0,
    height: 0,
    verticalVelocity: 0,
    wheelie: false,
    lastLanding: null,
    crashCause: null,
    recoveryProgress: 0,
    inputDevice: "keyboard",
    steeringRoll: 0,
    steeringDirection: "none",
    reducedMotion: false,
    actionState: "neutral",
    landingCompression: 0,
    suspensionCompression: { front: 0, rear: 0 },
    riderRoot: { positionZ: 0 },
    activeBikeName: "RRR_BikeVisual",
  };
}

function fixtureForState(stateId) {
  const fixture = baseFixture();
  const variants = {
    neutral: {},
    tuck: { actionState: "tuck", speed: 12 },
    "lean-left": {
      actionState: "lean-left",
      speed: 12,
      steeringDirection: "left",
      steeringRoll: 0.17,
    },
    "lean-right": {
      actionState: "lean-right",
      speed: 12,
      steeringDirection: "right",
      steeringRoll: -0.17,
    },
    wheelie: {
      actionState: "wheelie",
      speed: 12,
      wheelie: true,
      pitch: 0.32,
      presentationPitch: 0.464,
    },
    "airborne-up": {
      actionState: "airborne-up",
      phase: "airborne",
      speed: 12,
      height: 1,
      pitch: 0.3,
      presentationPitch: 0.435,
    },
    "airborne-down": {
      actionState: "airborne-down",
      phase: "airborne",
      speed: 12,
      height: 1,
      pitch: -0.3,
      presentationPitch: -0.435,
    },
    "airborne-neutral": {
      actionState: "airborne-neutral",
      phase: "airborne",
      speed: 12,
      height: 1,
      pitch: 0,
    },
    landing: {
      actionState: "landing",
      speed: 12,
      lastLanding: "clean",
      landingCompression: 0.3,
      presentationPitch: -0.07,
      suspensionCompression: { front: 0.075, rear: 0.02 },
      riderRoot: { positionZ: -0.11 },
    },
    crash: {
      actionState: "crash",
      phase: "crashed",
      crashCause: "wheelie-timeout",
    },
    "recovery-hold": {
      actionState: "recovery-hold",
      phase: "crashed",
      crashCause: "wheelie-timeout",
      recoveryProgress: 0.5,
    },
    "recovering-transition": {
      actionState: "recovery",
      phase: "recovering",
      recoveryProgress: 0.5,
    },
    "reduced-motion": {
      actionState: "reduced-motion",
      reducedMotion: true,
    },
    "portrait-touch-wheelie": {
      actionState: "wheelie",
      speed: 12,
      wheelie: true,
      pitch: 0.32,
      presentationPitch: 0.464,
      inputDevice: "touch",
    },
    "forced-fallback": {
      asset: "fallback",
      fallbackReason: "load-failed",
      activeBikeName: "procedural-bike-fallback",
      actionState: "tuck",
      speed: 12,
    },
  };
  const variant = variants[stateId];
  assert(variant, `No self-test fixture exists for ${stateId}.`);
  return { ...fixture, ...variant };
}

function runSelfTest() {
  const stateIds = STATE_DEFINITIONS.map((definition) => definition.stateId);
  const scenarioStateIds = SCENARIOS.map((scenario) => scenario.stateId);
  assert(new Set(stateIds).size === stateIds.length, "State IDs must be unique.");
  assert(new Set(scenarioStateIds).size === scenarioStateIds.length, (
    "Scenario state IDs must be unique."
  ));
  assert(JSON.stringify(scenarioStateIds) === JSON.stringify(stateIds), (
    "Scenario order and state-predicate order must match exactly."
  ));
  assert(new Set(SCENARIOS.map((scenario) => scenario.filename)).size === SCENARIOS.length, (
    "Scenario filenames must be unique."
  ));
  for (const stateId of stateIds) {
    const fixture = fixtureForState(stateId);
    const matches = STATE_DEFINITIONS
      .filter((definition) => definition.matches(fixture))
      .map((definition) => definition.stateId);
    assert(
      matches.length === 1 && matches[0] === stateId,
      `${stateId} fixture matched [${matches.join(", ")}] instead of itself only.`,
    );
  }
  console.log(JSON.stringify({ status: "PASS", predicates: stateIds.length }, null, 2));
}

function fullCanyonPractice(snapshot) {
  return snapshot.trackId === EXPECTED_TRACK_ID
    && snapshot.mode === EXPECTED_MODE
    && snapshot.courseLength === EXPECTED_COURSE_LENGTH;
}

function positiveIntegerString(value) {
  return /^\d+$/u.test(value ?? "") && Number(value) > 0;
}

async function waitForFonts(page) {
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('700 1em "Ridge Display"'),
      document.fonts.load('900 1em "Ridge Display"'),
    ]);
    await document.fonts.ready;
    await new Promise((resolveFrame) => requestAnimationFrame(() => (
      requestAnimationFrame(resolveFrame)
    )));
  });
}

async function activateVisibleButton(locator, description) {
  await locator.waitFor({ state: "visible", timeout: 15_000 });
  try {
    await locator.dispatchEvent("click");
  } catch (error) {
    throw new Error(`Unable to activate visible public button: ${description}.`, { cause: error });
  }
}

async function readMotionSnapshot(canvas) {
  const value = await canvas.getAttribute("data-player-motion-snapshot");
  if (!value) {
    throw new Error(
      "Passive data-player-motion-snapshot is unavailable; use a QA build with passive instrumentation.",
    );
  }
  let snapshot;
  try {
    snapshot = JSON.parse(value);
  } catch (error) {
    throw new Error("Passive data-player-motion-snapshot is not valid JSON.", { cause: error });
  }
  assert(fullCanyonPractice(snapshot), (
    `Snapshot is not full Canyon Kickoff Practice (${snapshot.trackId}/${snapshot.mode}/${snapshot.courseLength}).`
  ));
  return snapshot;
}

function snapshotSummary(snapshot) {
  if (!snapshot) return null;
  return {
    actionState: snapshot.actionState,
    phase: snapshot.phase,
    forwardPosition: snapshot.forwardPosition,
    localDistance: localTrackDistance(snapshot),
    speed: snapshot.speed,
    pitch: snapshot.pitch,
    presentationPitch: snapshot.presentationPitch,
    height: snapshot.height,
    wheelie: snapshot.wheelie,
    crashCause: snapshot.crashCause,
    recoveryProgress: snapshot.recoveryProgress,
    steeringDirection: snapshot.steeringDirection,
    steeringRoll: snapshot.steeringRoll,
    landingCompression: snapshot.landingCompression,
    suspensionCompression: snapshot.suspensionCompression,
    riderRootPositionZ: snapshot.riderRoot?.positionZ,
    inputDevice: snapshot.inputDevice,
    asset: snapshot.asset,
  };
}

async function waitForMatch(run, description, matches, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    lastSnapshot = await readMotionSnapshot(run.canvas);
    if (matches(lastSnapshot)) return lastSnapshot;
    await run.page.waitForTimeout(20);
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${description}; last snapshot ${JSON.stringify(snapshotSummary(lastSnapshot))}.`,
  );
}

async function waitForState(run, stateId, timeoutMs) {
  const definition = STATE_BY_ID.get(stateId);
  assert(definition, `Unknown state ID: ${stateId}`);
  return waitForMatch(run, stateId, definition.matches, timeoutMs);
}

function localTrackDistance(snapshot) {
  const forwardPosition = Number(snapshot.forwardPosition);
  const courseLength = Number(snapshot.courseLength);
  if (!Number.isFinite(forwardPosition) || !Number.isFinite(courseLength) || courseLength <= 0) {
    return Number.NaN;
  }
  return ((forwardPosition % courseLength) + courseLength) % courseLength;
}

function monitorPage(page, startedAt) {
  const monitor = {
    initialNavigation: null,
    pageErrors: [],
    consoleErrors: [],
    failedRequests: [],
    httpErrorResponses: [],
    forcedFallbackRequests: [],
  };
  const elapsedMs = () => Date.now() - startedAt;
  page.on("pageerror", (error) => {
    monitor.pageErrors.push({
      atMs: elapsedMs(),
      name: error.name,
      message: error.message,
    });
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    monitor.consoleErrors.push({
      atMs: elapsedMs(),
      message: message.text(),
      location: message.location(),
    });
  });
  page.on("requestfailed", (request) => {
    monitor.failedRequests.push({
      atMs: elapsedMs(),
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
      errorText: request.failure()?.errorText ?? "unknown",
    });
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const request = response.request();
    monitor.httpErrorResponses.push({
      atMs: elapsedMs(),
      method: request.method(),
      resourceType: request.resourceType(),
      status: response.status(),
      statusText: response.statusText(),
      url: response.url(),
    });
  });
  return monitor;
}

function URLPath(value) {
  try {
    return new URL(value).pathname;
  } catch {
    return "";
  }
}

function classifyHealth(monitor, forcedFallback) {
  const forcedFallbackRequestFailed = monitor.failedRequests.some((entry) => (
    URLPath(entry.url) === FORCED_FALLBACK_ASSET_PATH
    && entry.errorText.includes("ERR_FAILED")
  ));
  const expectedConsoleErrors = [];
  const unexpectedConsoleErrors = [];
  for (const entry of monitor.consoleErrors) {
    const locationPath = URLPath(entry.location?.url ?? "");
    const expected = forcedFallback
      && entry.message.includes("Failed to load resource")
      && entry.message.includes("ERR_FAILED")
      && (
        locationPath === FORCED_FALLBACK_ASSET_PATH
        || (forcedFallbackRequestFailed && locationPath !== FORCED_FALLBACK_ASSET_PATH)
      );
    (expected ? expectedConsoleErrors : unexpectedConsoleErrors).push(entry);
  }

  const expectedFailedRequests = [];
  const unexpectedFailedRequests = [];
  for (const entry of monitor.failedRequests) {
    const expected = forcedFallback
      && URLPath(entry.url) === FORCED_FALLBACK_ASSET_PATH
      && entry.errorText.includes("ERR_FAILED");
    (expected ? expectedFailedRequests : unexpectedFailedRequests).push(entry);
  }

  return {
    errors: {
      pageErrors: structuredClone(monitor.pageErrors),
      consoleErrors: structuredClone(monitor.consoleErrors),
      expectedConsoleErrors,
      unexpectedConsoleErrors,
      clean: monitor.pageErrors.length === 0 && unexpectedConsoleErrors.length === 0,
    },
    network: {
      failedRequests: structuredClone(monitor.failedRequests),
      expectedFailedRequests,
      unexpectedFailedRequests,
      forcedFallbackRequests: structuredClone(monitor.forcedFallbackRequests),
      clean: unexpectedFailedRequests.length === 0,
    },
    http: {
      initialNavigation: structuredClone(monitor.initialNavigation),
      errorResponses: structuredClone(monitor.httpErrorResponses),
      clean: monitor.initialNavigation?.ok === true && monitor.httpErrorResponses.length === 0,
    },
  };
}

async function readinessEvidence(run, snapshot) {
  const currentURL = new URL(run.page.url());
  const observed = {
    url: currentURL.href,
    title: await run.page.title(),
    canvasVisible: await run.canvas.isVisible(),
    raceGatePhase: await run.page.locator(".game-shell").getAttribute("data-race-gate-phase"),
    canvasAsset: await run.canvas.getAttribute("data-bike-asset"),
    canyonKitAsset: await run.canvas.getAttribute("data-canyon-kit-asset"),
    canyonKitRootCount: await run.canvas.getAttribute("data-canyon-kit-root-count"),
    canyonKitPlacementCount: await run.canvas.getAttribute("data-canyon-kit-placement-count"),
    canyonKitMeshCount: await run.canvas.getAttribute("data-canyon-kit-mesh-count"),
    canyonKitGameplayAuthority: await run.canvas.getAttribute("data-canyon-kit-gameplay-authority"),
    canyonKitProceduralReplacementCount: await run.canvas.getAttribute(
      "data-canyon-kit-procedural-replacement-count",
    ),
    canyonKitReplacedProceduralVisualCount: await run.canvas.getAttribute(
      "data-canyon-kit-replaced-procedural-visual-count",
    ),
    canyonKitRetainedCoolingCueCount: await run.canvas.getAttribute(
      "data-canyon-kit-retained-cooling-cue-count",
    ),
    canyonKitCoolingGateStyle: await run.canvas.getAttribute("data-canyon-kit-cooling-gate-style"),
    canyonKitCoolingGateArchCount: await run.canvas.getAttribute(
      "data-canyon-kit-cooling-gate-arch-count",
    ),
    canyonKitTabletopRole: await run.canvas.getAttribute("data-canyon-kit-tabletop-role"),
    environmentAsset: await run.canvas.getAttribute("data-environment-asset"),
    environmentFallbackReason: await run.canvas.getAttribute("data-environment-fallback-reason"),
    environmentWidth: await run.canvas.getAttribute("data-environment-width"),
    environmentHeight: await run.canvas.getAttribute("data-environment-height"),
    pbrEnvironment: await run.canvas.getAttribute("data-pbr-environment"),
    heroBikeMaterialResponse: await run.canvas.getAttribute("data-hero-bike-material-response"),
    heroBikeShadowStyle: await run.canvas.getAttribute("data-hero-bike-shadow-style"),
    groundedDustStyle: await run.canvas.getAttribute("data-grounded-dust-style"),
    groundedDustBurstCount: await run.canvas.getAttribute("data-grounded-dust-burst-count"),
    trackId: snapshot.trackId,
    mode: snapshot.mode,
    courseLength: snapshot.courseLength,
    passiveMotionSnapshot: Boolean(await run.canvas.getAttribute("data-player-motion-snapshot")),
  };
  const checks = {
    sameOrigin: currentURL.origin === run.configuration.baseURL.origin,
    rootPath: currentURL.pathname === "/",
    emptyQuery: currentURL.search === "",
    emptyFragment: currentURL.hash === "",
    expectedTitle: observed.title === "Rivet Ridge Rally",
    initialNavigationOk: run.monitor.initialNavigation?.ok === true,
    canvasVisible: observed.canvasVisible,
    raceGateRacing: observed.raceGatePhase === "racing",
    expectedAsset: observed.canvasAsset === run.scenario.expectedAsset,
    authoredCanyonKitReady: observed.canyonKitAsset === "ready",
    canyonKitContract: observed.canyonKitRootCount === "11"
      && positiveIntegerString(observed.canyonKitPlacementCount)
      && positiveIntegerString(observed.canyonKitMeshCount)
      && observed.canyonKitGameplayAuthority === "presentation-only"
      && observed.canyonKitProceduralReplacementCount === "8"
      && observed.canyonKitReplacedProceduralVisualCount === "18"
      && observed.canyonKitRetainedCoolingCueCount === "12"
      && observed.canyonKitCoolingGateStyle === "per-lane-open-arch"
      && observed.canyonKitCoolingGateArchCount === "12"
      && observed.canyonKitTabletopRole === "gameplay-ramp-shell",
    authoredEnvironmentReady: observed.environmentAsset === "ready"
      && observed.environmentFallbackReason === null
      && positiveIntegerString(observed.environmentWidth)
      && positiveIntegerString(observed.environmentHeight),
    pmremHeroMaterialResponse: run.scenario.expectedAsset === "ready"
      ? observed.pbrEnvironment === "pmrem"
        && observed.heroBikeMaterialResponse === "pmrem-three-point"
      : observed.canvasAsset === "fallback",
    expectedHeroShadowStyle: run.scenario.expectedAsset === "ready"
      ? observed.heroBikeShadowStyle === "pcf-contact"
        || observed.heroBikeShadowStyle === "pcf-disabled-low"
      : observed.canvasAsset === "fallback",
    groundedDustContract: observed.groundedDustStyle === "trail-burst-contact"
      && /^\d+$/u.test(observed.groundedDustBurstCount ?? ""),
    passiveMotionSnapshot: observed.passiveMotionSnapshot,
    fullCanyonKickoffPractice: fullCanyonPractice(snapshot),
    expectedFallbackRequestObserved: !run.scenario.forcedFallback
      || run.monitor.forcedFallbackRequests.length > 0,
  };
  return {
    observed,
    checks,
    pass: Object.values(checks).every(Boolean),
  };
}

async function openPublicPractice(context, configuration, scenario, attempt) {
  const startedAt = Date.now();
  const page = await context.newPage();
  const monitor = monitorPage(page, startedAt);
  if (scenario.forcedFallback) {
    await context.route("**/assets/3d/hero-bike-rider.glb", async (route) => {
      const request = route.request();
      monitor.forcedFallbackRequests.push({
        atMs: Date.now() - startedAt,
        method: request.method(),
        url: request.url(),
      });
      await route.abort("failed");
    });
  }

  const response = await page.goto(configuration.baseURL.href, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  monitor.initialNavigation = response
    ? {
        ok: response.ok(),
        status: response.status(),
        statusText: response.statusText(),
        url: response.url(),
      }
    : { ok: false, status: null, statusText: "No navigation response", url: page.url() };
  assert(response?.ok(), `Root shell returned HTTP ${response?.status() ?? "unknown"}.`);

  const skipTraining = page.getByRole("button", { name: /skip training/i });
  await activateVisibleButton(skipTraining, "Skip training");
  await activateVisibleButton(page.getByRole("button", { name: /^ride$/i }), "Ride");
  await activateVisibleButton(page.getByRole("button", { name: /practice/i }), "Practice");

  const canvas = page.getByLabel("Live 3D race on Canyon Kickoff");
  await canvas.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction((expectedAsset) => {
    const raceCanvas = document.querySelector(".game-canvas");
    const shell = document.querySelector(".game-shell");
    return raceCanvas?.getAttribute("data-bike-asset") === expectedAsset
      && raceCanvas?.getAttribute("data-canyon-kit-asset") === "ready"
      && raceCanvas?.getAttribute("data-environment-asset") === "ready"
      && shell?.getAttribute("data-race-gate-phase") === "racing";
  }, scenario.expectedAsset, { timeout: 30_000 });
  try {
    await page.waitForFunction(() => Boolean(
      document.querySelector(".game-canvas")?.getAttribute("data-player-motion-snapshot"),
    ), undefined, { timeout: 8_000 });
  } catch (error) {
    throw new Error(
      "Race loaded, but passive data-player-motion-snapshot never appeared. Use a passive-instrumentation QA build.",
      { cause: error },
    );
  }
  await waitForFonts(page);
  const initialSnapshot = await readMotionSnapshot(canvas);
  assert(initialSnapshot.asset === scenario.expectedAsset, (
    `Expected ${scenario.expectedAsset} hero asset, observed ${initialSnapshot.asset}.`
  ));

  return {
    attempt,
    canvas,
    configuration,
    context,
    initialSnapshot,
    monitor,
    page,
    scenario,
    startedAt,
  };
}

async function driveWithKeyboard(run, minimumSpeed = 8) {
  await run.canvas.focus();
  await run.page.keyboard.down("w");
  await waitForMatch(
    run,
    `keyboard speed >= ${minimumSpeed}`,
    (snapshot) => snapshot.phase === "grounded" && snapshot.speed >= minimumSpeed,
    20_000,
  );
}

async function createStableWheelieCrash(run) {
  await driveWithKeyboard(run, 6);
  await run.page.keyboard.down("ArrowUp");
  await waitForMatch(
    run,
    "public-control wheelie-timeout crash",
    (snapshot) => snapshot.phase === "crashed" && snapshot.crashCause === "wheelie-timeout",
    6_000,
  );
  await run.page.keyboard.up("ArrowUp");
  await run.page.keyboard.up("w");
  await waitForMatch(
    run,
    "stable crashed state before recovery",
    (snapshot) => snapshot.phase === "crashed" && snapshot.recoveryProgress <= 0.01,
    2_000,
  );
}

async function dispatchTouch(page, control, eventName, pointerId, isPrimary) {
  const button = page.locator(`button[data-control="${control}"]`);
  await button.waitFor({ state: "visible", timeout: 10_000 });
  await button.dispatchEvent(eventName, {
    pointerId,
    pointerType: "touch",
    isPrimary,
  });
}

async function releaseInputs(page) {
  if (!page || page.isClosed()) return;
  for (const key of [
    "w",
    "Space",
    "Shift",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
  ]) {
    await page.keyboard.up(key).catch(() => undefined);
  }
  if (await page.locator('button[data-control="pitch-up"]').isVisible().catch(() => false)) {
    await dispatchTouch(page, "pitch-up", "pointerup", TOUCH_POINTERS.pitchUp, false)
      .catch(() => undefined);
  }
  if (await page.locator('button[data-control="ride"]').isVisible().catch(() => false)) {
    await dispatchTouch(page, "ride", "pointerup", TOUCH_POINTERS.ride, true)
      .catch(() => undefined);
  }
}

async function prepareNeutral(run) {
  await run.page.locator(".race-start-gate").waitFor({ state: "hidden", timeout: 5_000 });
}

async function prepareTuck(run) {
  await driveWithKeyboard(run, 8);
}

async function prepareLean(run, key) {
  await driveWithKeyboard(run, 10);

  const stagingKey = key === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
  const stagingLane = key === "ArrowLeft" ? 3 : 0;
  const stagingPosition = key === "ArrowLeft" ? 4.5 : -4.5;
  const stagingPresses = key === "ArrowLeft" ? 2 : 1;
  for (let index = 0; index < stagingPresses; index += 1) {
    await run.page.keyboard.press(stagingKey, { delay: 24 });
    await run.page.waitForTimeout(45);
  }
  await waitForMatch(
    run,
    `settled staging lane ${stagingLane}`,
    (snapshot) => snapshot.phase === "grounded"
      && snapshot.lane === stagingLane
      && Math.abs(snapshot.lanePosition - stagingPosition) <= 0.05,
    2_000,
  );

  // Queue a two-lane public move so the measured lean remains active for the
  // complete before/screenshot/after evidence window.
  await run.page.keyboard.press(key, { delay: 24 });
  await run.page.waitForTimeout(45);
  await run.page.keyboard.down(key);
}

async function prepareWheelie(run) {
  await driveWithKeyboard(run, 6);
  await run.page.keyboard.down("ArrowUp");
}

async function prepareAirborne(run, pitchKey = null) {
  await driveWithKeyboard(run, 8);
  const approachSnapshot = await waitForMatch(
    run,
    "first public Canyon Kickoff ramp sector",
    (snapshot) => {
      const localDistance = localTrackDistance(snapshot);
      return (snapshot.phase === "airborne" && snapshot.height > 0.01)
        || (
          snapshot.phase === "grounded"
          && snapshot.speed >= 8
          && localDistance >= FIRST_CANYON_RAMP_APPROACH_DISTANCE
          && localDistance < FIRST_CANYON_RAMP_DISTANCE + 35
        );
    },
    180_000,
  );
  if (pitchKey && approachSnapshot.phase === "grounded") await run.page.keyboard.down(pitchKey);
  await waitForMatch(
    run,
    "first public Canyon Kickoff ramp launch",
    (snapshot) => snapshot.phase === "airborne" && snapshot.height > 0.01,
    30_000,
  );
}

async function prepareLanding(run) {
  await driveWithKeyboard(run, 8);
  await waitForMatch(
    run,
    "first public Canyon Kickoff ramp launch before landing capture",
    (snapshot) => snapshot.phase === "airborne" && snapshot.height > 0.01,
    180_000,
  );
}

async function prepareCrash(run) {
  await createStableWheelieCrash(run);
}

async function prepareRecoveryHold(run) {
  await createStableWheelieCrash(run);
  await run.page.keyboard.down("Space");
}

async function prepareRecoveringTransition(run) {
  await createStableWheelieCrash(run);
  await run.page.keyboard.down("Space");
  await waitForMatch(
    run,
    "mid-recovery transition",
    (snapshot) => snapshot.phase === "recovering"
      && snapshot.actionState === "recovery"
      && snapshot.recoveryProgress >= 0.35
      && snapshot.recoveryProgress <= 0.9,
    3_000,
  );
  await run.page.locator(".recover-prompt").waitFor({ state: "hidden", timeout: 1_000 });
  await run.page.keyboard.up("Space");
}

async function prepareReducedMotion(run) {
  await run.page.keyboard.press("Escape");
  const pauseDialog = run.page.getByRole("dialog", { name: "Race paused" });
  await pauseDialog.waitFor({ state: "visible", timeout: 5_000 });
  await pauseDialog.getByRole("button", { name: "Settings", exact: true }).click();
  const reducedMotion = run.page.getByRole("checkbox", { name: /^Reduced motion/ });
  if (!await reducedMotion.isChecked()) await reducedMotion.check();
  await run.page.getByRole("button", { name: "Done", exact: true }).click();
  await pauseDialog.getByRole("button", { name: "Resume", exact: true }).click();
}

async function preparePortraitTouchWheelie(run) {
  await dispatchTouch(run.page, "ride", "pointerdown", TOUCH_POINTERS.ride, true);
  await waitForMatch(
    run,
    "portrait touch speed >= 6",
    (snapshot) => snapshot.phase === "grounded"
      && snapshot.inputDevice === "touch"
      && snapshot.speed >= 6,
    12_000,
  );
  await dispatchTouch(run.page, "pitch-up", "pointerdown", TOUCH_POINTERS.pitchUp, false);
}

async function prepareFallback(run) {
  await driveWithKeyboard(run, 8);
}

const SCENARIOS = Object.freeze([
  {
    stateId: "neutral",
    filename: "01-neutral-desktop-1280x720.png",
    viewport: DESKTOP_VIEWPORT,
    interactionMethod: "public-ui-keyboard-none",
    expectedAsset: "ready",
    maxAttempts: 1,
    stateTimeoutMs: 5_000,
    prepare: prepareNeutral,
    notes: "Fresh full-length Canyon Kickoff Practice run before rider input.",
  },
  {
    stateId: "tuck",
    filename: "02-tuck-desktop-1280x720.png",
    viewport: DESKTOP_VIEWPORT,
    interactionMethod: "public-ui-keyboard-w-hold",
    expectedAsset: "ready",
    maxAttempts: 2,
    stateTimeoutMs: 8_000,
    prepare: prepareTuck,
    notes: "Grounded speed tuck reached by holding Ride on the keyboard.",
  },
  {
    stateId: "lean-left",
    filename: "03-lean-left-desktop-1280x720.png",
    viewport: DESKTOP_VIEWPORT,
    interactionMethod: "public-ui-keyboard-arrow-left",
    expectedAsset: "ready",
    maxAttempts: 3,
    stateTimeoutMs: 3_000,
    prepare: (run) => prepareLean(run, "ArrowLeft"),
    notes: "Transient left lane-change lean reached with ArrowLeft while riding.",
  },
  {
    stateId: "lean-right",
    filename: "04-lean-right-desktop-1280x720.png",
    viewport: DESKTOP_VIEWPORT,
    interactionMethod: "public-ui-keyboard-arrow-right",
    expectedAsset: "ready",
    maxAttempts: 3,
    stateTimeoutMs: 3_000,
    prepare: (run) => prepareLean(run, "ArrowRight"),
    notes: "Transient right lane-change lean reached with ArrowRight while riding.",
  },
  {
    stateId: "wheelie",
    filename: "05-wheelie-desktop-1280x720.png",
    viewport: DESKTOP_VIEWPORT,
    interactionMethod: "public-ui-keyboard-w-arrow-up-hold",
    expectedAsset: "ready",
    maxAttempts: 2,
    stateTimeoutMs: 4_000,
    prepare: prepareWheelie,
    notes: "Grounded wheelie reached by holding ArrowUp at usable speed.",
  },
  {
    stateId: "airborne-up",
    filename: "06-airborne-up-desktop-1280x720.png",
    viewport: DESKTOP_VIEWPORT,
    interactionMethod: "public-ui-first-ramp-arrow-up",
    expectedAsset: "ready",
    maxAttempts: 2,
    stateTimeoutMs: 5_000,
    prepare: (run) => prepareAirborne(run, "ArrowUp"),
    notes: "Positive airborne pitch reached from the first real Canyon Kickoff ramp.",
  },
  {
    stateId: "airborne-down",
    filename: "07-airborne-down-desktop-1280x720.png",
    viewport: DESKTOP_VIEWPORT,
    interactionMethod: "public-ui-first-ramp-arrow-down",
    expectedAsset: "ready",
    maxAttempts: 2,
    stateTimeoutMs: 5_000,
    prepare: (run) => prepareAirborne(run, "ArrowDown"),
    notes: "Negative airborne pitch reached from the first real Canyon Kickoff ramp.",
  },
  {
    stateId: "airborne-neutral",
    filename: "08-airborne-neutral-desktop-1280x720.png",
    viewport: DESKTOP_VIEWPORT,
    interactionMethod: "public-ui-first-ramp-no-pitch",
    expectedAsset: "ready",
    maxAttempts: 2,
    stateTimeoutMs: 5_000,
    prepare: (run) => prepareAirborne(run),
    notes: "Level airborne pose reached from the first real Canyon Kickoff ramp without pitch input.",
  },
  {
    stateId: "landing",
    filename: "09-landing-desktop-1280x720.png",
    viewport: DESKTOP_VIEWPORT,
    interactionMethod: "public-ui-first-ramp-clean-landing",
    expectedAsset: "ready",
    maxAttempts: 4,
    stateTimeoutMs: 38_000,
    prepare: prepareLanding,
    notes: "Presentation landing pulse reached after a real first-ramp landing.",
  },
  {
    stateId: "crash",
    filename: "10-crash-desktop-1280x720.png",
    viewport: DESKTOP_VIEWPORT,
    interactionMethod: "public-ui-keyboard-wheelie-timeout",
    expectedAsset: "ready",
    maxAttempts: 2,
    stateTimeoutMs: 3_000,
    prepare: prepareCrash,
    notes: "Stable crash pose reached through the public wheelie timeout rule.",
  },
  {
    stateId: "recovery-hold",
    filename: "11-recovery-hold-desktop-1280x720.png",
    viewport: DESKTOP_VIEWPORT,
    interactionMethod: "public-ui-keyboard-space-recover-hold",
    expectedAsset: "ready",
    maxAttempts: 4,
    stateTimeoutMs: 2_000,
    prepare: prepareRecoveryHold,
    notes: "Recovery meter in progress while the public Recover binding is held.",
  },
  {
    stateId: "recovering-transition",
    filename: "12-recovering-transition-desktop-1280x720.png",
    viewport: DESKTOP_VIEWPORT,
    interactionMethod: "public-ui-keyboard-completed-space-recover-hold",
    expectedAsset: "ready",
    maxAttempts: 4,
    stateTimeoutMs: 1_000,
    prepare: prepareRecoveringTransition,
    notes: "Automatic recovering transition after a completed public Recover hold.",
  },
  {
    stateId: "reduced-motion",
    filename: "13-reduced-motion-desktop-1280x720.png",
    viewport: DESKTOP_VIEWPORT,
    interactionMethod: "public-ui-pause-settings-reduced-motion",
    expectedAsset: "ready",
    maxAttempts: 2,
    stateTimeoutMs: 3_000,
    prepare: prepareReducedMotion,
    notes: "Reduced Motion enabled through the visible pause/settings flow.",
  },
  {
    stateId: "portrait-touch-wheelie",
    filename: "14-portrait-touch-wheelie-390x844.png",
    viewport: PORTRAIT_VIEWPORT,
    hasTouch: true,
    interactionMethod: "public-ui-touch-ride-pitch-up-hold",
    expectedAsset: "ready",
    maxAttempts: 3,
    stateTimeoutMs: 4_000,
    prepare: preparePortraitTouchWheelie,
    notes: "Portrait wheelie reached with the visible Ride and pitch-up touch buttons.",
  },
  {
    stateId: "forced-fallback",
    filename: "15-forced-fallback-desktop-1280x720.png",
    viewport: DESKTOP_VIEWPORT,
    interactionMethod: "public-ui-keyboard-with-forced-glb-request-failure",
    expectedAsset: "fallback",
    forcedFallback: true,
    maxAttempts: 2,
    stateTimeoutMs: 8_000,
    prepare: prepareFallback,
    notes: "Procedural fallback after only the authored hero GLB request is deliberately failed.",
  },
]);

async function captureVerifiedState(run) {
  const definition = STATE_BY_ID.get(run.scenario.stateId);
  assert(definition, `Unknown state ID: ${run.scenario.stateId}`);

  const before = await readMotionSnapshot(run.canvas);
  assert(definition.matches(before), (
    `${run.scenario.stateId} predicate failed immediately before screenshot: ${JSON.stringify(snapshotSummary(before))}.`
  ));
  const contents = await run.page.screenshot({
    animations: "disabled",
    caret: "hide",
    scale: "css",
    timeout: 10_000,
  });
  const after = await readMotionSnapshot(run.canvas);
  assert(definition.matches(after), (
    `${run.scenario.stateId} predicate failed immediately after screenshot: ${JSON.stringify(snapshotSummary(after))}.`
  ));
  await run.page.waitForTimeout(50);

  const readiness = await readinessEvidence(run, after);
  const classified = classifyHealth(run.monitor, Boolean(run.scenario.forcedFallback));
  const expectedFallbackEvidence = !run.scenario.forcedFallback || (
    run.monitor.forcedFallbackRequests.length > 0
    && classified.network.expectedFailedRequests.length > 0
    && after.asset === "fallback"
    && after.fallbackReason === "load-failed"
  );
  const clean = readiness.pass
    && classified.errors.clean
    && classified.network.clean
    && classified.http.clean
    && expectedFallbackEvidence;
  const health = {
    readiness,
    ...classified,
    expectedFallbackEvidence,
    clean,
  };
  assert(clean, `${run.scenario.stateId} capture health was not clean.`);

  return {
    contents,
    record: {
      stateId: run.scenario.stateId,
      predicate: definition.predicate,
      predicateVerifiedBeforeAndAfter: true,
      file: `${run.configuration.outputDirectory}/${run.scenario.filename}`,
      bytes: contents.byteLength,
      sha256: sha256(contents),
      viewport: run.scenario.viewport,
      interactionMethod: run.scenario.interactionMethod,
      independentPublicRun: true,
      attempt: run.attempt,
      durationMs: Date.now() - run.startedAt,
      notes: run.scenario.notes,
      before,
      after,
      health,
    },
  };
}

async function captureScenario(browser, configuration, scenario, attemptDiagnostics) {
  const definition = STATE_BY_ID.get(scenario.stateId);
  assert(definition, `Scenario uses unknown state ID: ${scenario.stateId}`);
  for (let attempt = 1; attempt <= scenario.maxAttempts; attempt += 1) {
    console.log(JSON.stringify({
      event: "capture-attempt-start",
      stateId: scenario.stateId,
      attempt,
      maxAttempts: scenario.maxAttempts,
    }));
    const attemptStartedAt = Date.now();
    const context = await browser.newContext({
      viewport: scenario.viewport,
      deviceScaleFactor: 1,
      hasTouch: Boolean(scenario.hasTouch),
      serviceWorkers: "block",
      reducedMotion: "no-preference",
    });
    let run = null;
    try {
      run = await openPublicPractice(context, configuration, scenario, attempt);
      await scenario.prepare(run);
      await waitForState(run, scenario.stateId, scenario.stateTimeoutMs);
      const capture = await captureVerifiedState(run);
      await writeFile(
        resolve(configuration.outputRoot, scenario.filename),
        capture.contents,
        { flag: "wx" },
      );
      console.log(JSON.stringify({
        event: "capture-attempt-pass",
        stateId: scenario.stateId,
        attempt,
        durationMs: Date.now() - attemptStartedAt,
      }));
      return capture.record;
    } catch (error) {
      console.log(JSON.stringify({
        event: "capture-attempt-fail",
        stateId: scenario.stateId,
        attempt,
        durationMs: Date.now() - attemptStartedAt,
        message: error instanceof Error ? error.message : String(error),
      }));
      attemptDiagnostics.push({
        stateId: scenario.stateId,
        attempt,
        durationMs: Date.now() - attemptStartedAt,
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
        },
      });
      if (attempt === scenario.maxAttempts) throw error;
    } finally {
      await releaseInputs(run?.page).catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  }
  throw new Error(`${scenario.stateId} exhausted its capture attempts.`);
}

function errorEvidence(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack ?? null : null,
  };
}

async function runCapture(configuration) {
  await mkdir(configuration.outputRoot, { recursive: false });
  const captures = [];
  const attemptDiagnostics = [];
  let browser;
  let runFailure = null;

  try {
    browser = await chromium.launch({
      headless: !configuration.headed,
      args: [
        "--mute-audio",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--disable-features=CalculateNativeWinOcclusion",
      ],
    });
    for (const scenario of SCENARIOS) {
      captures.push(await captureScenario(
        browser,
        configuration,
        scenario,
        attemptDiagnostics,
      ));
    }
  } catch (error) {
    runFailure = errorEvidence(error);
  } finally {
    await browser?.close().catch(() => undefined);
  }

  const requiredStateIds = STATE_DEFINITIONS.map((definition) => definition.stateId);
  const capturedStateIds = captures.map((capture) => capture.stateId);
  const capturedSet = new Set(capturedStateIds);
  const missingStateIds = requiredStateIds.filter((stateId) => !capturedSet.has(stateId));
  const duplicateStateIds = capturedStateIds.filter((stateId, index) => (
    capturedStateIds.indexOf(stateId) !== index
  ));
  const beforeAfterPredicateVerified = captures.length > 0
    && captures.every((capture) => capture.predicateVerifiedBeforeAndAfter === true);
  const cleanCaptureHealth = captures.length > 0
    && captures.every((capture) => capture.health.clean === true);
  const technicalStatus = runFailure === null
    && missingStateIds.length === 0
    && duplicateStateIds.length === 0
    && beforeAfterPredicateVerified
    && cleanCaptureHealth
    ? "PASS"
    : "FAIL";

  const evidence = {
    format: 3,
    kind: "hero-motion-visual-review",
    status: technicalStatus,
    capturedAt: new Date().toISOString(),
    baseURL: configuration.baseURL.origin,
    entryURL: configuration.baseURL.href,
    browser: {
      engine: "chromium",
      headed: configuration.headed,
      audioMutedByBrowserFlag: true,
      serviceWorkers: "blocked",
    },
    flow: {
      method: "public-ui-only",
      steps: ["/", "Skip training", "Ride", "Practice"],
      activation: "Visible public buttons activated with browser click events; no game state injection.",
      routeQuery: "",
      trackId: EXPECTED_TRACK_ID,
      mode: EXPECTED_MODE,
      courseLength: EXPECTED_COURSE_LENGTH,
      independentPublicRunPerCapture: true,
      qaBuildUsage: "passive data-player-motion-snapshot only",
    },
    stateInjection: false,
    networkFaultInjection: {
      used: true,
      scope: FORCED_FALLBACK_ASSET_PATH,
      purpose: "Exercise the required procedural fallback capture only",
    },
    technicalStateCoverage: {
      status: technicalStatus,
      requiredStateIds,
      capturedStateIds,
      missingStateIds,
      duplicateStateIds,
      predicateVerifiedImmediatelyBeforeAndAfterEveryScreenshot: beforeAfterPredicateVerified,
      cleanCaptureHealth,
      requiredStateCount: SCENARIOS.length,
      capturedStateCount: captures.length,
      failedAttemptCount: attemptDiagnostics.length,
    },
    visualAcceptance: "PENDING_OWNER_REVIEW",
    baselinePromoted: false,
    conceptFidelityClaimed: false,
    note: "Technical dirty-working-tree action-state evidence only; not owner visual acceptance, concept-fidelity approval, an immutable release, or a promoted baseline.",
    runFailure,
    attemptDiagnostics,
    captures,
  };
  await writeFile(
    resolve(configuration.outputRoot, "manifest.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { flag: "wx" },
  );
  console.log(JSON.stringify({
    status: technicalStatus,
    outputDirectory: configuration.outputDirectory,
    captures: captures.length,
    missingStateIds,
    visualAcceptance: evidence.visualAcceptance,
    baselinePromoted: evidence.baselinePromoted,
    stateInjection: evidence.stateInjection,
  }, null, 2));
  if (technicalStatus !== "PASS") process.exitCode = 1;
}

const parsedArguments = parseArguments(process.argv.slice(2));
if (parsedArguments.help) {
  printHelp();
} else if (parsedArguments.selfTest) {
  runSelfTest();
} else {
  await runCapture(validatedConfiguration(parsedArguments));
}
