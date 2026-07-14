# RIVET RIDGE RALLY — Launch Readiness

# NOT READY

**Decision date:** 2026-07-14

**Candidate:** `1.0.0-rc.2` working tree; no release commit or tag

**Code-owned gate status:** UNVERIFIED

**Commercial readiness status:** NOT READY

**Authority:** `QA_REPORT.md`

**Decision owner:** Unassigned

Player feedback reopened default lane controls, first-play training, and visual fidelity after the immutable `v1.0.0-rc.1` predecessor. The changed work is therefore a new `1.0.0-rc.2` candidate; the predecessor's tag, artifact, and evidence remain historical and do not qualify these bytes.

Final post-scene static and unit validation passes: whole-project strict typechecking, full lint, diff validation, and Vitest 9 files / 78 tests. Focused Chromium groups also pass for migrations, tutorial/quality, lifecycle, reliability, offline service-worker behavior, fresh keyboard race/save/retry, gamepad emulation/persistence/release quality, accessibility controls, and core fresh-race/editor journeys. Campaign qualification is complete in isolated Chromium: the original suite passed 3/3 in 6.4 minutes, and the hardened suite passed 18/18 in 7.3 minutes across all 16 applicable track/mode combinations plus the two progression scenarios. Selected Firefox, WebKit, Android-phone, iPhone, and tablet engine journeys added 19 passes; the only two initial failures were one stale focus-order assertion that omitted Rider School, and the corrected Firefox/WebKit rerun passed 2/2.

The documented asset pipeline verifies, and the final normal production build passes with 38,475-byte notices. The final release manifest records 21 files, 4,689,233 bytes, and aggregate SHA-256 `6a55c00ea36debe543ab946dee06dc5fa73cf8a13d45b047aec399469c9931a3`. `npm audit --audit-level=high` reports 0 vulnerabilities. Installed Google Chrome 150.0.7871.115 passes the normal-build boot/version, race/restart, editor, and offline service-worker smoke with no network, HTTP, or console failures.

Headed Chromium 149 local performance passes its desktop and emulated-mobile profiles, with mean FPS of 59.31/59.31 in normal/stress desktop sampling and 59.54/59.77 in normal/stress mobile-viewport sampling. The 30-minute headless Chromium 149 Rival soak's automated release gate also passes: 1,800,607 ms active workload, 58 completed races, 0 timeouts, and no failed requests, HTTP errors, harness errors, or unexpected console/page messages. The soak artifact still requires human interpretation of memory, input-latency, and fixed-step trends; headless FPS and the cross-restart cumulative dropped-time counter are diagnostic, not physical-device performance evidence.

The release remains **NOT READY**. In the current controlled visual run and repeat, editor passes but desktop race, portrait race, and high-contrast race fail the owner-unaccepted baselines by 61%, 36%, and 39% against a 2% threshold. Baselines remain untouched pending owner acceptance. Visual concept acceptance, the complete cross-browser and physical-device matrix, physical/manual input and accessibility review, and immutable `rc.2` source identity remain unresolved.

## Gate summary

