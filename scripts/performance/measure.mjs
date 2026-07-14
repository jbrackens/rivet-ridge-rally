import { mkdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import process from "node:process";
import { chromium } from "playwright";

import {
  DEFAULT_BASE_URL,
  REPO_ROOT,
  assertServer,
  builtAssetEvidence,
  collectPageMessages,
  createPerformanceSession,
  finishQaRace,
  hasFlag,
  heapEvidence,
  measureEditor,
  measureRestart,
  navigationEvidence,
  nodePerformance,
  openShell,
  readOption,
  readPositiveNumber,
  renderingEvidence,
  resourceEvidence,
  returnToTitleFromRace,
  startQaRace,
  writeJson,
} from "./common.mjs";

const argumentsList = process.argv.slice(2);

if (hasFlag(argumentsList, "help")) {
  console.log(`Usage: npm run perf:measure -- [options]\n\nOptions:\n  --base-url URL          QA preview URL (default ${DEFAULT_BASE_URL})\n  --output PATH           JSON output relative to the repository\n  --sample-seconds N      Rendering sample duration per viewport (default 5)\n  --screenshots-dir PATH  Optional screenshot directory\n  --headed                Run a visible Chromium window for hardware evidence\n  --help                   Show this help`);
  process.exit(0);
}

const baseURL = readOption(argumentsList, "base-url", process.env.PERF_BASE_URL ?? DEFAULT_BASE_URL);
const output = readOption(argumentsList, "output", "artifacts/performance/latest-measurement.json");
const sampleSeconds = readPositiveNumber(argumentsList, "sample-seconds", 5);
const screenshotsOption = readOption(argumentsList, "screenshots-dir", "");
const screenshotsDirectory = screenshotsOption ? resolve(REPO_ROOT, screenshotsOption) : null;
const headed = hasFlag(argumentsList, "headed");
const measurementStartedAt = nodePerformance.now();

await assertServer(baseURL);
if (screenshotsDirectory) await mkdir(screenshotsDirectory, { recursive: true });

const browser = await chromium.launch({
  headless: !headed,
  args: ["--enable-precise-memory-info"],
});

const profiles = [
  {
    name: "desktop-1920x1080",
    context: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
  },
  {
    name: "mobile-390x844",
    context: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  },
];

const evidence = {
  schemaVersion: 1,
  kind: "performance-measurement",
  createdAt: new Date().toISOString(),
  baseURL,
  browser: { name: "chromium", version: browser.version(), headless: !headed },
  host: { node: process.version, platform: process.platform, architecture: process.arch },
  configuration: { sampleSeconds, qaModeRequired: true },
  builtAssets: await builtAssetEvidence(),
  profiles: [],
};

try {
  for (const profile of profiles) {
    const context = await browser.newContext(profile.context);
    const page = await context.newPage();
    const messages = collectPageMessages(page);
    const session = await createPerformanceSession(context, page);
    const profileEvidence = {
      name: profile.name,
      viewport: profile.context.viewport,
      deviceScaleFactor: profile.context.deviceScaleFactor,
      navigation: null,
      firstRaceLoadMs: null,
      restartMs: null,
      editor: null,
      rendering: null,
      stress: null,
      heaps: [],
      network: {},
      consoleMessages: messages,
      screenshot: null,
    };

    profileEvidence.navigation = {
      ...await openShell(page, baseURL),
      timing: await navigationEvidence(page),
    };
    profileEvidence.network.shell = await resourceEvidence(page);
    profileEvidence.heaps.push({ stage: "shell", ...await heapEvidence(session) });

    profileEvidence.firstRaceLoadMs = await startQaRace(page);
    profileEvidence.heaps.push({ stage: "first-race-ready", ...await heapEvidence(session) });
    await page.keyboard.down("w");
    await page.keyboard.down("Space");
    try {
      profileEvidence.rendering = await renderingEvidence(page, sampleSeconds);
      profileEvidence.heaps.push({ stage: "after-render-sample", ...await heapEvidence(session) });
      await finishQaRace(page);
    } finally {
      await page.keyboard.up("w").catch(() => undefined);
      await page.keyboard.up("Space").catch(() => undefined);
    }

    profileEvidence.restartMs = await measureRestart(page);
    profileEvidence.heaps.push({ stage: "after-restart", ...await heapEvidence(session) });
    await returnToTitleFromRace(page);
    await startQaRace(page, "rival");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.down("w");
    await page.keyboard.down("Shift");
    await page.keyboard.down("Space");
    try {
      profileEvidence.stress = await renderingEvidence(page, sampleSeconds);
      profileEvidence.heaps.push({ stage: "rival-ai-jump-crash-stress", ...await heapEvidence(session) });
    } finally {
      await page.keyboard.up("w").catch(() => undefined);
      await page.keyboard.up("Shift").catch(() => undefined);
      await page.keyboard.up("Space").catch(() => undefined);
    }
    await returnToTitleFromRace(page);
    profileEvidence.editor = await measureEditor(page);
    profileEvidence.heaps.push({ stage: "editor-test-play", ...await heapEvidence(session) });
    profileEvidence.network.completeFlow = await resourceEvidence(page);

    if (screenshotsDirectory) {
      const screenshotPath = resolve(screenshotsDirectory, `${profile.name}.png`);
      await page.screenshot({ path: screenshotPath });
      profileEvidence.screenshot = relative(REPO_ROOT, screenshotPath).split(sep).join("/");
    }

    evidence.profiles.push(profileEvidence);
    await session.detach();
    await context.close();
  }
} finally {
  await browser.close();
}

evidence.durationMs = Math.round(nodePerformance.now() - measurementStartedAt);
const outputPath = await writeJson(output, evidence);
console.log(JSON.stringify({ outputPath, profiles: evidence.profiles.map((profile) => ({
  name: profile.name,
  firstRaceLoadMs: profile.firstRaceLoadMs,
  fpsMean: profile.rendering?.fps.mean,
  frameTimeP95Ms: profile.rendering?.frameTimeMs.p95,
  drawCallsMax: profile.rendering?.drawCalls.max,
  restartMs: profile.restartMs,
  editorOpenMs: profile.editor?.openMs,
  editorTestPlayMs: profile.editor?.testPlayMs,
})) }, null, 2));
