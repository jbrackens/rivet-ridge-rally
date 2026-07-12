# RIVET RIDGE RALLY — QA Report

**Report date:** 2026-07-13

**Milestone:** `1.0.0-rc.1` RC hardening

**Tested source:** immutable release commit on `main`, identified by annotated tag `v1.0.0-rc.1`

**Automated candidate:** Path-clean QA-mode full-matrix build plus the final non-QA `dist/` identified by `artifacts/release-manifest.json`

**Overall code-owned QA status:** PASS

**Release decision:** NOT READY

## 1. Executive result

The implemented game and its current automated RC matrix pass within their recorded scope. The current-source full Playwright matrix completed in approximately **48.4 minutes** with **67 passed, 221 intentional project-scoped skips, and 0 failures** across 288 project results. Eight Vitest files contain **76 passing tests**. The passing evidence covers the complete first-play tutorial, every applicable launch-track/race-mode combination, campaign progression, shared-rule AI, the 25-module editor, persistence and migrations, lifecycle/restart recovery, offline startup, accessibility, responsive controls, quality presets, and accepted visual compositions.

All repository-controlled RC1 implementation, validation, artifact, and immutable-source gates are `PASS`. The continuous 30-minute Rival soak, final non-QA artifact/manifest, actual-Chrome production smoke, release commit, and annotated `v1.0.0-rc.1` tag are complete.

Physical Android/iOS behavior and touch ergonomics, a physical gamepad, actual Firefox, actual Edge, actual Safari, and subjective physical-device audio/fairness remain `UNVERIFIED`. Final legal/trademark/trade-dress approval, the owner-selected top-level license, production hosting/DNS/TLS/security headers/deployment/support/rollback ownership, generated-image account provenance, physical-matrix access, and the local-folder rename are `EXTERNAL BLOCKER` items.

No open product P0 or P1 remains in the completed automated scope. An earlier 30-minute soak reproduced a WebGL-context lifecycle defect; the renderer lifecycle was corrected, targeted lifecycle regressions passed, the current full matrix passed, and the post-fix 30-minute soak passed without context warnings or timeouts. The non-QA artifact and installed-Chrome smoke also pass. That closure does not certify unavailable physical environments or resolve owner-controlled commercial-release blockers.

## 2. Status definitions

| Status | Meaning in this report |
|---|---|
| `PASS` | The specifically named scope was executed against this candidate and produced recorded evidence. |
| `FAIL` | A mandatory behavior, artifact, or release gate is absent or did not pass. |
| `UNVERIFIED` | A required physical device, browser, hardware input, or environment was unavailable or not exercised. |
| `EXTERNAL BLOCKER` | Completion requires owner credentials, legal approval, publishing access, or another owner action outside the repository. |

These statuses are deliberately scoped. A Playwright mobile project does not prove physical-device ergonomics or thermal performance, and Playwright WebKit does not certify the installed Safari application.

## 3. Candidate identity and environment

| Item | Status | Recorded evidence |
|---|---:|---|
| Package candidate | PASS | `rivet-ridge-rally@1.0.0-rc.1` |
| Host environment | PASS | Apple-silicon `arm64` Mac; macOS 26.5.2 build 25F84; Node.js v26.4.0; npm 11.17.0 |
| Automation | PASS | Playwright 1.61.1 with Chromium, Firefox, WebKit, Pixel 7, iPhone 15, and Galaxy Tab S9 projects |
| Lockfile identity | PASS | `package-lock.json`: 165,779 bytes; SHA-256 `43dfce57099cd11a1081d10286578d47e0126e839ffe8c9deac2fe628430e5d3` |
| Full browser report | PASS | `artifacts/playwright/full-matrix-current/index.html`; SHA-256 `cbf40421cd5fd9a1c1982a467e67fd38270514c46ad5f4fb1cfb3cf8d3ea3590`; 67 passed, 221 scoped skips, 0 failed; embedded archive has 0 local-folder-name and 0 `/Users/` hits |
| Immutable source revision | PASS | Release commit exists on `main` and is identified by annotated tag `v1.0.0-rc.1`; staged/source-history scans found no prohibited marks, absolute home paths, credential files, or known secret signatures |
| Final release artifact identity | PASS | Non-QA `artifacts/release-manifest.json`: 21 files, 4,675,553 bytes, aggregate SHA-256 `d953ed1ed66f82a26043d3fbffe634ed8d35021edb8e90ee0f8f064567a70a97` |

