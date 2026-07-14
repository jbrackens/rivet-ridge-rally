# RIVET RIDGE RALLY — QA Report

**Report date:** 2026-07-14

**Milestone:** `1.0.0-rc.2` working-candidate hardening

**Tested source:** uncommitted working tree derived from the immutable `v1.0.0-rc.1` release tag

**Overall code-owned QA status:** UNVERIFIED

**Release decision:** NOT READY

## 1. Executive result

Player feedback reopened keyboard defaults, first-play training, and concept-art fidelity after `v1.0.0-rc.1`. The fixes are being qualified as a new `1.0.0-rc.2` candidate. The `v1.0.0-rc.1` tag, artifact, reports, and test evidence remain immutable historical records; none of that evidence is represented as qualification of the changed working tree.

Post-scene static and unit validation is positive: whole-project strict typechecking and lint pass, and Vitest passes 9 files / 78 tests. Focused Chromium groups pass for migrations, tutorial/quality, lifecycle, reliability, offline service-worker behavior, a fresh keyboard race/save/retry, gamepad emulation/persistence/release quality, accessibility controls, and core fresh-race/editor journeys. Campaign qualification is now complete in isolated Chromium: the original suite passed 3/3 in 6.4 minutes, then the hardened one-case-per-scenario suite passed 18/18 in 7.3 minutes, covering all 16 applicable track/mode combinations plus Solo-to-Rival and Summit Mastery progression. A selected cross-engine run added 19 passes across Firefox, WebKit, mobile-chrome, mobile-safari, and tablet-chrome; its only two failures were the same stale focus-order assertion, which omitted the new Rider School menu item. After the assertion was corrected, the Firefox and WebKit keyboard-only journeys passed 2/2.

The controlled visual gate remains open. Across Chromium and mobile-chrome, the current run passed the editor baseline but failed the desktop race, portrait race, and high-contrast race baselines by 61%, 36%, and 39%, respectively, against a 2% threshold. A controlled repeat produced the same three failures. These are deliberate scene changes against owner-unaccepted baselines, so the baselines remain untouched pending owner review.

The final `rc.2` evidence also now includes a headed Chromium 149 local performance measurement, a 30-minute headless Chromium 149 Rival soak whose automated release gate is `PASS`, a normal non-QA 21-file checksum manifest, `npm audit` with 0 vulnerabilities, and an installed Google Chrome 150 production smoke covering boot/version, race/restart, editor, and offline service-worker reload. The performance and soak artifacts use a QA-enabled production build at `http://127.0.0.1:4373`; the checksum manifest and Chrome smoke qualify the distinct normal non-QA build at `http://127.0.0.1:4173`.

The soak pass is scoped honestly. It completed 58 races with 0 timeouts over 1,800,607 ms of active workload and reported no failed requests, HTTP errors, harness errors, or unexpected console/page messages. Its FPS is diagnostic because the browser was headless and offscreen scheduling throttled animation. The artifact explicitly requires manual review of memory, input-latency, and fixed-step trends: heap use rose from 14,761,964 to 28,469,480 bytes; input-window means improved rather than accumulated; and the cross-restart cumulative dropped-simulation counter reached 706,442 ms even though the per-attempt maximum trend fell by 1,441.92 ms between the first and last windows. This cumulative headless counter is retained as evidence, not treated as a headed-FPS result or silently generalized into a physical-device conclusion.

Physical device/browser coverage and owner-controlled legal, licensing, naming, hosting, deployment, support, and release actions remain unresolved. This report does not claim launch readiness.

## 2. Status definitions

| Status | Meaning in this report |
|---|---|
| `PASS` | The specifically named scope was executed against the recorded candidate state and produced evidence; any later source difference is stated explicitly. |
| `FAIL` | A mandatory behavior, artifact, or release gate is absent or did not pass. |
| `UNVERIFIED` | Required evidence has not been executed for this changed candidate or the required environment was unavailable. |
| `EXTERNAL BLOCKER` | Completion requires owner credentials, legal approval, publishing access, or another owner action outside the repository. |

