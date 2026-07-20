# UI/UX Polish — Strategy & Execution Plan

**Date:** 2026-07-18 · **Owner gate:** all visual changes re-verified through the repo's own
visual harness; baselines only change via deliberate `npm run visual:promote:canyon` /
promote flow, never silently.

This plan was produced from (a) a file-level audit of the entire UI surface (`src/ui/`,
`src/app/`, `src/styles.css`, `index.html`), (b) the open findings already tracked in
`QA_REPORT.md` / `LAUNCH_READINESS.md` / `docs/design/FIDELITY_LEDGER.md`, and (c) a
verified inventory of the tools now available locally. Every item is file-anchored and has
a named verification tool — no claim lands without evidence.

---

## 1. Toolbelt (verified working on this machine)

### Local CLI (driveable right now via Bash)

| Tool | Status | Use for |
|---|---|---|
| **Playwright 1.61** + Chromium/Firefox/WebKit | installed (project) | Cross-engine screenshots, e2e specs, visual-regression harness, throttled loads |
| **axe** (`@axe-core/playwright`) | installed (project) | Contrast + ARIA audits per screen |
| **Lighthouse 13.4** | `npx -y lighthouse` on demand | LCP/CLS, image-format, tap-target, font-display audits vs `npm run preview` (:4173). Dev-server scores understate prod — treat as relative baselines |
| **sharp-cli** | `npx -y sharp-cli` on demand | PNG → WebP/AVIF re-encodes (the 2.0 MB title backdrop, 1.7 MB canyon panorama) |
| **oxipng 10.1.1** | installed (brew) | Lossless PNG recompression for the 5 PWA icons + any art that must stay PNG (`oxipng -o max --strip safe`) |
| **vite-bundle-visualizer** | `npx -y vite-bundle-visualizer` | Treemap the 604 KB CoursePresentationRoute / 464 KB index / 328 KB GameView chunks before touching `manualChunks` |
| **ffmpeg / sips** | installed (system) | Gameplay capture GIFs/MP4s for review; quick image inspection |
| **TypeScript 7.0.2 (native)** | installed (see §4) | ~0.6 s typechecks — fast enough to run per-edit |