Installed application versions were identified as Chrome 150.0.7871.115, Firefox 152.0.4, and Safari 26.5.2. The full matrix used Playwright-managed browser engines; actual Google Chrome 150 has a separate non-QA production smoke below, while actual Firefox and Safari application runs remain `UNVERIFIED`.

## 4. Build, unit, asset, and dependency evidence

| Check | Status | Executed result and scope |
|---|---:|---|
| `npm ci` | PASS | Final clean lockfile install completed under Node.js v26.4.0/npm 11.17.0; 268 packages installed, 269 audited, zero vulnerabilities reported |
| `npm run typecheck` | PASS | Strict whole-project TypeScript build passed; also reran inside the final Playwright web-server build |
| `npm run lint` | PASS | ESLint passed against the current lifecycle-fixed source |
| `npm run test` | PASS | 8 files, 76 tests, 0 failures |
| `npm run test:coverage` | PASS | 8 files and 76 tests passed; local HTML/JSON output was generated under ignored `coverage/`, with exact totals retained in this report |
| `npm run assets:verify` | PASS | 15,172-byte GLB and 2,236-byte KTX2 verified; 12 Meshopt views; 22 nodes; 9 meshes; 6 materials; required Meshopt/quantization/Basis extensions; validator 0 errors |
| `npm run audit` | PASS | 0 info, low, moderate, high, or critical vulnerabilities across 320 lockfile package entries |
| `npm ls --depth=0 --json` | PASS | Exit 0; all 31 exact direct dependencies present; no problems, missing entries, or extraneous packages |
| `VITE_QA_MODE=1 npm run build` | PASS | Current full browser matrix built the production-format QA candidate, including asset verification, strict typecheck, lazy chunks, service worker, and complete third-party notice |
| Final non-QA `npm run build` plus `npm run release:manifest` | PASS | Guard accepted 21 files/4,675,553 bytes with complete notices, no source maps, QA marker, local `/Users/` path, or prohibited workspace-name bytes; aggregate SHA-256 `d953ed1ed66f82a26043d3fbffe634ed8d35021edb8e90ee0f8f064567a70a97` |

### Coverage detail

Coverage execution passed, but no global threshold is configured. The global percentage is low because browser-driven React/Three.js code is exercised primarily by Playwright rather than instrumented Vitest. It must not be represented as broad unit coverage.

| Metric | Covered / total | Result |
|---|---:|---:|
| Lines | 631 / 3,540 | 17.82% |
| Statements | 695 / 3,987 | 17.43% |
| Functions | 110 / 647 | 17.00% |
| Branches | 533 / 2,112 | 25.23% |

The deterministic rule modules have materially stronger coverage: simulation exceeds 91% line coverage, and editor validation plus track-to-definition conversion exceed 89%. Exact per-file detail is available at `coverage/index.html`.

## 5. Full Playwright matrix

`PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_HTML_OUTPUT_DIR=artifacts/playwright/full-matrix-current npx playwright test --reporter=list,html` executed 48 test definitions across six configured projects, producing 288 project results:

- **67 passed**;
- **221 skipped** because each definition explicitly limits itself to the browser or device project that owns that requirement;
- **0 failed**;
- approximately **48.4 minutes** elapsed.

The skips are intentional project routing, not runtime skips of the owning gate. Cross-engine core/editor/release-quality and lifecycle checks run in their owning desktop engines; phone/tablet checks run in their device projects; exhaustive deterministic browser matrices run once in Chromium to avoid multiplying identical long tests. The final report's embedded archive contains zero `/Users/` or local workspace-folder-name hits.