Statuses are deliberately scoped. A focused Chromium pass does not qualify other browsers, a direct Vite compile does not replace the repository asset gate, and an emulated viewport does not prove physical-device ergonomics or performance.

## 3. Candidate identity

| Item | Status | Recorded evidence |
|---|---:|---|
| Working candidate | UNVERIFIED | Changes are assigned to `1.0.0-rc.2`, but the working tree is uncommitted and has no annotated release tag. A checksummed artifact exists, but it is not yet tied to immutable source identity. |
| Historical predecessor | PASS | Annotated `v1.0.0-rc.1` and its recorded artifact/evidence remain unchanged historical inputs only. |
| Immutable `rc.2` source identity | UNVERIFIED | Requires a clean final source revision and new annotated tag after all mandatory gates pass. |
| Recorded `rc.2` artifact identity | PASS | `artifacts/release-manifest.json` records format 1, product/version, 21 files, 4,689,233 bytes, and aggregate SHA-256 `6a55c00ea36debe543ab946dee06dc5fa73cf8a13d45b047aec399469c9931a3`. The installed-Chrome production smoke also passes. This byte identity remains distinct from the open immutable-source gate. |

## 4. Evidence executed for `1.0.0-rc.2`

| Check | Status | Executed result and scope |
|---|---:|---|
| Final strict TypeScript check | PASS | Whole-project typecheck completed without errors after the final scenery-density adjustment. |
| Final full lint | PASS | The complete lint suite passed after the final scenery-density adjustment. |
| Final Vitest suite | PASS | 9 test files / 78 tests passed after the final scenery-density adjustment. |
| Final Vitest coverage run | PASS | `npm run test:coverage` passed 9 files / 78 tests. V8 reported 17.06% statements, 24.00% branches, 16.61% functions, and 17.33% lines; no repository coverage threshold is configured, so this is execution evidence rather than a claim of comprehensive unit coverage. Browser suites carry the rendered runtime/editor/UI coverage. |
| Direct QA-mode Vite build | PASS | `VITE_QA_MODE=1 npx vite build` completed. This proves compilation only because it bypasses the repository asset-verification wrapper. |
| Quality presets + comprehensive tutorial — Chromium | PASS | 2/2 passed. The tutorial completed in approximately 1.2 minutes, exercised all 12 no-skip lessons and the persistent Rider School replay path, and remained below the 180-second requirement. |
| Sequential/default-binding migrations — Chromium | PASS | 4/4 migration cases passed, including conversion of the exact legacy default lane pair while preserving custom bindings. |
| Keyboard remapping — Chromium | PASS | 1/1 passed; a custom lane binding remains accepted and usable. |
| Lifecycle — Chromium | PASS | 5/5 passed for the focused lifecycle group. |
| Reliability — Chromium | PASS | 6/6 passed after the paused fallback HUD began emitting and the tutorial reliability case explicitly started Lesson 1. |
| Offline service worker — Chromium | PASS | 1/1 passed. |
| Fresh keyboard race/save/retry — Chromium | PASS | 1/1 passed with the arrow-cluster defaults. |
| Gamepad emulation + persistence + release quality — Chromium | PASS | 3/3 passed. This is emulated-controller evidence, not a physical-gamepad pass. |
| Accessibility controls — Chromium | PASS | 7 checks passed; 1 touch-project case was intentionally skipped by project scope. |
| Selected cross-engine browser journeys | PASS | The selected Firefox/WebKit/mobile-chrome/mobile-safari/tablet-chrome run produced 19 passes and 74 project-scope skips. Firefox and WebKit passed fresh keyboard race, editor, settings persistence, and release-quality surfaces; WebKit also passed five lifecycle stress cases; the phone/tablet projects passed touch-race and mirrored-control journeys. The only two initial failures were one stale keyboard focus-order assertion in Firefox and WebKit; after adding Rider School to the expected tab sequence, the targeted rerun passed 2/2. This is engine/emulation evidence, not installed Safari/Firefox or physical-device qualification. |
| Core fresh race/editor — Chromium | PASS | The fresh-race and editor checks passed; the touch-project case was intentionally skipped by project scope. |
| Original campaign modes suite — isolated Chromium | PASS | The original isolated `e2e/campaign-modes.spec.ts` run passed 3/3 in 6.4 minutes. |
| Hardened campaign modes suite — isolated Chromium | PASS | The hardened suite passed 18/18 in 7.3 minutes: 16 independently timed track/mode cases plus Solo-to-Rival and Summit Mastery progression. Per-case race-health capture now preserves failure context without turning one slow case into an opaque suite timeout. |
| Controlled visual regression + repeat — Chromium/mobile-chrome | FAIL | Each controlled run executed four applicable baselines: editor passed; desktop race differed by 61%, portrait race by 36%, and high-contrast race by 39%, each against a 2% threshold. The controlled repeat produced the same failures. Baselines were intentionally not updated pending owner acceptance. |
| Headed local performance measurement | PASS | `artifacts/performance/final-headed-measurement.json` records headed Chromium 149.0.7827.55 on macOS arm64. Desktop 1920×1080: shell 1,284.12 ms, first race 324.48 ms, restart 175.35 ms, editor open/test 848.91/180.31 ms; normal FPS min/mean/p95 57/59.31/60 with frame-work mean/p95 2.71/4.45 ms and draw calls mean/p95 357.15/381; stress FPS 57/59.31/60 with 3.42/4.73 ms and 561.62/593 draws. Emulated mobile 390×844 at 2×: shell 1,363.59 ms, first race 123.89 ms, restart 157.23 ms, editor 855.33/176.38 ms; normal FPS 58/59.54/60 with 1.80/3.16 ms and 202.38/238 draws; stress FPS 59/59.77/60 with 2.30/3.25 ms and 266.46/338 draws. Both profiles recorded six heap stages and no console messages. The mobile profile is local viewport evidence, not physical-mobile performance. |
| Continuous 30-minute Rival soak | PASS | `artifacts/performance/final-30m-soak.json` records headless Chromium 149.0.7827.55, 1,800,607 ms active workload / 1,809,937 ms wall duration, 176 samples, 58 completed races, 0 timeouts, and restart min/mean/p95/max 3,365.95/3,583.24/3,908.50/4,208.60 ms. All 12 automated release criteria passed; there were 0 failed requests, HTTP errors, harness errors, or unexpected console/page messages. Four known headless `ReadPixels` warnings were separated. Manual trend and headless fixed-step caveats are recorded in Section 7. |
| `npm run assets:build` | PASS | The documented pipeline replaced only the LF-normalized 9,141-byte Basis license with the pinned TypeScript pipeline output already recorded in the asset inventory: 9,197 bytes, SHA-256 `a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47`. No GLB, KTX2, or asset-manifest content changed. |
| Final `npm run assets:verify` | PASS | The post-adjustment pipeline output matches the committed asset inventory, including the 9,197-byte Basis license and its recorded hash. |
| Final normal `npm run build` | PASS | After the final scenery-density adjustment, the full `1.0.0-rc.2` build completed asset verification, strict typecheck, Vite production compilation, and notice generation. `dist/THIRD_PARTY_NOTICES.txt` is 38,475 bytes with SHA-256 `c959caf9bfbb3d9b051921453e8a19132c1b40fec2ef3f3db41676d3492f84a1`. |
| Dependency audit | PASS | `npm audit --audit-level=high` completed with exit code 0 and reported 0 vulnerabilities. |
| Final non-QA release manifest | PASS | `artifacts/release-manifest.json` records format 1, `RIVET RIDGE RALLY` `1.0.0-rc.2`, 21 files, 4,689,233 bytes, and aggregate SHA-256 `6a55c00ea36debe543ab946dee06dc5fa73cf8a13d45b047aec399469c9931a3`. Its notices entry is 38,475 bytes with SHA-256 `c959caf9bfbb3d9b051921453e8a19132c1b40fec2ef3f3db41676d3492f84a1`. |
| Installed-Chrome production smoke | PASS | `artifacts/production-smoke/chrome-smoke.json` records installed Google Chrome 150.0.7871.115, headless, against the normal build. Boot/version, race start/restart, editor open, and offline service-worker reload passed; the production runtime exposed no QA API; service-worker control and offline reload passed; failed requests, HTTP errors, and all console-message lists were empty. Screenshots: `chrome-race.png`, `chrome-editor.png`, `chrome-offline-title.png`. |
| Final production in-app-browser smoke | PASS | The normal build at `http://127.0.0.1:4173/` was inspected at desktop 1280×720 and emulated portrait 390×844. Settings showed `← Left` / `→ Right`; live Practice accepted ArrowLeft/ArrowRight and pause/resume; Rider School showed 12 lessons and current adaptive controls. Captures: `/tmp/rivet-ridge-final-desktop.png`, `/tmp/rivet-ridge-final-mobile.png`, `/tmp/rivet-ridge-final-mobile-tutorial.png`. Emulated portrait is responsive-layout evidence only, not physical-mobile or performance evidence. |