| Gate | Required outcome | Status | Current evidence |
|---|---|---:|---|
| Candidate identity | Final bytes tied to a clean source commit and annotated `v1.0.0-rc.2` tag | UNVERIFIED | A checksummed `rc.2` artifact exists and passes installed-Chrome smoke, but the working tree is uncommitted and the artifact is not tied to a clean source revision or annotated tag. |
| Strict typecheck | Whole-project strict TypeScript check passes | PASS | Executed successfully after the final scenery-density adjustment. |
| Lint | Whole-project lint passes | PASS | The final full lint run passed after the final scenery-density adjustment. |
| Unit tests | Whole-project deterministic suite passes | PASS | Vitest passed 9 files / 78 tests after the final scenery-density adjustment. |
| Asset pipeline and verification | Every shipped asset matches the committed licensed inventory | PASS | `npm run assets:build` normalized only the Basis license to the already-inventoried 9,197-byte pinned output (SHA-256 `a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47`); no GLB, KTX2, or asset-manifest content changed, and `npm run assets:verify` passes. |
| Normal release build | Repository build wrapper and notices complete | PASS | After the final scenery-density adjustment, `npm run build` completed asset verification, strict typecheck, Vite production compilation, and 38,475-byte notices generation (SHA-256 `c959caf9bfbb3d9b051921453e8a19132c1b40fec2ef3f3db41676d3492f84a1`). |
| Dependency audit | Installed dependency tree has no reported vulnerabilities | PASS | `npm audit --audit-level=high` exited 0 and reported 0 vulnerabilities. |
| Comprehensive first-play tutorial | Expanded no-skip lessons and training route complete below three minutes and remain replayable | PASS | The focused tutorial/quality group passed 2/2; the 12-lesson tutorial completed in approximately 1.2 minutes and the production smoke confirmed its adaptive control guide. |
| Keyboard defaults and remapping | Arrow-cluster lane defaults, targeted migration, and custom remaps work | PASS | Migrations passed 4/4, remapping passed 1/1, the fresh keyboard race/save/retry passed 1/1, and the production smoke confirmed `← Left` / `→ Right` plus live ArrowLeft/ArrowRight input. |
| Modes and progression | Complete campaign/mode matrix remains correct | PASS | The original isolated campaign suite passed 3/3 in 6.4 minutes. The hardened isolated suite then passed 18/18 in 7.3 minutes, independently covering all 16 applicable track/mode combinations plus Solo-to-Rival and Summit Mastery progression. |
| Gamepad, touch, accessibility, and responsive layouts | All required projects and interaction gates pass | UNVERIFIED | Emulated gamepad/persistence/release quality passed 3/3; focused Chromium accessibility passed 7 checks; selected mobile-chrome, mobile-safari, and tablet-chrome touch/mirroring journeys passed. Physical inputs/devices and the full project matrix remain unverified. |
| Visual acceptance | Desktop/mobile composition and five-track identity meet accepted concept direction | UNVERIFIED | Fresh production captures exist, but owner concept review is required. Visual baselines remain untouched. |
| Visual regression | Accepted desktop/mobile/editor/high-contrast baselines pass | FAIL | The controlled run and repeat each produced 1 pass / 3 failures: editor passed; desktop race differed by 61%, portrait race by 36%, and high contrast by 39% against the 2% threshold. Baselines remain owner-unaccepted and untouched. |
| Focused lifecycle/reliability/offline | Required focused Chromium behaviors pass | PASS | Lifecycle passed 5/5, reliability passed 6/6 after the paused fallback HUD emit and explicit Lesson 1 start, and offline service-worker behavior passed 1/1. |
| Full cross-browser/device matrix | Chromium, Firefox, WebKit, mobile/tablet, persistence, lifecycle, offline, and error gates pass | UNVERIFIED | Focused Chromium scopes, campaign qualification, installed-Chrome smoke, and selected Firefox/WebKit/mobile/tablet journeys pass. The complete all-project suite, installed non-Chrome applications, and physical-device/input projects have not qualified one exact final source identity. |
| Headed local performance | Changed scene meets measured desktop/mobile-viewport budgets | PASS | `artifacts/performance/final-headed-measurement.json` records headed Chromium 149.0.7827.55. Desktop normal/stress mean FPS is 59.31/59.31 with p95 frame work 4.45/4.73 ms; emulated-mobile normal/stress mean FPS is 59.54/59.77 with p95 frame work 3.16/3.25 ms. Exact timing, draw-call, heap, host, and build details are recorded; physical mobile remains unverified. |
| Continuous 30-minute Rival soak | Automated 30-minute stability gate passes, with trends retained for human interpretation | PASS | `artifacts/performance/final-30m-soak.json` reports `releaseGate.status: PASS`: 1,800,607 ms active workload, 58 completed races, 0 timeouts, and 0 harness, failed-request, HTTP, or unexpected console/page errors. Manual memory/input/fixed-step trend review and headless scheduling caveats remain explicit; this pass is not physical-device performance evidence. |
| Final non-QA artifact and production smoke | Complete notices, checksum manifest, and installed-Chrome boot/race/editor/offline smoke pass | PASS | `artifacts/release-manifest.json` records 21 files, 4,689,233 bytes, and aggregate SHA-256 `6a55c00ea36debe543ab946dee06dc5fa73cf8a13d45b047aec399469c9931a3`. Installed Google Chrome 150.0.7871.115 passes boot/version, race/restart, editor, service-worker control, and offline reload with no network/HTTP/console failures. |
| No known product P0/P1 | Every mandatory code-owned gate is closed | UNVERIFIED | Visual regression remains `FAIL` pending owner acceptance, while visual concept review, the full cross-browser/physical-device matrix, manual/physical interaction review, and immutable source identity remain open. |

