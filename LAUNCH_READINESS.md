# RIVET RIDGE RALLY — Launch Readiness

# NOT READY

**Decision date:** 2026-07-13

**Candidate:** annotated `v1.0.0-rc.1` release tag on `main`

**Code-owned gate status:** PASS

**Commercial readiness status:** NOT READY

**Authority:** `QA_REPORT.md`

**Decision owner:** Unassigned

RIVET RIDGE RALLY is feature-complete for the defined RC1 scope and its current automated product matrix passes. The path-clean current-source browser run completed in approximately **48.4 minutes** with **67 passed, 221 intentional project-scoped skips, and 0 failures** across 288 project results. Eight Vitest files contain **76 passing tests**. Gameplay, the under-three-minute tutorial, every applicable launch-track/race-mode combination, campaign progression, shared-rule AI, the complete editor, accessibility, persistence, lifecycle/restart recovery, offline operation, visual regression, headed performance, the post-fix continuous 30-minute Rival soak, the final non-QA artifact, and installed-Chrome production smoke are `PASS` in their recorded scope.

All repository-controlled implementation, evidence, artifact, and immutable-source gates are `PASS`. No known product P0 or P1 remains in the completed automated scope. The earlier soak that reproduced WebGL-context leakage is retained as failed evidence; renderer lifecycle regressions, the current full matrix, and the post-fix 30-minute soak now pass. The non-QA manifest, actual Google Chrome 150 production smoke, release commit, and annotated tag also pass.

The commercial decision remains **NOT READY** because physical and application-specific gaps remain explicitly `UNVERIFIED`, while owner-only legal, licensing, naming, hosting, deployment, support, rollback, and physical-matrix actions remain `EXTERNAL BLOCKER` items.

## Gate summary

| Gate | Required outcome | Status | Current evidence |
|---|---|---:|---|
| Clean install and static validation | Lockfile install, strict typecheck, lint, unit tests, asset verification, dependency audit, and direct tree pass | PASS | `npm ci`; typecheck; lint; 8 files/76 tests; GLB/KTX2 validator 0 errors; audit 0 vulnerabilities/320 entries; 31 exact direct dependencies |
| Playable core and tutorial | Title, no-skip tutorial, handling, finish/results, persistence, pause, and immediate retry/restart | PASS | Tutorial clears every required mechanic and both collision drills in 48.0 seconds; desktop core journeys pass in Chromium, Firefox, and WebKit |
| Five-track content | Every launch track loads and completes two production-distance laps with ordered checkpoints | PASS | Canyon Kickoff, Pine Run, Coastline Clash, Foundry Flight, and Summit Showdown each complete Lap 1 and Lap 2 in Chromium |
| Modes and progression | Solo, Rival, Practice, campaign unlocks, classification, and seven-tier Summit mastery work | PASS | Browser Solo/Rival/Mastery journeys plus progression unit matrix pass; official Rival field contains six sorted finishers |
| Simulation, AI, and collisions | Deterministic fixed-step rules, three difficulties, route/pursuer behaviors, and asymmetric rear contact pass | PASS | Shared `RaceSimulation` unit coverage and browser Rival results pass |
| Track editor | All 25 modules, camera, 50-action history, tools, 1–9 laps, validation, interchange, examples, save/reload, and test play pass | PASS | Exhaustive Chromium matrix plus cross-engine core editor journeys and deterministic conversion/validation tests pass |
| Controls and accessibility | Keyboard/remap, synthetic gamepad, touch/mirror, settings, captions, non-color cues, axe, and responsive layouts pass | PASS | Desktop engine, Pixel 7, iPhone 15, Galaxy Tab S9, high-contrast, all-screen axe, and layout gates pass |
| Persistence and reliability | Browser restart, repeated in-place restart, visibility suspension, v1/v2 migrations, corruption, unavailable/quota/version failures, unsupported WebGL, asset fallback, and offline reload pass | PASS | Persistence, migration, Chromium/WebKit lifecycle, reliability, and service-worker v7 tests pass |
| Visual acceptance | Accepted title/race/mobile/editor/high-contrast compositions and five track identities remain stable | PASS | Seven visual baselines, ten five-track review captures, and `docs/design/FIDELITY_LEDGER.md` report no visual P0/P1 |
| Privacy, dependencies, and asset provenance | Local-only runtime, no tracking/account, pinned dependencies, inventoried original/licensed assets, and notices | PASS | Source/static audit, zero-vulnerability audit, asset verifier, `ASSET_LICENSES.md`, and generated full third-party notice pass |
| Headed local performance | Desktop 1920×1080 and emulated mobile metrics, load/restart/editor timing, heap checkpoints, and Rival stress are recorded | PASS | Desktop normal/stress mean 59.31 FPS; mobile normal mean 58.50 and stress mean 59.54 FPS; exact artifact below |
| QA payload budget | Measured QA candidate remains below 12 MB raw | PASS | 21 files; 4,678,172 raw bytes; 3,025,236 independently gzipped bytes |
| No known product P0/P1 | Completed automated scope contains no open product-blocking defect | PASS | Current full matrix has zero failures; lifecycle failure is closed by targeted tests, full rerun, and post-fix soak |
| Continuous 30-minute Rival soak | No runaway memory, dropped-time growth, input lag, crash loop, or save corruption | PASS | 1,800,503 ms active duration; 65 races; 0 timeouts; complete telemetry; no failed requests, HTTP errors, unexpected runtime messages, or harness errors; manual trend review passed |
| Final non-QA release artifact | Release build, notices, source/path/QA-marker guard, checksums, and production smoke pass | PASS | Manifest: 21 files/4,675,553 bytes, aggregate SHA-256 `d953ed1ed66f82a26043d3fbffe634ed8d35021edb8e90ee0f8f064567a70a97`; installed Chrome 150 boot/race/editor/offline smoke passes cleanly |
| Immutable source identity | Final evidence is tied to a source commit and annotated release tag | PASS | Release commit on `main` is identified by annotated tag `v1.0.0-rc.1`; source/history hygiene scans pass |