| Automated project | Status | Scope exercised |
|---|---:|---|
| Playwright Chromium desktop | PASS | Core race, editor, every applicable track/mode combination, tutorial, exhaustive editor, persistence, migrations, lifecycle/restart reliability, accessibility, quality, synthetic gamepad, offline, and visual gates |
| Playwright Firefox desktop | PASS | Core keyboard race, editor journey, keyboard navigation/pause, settings persistence, required-surface axe and request/console/page-error gate |
| Playwright WebKit desktop | PASS | Core keyboard race, editor journey, keyboard navigation/pause, settings persistence, visibility/restart lifecycle, required-surface axe, and request/console/page-error gate |
| Pixel 7 mobile-Chrome emulation | PASS | Complete touch race, labeled controls, mirrored layout, and portrait visual baseline |
| iPhone 15 mobile-Safari emulation | PASS | Complete touch race, labeled controls, and mirrored layout |
| Galaxy Tab S9 Chrome emulation | PASS | Complete touch race, labeled controls, and mirrored layout |
| Actual installed Google Chrome 150 | PASS | Headless non-QA production smoke covers boot/version, QA absence, race restart, editor open, service-worker control, offline reload, and clean console/network results |
| Actual installed Firefox | UNVERIFIED | Installed version identified, but this report does not record a separate installed-application run |
| Actual Edge | UNVERIFIED | Edge is not installed in the test environment |
| Actual Safari | UNVERIFIED | Safari version identified; Playwright WebKit is not an actual Safari run |
| Physical Chrome Android | UNVERIFIED | No physical Android device session |
| Physical Safari iOS | UNVERIFIED | No physical iPhone or iPad session |
| Physical gamepad | UNVERIFIED | No physical controller, prompt, or vibration session |

## 6. Gameplay, tutorial, modes, and AI

| ID | Requirement | Status | Evidence |
|---|---|---:|---|
| GP-01 | First-play tutorial demonstrates all mechanics in under three minutes | PASS | Chromium completed the no-skip production tutorial in 48.0 seconds, below the 180-second assertion: throttle, turbo/critical heat, cooling, lane change, wheelie, airborne pitch, clean landing, mud, grass/off-track, and both asymmetric collision drills |
| GP-02 | All five launch tracks complete two production-distance laps | PASS | Chromium completed Practice, Solo, and Rival on Canyon Kickoff, Pine Run, Coastline Clash, Foundry Flight, and Summit Showdown, plus Summit Mastery; every result showed Lap 1 and Lap 2 |
| GP-03 | Ordered checkpoints and lap rules prevent shortcut credit | PASS | Fixed-step unit tests require ordered checkpoints and two laps; all five browser completions reached valid results |
| GP-04 | Solo qualification and personal-best reporting | PASS | Every launch track completes Solo; the focused browser gate verifies visible target, saved-best-before-run, final/best time, new personal best, and Rival unlock; progression unit tests cover target pass/fail behavior |
| GP-05 | Rival race and official classification | PASS | Every launch track completes Rival; browser results report live position and a sorted official six-rider table with exactly one player row and authoritative finish times |
| GP-06 | Campaign unlocks and Summit mastery | PASS | Unit tests cover every next-track unlock, idempotence, Summit podium gate, seven mastery tiers, escalating targets, and hot-start heat; browser clears Tier 1 and observes Tier 2/40% heat |
| GP-07 | Practice and immediate retry/restart | PASS | Practice is available in covered flows; core journeys complete a race, expose Retry now, retry, pause/resume, and reload without unnecessary menu traversal |
| GP-08 | Throttle, turbo, heat, surfaces, wheelies, pitch, landings, crashes, and recovery | PASS | Deterministic tests cover each rule, including 1.4-second normal wheelie instability, finite tutorial allowance, airborne self-centering, cooling entry, grass/mud penalties, clean/rough/crash landings, and hold/tap recovery |
| GP-09 | Shared-rule AI and three difficulty policies | PASS | AI tests cover exact Easy/Standard/Expert planning, consistency, heat, pitch, and recovery differences; route followers and pursuers use their own shared `RaceSimulation`, checkpoints, laps, terrain, ramps, cooling, obstacles, and recovery |
| GP-10 | Asymmetric rider collision rules | PASS | Unit policy and tutorial drills verify that the rider striking from behind crashes, whether player or pursuer |
| GP-11 | Results telemetry and coaching fields | PASS | Browser results verify final time, target/best reporting, position/field size, crashes, overheats, and mode-specific result headings |