The headed performance and soak artifacts qualify the QA-enabled production build needed for deterministic controls; the release manifest and Chrome smoke qualify the separate normal non-QA build. They must not be treated as one byte-identical artifact. The working tree is still uncommitted, so none of these saved results closes immutable source identity or the unexecuted cross-browser/physical-device matrix.

## 5. Gameplay, controls, and persistence

| ID | Requirement | Status | Current evidence |
|---|---|---:|---|
| GP-01 | First-play tutorial demonstrates required mechanics in under three minutes and remains replayable | PASS | The focused tutorial/quality group passed 2/2; the 12-lesson tutorial completed in approximately 1.2 minutes and the production smoke confirmed its adaptive control guide. |
| GP-02 | Campaign and every track/mode remain complete | PASS | The original isolated campaign suite passed 3/3 in 6.4 minutes. The hardened isolated suite then passed 18/18 in 7.3 minutes, independently covering all 16 applicable track/mode combinations plus Solo-to-Rival and Summit Mastery progression. This supersedes the earlier loaded-host timeout as current campaign qualification evidence. |
| CA-01 | Keyboard lane defaults use the arrow cluster | PASS | The fresh keyboard race/save/retry passed 1/1, and the final production smoke confirmed `← Left` / `→ Right` plus live ArrowLeft/ArrowRight input; A/D are no longer the fresh-profile defaults. |
| CA-02 | Custom keyboard remapping remains supported | PASS | Focused Chromium remapping 1/1 passed. |
| CA-03 | Existing exact A/D defaults migrate without overwriting custom pairs | PASS | Focused Chromium migration suite 4/4 passed. |
| CA-04 | Gamepad and touch behavior remain correct | UNVERIFIED | The focused emulated-gamepad group passed, but the touch-project cases were intentionally skipped and no physical gamepad or touch device was exercised. |
| RL-02 | Sequential database migrations preserve rider data | PASS | Focused migration suite 4/4 passed through schema v4, including the targeted default-binding update. |
| RL-13 | Restart, visibility, renderer, input, and storage lifecycle remain reliable | PASS | Focused Chromium lifecycle 5/5 and reliability 6/6 passed; the reliability rerun followed the paused fallback HUD emit and explicitly started Lesson 1. Offline service-worker behavior also passed 1/1. |