## Validated evidence

### Automated matrix

- `npm ci` — `PASS`; final clean install added 268 packages, audited 269, and reported zero vulnerabilities.
- `npm run typecheck` — `PASS`.
- `npm run lint` — `PASS`.
- `npm run test` — `PASS`; 8 files, 76 tests, 0 failures.
- `npm run test:coverage` — `PASS`; lines 631/3,540 (17.82%), statements 695/3,987 (17.43%), functions 110/647 (17.00%), branches 533/2,112 (25.23%). Browser-heavy UI/renderer code is covered primarily by Playwright; simulation exceeds 91% line coverage and editor validation/definition conversion exceed 89%.
- `npm run assets:verify` — `PASS`; original 15,172-byte Meshopt GLB, 2,236-byte BasisLZ KTX2, required extensions, independent decode, and validator 0 errors.
- `npm run audit` — `PASS`; zero vulnerabilities across 320 lockfile package entries.
- `npm ls --depth=0 --json` — `PASS`; 31 exact direct dependencies, no problems/missing/extraneous entries.
- `npm run test:e2e` — `PASS`; 48 definitions across six projects, 67 passed, 221 intentional project-routed skips, 0 failed, approximately 48.4 minutes.

The durable path-clean current-source report is `artifacts/playwright/full-matrix-current/index.html`, SHA-256 `cbf40421cd5fd9a1c1982a467e67fd38270514c46ad5f4fb1cfb3cf8d3ea3590`. Its embedded archive has zero `/Users/` and local workspace-folder-name hits. The passing projects are Playwright Chromium, Firefox, WebKit, Pixel 7 mobile-Chrome, iPhone 15 mobile-Safari, and Galaxy Tab S9 tablet-Chrome.

### Headed performance

`artifacts/performance/final-headed-measurement.json` records headed Chromium 149.0.7827.55 on the local arm64 Mac:

| Metric | Desktop 1920×1080 | Mobile viewport 390×844 |
|---|---:|---:|
| First race ready | 137.42 ms | 129.16 ms |
| Restart | 238.33 ms | 163.23 ms |
| Editor open / test play | 848.26 / 170.09 ms | 838.15 / 181.10 ms |
| Normal FPS min / mean / max | 57 / 59.31 / 60 | 55 / 58.50 / 60 |
| Normal CPU work p95 | 4.59 ms | 2.84 ms |
| Normal draw calls max | 367 | 232 |
| Rival-stress FPS mean | 59.31 | 59.54 |
| Rival-stress CPU work p95 | 4.49 ms | 3.15 ms |
| Rival-stress draw calls max | 559 | 309 |

### Continuous Rival soak

`artifacts/performance/final-30m-soak.json` is `PASS`: Chromium 149.0.7827.55 headless, 1920×1080 Rival mode, 1,800,503 ms active and 1,808,774 ms total harness duration, 65 completed races, 0 timeouts, and 196 complete samples. It recorded 0 failed requests, 0 HTTP error responses, 0 unexpected console/page messages, and 0 harness errors. Four known headless `ReadPixels` driver diagnostics were classified separately.