The automated passes prove deterministic and browser behavior. Human fairness and comfort on unavailable physical devices remain bounded by the device `UNVERIFIED` rows rather than being inferred from automation.

## 7. Track editor

| ID | Requirement | Status | Evidence |
|---|---|---:|---|
| ED-01 | All 25 modules are selectable, placeable, removable, and runtime-accounted | PASS | Exhaustive Chromium editor test selects, places, and removes all 25; unit conversion accounts for every module |
| ED-02 | Camera interaction does not place modules | PASS | Orbit and zoom test verifies the 3D build camera never creates placement side effects |
| ED-03 | Undo/redo preserves 50 actions | PASS | Browser applies, undoes, and redoes the full 50-action history |
| ED-04 | Core tools and responsive reachability | PASS | Duplicate, rename, thumbnail, confirmed clear-all, save, library, reload, and test ride pass; narrow layout keeps Save and Test Ride reachable |
| ED-05 | One-through-nine lap contract | PASS | Browser starts a race for every lap value; unit tests accept 1–9 and reject values outside that range |
| ED-06 | Validation errors are actionable | PASS | Route/order, checkpoint, overlap, bounds, unsupported-module, and invalid export/save cases are covered by unit and browser tests |
| ED-07 | Safe interchange | PASS | Valid JSON round-trip passes; corrupt, over-1-MB, incompatible, semantically invalid, overlapping, and external-thumbnail imports are rejected |
| ED-08 | Authored runtime fidelity | PASS | A saved circuit containing every module completes its authored gates/laps; transforms, rotation, height, curves, banks, checkpoints, and obstacle semantics are preserved by conversion tests |
| ED-09 | Three bundled examples validate and race | PASS | All three examples pass validation and complete browser test rides |
| ED-10 | Cross-engine basic journey | PASS | Chromium, Firefox, and WebKit place, validate, save, reload, open the library, and test-ride a local track |

## 8. Controls, accessibility, responsive behavior, and visuals

| ID | Requirement | Status | Evidence |
|---|---|---:|---|
| CA-01 | Keyboard race and keyboard-only menus | PASS | Desktop engine projects reach and complete a race by keyboard; Escape freezes and resumes gameplay without timer drift |
| CA-02 | Keyboard remapping and conflict errors | PASS | Chromium rejects conflicts, accepts a remap, and completes a race with the accepted binding |
| CA-03 | Standard gamepad path | PASS | Synthetic standard-layout gamepad input completes a browser race; unit tests cover buttons, analog triggers, prompts/device state, and optional vibration call |
| CA-04 | Physical gamepad | UNVERIFIED | No physical controller or browser vibration session |
| CA-05 | Phone/tablet touch race | PASS | Pixel 7, iPhone 15, and Galaxy Tab S9 emulations complete a race with labeled lane, pitch, Ride, Turbo, and Pause controls |
| CA-06 | Physical mobile touch ergonomics | UNVERIFIED | Emulation does not prove real-device reach, audio, storage, thermal stability, or comfort |
| CA-07 | Mirrored touch layout | PASS | All mobile/tablet projects swap control sides without losing accessible labels |
| CA-08 | Accessibility and audio settings | PASS | Reduced motion/shake, high contrast, captions, UI scale, and separate master/music/SFX volumes apply immediately and persist across desktop engines |
| CA-09 | Non-color critical cues | PASS | Captions and semantic labels cover critical race state; WebGL high-contrast lane/edge strips and snowflake/stripe/rut/tuft/rail geometry provide redundant cues |
| CA-10 | Axe and browser-error release gate | PASS | Title, settings, mode selection, race HUD, results, and track builder have zero recorded axe violations in Chromium, Firefox, and WebKit; no unexpected console errors, page errors, failed requests, or HTTP 4xx/5xx responses |
| CA-11 | Required layouts | PASS | Automated geometry checks cover 16:9, ultrawide, tablet, phone, and narrow menus plus race/results/editor controls |
| CA-12 | Fixed-step overload disclosure | PASS | Renderer accessibility test forces the catch-up cap and verifies visible dropped-simulation telemetry |
| CA-13 | Visual regression | PASS | Three desktop title baselines plus desktop race/editor/high-contrast and portrait-race baselines match the accepted candidate |
| CA-14 | Five-track visual identity | PASS | Human ledger review and ten start/midcourse captures confirm distinct Canyon, Pine, Coastline, Foundry, and Summit palettes, scenery, and obstacle silhouettes; no visual P0/P1 found |