## 6. Visual and browser acceptance

| Gate | Status | Required closure evidence |
|---|---:|---|
| Concept-art fidelity | UNVERIFIED | Fresh desktop 1280×720 and emulated portrait 390×844 production captures exist, but owner review of composition, camera, terrain, rider scale, lighting, HUD, and tutorial placement is still required. |
| Visual regression | FAIL | The current controlled run and controlled repeat each produced 1 pass / 3 failures across the four applicable Chromium/mobile-chrome baselines. Editor passed; desktop race differed by 61%, portrait race by 36%, and high contrast by 39% against the 2% threshold. Baselines remain untouched until the deliberate scene changes receive owner acceptance. |
| Five-track visual identity | UNVERIFIED | Fresh start/midcourse captures and human review for all five tracks. |
| Five-track-by-mode campaign matrix | PASS | The original isolated suite passed 3/3 in 6.4 minutes; the hardened isolated suite passed 18/18 in 7.3 minutes, including independent coverage of all 16 applicable track/mode combinations. |
| Full cross-browser/device matrix | UNVERIFIED | Selected journeys now pass in Firefox, WebKit, mobile-chrome, mobile-safari, and tablet-chrome, but the complete suite was not rerun across every project. Bundled engines/emulated viewports also do not qualify installed Safari/Firefox/Edge or physical devices. |
| Accessibility and responsive layouts | UNVERIFIED | Focused accessibility controls passed 7 checks with 1 intentional touch-project skip, and emulated 390×844 production inspection passed as responsive evidence. Physical touch, all target projects, and manual accessibility review remain unverified. |
| Browser/runtime error gate | UNVERIFIED | Focused lifecycle, reliability, offline, race, editor, campaign, soak, installed-Chrome smoke, Firefox/WebKit release-quality, and selected mobile/tablet scopes pass without unexpected runtime/network errors. The aggregate gate remains open because the entire project matrix, installed non-Chrome browsers, and physical devices are unverified. |

