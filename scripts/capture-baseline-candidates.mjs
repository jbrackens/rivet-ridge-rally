// Captures promotion candidates for every checked-in visual-regression baseline.
//
// Why this exists. `e2e/visual-regression.spec.ts` refuses to create or replace baselines:
// its `beforeEach` asserts on `testInfo.config.updateSnapshots` and fails the run before any
// snapshot is written. That is deliberate — baselines may only enter through the guarded
// promotion path. So the candidates have to be produced here, by the capture harness, from
// the frozen visual QA candidate.
//
// Two properties are mandatory and were established by prototype (finding R14):
//
//   * `scale: "css"`. `toHaveScreenshot()` normalises to CSS pixels while a raw
//     `page.screenshot()` defaults to device pixels. On the Pixel 7 profile that is 1082×2202
//     against a 412×839 baseline, so omitting it fails instantly on dimensions.
//   * `animations: "disabled"`, matching the spec's own screenshot options.
//
// Navigation deliberately mirrors `openFrozenRace()` in the spec rather than using the
// `__RRR_QA__.startTrack` shortcut the review-frame capture uses, so the promoted bytes come
// from the same journey the verifying test takes.

const RACE_CANVAS_LABEL = "Live 3D race on Canyon Kickoff";
const SNAPSHOT_DIR = "e2e/visual-regression.spec.ts-snapshots";

// Mirrors the projects in playwright.config.ts. `device` is resolved against Playwright's
// device registry by the caller so this module stays free of a direct playwright import.
export const BASELINE_STATES = Object.freeze([
  {
    id: "desktop-race",
    snapshotPath: `${SNAPSHOT_DIR}/race-screen-chromium-darwin.png`,
    project: "chromium",
    device: "Desktop Chrome",
    specTitle: "desktop race matches its checked-in visual baseline",
  },
  {
    id: "curved-canyon",
    snapshotPath: `${SNAPSHOT_DIR}/race-curved-course-canyon-chromium-darwin.png`,
    project: "chromium",
    device: "Desktop Chrome",
    initialPath: "/?qa-visual-freeze=1&qa-visual-distance=500",
    expectVisualDistance: "500",
    specTitle: "production Canyon bend matches its checked-in visual baseline",
  },
  {
    id: "editor",
    snapshotPath: `${SNAPSHOT_DIR}/editor-screen-chromium-darwin.png`,
    project: "chromium",
    device: "Desktop Chrome",
    surface: "editor",
    specTitle: "editor matches its checked-in visual baseline",
  },
  {
    id: "portrait-race",
    snapshotPath: `${SNAPSHOT_DIR}/race-mobile-mobile-chrome-darwin.png`,
    project: "mobile-chrome",
    device: "Pixel 7",
    requireTouchControls: true,
    specTitle: "portrait race matches its checked-in visual baseline",
  },
  {
    id: "high-contrast",
    snapshotPath: `${SNAPSHOT_DIR}/race-high-contrast-chromium-darwin.png`,
    project: "chromium",
    device: "Desktop Chrome",
    highContrast: true,
    uiScale: "1.2",
    specTitle: "high-contrast scaled HUD matches its checked-in visual baseline",
  },
]);

function fail(message) {
  throw new Error(`Baseline candidate capture failed: ${message}`);
}

// Same wait the spec performs. Without settled fonts the HUD text renders at fallback
// metrics and the promoted baseline bakes in the wrong glyphs.
async function waitForStableFonts(page) {
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('700 16px "Ridge Display"'),
      document.fonts.load('900 16px "Ridge Display"'),
    ]);
    if (
      !document.fonts.check('700 16px "Ridge Display"')
      || !document.fonts.check('900 16px "Ridge Display"')
    ) throw new Error("Bundled Ridge Display font did not load.");
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

async function waitForCanvasAttribute(page, attribute, value, timeout = 30_000) {
  await page.waitForFunction(
    ({ attr, val, label }) => {
      const canvas = Array.from(document.querySelectorAll("canvas")).find(
        (candidate) => candidate.getAttribute("aria-label") === label,
      );
      return canvas?.getAttribute(attr) === val;
    },
    { attr: attribute, val: value, label: RACE_CANVAS_LABEL },
    { timeout },
  );
}