Visual evidence is inventoried in `ASSET_LICENSES.md`; concept-to-browser decisions and accepted low-poly differences are recorded in `docs/design/FIDELITY_LEDGER.md`.

## 9. Persistence, reliability, offline behavior, and security

| ID | Requirement | Status | Evidence |
|---|---|---:|---|
| RL-01 | Browser-restart persistence | PASS | A persistent Chromium profile preserves campaign progress, settings, and a custom track across browser restart |
| RL-02 | Sequential database migrations | PASS | Native v1 data migrates v1→v2→v3 while preserving rider data; native v2 upgrades to v3 without losing its track or replay |
| RL-03 | Corrupt profile recovery | PASS | Corrupt local progress is quarantined and replaced with a safe profile |
| RL-04 | IndexedDB unavailable/quota/version failures | PASS | Session-mode disclosure remains playable; quota retry flushes session settings; version-open failure preserves data and gives upgrade guidance |
| RL-05 | Unsupported WebGL | PASS | Unsupported renderer state presents recovery/menu paths instead of crashing |
| RL-06 | Compressed-model failure | PASS | Failed GLB/KTX2 loading leaves the procedural player fallback playable and reports the fallback |
| RL-07 | Offline application shell | PASS | Service-worker-controlled shell reloads offline from the app-owned v7 cache with required same-origin resources present |
| RL-08 | Quality presets | PASS | Auto, Low, Medium, and High each start a clean race |
| RL-09 | Privacy-neutral local runtime | PASS | Source/static audit finds no account, payment, ad, analytics, tracker, public sharing, WebSocket, beacon, or external application endpoint |
| RL-10 | Dependency and direct-tree integrity | PASS | Clean install, zero-vulnerability audit, exact direct tree, pinned Three.js, and lockfile/license enumeration pass |
| RL-11 | Asset provenance and third-party notices | PASS | Original/generated assets, Basis runtime, license/NOTICE files, generated full distribution notice, and stable source hashes are inventoried; duplicate Basis pair is an accepted RC1 P2 |
| RL-12 | Final production bundle guard | PASS | Final non-QA manifest certifies 21 files/4,675,553 bytes, complete notices, no source maps, QA marker, local `/Users/` path, or prohibited workspace-name bytes, and aggregate SHA-256 `d953ed1ed66f82a26043d3fbffe634ed8d35021edb8e90ee0f8f064567a70a97` |
| RL-13 | Visibility and repeated-restart lifecycle | PASS | Chromium and WebKit pause safely on visibility loss and preserve held-input/audio state; twenty immediate restarts retain one active engine, renderer context, listener set, audio lifecycle, and IndexedDB connection without unexpected runtime failures |

## 10. Headed performance evidence

`npm run perf:measure -- --headed --output artifacts/performance/final-headed-measurement.json --screenshots-dir artifacts/performance/headed-screenshots` produced the JSON evidence and matching screenshots. It ran headed Chromium 149.0.7827.55 on a MacBook Pro with an Apple M1 Max (10 CPU cores) and 32 GB memory under macOS 26.5.2. It sampled each profile for five seconds, exercised shell, first race, restart, Rival AI/jump/crash stress, editor open, and editor test play, and recorded no console messages.

| Metric | Desktop 1920×1080 | Mobile viewport 390×844 |
|---|---:|---:|
| First race ready | 137.42 ms | 129.16 ms |
| Restart | 238.33 ms | 163.23 ms |
| Editor open | 848.26 ms | 838.15 ms |
| Editor test play | 170.09 ms | 181.10 ms |
| Normal FPS min / mean / max | 57 / 59.31 / 60 | 55 / 58.50 / 60 |
| Normal CPU frame-work p95 | 4.59 ms | 2.84 ms |
| Normal draw calls max | 367 | 232 |
| Rival-stress FPS mean | 59.31 | 59.54 |
| Rival-stress CPU work p95 | 4.49 ms | 3.15 ms |
| Rival-stress draw calls max | 559 | 309 |