## Focused evidence retained for `rc.2`

- Final post-adjustment whole-project strict typecheck — `PASS`.
- Final post-adjustment full lint and diff validation — `PASS`.
- Final post-adjustment Vitest — `PASS`, 9 files / 78 tests.
- `VITE_QA_MODE=1 npx vite build` — `PASS` for direct compilation only.
- Chromium quality presets + comprehensive tutorial — `PASS`, 2/2; the tutorial completed in approximately 1.2 minutes, below three minutes.
- Chromium migrations — `PASS`, 4/4.
- Chromium keyboard remapping — `PASS`, 1/1.
- Chromium lifecycle — `PASS`, 5/5.
- Chromium reliability — `PASS`, 6/6 after the paused fallback HUD emit and explicit Lesson 1 start.
- Chromium offline service worker — `PASS`, 1/1.
- Chromium fresh keyboard race/save/retry — `PASS`, 1/1.
- Chromium gamepad emulation + persistence + release quality — `PASS`, 3/3.
- Chromium accessibility controls — `PASS`, 7 checks; 1 touch-project case intentionally skipped.
- Chromium core fresh race/editor — `PASS`; touch-project case intentionally skipped.
- Original isolated Chromium campaign suite — `PASS`, 3/3 in 6.4 minutes.
- Hardened isolated Chromium campaign suite — `PASS`, 18/18 in 7.3 minutes: 16 independent track/mode cases plus Solo-to-Rival and Summit Mastery.
- Selected Firefox/WebKit/mobile-chrome/mobile-safari/tablet-chrome journeys — 19 initial passes / 74 project-scope skips; the only two failures were the same stale keyboard focus-order assertion. After adding Rider School to the expected tab sequence, the Firefox/WebKit targeted rerun passed 2/2. Covered fresh race, editor, settings, release-quality, WebKit lifecycle stress, and emulated phone/tablet touch/mirroring scopes.
- Controlled Chromium/mobile-chrome visual regression and repeat — `FAIL`, each 1 pass / 3 failures; editor passed, while desktop race differed by 61%, portrait race by 36%, and high contrast by 39% against 2%; baselines untouched pending owner acceptance.
- Headed local performance — `PASS`, `artifacts/performance/final-headed-measurement.json`; Chromium 149.0.7827.55 headed on macOS arm64. Desktop normal/stress mean FPS 59.31/59.31; emulated-mobile normal/stress mean FPS 59.54/59.77. Exact frame-work, draw-call, timing, heap, host, and build-size results are retained in the artifact and `QA_REPORT.md`.
- Continuous 30-minute Rival soak automated gate — `PASS`, `artifacts/performance/final-30m-soak.json`; 1,800,607 ms active workload, 58 completed races, 0 timeouts, and no harness/network/HTTP/unexpected console-page errors. Heap, input, and fixed-step trends remain recorded for manual interpretation; headless FPS and cumulative dropped time are diagnostic.
- `npm run assets:build` — `PASS`; normalized only the Basis license to the already-inventoried 9,197-byte pinned pipeline output, with no GLB, KTX2, or asset-manifest content change.
- Final `npm run assets:verify` — `PASS`.
- Final normal `npm run build` — `PASS` after the final scenery-density adjustment; asset verification, strict typecheck, Vite production build, and 38,475-byte notices generation completed (SHA-256 `c959caf9bfbb3d9b051921453e8a19132c1b40fec2ef3f3db41676d3492f84a1`).
- `npm audit --audit-level=high` — `PASS`, exit 0 and 0 vulnerabilities.
- Final non-QA release manifest — `PASS`, format 1, 21 files, 4,689,233 bytes, aggregate SHA-256 `6a55c00ea36debe543ab946dee06dc5fa73cf8a13d45b047aec399469c9931a3`.
- Installed-Chrome production smoke — `PASS`, `artifacts/production-smoke/chrome-smoke.json`; Google Chrome 150.0.7871.115 headless passed boot/version, race/restart, editor, service-worker control, and offline reload with empty network/HTTP/console failure lists.
- Final production in-app-browser smoke — `PASS` at `http://127.0.0.1:4173/`: desktop 1280×720 and emulated portrait 390×844 inspected; Settings showed `← Left` / `→ Right`; live Practice accepted ArrowLeft/ArrowRight and pause/resume; Rider School showed 12 lessons/current adaptive controls. Captures: `/tmp/rivet-ridge-final-desktop.png`, `/tmp/rivet-ridge-final-mobile.png`, `/tmp/rivet-ridge-final-mobile-tutorial.png`.