Deliberately skipped: `svgo` (only one 4 KB standalone SVG — everything else is inline JSX),
`imagemagick` (fully covered by sips + sharp + Playwright's pixelmatch).

### MCP servers (wired in `.mcp.json`, project scope)

| Server | Package | What it adds |
|---|---|---|
| **playwright** | `@playwright/mcp@0.0.78` | Accessibility-tree-driven browsing of localhost:5173 — deterministic click-throughs, screenshots, console/network reads without writing spec files |
| **chrome-devtools** | `chrome-devtools-mcp@1.6.0` | The only tool here that can profile Three.js frame-time/jank: CDP performance traces, CPU/network throttle emulation |
| **lighthouse** | `@danielsogl/lighthouse-mcp@1.3.0` | 13+ audit tools: perf score, a11y, CWV, unused-JS, perf budgets — objective before/after scores per wave |

> **Activation note:** MCP servers load at session start — they become driveable in the
> *next* Claude Code session opened in this project. Until then the same capabilities are
> available via `npx playwright`, `npx lighthouse`, and Chrome DevTools manually.
> Rejected during research: Tencent's `lighthouse-mcp-server` (cloud API key), `mcp-lighthouse`
> (crypto tracker, unrelated), Figma MCPs (cloud OAuth).

---

## 2. Execution waves

Ordering principle: **measure → cheap high-impact CSS wins → semantics → flow/motion →
assets/bundle**. Each item lists file anchor → change → verification evidence.

### Wave 0 — Baseline measurement (half a day)

1. `npm run build && npm run preview`, then `npx -y lighthouse http://localhost:4173 --preset=desktop`
   → record perf/a11y/CWV scores as the before-numbers.
2. `npx -y vite-bundle-visualizer` → save treemap; answer whether three.js is duplicated
   across the lazy chunks.
3. Cross-engine title/mode/results screenshots via the existing Playwright projects → the
   before-gallery for every later diff.

### Wave 1 — Quick wins: high impact, small effort, CSS/HTML only (1–2 days)

| # | Anchor | Change | Verify |
|---|---|---|---|
| 1.1 | `src/styles.css:317–320`, `src/styles.css:450–457`, `e2e/core-flow.spec.ts:149` | **Done 2026-07-19:** `font-variant-numeric: tabular-nums` now covers the race clock, lap number, target/position numerals, final result time, and prior-best comparison timing text. | `npm run typecheck`; `npx eslint e2e/core-flow.spec.ts`; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/core-flow.spec.ts -g "fresh load completes a keyboard race, saves onboarding, and retries" --project=chromium`; live `4173` probe sampled eight changing clock values with stable x/width and captured `/tmp/rivet-ridge-tabular-timer-live-4173-1280x720.png` |
| 1.2 | `src/styles.css:48,185–201,269–279` + `MenuScreens.tsx:134,230` | **Done 2026-07-19:** locked campaign stops and locked mode rows now use explicit `.locked` styling so unavailable controls remain disabled but unlock instructions stay readable at full opacity. | `npm run typecheck`; `npx eslint src/ui/screens/MenuScreens.tsx e2e/accessibility-controls.spec.ts`; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/accessibility-controls.spec.ts -g "locked progression instructions remain readable" --project=chromium`; live `4173` screenshots `/tmp/rivet-ridge-locked-campaign-readable-live-4173-1280x720.png` and `/tmp/rivet-ridge-locked-mode-readable-live-4173-1280x720.png` |
| 1.3 | `index.html:19`, `src/styles.css:120` | **Done 2026-07-19:** the title backdrop now preloads with `as="image"` / `fetchpriority="high"`, and `.menu-sky` has an image-compatible canyon/sky fallback gradient behind the production title art. | `npm run typecheck`; `npx eslint e2e/accessibility-controls.spec.ts`; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/accessibility-controls.spec.ts -g "primary menus fit" --project=chromium`; live `4173` probe recorded preload `{ as:"image", type:"image/png", fetchPriority:"high" }`, title art resource `initiatorType="link"`, and screenshot `/tmp/rivet-ridge-title-first-paint-live-4173-1280x720.png` |
| 1.4 | `src/styles.css:1–15`, `e2e/accessibility-controls.spec.ts:664` | **Done 2026-07-19:** both bundled `Ridge Display` font faces now use `font-display: optional` to avoid late display-font swaps shifting the brand mark/menu text. | `npm run typecheck`; `npx eslint e2e/accessibility-controls.spec.ts`; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/accessibility-controls.spec.ts -g "primary menus fit" --project=chromium`; live `4173` probe recorded font-face weights `700` and `900` with `display="optional"` |
| 1.5 | `src/styles.css:453`, `e2e/core-flow.spec.ts:82` | **Done 2026-07-19:** `.results-screen` now uses `align-content: safe center`, a fixed app-shell height, and its own scroll container so the results header starts onscreen and actions remain reachable on compact landscape viewports. | `npm run typecheck`; `npx eslint e2e/core-flow.spec.ts`; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/core-flow.spec.ts -g "fresh load completes a keyboard race, saves onboarding, and retries" --project=chromium`; temporary-port screenshots `/tmp/rivet-ridge-results-safe-center-1280x600.png`, `/tmp/rivet-ridge-results-safe-center-844x390.png`, and `/tmp/rivet-ridge-results-safe-center-844x390-bottom.png`; scroll probe recorded `alignContent="safe center"`, zero horizontal overflow, 844×390 panel `clientHeight=390`, `scrollTop=190`, and visible Retry action after panel scroll |
| 1.6 | `src/styles.css:708`, `e2e/accessibility-controls.spec.ts:672` | **Done 2026-07-19:** the mobile/tablet campaign rail now owns horizontal scrolling with `overflow-x:auto`, scroll snap, and a route line sized to the stop row, so the title document no longer pans sideways on phones. | `npm run typecheck`; `npx eslint e2e/accessibility-controls.spec.ts`; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/accessibility-controls.spec.ts -g "primary menus fit" --project=chromium`; live `4173` probe at 360×640 recorded rail `scrollWidth=653`, `clientWidth=360`, `scrollLeft=293`, document overflow `0`, and the final stop fully visible; screenshots `/tmp/rivet-ridge-campaign-rail-scroll-start-360x640.png`, `/tmp/rivet-ridge-campaign-rail-scroll-end-360x640.png`, and `/tmp/rivet-ridge-campaign-rail-scroll-live-4173-360x640.png` |
| 1.7 | `src/styles.css:321`, `e2e/core-flow.spec.ts:121` | **Done 2026-07-19:** show the existing race pause/resume button on desktop with the same chunky rally styling as the touch affordance, while keeping it clear of target/timing HUD cards. | `npm run typecheck`; `npx eslint e2e/core-flow.spec.ts`; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/core-flow.spec.ts -g "fresh load completes a keyboard race, saves onboarding, and retries" --project=chromium`; live `4173` geometry probe and `/tmp/rivet-ridge-desktop-pause-affordance-live-4173-1280x720.png` |
| 1.8 | `src/styles.css:291`, `e2e/accessibility-controls.spec.ts:225` | **Done 2026-07-19:** Settings toggle hidden checkboxes now use a 44 px-plus right-side hit panel while preserving the visible switch art. | `npm run typecheck`; `npx eslint e2e/accessibility-controls.spec.ts`; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/accessibility-controls.spec.ts -g "accessibility and volume controls apply immediately and persist" --project=chromium`; live `4173` edge-click probe measured 70.39×75.80 px and captured `/tmp/rivet-ridge-settings-toggle-hit-area-live-4173-1280x720.png` |
| 1.9 | `src/styles.css:189,207`, `e2e/accessibility-controls.spec.ts:688` | **Done 2026-07-19:** campaign taglines now keep the desktop hover/focus reveal by default, but coarse/no-hover devices get visible taglines without needing a mouse hover. | `npm run typecheck`; `npx eslint e2e/accessibility-controls.spec.ts`; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/accessibility-controls.spec.ts -g "campaign taglines stay readable" --project=chromium --project=tablet-chrome`; live `4173` tablet-touch probe recorded `pointerCoarse=true`, `anyHoverNone=true`, visible campaign guidance, no page/request failures, zero document overflow, and screenshot `/tmp/rivet-ridge-campaign-taglines-tablet-touch-live-4173-1024x768.png` |

### Wave 2 — Accessibility semantics (1 day)

| # | Anchor | Change | Verify |
|---|---|---|---|
| 2.1 | `MenuScreens.tsx:392`, `TrackEditorScreen.tsx:614,627`, `e2e/accessibility-controls.spec.ts:653` | **Done 2026-07-19:** Settings section buttons plus Track Builder category/module selector buttons now expose their active state with `aria-pressed`, instead of relying on `.active` styling alone. | `npm run typecheck`; `npx eslint src/ui/screens/MenuScreens.tsx src/ui/editor/TrackEditorScreen.tsx e2e/accessibility-controls.spec.ts`; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/accessibility-controls.spec.ts -g "settings and editor selector buttons expose" --project=chromium`; live `4173` probe recorded Settings `audio=true`, editor `jumps=true`, `Medium Ramp=true`, sibling options false, and screenshot `/tmp/rivet-ridge-aria-pressed-selectors-live-4173-1280x720.png` |
| 2.2 | `GameView.tsx:534,547,959`, `e2e/accessibility-controls.spec.ts:653` | **Done 2026-07-19:** tutorial announcements are now scoped to one concise visually-hidden `role="status"` region; the tutorial card itself no longer has `aria-live`, so full card content should not re-announce on every render. | `npm run typecheck`; `npx eslint src/ui/game/GameView.tsx e2e/accessibility-controls.spec.ts`; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/accessibility-controls.spec.ts -g "tutorial lesson updates use" --project=chromium`; live `4173` probe recorded card `aria-live=null`, status `aria-live="polite"`, `aria-atomic="true"`, intro-to-lesson status text update, no page/request failures, and screenshot `/tmp/rivet-ridge-tutorial-live-status-region-live-4173-1280x720.png` |

### Wave 3 — Flow, motion, consistency (2–3 days)

| # | Anchor | Change | Verify |
|---|---|---|---|
| 3.1 | `App.tsx:184–196` | **Done 2026-07-19:** top-level surfaces now mount through `.screen-surface` with a 180 ms opacity/translate entrance, and the race settings overlay uses a 160–180 ms fade/panel settle. Both `html[data-reduced-motion="true"]` and `prefers-reduced-motion: reduce` explicitly disable the new animations. | `npm run typecheck`; `npx eslint src/app/App.tsx e2e/accessibility-controls.spec.ts`; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/accessibility-controls.spec.ts -g "screen swaps" --project=chromium`; `npm run build`; live `4173` probe recorded `screen-surface-enter`, `settings-overlay-fade`, `settings-overlay-panel`, reduced overlay/panel `animationName="none"`, zero console/page/request failures, and screenshot `/tmp/rivet-ridge-screen-motion-overlay-live-4173-1280x720.png` |
| 3.2 | `TrackEditorScreen.tsx:487,512,633,878`, `src/styles.css:576`, `e2e/editor-coverage.spec.ts:357,393,508` | **Done 2026-07-19:** the three Track Builder destructive confirmations now use one styled in-app modal dialog instead of browser-native `window.confirm()`: recovery record removal, saved-track deletion, and clear-all. | `npm run typecheck`; `npx eslint src/ui/editor/TrackEditorScreen.tsx e2e/editor-coverage.spec.ts`; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/editor-coverage.spec.ts -g "duplicate, rename\|saved-track deletion\|invalid tracks" --project=chromium`; `rg "window\\.confirm" src/ui/editor/TrackEditorScreen.tsx` returned no matches; live `4173` probe recorded modal role/`aria-modal`, focused destructive action, inert editor chrome, no native dialogs/page/request failures, and screenshot `/tmp/rivet-ridge-editor-confirm-dialog-live-4173-1280x720.png` |
| 3.3 | `GameView.tsx:925–944` + `styles.css:449–456` | **Done 2026-07-19:** slow race prep now reveals the shared `.loading-track` affordance after 150 ms and holds it for at least 400 ms before countdown; fast-ready races skip the loading card, avoiding a single-frame strobe. Countdown still owns the race-time handoff and the loading track is removed before `GO`. | `npm run typecheck`; `npx eslint src/ui/game/GameView.tsx e2e/core-flow.spec.ts`; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/core-flow.spec.ts -g "slow race prep" --project=chromium`; `npm run build`; live `4173` delayed-asset probe recorded states `loading/loading/true → countdown/countdown/false → racing/null/false`, then-current `assets/index-DlCGuHVg.js` / `assets/index-C2e4audF.css`, zero console/page/request failures, and screenshots `/tmp/rivet-ridge-race-gate-loading-live-4173-1280x720.png` plus `/tmp/rivet-ridge-race-gate-countdown-live-4173-1280x720.png` |
| 3.4 | `App.tsx:191–193` + `MenuScreens.tsx:72–81` | **Done 2026-07-19:** BootScreen now accepts a destination-specific `message` prop while preserving the store boot/recovery message as its default. Track Builder, Rider School, and race Suspense fallbacks no longer reuse stale boot copy during route-chunk loads. | `npm run typecheck`; `npx eslint src/app/App.tsx src/ui/screens/MenuScreens.tsx e2e/accessibility-controls.spec.ts`; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/accessibility-controls.spec.ts -g "chunk loading screens" --project=chromium`; `npm run build`; live `4173` delayed Track Builder chunk probe recorded fallback text `Opening Track Builder…`, editor readiness, zero console/page/request failures, and screenshot `/tmp/rivet-ridge-bootscreen-track-builder-message-live-4173-1280x720.png` |
| 3.5 | `MenuScreens.tsx:201,392`, `TrackEditorScreen.tsx:586–587,671`, `GameView.tsx:855` | **Done 2026-07-19:** icon-only controls now use one authored inline SVG family (`RallyIcon`) for back, undo, redo, close, pause, and active/play progress markers instead of platform text glyphs. Instructional control copy remains text for readability. | `npm run typecheck`; `npx eslint src/ui/icons/RallyIcon.tsx src/ui/screens/MenuScreens.tsx src/ui/editor/TrackEditorScreen.tsx src/ui/game/GameView.tsx e2e/accessibility-controls.spec.ts e2e/tutorial.spec.ts`; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/accessibility-controls.spec.ts -g "icon-only controls" --project=chromium`; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/tutorial.spec.ts -g "missed one-shot\|new rider completes" --project=chromium`; `npm run build`; live `4173` probe recorded Settings/editor/drawer/race authored icon selectors, zero console/page/request failures, and screenshots `/tmp/rivet-ridge-authored-svg-icons-editor-live-4173-1280x720.png` plus `/tmp/rivet-ridge-authored-svg-icons-pause-live-4173-1280x720.png` |
| 3.6 | `GameView.tsx:236`, `src/styles.css:369`, `e2e/accessibility-controls.spec.ts:340` | **Done 2026-07-19:** the Heat HUD warning marker now reads the shared `CRITICAL_HEAT_WARNING` simulation threshold through a CSS custom property instead of duplicating `78%` in stylesheet code. The focused browser gate now checks the intended critical-warning state rather than requiring the bike to overheat during the probe, preserving the latest slower-overheat tuning. | `npm run typecheck`; `npx eslint src/ui/game/GameView.tsx src/ui/game/__tests__/heatMeterThreshold.test.tsx e2e/accessibility-controls.spec.ts`; `npx vitest run src/ui/game/__tests__/heatMeterThreshold.test.tsx`; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/accessibility-controls.spec.ts -g "captions and critical race state" --project=chromium`; `npm run build`; live `4173` probe recorded `--heat-warning-threshold="78%"`, visible `.heat-warning`, colorblind-safe heat fill, zero console/page/request failures, and screenshot `/tmp/rivet-ridge-heat-warning-threshold-live-4173-1280x720.png` |

### Wave 4 — Asset payload & bundle (2 days, touches release machinery)

| # | Anchor | Change | Verify |
|---|---|---|---|
| 4.1 | `public/assets/art/*.png` + `docs/design/concepts/title-background-production.png` | **Done (lossless) 2026-07-20:** both art PNGs recompressed in place with oxipng — title backdrop 2,129,759 → 2,049,503 B (−3.8 %), canyon panorama 1,801,764 → 1,683,944 B (−6.5 %) — with the C2PA `caBX` content-credentials chunk re-injected verbatim (oxipng drops unknown chunks; all four provenance markers re-verified) and the concepts provenance pair kept byte-identical. **Lossy WebP/AVIF deliberately deferred to the owner fidelity gate:** it changes pixels on the most-gated screen and requires re-embedding C2PA in a new container; measured lossless ceiling is ~5 %, so the 70–85 % estimate requires the lossy path. | `npm run assets:verify` 0; release-scope audit 0; provenance markers c2pa/gpt-image/OpenAI/trainedAlgorithmicMedia present in both files; pins in verify-production-art.mjs re-synced |
| 4.2 | `public/assets/icons/*` (4 PNG rasters) | **Done 2026-07-20:** oxipng lossless recompression — 192: 8,560→5,485 B (−36 %), 512: 27,595→16,501 B (−40 %), maskable-512: 19,855→11,287 B (−43 %), apple-touch-180: 5,426→3,434 B (−37 %). Maskable + apple-touch redone with `--nc --nb` after `-o max` reduced colorType 6→2, which the png-integrity contract pins deliberately; eXIf stripped only after confirming it carried no provenance markers. | `npm run assets:verify` 0 (colorType 6 preserved on all four); pins re-synced |
| 4.3 | `vite.config.ts` | **Done 2026-07-19:** Vite now splits Three core and Three examples/loaders into explicit `vendor-three` and `vendor-three-addons` chunks. This removes the build chunk-size advisory without hiding it: `CoursePresentationRoute` fell from 616.11 kB to 17.40 kB, `GameView` from ~349.99 kB to 214.65 kB in the final current build, and the largest chunk is now `vendor-three` at 598.50 kB / 151.14 kB gzip. | `npm run typecheck`; `npx eslint vite.config.ts`; `npm run build` with no Vite chunk warning; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/accessibility-controls.spec.ts -g "chunk loading screens" --project=chromium`; `RRR_PLAYWRIGHT_PORT=4174 npx playwright test e2e/core-flow.spec.ts -g "slow race prep" --project=chromium`; live `4173` smoke loaded Track Builder and `Ride → Practice` with `vendor-three-_L_YAsy5.js`, `vendor-three-addons-kpozWyf3.js`, `CoursePresentationRoute-5w4HYH5V.js`, `TrackEditorScreen-QZzt4POl.js`, and `GameView-XEx2y4fx.js`, no app errors or failed requests, and screenshot `/tmp/rivet-ridge-final-practice-live-4173-1280x720.png` |
| 4.4 | `.github/workflows/ci.yml` | **Done 2026-07-20:** non-blocking `lighthouse-report` job builds, serves the preview, and logs category scores + LCP/CLS per PR (SHA-pinned actions, `continue-on-error`). Promote to a blocking budget once score targets are agreed. | Job green on PR CI; scores visible in the job log |

### Cleanup (opportunistic)

- `MenuScreens.tsx:94–100` + `styles.css:121–160`: delete the hidden pre-PNG procedural
  backdrop DOM/CSS (~40 dead lines on the most-visited screen) — or deliberately resurrect
  as parallax layers. Title snapshot proves no visual change.
- `styles.css:19`: Inter leads the body stack but is never bundled → typography is
  nondeterministic across machines **and destabilizes the already-failing visual baselines**.
  Recommendation: drop to `system-ui` (determinism) or bundle an Inter subset with the same
  care as the display font. Decide once, before re-promoting baselines.
- Heat meter warning tick drift is closed in Wave 3.6: the HUD now reads the shared
  critical threshold through `--heat-warning-threshold`, with a focused unit/browser gate.

---

## 3. Protocol per change

1. Make the change (smallest reviewable unit).
2. `npm run typecheck && npx eslint .` (both fast now — TS7 typecheck is ~0.6 s).
3. Run the named verification tool; capture evidence (screenshot/score/assertion).
4. Run the affected e2e spec(s); the visual-regression suite runs but **baseline promotion
   stays a deliberate, owner-visible act** — several baselines are already FAILING/open in
   QA_REPORT §6, and polish work must not silently absorb them.
5. Log evidence in the QA evidence flow (this repo treats prose without execution evidence
   as non-passing — see ARCHITECTURE.md).

## Explicit non-goals of this plan

- **3D concept-fidelity gates** (hero bike materials, canyon dressing/emission, rival
  legibility, venue density) — tracked in FIDELITY_LEDGER.md and owner-gated; different
  workstream.
- **Release qualification itself** (tagged candidate, soak/smoke/attestation) — tracked in
  LAUNCH_READINESS.md.

---

## 4. TypeScript 7 arrangement (context for future sessions)

- `"typescript"` resolves to **`@typescript/typescript6`** — Microsoft's official API-shim
  wrapper (re-exports TS 6.0.x) so typescript-eslint keeps working: **TS 7.0 ships no
  programmatic API** (it arrives in 7.1; typescript-eslint #12518 is waiting on it).
- Real **TypeScript 7.0.2 (native)** lives under the `"typescript-7"` alias; the
  `typecheck` script calls its bin by explicit path (`node node_modules/typescript-7/bin/tsc`)
  because `.bin/tsc` links to the TS6 wrapper's binary.
- **Collapse condition:** when TS 7.1 + a typescript-eslint release with a `>=7` peer range
  ship, revert to a single `"typescript": "7.1.x"`, delete `"typescript-7"`, restore
  `"typecheck": "tsc -b --pretty false"`.
- Editor note: VS Code's workspace-TS now serves TS6 semantics; use the built-in native TS
  (LSP) support for TS7 language service.
- Environment: `npm test`'s release-manifest guard requires the **pinned npm 11.17.0**
  (`packageManager` field). Under this machine's default npm 10.9.8 exactly that one guard
  test fails by design; all 45 pass under `npx -y npm@11.17.0 run test:…`.

## 5. Verified green (2026-07-19, this machine)

| Gate | Result |
|---|---|
| `npm run typecheck` (TS 7.0.2 native) | ✅ exit 0 (~0.6 s) |
| `npx eslint .` (type-aware via TS6 shim) | ✅ exit 0 |
| `npx vitest run` | ✅ 297/297, 32 files, via `npm test` |
| `npm run build` | ✅ exit 0, no Vite chunk-size warning |
| `npm test` release scripts | ✅ 45/45 release-manifest, 71/71 release-attestation, 31/31 production-smoke/service-worker under pinned npm 11.17.0 |