The measured QA build contained 21 files totaling 4,678,172 raw bytes and 3,025,236 independently gzipped bytes, below the 12 MB initial-asset budget. These figures are a scoped `PASS` for the measured QA candidate, not the final distribution payload.

| Performance gate | Status | Evidence/limitation |
|---|---:|---|
| Headed local desktop 60 FPS target | PASS | Normal mean 59.31/minimum 57/maximum 60; Rival stress mean 59.31 with 4.49 ms CPU-work p95, below a 16.67 ms frame budget |
| Emulated mobile viewport 30 FPS target | PASS | Normal mean 58.50/minimum 55/maximum 60; Rival stress mean 59.54 with 3.15 ms CPU-work p95 |
| Physical mid-range mobile performance | UNVERIFIED | No physical device, GPU, thermal, or battery capture |
| Load/restart/editor timings | PASS | Exact headed measurements recorded above |
| Memory checkpoints | PASS | Six staged heap observations per profile are recorded without a page crash; this is not a long-run trend |
| Continuous 30-minute Rival soak | PASS | Post-fix headless Chromium Rival soak recorded 1,800,503 ms active duration, 65 completed races, 0 timeouts, complete telemetry, no failed requests/HTTP errors/unexpected runtime messages, and stable manually reviewed memory/input/fixed-step trends |
| Final non-QA payload and production smoke | PASS | Final manifest records 21 files/4,675,553 raw and 3,024,330 gzip-9 bytes; installed Google Chrome 150 smoke records clean required requests/runtime messages and controlled offline reload |

### Continuous Rival soak and defect chronology

`artifacts/performance/final-30m-soak.json` records Chromium 149.0.7827.55 headless at 1920×1080 in Rival mode. The configured active duration was 1,800,503 ms and the complete harness duration was 1,808,774 ms. It completed 65 races with 0 timeouts, retained all 196 expected memory/input/fixed-step telemetry samples, and recorded request/response/console/harness outcomes throughout. It recorded 0 failed requests, 0 HTTP error responses, 0 unexpected console/page messages, and 0 harness errors. Four known headless Chromium `ReadPixels` driver diagnostics were classified separately and did not repeat after the browser's suppression notice.

Key-to-frame input latency remained flat at 2.63 ms mean and 3.3 ms p95. The first-to-last heap observation increased by 18.39 MB, but manual trend review found a warm-up/garbage-collection plateau rather than runaway growth: the 15–30 minute five-minute-window means were 31.09, 35.93, and 35.13 MB; maxima were 56.57, 56.98, and 56.64 MB; minima were 20.67, 21.19, and 21.66 MB. Per-attempt maximum dropped-simulation timing was likewise stable: the first and last window means were 10,512.64 and 10,580.64 ms, a 68 ms difference. The 679,807 ms cumulative field is the sum of independent attempt-local headless diagnostics, not continuously worsening simulation debt.

The historical `artifacts/performance/failed-context-leak-30m-soak.json` completed 56 races with 1 timeout, 43 WebGL-context warnings, and 18.60 MB first-to-last heap growth. That run correctly failed and led to the renderer-lifecycle correction. Targeted Chromium/WebKit lifecycle tests and the full matrix passed before the successful post-fix soak. One interrupted harness invocation produced no artifact and is not counted as QA evidence.

### Final non-QA production smoke

`artifacts/production-smoke/chrome-smoke.json` is a `PASS` from the installed Google Chrome 150.0.7871.115 application in headless mode against the final non-QA production preview; SHA-256 `c63e476ed8b62205374cd8704770ab7f886f9defb56227b8d64ee3178e04061b`. It verified title boot and visible version, absence of the QA API, race start/restart, editor open, service-worker control, and an offline reload. It recorded 0 failed requests, 0 HTTP errors, 0 console messages, and no smoke error. Matching 1440×900 race, editor, and offline-title screenshots are retained under `artifacts/production-smoke/` and inventoried in `ASSET_LICENSES.md`.