The performance and soak artifacts qualify the deterministic QA-enabled production build at `http://127.0.0.1:4373`. The release manifest and installed-Chrome smoke qualify the separate normal non-QA build at `http://127.0.0.1:4173`. These are deliberately distinct byte sets. Emulated portrait/mobile viewport results remain responsive/local evidence only, not physical-mobile qualification.

## Required code-owned closure

1. Complete concept-art review using fresh desktop and portrait captures, deliberately accept or revise the visual baselines, and rerun the controlled visual suite after that owner decision.
2. Complete the Firefox, WebKit, installed-browser, physical mobile/tablet, physical gamepad, accessibility, touch, audio, persistence, reliability, and offline matrix against one exact final source identity. Chromium campaign qualification, headed local performance, the automated soak gate, the checksum manifest, and installed-Chrome smoke already pass in their recorded scopes.
3. Tie the exact qualified artifact and evidence to a clean source commit and annotated `v1.0.0-rc.2` tag, rebuilding and rechecking the manifest/smoke if the bytes change.

## Historical `v1.0.0-rc.1` predecessor

The annotated predecessor tag remains immutable. Its 67-pass Playwright report, 76-test Vitest run, headed-performance capture, post-fix 30-minute soak, checksum manifest, and installed-Chrome production smoke remain valid only for the predecessor's source and bytes. They may be used as comparison evidence, but they must not be relabeled as `rc.2` results or used to skip rerunning gates affected by the current changes.

## Unverified physical and application environments

| Environment | Status | Missing evidence |
|---|---:|---|
| Actual installed Firefox | UNVERIFIED | Separate current installed-application run |
| Actual Edge | UNVERIFIED | Current installed-application run |
| Actual Safari | UNVERIFIED | Current installed Safari run; Playwright WebKit is not equivalent |
| Physical Android Chrome | UNVERIFIED | Real touch, audio, storage, GPU, thermal, and battery session |
| Physical iPhone/iPad Safari | UNVERIFIED | Real touch, audio, storage, GPU, thermal, and battery session |
| Physical gamepad | UNVERIFIED | Controller model, prompts, stuck-input cleanup, and vibration where supported |
| Subjective audio, touch comfort, visual fidelity, and race fairness | UNVERIFIED | Human review on representative physical devices and inputs |

## External owner actions

| Owner action | Status | Required evidence |
|---|---:|---|
| Final trademark, trade-dress, copyright, and generated-output review | EXTERNAL BLOCKER | Owner/counsel approval and archived provenance decision |
| Top-level product license | EXTERNAL BLOCKER | Owner-selected root `LICENSE` and final notice review |
| Generated-image account/agreement provenance | EXTERNAL BLOCKER | Governing account terms and prompt/session or receipt evidence |
| Neutral public workspace/repository name | EXTERNAL BLOCKER | Rename the local folder before public logs, CI, support exports, or provenance records |
| Production hosting, DNS/TLS, security headers, credentials, and deployment target | EXTERNAL BLOCKER | Owner-selected host, verified response headers, and tested immutable deploy/rollback procedure |
| Public support, release, rollback, and incident ownership | EXTERNAL BLOCKER | Named release/support/rollback/incident owners and public support path |
| Physical/application test-matrix access | EXTERNAL BLOCKER | Owner-provided devices, gamepad, installed browsers, and assigned human review |

**Current final status: NOT READY.**