async function openFrozenRace(page, state, baseURL) {
  // The frozen-candidate server (visual-candidate-support.mjs) accepts the index page ONLY
  // with exactly qa-visual-freeze=1 and qa-visual-distance=<integer> — nothing more, nothing
  // less — and every other path must carry no query string. A param-less URL 404s. The app
  // treats an explicit distance of 0 identically to an absent one: parseQaVisualDistance
  // returns undefined for absent, and relocate(0) equals the player's natural start.
  const target = new URL(state.initialPath ?? "/?qa-visual-freeze=1&qa-visual-distance=0", baseURL);
  const response = await page.goto(target.href, { waitUntil: "load", timeout: 60_000 });
  if (!response?.ok()) fail(`${state.id}: QA shell returned HTTP ${response?.status() ?? "unknown"}`);
  await waitForStableFonts(page);
  await page.getByRole("button", { name: "Skip training" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  if (state.highContrast) await page.getByRole("checkbox", { name: /^High contrast/ }).check();
  if (state.uiScale) await page.getByRole("slider", { name: /^UI scale/ }).fill(state.uiScale);
  await page.getByRole("button", { name: "play", exact: true }).click();
  await page.getByLabel("Quality").selectOption("high");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();

  await page.getByLabel(RACE_CANVAS_LABEL).waitFor({ state: "visible", timeout: 30_000 });
  for (const [attribute, value] of [
    ["data-visual-state", "frozen"],
    ["data-bike-asset", "ready"],
    ["data-canyon-kit-asset", "ready"],
    ["data-environment-asset", "ready"],
  ]) await waitForCanvasAttribute(page, attribute, value);
  if (state.expectVisualDistance) {
    await waitForCanvasAttribute(page, "data-visual-distance", state.expectVisualDistance);
  }
  await page.waitForFunction(
    () => document.querySelector(".game-shell")?.getAttribute("data-race-gate-phase") === "racing",
    null,
    { timeout: 30_000 },
  );
  if (state.requireTouchControls) {
    await page.getByLabel("Touch race controls").waitFor({ state: "visible", timeout: 15_000 });
  }
  await waitForStableFonts(page);
}

async function openEditor(page, state, baseURL) {
  // Same strict-server contract as openFrozenRace: the index page is served only with the
  // exact freeze/distance query pair. The params are inert on the editor surface — the shell
  // consults them only when a race starts.
  const response = await page.goto(new URL("/?qa-visual-freeze=1&qa-visual-distance=0", baseURL).href, { waitUntil: "load", timeout: 60_000 });
  if (!response?.ok()) fail(`${state.id}: QA shell returned HTTP ${response?.status() ?? "unknown"}`);
  await page.getByRole("button", { name: "Skip training" }).click();
  await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  await page.getByLabel(/Interactive 3D track build camera/).waitFor({ state: "visible", timeout: 30_000 });
  await waitForStableFonts(page);
}

/**
 * Captures every baseline promotion candidate against an already-running candidate server.
 * Returns one entry per state; the caller is responsible for recording them in a manifest.
 */
export async function captureBaselineCandidates({ browser, devices, baseURL, onCapture }) {
  const results = [];
  for (const state of BASELINE_STATES) {
    const descriptor = devices[state.device];
    if (!descriptor) fail(`${state.id}: unknown Playwright device "${state.device}"`);
    const context = await browser.newContext({ ...descriptor });
    try {
      const page = await context.newPage();
      const failures = [];
      page.on("console", (message) => {
        if (message.type() === "error") failures.push(`console: ${message.text()}`);
      });
      page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));

      if (state.surface === "editor") await openEditor(page, state, baseURL);
      else await openFrozenRace(page, state, baseURL);

      // scale: "css" and animations: "disabled" together are what make these bytes
      // comparable with what toHaveScreenshot() produces at verification time.
      const contents = await page.screenshot({ animations: "disabled", scale: "css" });
      if (failures.length > 0) fail(`${state.id}: browser reported ${failures[0]}`);
      // Recorded so promotion can reject a wrong-scale capture outright. Getting this wrong
      // is exactly the failure R14 found: a device-pixel screenshot silently promoted
      // against a CSS-pixel baseline.
      const viewport = page.viewportSize();
      if (!viewport) fail(`${state.id}: viewport size is unavailable`);
      results.push({ state, contents, viewport });
      if (onCapture) await onCapture(state, contents, viewport);
    } finally {
      await context.close();
    }
  }
  return results;
}