The previously accepted `rc.1` visual baselines and fidelity ledger do not close the new feedback. They remain historical evidence until the `rc.2` compositions receive fresh review; the current screenshot deltas were not accepted by silently rewriting those baselines.

## 7. Performance, artifact, and source gates

| Gate | Severity | Status | Required closure evidence |
|---|---:|---:|---|
| Basis asset inventory consistency | P1 | PASS | The documented asset build normalized the license to the already-inventoried 9,197-byte pipeline output; verification and the normal build now pass. |
| Final whole-project static and unit validation | P1 | PASS | Post-adjustment typecheck, full lint, diff validation, and Vitest 9 files / 78 tests passed. |
| Final whole-project browser validation | P1 | FAIL | Campaign qualification now passes in isolated Chromium, including the hardened 18/18 run. The controlled visual run and repeat each remain 1 pass / 3 owner-unaccepted baseline failures, and the complete cross-browser/device matrix remains unverified. |
| Headed local desktop/emulated-mobile performance | P1 | PASS | `artifacts/performance/final-headed-measurement.json` records Chromium 149 headed results for desktop 1920×1080 and emulated mobile 390×844 at 2×. Normal/stress mean FPS is 59.31/59.31 desktop and 59.54/59.77 mobile; p95 frame work is 4.45/4.73 ms desktop and 3.16/3.25 ms mobile. Exact load, restart, editor, draw-call, heap, browser, host, and build-size evidence is retained in the artifact and Section 4. Physical-mobile performance remains unverified. |
| Continuous 30-minute Rival soak | P1 | PASS | The artifact's automated release gate passed all 12 criteria: 1,800,607 ms active workload, 58 completed races, 0 timeouts, complete memory/input/fixed-step samples, and no harness, network, HTTP, or unexpected console/page failures. The four known headless `ReadPixels` warnings were classified separately. Manual trend review and headless/offscreen limitations are stated below. |
| Dependency audit | P1 | PASS | `npm audit --audit-level=high` exited 0 with 0 vulnerabilities. |
| Final non-QA artifact and production smoke | P1 | PASS | The normal build and notices pass; the 21-file, 4,689,233-byte release manifest records aggregate SHA-256 `6a55c00ea36debe543ab946dee06dc5fa73cf8a13d45b047aec399469c9931a3`; installed Google Chrome 150.0.7871.115 passes boot/version, race/restart, editor, service-worker control, and offline reload with no network/HTTP/console failures. |
| Immutable source identity | P1 | UNVERIFIED | Clean final commit and annotated `v1.0.0-rc.2` tag tied to the qualified artifact and reports. |