A separate in-app-browser manual smoke was also clean within its observed scope. It is supplemental visual/console evidence only and is not used to certify actual Firefox, Safari, Edge, or any physical mobile environment.

## 11. Remaining release gates

### Code-owned release-gate ledger

| ID | Severity | Gate | Status | Required closure evidence |
|---|---:|---|---:|---|
| RRR-RC1-01 | P1 | Continuous 30-minute Rival soak | PASS | Post-fix artifact records 1,800,503 ms active duration, 65 races, 0 timeouts, complete telemetry, clean network/runtime failure counts, and stable manually reviewed trends |
| RRR-RC1-02 | P1 | Final non-QA release artifact | PASS | Manifest certifies 21 files/4,675,553 bytes and aggregate SHA-256 `d953ed1ed66f82a26043d3fbffe634ed8d35021edb8e90ee0f8f064567a70a97`; installed Chrome smoke passes boot/version/race/editor/offline and runtime/network gates |
| RRR-RC1-03 | P1 | Immutable source identity | PASS | Release commit and annotated `v1.0.0-rc.1` tag identify the source containing the final manifest, reports, and retained evidence |

The intentional 584,862-byte duplicate Basis transcoder pair is an accepted P2, not a P0/P1 blocker. Its stable same-origin/offline value, license evidence, and later optimization requirement are recorded in `ASSET_LICENSES.md`.

### Unavailable physical/application environments

| Environment | Status | Missing evidence |
|---|---:|---|
| Actual installed Firefox | UNVERIFIED | Separate current installed-application run |
| Actual Edge | UNVERIFIED | Edge is not installed in the test environment |
| Actual Safari | UNVERIFIED | Current installed Safari run; Playwright WebKit is recorded separately |
| Physical Android Chrome | UNVERIFIED | Real touch/audio/storage/performance/thermal session |
| Physical iPhone/iPad Safari | UNVERIFIED | Real touch/audio/storage/performance/thermal session |
| Physical gamepad | UNVERIFIED | Controller model, prompts, stuck-input cleanup, and vibration where supported |
| Subjective audio, touch comfort, and race fairness | UNVERIFIED | Human review on representative physical devices and inputs |

### External owner actions

| Owner action | Status | Required evidence |
|---|---:|---|
| Final trademark, trade-dress, copyright, and generated-output review | EXTERNAL BLOCKER | Owner/counsel approval and archived provenance decision |
| Top-level product license | EXTERNAL BLOCKER | Owner-selected root `LICENSE` and final notice review |
| Generated-image account/agreement provenance | EXTERNAL BLOCKER | Archive the governing account terms and prompt/session or receipt evidence |
| Neutral public workspace/repository name | EXTERNAL BLOCKER | Rename the local folder before public logs, CI, support exports, or provenance records |
| Production hosting, DNS/TLS, security headers, credentials, and deployment target | EXTERNAL BLOCKER | Owner-selected host, verified response headers, and tested immutable deploy/rollback procedure |
| Public support, release, rollback, and incident ownership | EXTERNAL BLOCKER | Named release/support/rollback/incident owners and public support path |
| Physical/application test-matrix access | EXTERNAL BLOCKER | Owner-provided devices, gamepad, installed browsers, and assigned human review |

## 12. QA conclusion

The current implementation has complete, passing automated evidence for the shipped gameplay, campaign, AI, editor, accessibility, persistence, lifecycle reliability, offline, visual, headed-performance, continuous-soak, final non-QA artifact, and installed-Chrome production-smoke scope. The path-clean current-source full browser matrix is green with 67 passes and no failures, and the deterministic rules suite passes 76 tests.

The code-owned QA status is **PASS** and all repository-controlled RC1 gates are complete. The commercial release decision remains **NOT READY**: physical and application-specific gaps retain their explicitly scoped `UNVERIFIED` status, and legal, licensing, naming, hosting, deployment, support, rollback, and test-access actions remain `EXTERNAL BLOCKER` items. This report does not claim commercial launch readiness.