Manual trend review passed. Key-to-frame latency remained flat at 2.63 ms mean/3.3 ms p95. The first-to-last heap delta was +18.39 MB, but the final three five-minute-window means were 31.09/35.93/35.13 MB with stable maxima and minima, consistent with warm-up and garbage-collection plateaus rather than runaway growth. Per-attempt dropped-time first/last window means were 10,512.64/10,580.64 ms (+68 ms); the 679,807 ms cumulative value is a sum of independent attempt-local headless diagnostics, not worsening simulation debt.

The historical `artifacts/performance/failed-context-leak-30m-soak.json` remains explicit failed evidence: 56 races, 1 timeout, 43 WebGL-context warnings, and +18.60 MB first-to-last heap growth. The renderer lifecycle fix closed that defect. An interrupted harness invocation produced no artifact and is not counted.

### Final non-QA artifact and production smoke

`artifacts/release-manifest.json` passes with 21 files, 4,675,553 raw bytes, complete notices, no source maps/QA marker/local path/prohibited workspace-name bytes, and aggregate SHA-256 `d953ed1ed66f82a26043d3fbffe634ed8d35021edb8e90ee0f8f064567a70a97`.

`artifacts/production-smoke/chrome-smoke.json`, SHA-256 `c63e476ed8b62205374cd8704770ab7f886f9defb56227b8d64ee3178e04061b`, is a `PASS` from installed Google Chrome 150.0.7871.115 headless against those non-QA bytes. It verifies boot/version and QA absence, race restart, editor open, service-worker control, and offline reload, with 0 failed requests, HTTP errors, console messages, or smoke errors. Three matching screenshots are retained under `artifacts/production-smoke/`. A clean in-app-browser manual smoke is supplemental only and does not certify actual Firefox, Safari, Edge, or physical devices.

## Accepted candidate decisions

The stable public Basis transcoder and Vite-emitted hashed copy create an intentional **584,862-byte raw duplicate**. This is an accepted `1.0.0-rc.1` P2 because it preserves explicit same-origin/offline paths, retains required license/NOTICE material, and remains within the payload budget. Removing it is a later optimization and requires a new offline and asset audit.

The CSP is hardened to same-origin defaults/connections, self/blob workers, no media or objects, and constrained form/base behavior. The remaining Basis-required `'unsafe-eval'` and controlled inline-style allowances are documented compatibility decisions. They are not known P0/P1 defects; any transcoder or UI dependency change must reopen CSP review. The final non-QA bundle/network scan passed as part of the recorded release-artifact evidence.

## Remaining code-owned work

None. The immutable release identity and all other repository-controlled RC1 gates are `PASS`.

## Unverified physical and application environments

These gaps are not converted into failures or passes. Emulation and Playwright engines remain explicitly scoped evidence.

| Environment | Status | Missing evidence |
|---|---:|---|
| Actual installed Firefox | UNVERIFIED | Separate current installed-application run |
| Actual Edge | UNVERIFIED | Edge is not installed in the test environment |
| Actual Safari | UNVERIFIED | Current installed Safari run; Playwright WebKit is not equivalent |
| Physical Android Chrome | UNVERIFIED | Real touch, audio, storage, GPU, thermal, and battery session |
| Physical iPhone/iPad Safari | UNVERIFIED | Real touch, audio, storage, GPU, thermal, and battery session |
| Physical gamepad | UNVERIFIED | Controller model, prompts, stuck-input cleanup, and vibration where supported |
| Subjective audio, touch comfort, and race fairness | UNVERIFIED | Human review on representative physical devices and inputs |

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

## Artifacts

- `QA_REPORT.md` — detailed requirement-level authority.
- `artifacts/playwright/full-matrix-current/index.html` — current-source 67-pass browser report.
- `coverage/index.html` — unit coverage report.
- `artifacts/performance/final-headed-measurement.json` and `artifacts/performance/headed-screenshots/` — headed performance evidence.
- `artifacts/performance/final-30m-soak.json` — passing post-fix 30-minute Rival soak.
- `artifacts/performance/failed-context-leak-30m-soak.json` — retained historical failed soak and defect evidence.
- `artifacts/release-manifest.json` — final non-QA 21-file checksum manifest.
- `artifacts/production-smoke/chrome-smoke.json` and its three screenshots — installed-Chrome production-smoke evidence.
- `e2e/core-flow.spec.ts-snapshots/` and `e2e/visual-regression.spec.ts-snapshots/` — accepted visual baselines.
- `artifacts/visual-review/` and `docs/design/FIDELITY_LEDGER.md` — five-track and concept fidelity review.
- `ASSET_LICENSES.md` and `THIRD_PARTY_NOTICES.md` — source/static provenance and notice evidence.

The release commit, annotated tag, continuous 30-minute soak, final non-QA release manifest, and installed-Chrome production smoke are complete and `PASS`. The remaining decision gates require physical/application testing or owner action outside the repository.

**Current final status: NOT READY.**