The soak's `releaseGate.status` is `PASS`, but the artifact intentionally does not automate the required trend judgment. Heap used bytes were 14,761,964 first, 28,469,480 last, and 56,992,116 maximum; the first-to-last 36-sample window means increased by 14,407,287.22 bytes. Dispatch-delay mean/p95/max was 168.81/198.50/240.50 ms and its window mean fell 5.92 ms; keydown-to-frame mean/p95/max was 2.84/3.70/4.50 ms and its window mean fell 0.20 ms. The cumulative dropped-simulation counter deliberately sums each restarted race and ended at 706,442 ms; the per-attempt maximum was 9,231–14,091 ms and its first-to-last window mean fell 1,441.92 ms. Because this was a headless offscreen run, sampled FPS and cumulative dropped time are diagnostic stability evidence, not qualifying headed performance or physical-device evidence.

## 8. Unverified physical/application environments

| Environment | Status | Missing evidence |
|---|---:|---|
| Actual installed Firefox | UNVERIFIED | Separate current installed-application run |
| Actual Edge | UNVERIFIED | Current installed-application run |
| Actual Safari | UNVERIFIED | Current installed Safari run; Playwright WebKit is not equivalent |
| Physical Android Chrome | UNVERIFIED | Real touch/audio/storage/performance/thermal session |
| Physical iPhone/iPad Safari | UNVERIFIED | Real touch/audio/storage/performance/thermal session |
| Physical gamepad | UNVERIFIED | Controller model, prompts, stuck-input cleanup, and vibration where supported |
| Subjective audio, touch comfort, visual fidelity, and race fairness | UNVERIFIED | Human review on representative physical devices and inputs |

## 9. External owner actions

| Owner action | Status | Required evidence |
|---|---:|---|
| Final trademark, trade-dress, copyright, and generated-output review | EXTERNAL BLOCKER | Owner/counsel approval and archived provenance decision |
| Top-level product license | EXTERNAL BLOCKER | Owner-selected root `LICENSE` and final notice review |
| Generated-image account/agreement provenance | EXTERNAL BLOCKER | Governing account terms and prompt/session or receipt evidence |
| Neutral public workspace/repository name | EXTERNAL BLOCKER | Rename the local folder before public logs, CI, support exports, or provenance records |
| Production hosting, DNS/TLS, security headers, credentials, and deployment target | EXTERNAL BLOCKER | Owner-selected host, verified response headers, and tested immutable deploy/rollback procedure |
| Public support, release, rollback, and incident ownership | EXTERNAL BLOCKER | Named release/support/rollback/incident owners and public support path |
| Physical/application test-matrix access | EXTERNAL BLOCKER | Owner-provided devices, gamepad, installed browsers, and assigned human review |

## 10. Historical `v1.0.0-rc.1` evidence

The annotated `v1.0.0-rc.1` tag identifies the predecessor's immutable source and its passing evidence: 67 Playwright passes with 0 failures, 76 Vitest passes, headed performance, a successful post-fix 30-minute Rival soak, a 21-file non-QA checksum manifest, and an installed-Chrome production smoke. Those reports and artifacts remain valid only for the predecessor's bytes. The tag must not be moved, rebuilt, or relabeled as `rc.2` evidence.

## 11. QA conclusion

The changed candidate has proof for the requested keyboard defaults, migration behavior, remapping, expanded tutorial, static/unit quality, campaign/mode completeness, selected Firefox/WebKit/mobile/tablet journeys, headed local performance, the automated 30-minute soak gate, the final normal build and notices, dependency audit, checksum artifact, and installed-Chrome production smoke. It does not yet have the full evidence needed for release.

The code-owned QA status is **UNVERIFIED**. The controlled visual regression gate is **FAIL** pending deliberate owner acceptance: editor passes, but desktop, portrait, and high-contrast race baselines fail repeatably and remain untouched. Concept-art acceptance, the complete cross-browser and physical-device matrix, manual/physical input and accessibility review, and immutable `rc.2` source identity remain **UNVERIFIED**. The exact non-QA artifact is checksummed and passes installed-Chrome smoke, but it is not yet tied to a clean commit and annotated tag. The release decision is **NOT READY**.
