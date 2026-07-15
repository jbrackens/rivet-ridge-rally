# RIVET RIDGE RALLY — Operations Runbook

**Candidate:** `1.0.0-rc.2` working candidate

**Application model:** static Vite site with same-origin assets and an offline service worker

**Production/staging host:** owner selection required

**Deploy, support, and incident owners:** owner assignment required

This runbook covers the code-owned release procedure. Hosting credentials, DNS/TLS, a public support address, retention policy, and final legal approval are external owner actions.

## Current qualification status

`1.0.0-rc.2` is **not qualified for deployment**. The canonical workspace now uses the neutral `Rivet Ridge Rally` directory name. This source snapshot is tracked by the commit containing this record, but it has no annotated `v1.0.0-rc.2` tag or clean qualified release-bound rebuild. The automated suite is intentionally paused at the owner's request. The annotated `v1.0.0-rc.1` source tag and recorded evidence remain immutable historical records and must not be rebuilt or relabeled as evidence for the changed candidate; deployable predecessor artifact retrieval is separately **UNVERIFIED**.

The current generated Festival Trail Bike is a 29,132-byte GLB with SHA-256 `8668d05f42f3b8303c0825b8d4aa4b9c66a8ef64acba18f2df70b69f9a8f595b`; its standalone 2,236-byte KTX2 has SHA-256 `a86588924b53fd51915d505d0ba23e343ac3e84a5139c687845a49f8ad8a1ba2`, and its 3,369-byte manifest has SHA-256 `ebd431902d7177bfdaad64733eedf246bb8c31f132a3e063a61188412ae244e7`. During the latest permitted normal build run from 2026-07-15 10:26:16 to 10:26:21 CEST, the strengthened `assets:verify` contract confirmed 22 Meshopt-compressed views, 34 nodes, 15 meshes, 7 materials, one texture, 30 mesh-bearing nodes, one merged 14-block tread mesh per wheel, one merged 10-segment rear number, required focal-part names/materials/placement, and a pinned-validator result of 0 errors / 2 expected warnings / 3 informational notices. It also matched the 1,801,764-byte Canyon panorama's exact SHA-256 `43b39c9075428e9bc081b3d8f216fae0027e889f89caa59586aa6097080b26a5`, 1774×887 opaque-RGB PNG structure, single C2PA chunk, and embedded provenance markers; pinned both Barlow Condensed WOFF2 files by length, `wOF2` signature, and SHA-256; and pinned the retained 4,377-byte OFL by SHA-256 `186d750eb496a4c17a76385f82be6aea2ac1cf2de074a811d63786cf374ea73f` plus its copyright/license markers. The verifier also passed the exact 3D manifest/directory, shipped/source-title, and app-icon identity contracts. The pipeline retains the exact 9,197-byte upstream Basis license (`a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47`) under `-text -diff` so Git preserves its bytes across platforms. A complete current source/license/static audit plus human similarity/legal review remains required before deployment.

An earlier normal `rc.2` snapshot passed its recorded build, performance, soak, dependency-audit, manifest, and installed-Chrome smoke scopes. Its retained format-1 record is preserved at `artifacts/history/release-manifest-1.0.0-rc.2-earlier-snapshot-format-1.json`: 21 files / 4,689,233 bytes with aggregate SHA-256 `6a55c00ea36debe543ab946dee06dc5fa73cf8a13d45b047aec399469c9931a3`. It does **not** match or qualify the current `dist/` or candidate. On macOS 26.5.2 arm64 with Node v26.4.0 and npm 11.17.0, the latest permitted `npm run build` ran from 2026-07-15 10:26:16 to 10:26:21 CEST and completed successfully. Exact 3D manifest/directory, shipped/source-title, app-icon, panorama, font, and font-license verification plus strict typecheck and the 142-module Vite production compilation passed; notices verification retained the 43,825-byte `THIRD_PARTY_NOTICES.txt` with SHA-256 `5fa8f7b4aaf95b4cc28b9b36a10c7f451e0ef83e6ac959d530ed3fdceacb60d0`. `dist/` contains 24 files / 6,679,904 raw bytes with `shell-v30`; its 5,722-byte `dist/sw.js` has SHA-256 `f5cc9b23c2d507b9cede7a11cd72f62d05549c4ae72888853b5191d4cb6b78ca`, and its 1,418-byte `dist/index.html` has SHA-256 `4252cb572300d9e2dd838b7e39f8440b8b40b6762556e17cd9f3d7b44690f433`. The 282,888-byte game chunk is `GameView-Cy_z8oq_.js`, SHA-256 `3517031f108f19e570938c10d31fb6e58af56ecb8859ea25a09355b6ef575bd4`; the 612,073-byte shared route chunk is `CoursePresentationRoute-CMRHtjX1.js`, SHA-256 `87e856adf652bb8a49b45ed3d96256221a360ca7edff9a94341a17fa63af71b8`; and the 56,935-byte editor chunk is `TrackEditorScreen-niBUL8yv.js`, SHA-256 `6c800124e378c8e16dc420210b1e696e3418d4843c537ebab3218e3797b1f5f0`. This build embeds commit `62664b1f8ba814f3ec685d228fa4e600e6e7dc84` with `dirty=true` and compiles the shared route/editor, focal-bike, rival presentation, panorama, tutorial/input, persistence, accessibility, and offline app source recorded below, so it is development/build evidence rather than immutable release evidence. Release-evidence scripts were present but are not part of the client compilation and were not executed. Runtime/browser inspection, current visual capture, automated regression tests, offline smoke, dependency audit, performance measurement, and soak were **NOT RUN**; concept fidelity remains **NOT ACCEPTED / UNVERIFIED**. Before any `rc.2` deployment, resume the paused checks and regenerate the complete release evidence against one exact candidate.

The latest permitted build also contains one quality-tier instanced safety-wall batch along both Canyon Kickoff and Rider School edges, with 8/6/4 m Low/Medium/High spans, x ±7.70 placement, and explicit authored-course exclusion. This is source/build evidence only: automated diagnostics, browser appearance, actual renderer draw calls, and performance remain **UNVERIFIED** while the requested pause is active.

The same build reuses the existing five Canyon festival batches for two/three/four outward-rising timber rows and staffed elevated cooling-gate watchtowers on Low/Medium/High, with no new asset, material, geometry type, or visible draw batch. Each watchtower raises the existing deck/canopy/four posts and moves two/three/four existing spectators onto the deck. Source review verifies QA-fast 8-pocket and 16/24/32-tier counts, four towers with 8/12/16 staff, production-High 26-pocket/104-tier counts because all 22 route pockets already clear the 5.6 m showcase guard, Rider School's two towers with 4/6/8 staff, zero authored-course towers, and legacy flat density outside handcrafted Canyon. Browser composition, actual draw calls, memory/frame time, and owner acceptance remain **UNVERIFIED** while the requested pause is active.

The build also compiles the active-scoped tutorial lesson gate, its 550 ms atomic handoff, focused **Retry this lesson** reconstruction, interactive-target keyboard guards, and the six original inline touch pictograms. Cumulative mechanic flags remain recap/diagnostic data, while only fresh ordered evidence from the active lesson can clear it; the handoff retains held Ride/Turbo input so release lessons remain deliberate. Focused retry preserves the lesson index and earlier credit while clearing the authoritative attempt, active evidence, one-shot obstacle handling, replay/presentation state, and keyboard/touch latches. The pictograms preserve button names, visible Ride/Turbo text, hit areas, safe-area layout, and mirroring. Deferred unit/browser/accessibility assertions exist but were **NOT RUN** under the requested pause; portrait/physical-device acceptance remains **UNVERIFIED**.

Release-provenance hardening is implemented in source and **UNVERIFIED**. The guard captures clean `HEAD`, creates its detached checkout, then reads and revalidates package/lock/Node bytes there before accepting the exact annotated tag object and absolute npm CLI. The exact tag object/type is retained through the build, and the CLI file identity/SHA-256 is checked after version, `ci`, and build invocations. Both npm user/global configs point to an empty temporary file, install scripts are forced enabled, and ignored-entry checks allow nothing before install, only `node_modules` after `ci`, and only `node_modules`/`dist` after build. Regular isolated output replaces root `dist/`; recursive guarded cleanup covers stale `dist/` and file-or-directory sidecar output on every failure. Hostile-config/fake-CLI fixtures cover all phases, same-commit retagging, and CLI mutation, but nothing was run while qualification is paused. Historical format-1 evidence remains unchanged, and the dirty untagged candidate must still be rejected.

The latest permitted source/build inventory also contains the safe 62 normal-Ride heat ceiling; standing Solo PB lap/checkpoint persistence and signed prior-PB result comparisons; symmetric per-fixed-step live/classification rival contact; numbered course-anchored campaign/Rider School start treatment with authored-Test-Ride exclusion; the shared portrait-or-sub-680 px camera predicate; 320–780 px / 140% normal-and-mirrored HUD/control/Heat bounds; a 320×568 touch-scrollable tutorial card; and semantic touch/Recovery states. These are operator awareness items only: their focused unit, component, E2E, accessibility, visual, browser, persistence, physical-device, and performance checks were **NOT RUN** and remain **UNVERIFIED**.

The same latest build compiles the follow-up persistence/input safeguards: held-touch precedence, selective transactional profile recovery, current-snapshot cross-tab track recovery, transactional replay pruning, one 500-module editor boundary, exact pending Test Ride retry, and budget-before-materialization tagged recovery export with fail-closed aggregate accounting. No focused regression or failure-path browser check ran. Operators must therefore keep session/export guidance enabled and must not treat compilation as proof of recovery behavior.

Production smoke is now manifest-bound in source. It requires a readable, internally consistent format-2 sidecar, validates source/toolchain/build provenance, fetches every listed served file with revalidation headers, and matches byte count, SHA-256, and aggregate both before and after the installed-Chrome boot/race/editor/offline journey. It also requires the runtime Git commit marker to equal the manifest source commit, opens a cached Practice race while offline, and promotes the completed evidence bundle atomically. The source cache generation is now `shell-v30`; install separately fetches core and index-discovered build assets with `cache: reload`, rejects bad or cross-origin responses, populates the current cache only after all fetches resolve, and deletes that current cache without calling `skipWaiting` if installation fails. The smoke-flow/support and install fixtures plus the real manifest/smoke/install/activation/offline transition were **NOT RUN**; no artifact or offline pass is claimed.

The current guard also prepends the active Node executable directory to the isolated child `PATH`, records and repeatedly verifies the resolved Node executable hash/identity, and revalidates source, release inputs, annotated tag, npm CLI, and Node after sidecar creation and temporary-worktree cleanup. Production smoke accepts only a credential-free HTTP(S) root URL for a dedicated origin, verifies every manifest file, fetches `/` separately, requires it to equal manifest `index.html`, and rejects entrypoint or browser navigation that leaves the origin. Service-worker install fetches `index.html` once and caches clones of those bytes under `/` and `/index.html`. All corresponding fixtures and real release paths remain **UNVERIFIED** during the pause.

The latest permitted normal build generated the current notices, but it did not execute the separate release-evidence scripts. Production-smoke source rejects unsafe screenshot names, emits schema-4 per-screenshot path/byte/SHA-256 records with a deterministic aggregate, and now checks evidence-root symlink ancestors before the first directory write; notice generation requires exact one-to-one coverage of all `package.json` runtime dependencies while retaining explicit embedded/vendored classifications; and the release bundle guard rejects exact source/temp/worktree paths, common home/file-URL forms, PEM private-key headers, and high-confidence live-token prefixes. Fixture source covers these contracts, including a real-filesystem outside-sentinel regression for the symlink boundary, but no fixture, manifest, smoke, dependency audit, or release-evidence command ran, so every runtime behavior and release output remains **UNVERIFIED**.

An earlier source-only corrective slice also couples environment, player, tutorial, AI, and collision work within each due fixed tick; preserves unique non-lane actions while migrating the exact legacy A/D lane defaults to arrow keys; excludes the Canyon panorama from authored Test Rides; completes the procedural fallback-bike focal silhouette; and stages production-smoke evidence before atomically promoting a candidate/run-specific bundle. The permitted build proves compilation and declared static-asset contracts only. Focused regressions, real browser behavior, migration execution, smoke output, offline behavior, and visual acceptance were **NOT RUN** and remain **UNVERIFIED** while qualification is paused.

A final source-only gameplay, accessibility, editor, and persistence audit found no P0 defects and 16 P1 defects. All 16 have source corrections: an authoritative pre-frame HUD snapshot; truthful field-aware results language; retained crash cause and consecutive-crash telemetry; visible control focus; bounded short-phone pause/tutorial/caption/telemetry geometry; selection and focus for persisted editor modules across the full accepted course range; pointer-derived placement validity; a 1 MB/depth/item/string-capped JSON preflight with strict schemas; an explicit bounded IndexedDB open/retry path; strict current/future persisted-record handling; and atomic corrupt-track quarantine plus downloadable recovery records. Operators must treat these as **UNVERIFIED** until the focused unit, component, E2E, accessibility, persistence, browser, and device checks run against the frozen candidate. Do not infer data-recovery, import-safety, editor-continuity, or responsive-layout qualification from source review or the permitted build.

## Operating model

RIVET RIDGE RALLY has no application server, account, remote database, analytics, ads, payments, or public UGC. The production unit is the complete `dist/` directory. Profiles, settings, progression, replay samples, and custom tracks are stored locally in versioned IndexedDB. Custom-track JSON export is the player-controlled backup path.

The site requires HTTPS in production for normal service-worker behavior. All runtime requests are same-origin. Deploy it at the URL root of a dedicated origin: application assets use absolute root paths and the service worker owns root scope. Do not mount the build below a path prefix or share its origin with unrelated applications or service workers. WebGL is the rendering baseline; unsupported WebGL, asset decode failure, offline startup, and corrupt local data have explicit recovery paths.

## Locked toolchain and clean verification

Use Node `26.4.0` from `.node-version` and npm `11.17.0` from `packageManager`; record both reported versions with the candidate. Freeze one intended candidate before qualification: inventory and track every required source, asset, provenance record, release tool/fixture, Node pin, and retained historical record; commit them; confirm `git status --short` is empty; and record the final commit. Untracked files are not available to the detached release build and therefore cannot be treated as candidate inputs or durable evidence.

Run the pre-tag qualification from that clean final commit:

```sh
npm ci
npm run assets:verify
npm run typecheck
npm run lint
npm run test
npm run test:coverage
npm run test:e2e
npm run audit
npm run build
```

`npm run test` executes Vitest plus the Node release-manifest, production-smoke-support, production-smoke-flow, and service-worker-install fixtures. `npm run test:coverage` is a separate Vitest-only coverage report; it does not cover the Node fixtures or replace browser coverage.

After every required pre-tag gate, performance run, soak, and review passes, create the annotated local tag `v1.0.0-rc.2` at that exact commit and verify that the tag peels to the recorded commit. Do not move or reuse a published tag. The manifest guard requires that exact annotated tag at `HEAD` and a clean tree:

```sh
git tag -a v1.0.0-rc.2 -m "RIVET RIDGE RALLY 1.0.0-rc.2"
npm run release:manifest
```

`npm run build` writes review bytes only. The manifest command captures clean `HEAD`, deletes stale outputs through guarded recursive cleanup, creates a detached checkout, and reads package/lock/Node inputs there. Empty temporary user/global npm configs, an isolated cache, `ignore_scripts=false`, `NODE_ENV=production`, and `VITE_QA_MODE=0` prevent inherited configuration or QA mode from defining release bytes. Strict ignored-entry checks bracket install and build; exact input bytes, both checkouts, the annotated tag object/type, and the npm CLI file identity/hash are revalidated. Only regular files from this isolated `dist/` replace root output and receive the existing content checks and hashes. Any failure removes root output; cleanup always prunes the worktree. Preserve the ignored passing sidecar with the artifact.

For local inspection of those exact bytes:

```sh
npm run preview -- --host 127.0.0.1 --port 4173
```

Do not qualify or deploy the development server. Do not rebuild the same version/tag with different bytes.

With that preview still running, execute the installed-Chrome production smoke against the exact non-QA bytes:

```sh
npm run smoke:production -- --base-url http://127.0.0.1:4173 --manifest artifacts/release-manifest.json
```

The command exits unsuccessfully unless the visible version, runtime Git commit, clean-build marker, and absence of the QA API match the manifest-bound candidate; a Practice race starts and restarts; the 3D editor opens; the production service worker controls a reload; the title reloads offline; a cached Practice race reaches `racing` offline; every served manifest byte is reverified after that journey; and no required request, HTTP, page, or unexpected console failure occurs. It stages one run and then atomically promotes a fresh bundle under `artifacts/production-smoke/candidates/<full-manifest-SHA>/runs/<timestamp>-<UUID>/` rather than overwrite the tracked schema-1 historical smoke. Schema-4 source records each safe screenshot path, byte count, and SHA-256 plus a deterministic path-sorted screenshot aggregate. Retain the resulting JSON and only the screenshot records named and hash-matched by that JSON with the candidate. This schema-4 path and its fixture source have **NOT RUN** while qualification is paused.

### Evidence-only post-tag attestation

The product tag must remain byte-immutable even though manifest and production-smoke evidence can only be produced after that tag exists. Use this finalization sequence:

1. Keep `v1.0.0-rc.2` local and unchanged while generating the format-2 manifest and production-smoke bundle. Do not amend its commit, move its tag, or rebuild its bytes.
2. If any post-tag gate fails, do not publish or relabel the candidate. Preserve failure evidence if useful, fix forward under a new version/commit/tag, and leave the rejected tag identity untouched or delete only the unpublished local tag.
3. After every gate passes, copy `artifacts/release-manifest.json` byte-for-byte to `artifacts/history/release-manifest-1.0.0-rc.2-format-2.json`. Copy the qualifying measurement and soak from the ignored, product-commit-keyed staging tree into the exact unignored directory `artifacts/release-attestations/v1.0.0-rc.2-evidence/performance/`, retain the candidate-specific smoke run, and record every copied file's SHA-256 plus the product source commit/tag object, manifest aggregate, and approvals in `artifacts/release-attestations/v1.0.0-rc.2.json`. Use the product tag—not the later evidence commit—to derive the staging key:

   ```sh
   PRODUCT_COMMIT="$(git rev-parse 'v1.0.0-rc.2^{commit}')"
   STAGED_EVIDENCE_ROOT="artifacts/candidate-evidence/$PRODUCT_COMMIT"
   ATTESTATION_EVIDENCE_ROOT="artifacts/release-attestations/v1.0.0-rc.2-evidence"
   mkdir -p artifacts/history "$ATTESTATION_EVIDENCE_ROOT/performance"
   cp artifacts/release-manifest.json artifacts/history/release-manifest-1.0.0-rc.2-format-2.json
   cp "$STAGED_EVIDENCE_ROOT/performance/headed-measurement.json" "$ATTESTATION_EVIDENCE_ROOT/performance/headed-measurement.json"
   cp "$STAGED_EVIDENCE_ROOT/performance/30m-soak.json" "$ATTESTATION_EVIDENCE_ROOT/performance/30m-soak.json"
   shasum -a 256 artifacts/history/release-manifest-1.0.0-rc.2-format-2.json "$ATTESTATION_EVIDENCE_ROOT/performance/headed-measurement.json" "$ATTESTATION_EVIDENCE_ROOT/performance/30m-soak.json"
   ```

   Compare those printed hashes with the manifest and qualifying performance records before writing the attestation JSON. The named `v1.0.0-rc.2-evidence` directory is intentionally not ignored and must appear in the evidence-only commit.
4. Update `QA_REPORT.md` and `LAUNCH_READINESS.md` with only the evidence actually produced. Create a separate evidence-only commit containing the archived manifest, named smoke bundle, attestation record, and final reports. That commit must not alter product source, dependency inputs, assets, release tools, or the tagged `dist/` bytes.
5. Annotate that evidence commit with `attestation/v1.0.0-rc.2`. The attestation tag pins the final reports and evidence; the product tag continues to pin source and build identity. Do not rerun the release-manifest command from the evidence commit or treat its commit as the product source.
6. Publish the product and attestation tags together only after owner acceptance. Deploy only the manifest-recorded bytes produced from the product tag, never a rebuild from the attestation commit.

This avoids a false claim that post-tag reports live inside the product tag while preserving an immutable, reviewable chain from product commit → manifest/served hashes → smoke bundle → evidence commit/tag.

## Performance qualification

Build the QA-only performance candidate and serve it on the harness's isolated port first:

```sh
VITE_QA_MODE=1 npm run build
npm run preview -- --host 127.0.0.1 --port 4373
```

In another shell, run the measurement and soak. After they finish, stop the QA preview and run the normal `npm run build` again before generating the release manifest or production smoke evidence.

```sh
PRODUCT_COMMIT="$(git rev-parse HEAD)"
EVIDENCE_ROOT="artifacts/candidate-evidence/$PRODUCT_COMMIT"
npm run perf:measure -- --headed --output "$EVIDENCE_ROOT/performance/headed-measurement.json"
npm run perf:soak -- --minutes 30 --sample-interval 10 --mode rival --output "$EVIDENCE_ROOT/performance/30m-soak.json"
```

The `artifacts/candidate-evidence/` tree is intentionally ignored. Qualifying runs therefore do not dirty or change the product-tag checkout before the clean detached release build. Do not overwrite the tracked historical `artifacts/performance/final-*.json` files. After the product manifest and smoke pass, copy only the hash-reviewed qualifying files into `artifacts/release-attestations/v1.0.0-rc.2-evidence/performance/` with the exact commands above, then include that unignored directory in the separate evidence-only attestation commit; that commit may change `HEAD`, but it must not move or rebuild the product tag.

Run both commands against a production preview built with `VITE_QA_MODE=1` so deterministic automation controls are available. The harness inventories and hashes local `dist/`, verifies every served file and `/` before and after the run, records source commit/tag/dirty state, and requires the build-time runtime commit marker to match that clean source. Quality is never left at `auto`: measurement defaults to explicit High desktop and Low mobile presets, while soak defaults to High desktop or Low mobile and accepts `--quality low|medium|high`. The headed measurement is the qualifying FPS, frame-work, draw-call, load, restart, and editor timing capture; a headless measurement cannot report release `PASS`. Its automated release floor requires desktop normal and stress mean FPS ≥58 with p95 frame work ≤16.67 ms, emulated-mobile normal and stress mean FPS ≥30 with p95 frame work ≤33.33 ms, and total gzip-compressed `dist/` bytes <12,000,000. The desktop floor allows normal sampling jitter around the 60 FPS product target. Emulated mobile is a local technical floor only and never substitutes for representative physical mid-range mobile proof. The headless 30-minute Rival soak is long-duration stability, memory, input-latency, fixed-step, restart, and crash/console evidence; its FPS is diagnostic because offscreen browser scheduling may throttle animation. A headed long soak may supplement it when the window can remain visible and undisturbed. Record browser build, viewport, host OS/CPU/memory/GPU fields, effective quality, duration, FPS/frame work, draw calls, compressed bytes, memory delta, input lag, first-race load, restart, and editor test-play timings in `QA_REPORT.md`.

The soak JSON records failed requests and HTTP error responses, separates Chromium's known headless `ReadPixels` driver diagnostic from unexpected console/page messages, and reports memory, input-latency, and fixed-step trends. Dropped fixed-step time is retained both as the original per-attempt HUD samples and as a cumulative value across race restarts. Each accelerated Rival attempt has a 90-second observation window: this is nearly three times the observed roughly 32-second average, leaving room for measurement and headless scheduling overhead while still detecting a stuck race. A timed-out attempt is restarted through the QA race path, remains recorded, and still fails the zero-timeout release criterion.

Operational harness exceptions are serialized in the artifact after resource cleanup and fail the `no-harness-error` criterion. Measurement and Rival soak commands exit unsuccessfully when their automated gates fail, including candidate/source/runtime binding, request, HTTP, page, console, quality, and telemetry criteria. A release `PASS` is possible only for a Rival workload with at least 30 minutes of active race time and the requested duration; `--mode practice` always reports release status `DIAGNOSTIC` and can only pass its separate diagnostic gate. A passing automated gate does not replace review of the named trend fields for runaway memory, accumulating input lag, or worsening dropped-time behavior; no numeric limit is inferred where the product specification does not define one.

## Release artifact contract

Every uploaded candidate must have:

- product version plus immutable source commit/tag;
- exact lockfile and Node/npm versions;
- the one-time-built `dist/` directory, its `THIRD_PARTY_NOTICES.txt`, and `artifacts/release-manifest.json`;
- current `QA_REPORT.md`, `LAUNCH_READINESS.md`, and `ASSET_LICENSES.md`;
- passing typecheck, lint, unit, browser, accessibility, visual, persistence, reliability, asset, and dependency checks;
- performance and 30-minute soak artifacts;
- a retained previous known-good production artifact for rollback, with a tested locator and verified retrieval (currently unmet).

The title footer exposes the package version for support. The checksum manifest distinguishes different byte sets with the same visible version.

## Pre-deployment gate

Stop the release if any of these is false:

1. `LAUNCH_READINESS.md` reflects the exact artifact and has no open P0/P1 defect.
2. Mandatory QA checks are `PASS`, apart from precisely documented unavailable physical hardware and genuine external actions.
3. The build, browser tests, asset verifier, dependency audit, and release manifest completed without errors.
4. No unexpected console/page errors, required request failures, missing assets, credentials, tokens, or known high/critical dependency vulnerabilities are present.
5. Shipped assets and distributed third-party components are inventoried, and `dist/THIRD_PARTY_NOTICES.txt` contains the required complete license/notice text.
6. Bundle and performance budgets are met or an owner-approved exception is recorded.
7. The previous release can still be retrieved and its checksum matches.

## Staging and production deployment

Choose a static host/CDN that supports immutable, versioned uploads and an atomic production alias.

1. Upload the already-qualified `dist/` bytes under a unique release identifier; never partially overwrite the active release.
2. Verify uploaded file hashes against `artifacts/release-manifest.json` where the host permits.
3. Expose the upload at an isolated staging/canary URL.
4. Smoke test title → race → results → retry, refresh/continue, settings, editor save/reload/test play, offline reload, and the visible version.
5. Inspect public-origin console/network results, MIME types, CSP/security headers, service-worker registration/scope, cache headers, TLS, and asset 404s.
6. Record staging URL, artifact hash, operator, UTC times, test results, and approval.
7. Atomically switch the production alias to the staged release.
8. Repeat a minimal public-origin boot/race-start/offline/version smoke and observe host availability during the chosen release window.
9. Preserve both the new and prior immutable releases through the rollback window.

The owner must add the host-specific upload, alias-switch, verification, and access-role commands here before public deployment. Verify these response-header controls on the public origin:

- HTTP `Content-Security-Policy` includes `frame-ancestors 'none'`; if the host cannot supply it, use `X-Frame-Options: DENY` as the framing control. A meta CSP cannot enforce `frame-ancestors`.
- `X-Content-Type-Options: nosniff`.
- a strict `Referrer-Policy`, preferably `no-referrer` for this same-origin application.
- an appropriate `Permissions-Policy` disabling unused capabilities such as camera, microphone, geolocation, payment, and USB.
- `Strict-Transport-Security` only after production TLS and redirect behavior are validated; add `includeSubDomains` only when every affected subdomain is controlled and HTTPS-ready.

## Cache and service-worker policy

Configure the host as follows and verify actual response headers:

- only content-hashed filenames, such as Vite's generated `/assets/...-[hash].js` and `/assets/...-[hash].css`, may use `Cache-Control: public, max-age=31536000, immutable`;
- stable shell and asset paths must revalidate on every online request (`Cache-Control: no-cache` or an equivalent policy): `/`, `/index.html`, `/manifest.webmanifest`, `/sw.js`, `/assets/icons/app-icon.svg`, `/assets/art/title-background.png`, `/assets/art/canyon-festival-panorama.png`, both `/assets/fonts/*.woff2` files, `/assets/3d/festival-trail-bike.glb`, and the stable Basis transcoder JS/WASM paths; apply the same rule to any served release-manifest sidecar;
- GLB, KTX2, WASM, JS, JSON, PNG, SVG, TXT, and manifest files require correct MIME type and compression where applicable; a file extension alone does not authorize immutable caching;
- old fingerprinted assets: retain through the rollback and service-worker transition window.

The current source and latest permitted build use service-worker cache generation `rivet-ridge-rally-shell-v30`; the preceding 04:53 `shell-v29` build remains historical evidence only. The build proves compilation, not service-worker install, activation, cache-transition, offline, or runtime behavior. The core cache source includes `/assets/art/canyon-festival-panorama.png` and both `/assets/fonts/*.woff2` files. Its precache and offline behavior are **UNVERIFIED** until one clean frozen candidate receives a fresh manifest and production/offline smoke. After both lazy race/editor entry points import, the page claims cached-race readiness only when the current controller acknowledges this exact cache identity; a stale acknowledgement, import failure, controller mismatch, or timeout leaves readiness unset and the offline banner conservative. Fetches prefer the current cache and may fall back only to the immediately previous app-owned transition cache. Activation keeps that one prior generation for already-open tabs, removes older app-owned generations, and never touches unrelated origin caches. Navigation can fall back to current-or-transition `index.html`; non-GET and cross-origin requests are ignored. A changed cache name forces the next version's installation. Deployments and rollbacks must preserve both transition generations' fingerprinted server assets because clients may retain an older active worker or open page until reload/activation. If a worker is corrupt, unregister only the app service worker and remove only app-owned `rivet-ridge-rally-*` Cache Storage entries, then reload online and confirm the expected visible version and cache identity. Do not clear all site storage as worker recovery: that also deletes IndexedDB progress and tracks. A full site-data reset is a destructive last resort requiring an explicit irreversible-loss warning and custom-track export first where the application remains usable.

Install fetches every core and index-discovered build asset with `cache: reload`, rejects failed or cross-origin responses, and populates `rivet-ridge-rally-shell-v30` only after all fetches settle successfully. Any install failure deletes that partial current-generation cache, rethrows, and does not call `skipWaiting`. This fail-closed path and the real reload transition remain **UNVERIFIED**.

Every page-level `controllerchange` now invalidates the visible readiness claim synchronously and notifies the offline-status UI. A newly controlling worker must provide a fresh exact `rivet-ridge-rally-shell-v30` acknowledgement before cached-race language returns. The synthetic regression covers only this page-side invalidation; real install, activation, cache eviction, and rollback transitions remain part of the paused production/offline gate.

## Rollback

Rollback triggers include boot failure, widespread asset 404s, mixed-version caches, save corruption, crash/restart loops, runaway memory, required-input/browser regressions, or a security exposure.

The current predecessor rollback gate is **UNVERIFIED**. An annotated source tag and historical reports are not a deployable rollback archive, and this repository does not currently record a tested artifact locator plus retrieval/hash evidence for `v1.0.0-rc.1`. Before deployment, the release owner must identify the immutable predecessor archive, record its storage locator and manifest hash in the private release record, retrieve it, verify every byte, and rehearse its staging smoke. Until then, do not describe predecessor rollback as `PASS` or promise immediate rollback.

1. Freeze deployment, name an incident lead, and preserve logs plus the current aggregate artifact hash.
2. Confirm the previous immutable artifact still matches its retained manifest.
3. Atomically repoint production to that artifact; never rebuild or patch it.
4. Revalidate/purge only `index.html`, `sw.js`, and other short-cache shell paths. Keep old and new fingerprinted assets available.
5. Smoke test the public origin, including visible version, required assets, service-worker transition, race start, and local-save read.
6. Record impact, versions, hashes, UTC duration, user guidance, and follow-up defect.
7. Fix forward under a new version/build identity.

IndexedDB migrations require special care: current source declares Dexie schema v5, which maps to native IndexedDB version 50, and custom tracks now use schema v2. Structurally valid v1 tracks that satisfy current semantics upgrade by changing only `schemaVersion`; legacy v1 tracks needing the stricter full-parent-footprint repair remain stored, normalize to editable v2 data in memory, and are not quarantined, while save/Test Ride/export remain blocked until repair. Rolling back to a Dexie-v4/native-40 predecessor after v5 has opened is a version downgrade barrier, not an ordinary migration. Before deployment, rehearse the retained predecessor against a database already opened by v5 and prove it either reads safely or shows a non-destructive incompatibility path. Never clear or silently delete local progress or tracks to make rollback appear successful.

## Support and incidents

Assign a public support path, release owner, hosting owner, and incident lead before launch. Ask users only for the visible game version, browser/OS/device, input method, mode/track, reproduction steps, and optional screenshot/error text. Do not request raw IndexedDB or unrelated browsing data through normal support.

| Severity | Example | Response |
|---|---|---|
| P0 | Site unavailable, widespread save loss, critical exposure | Stop release, incident response, immediate rollback assessment |
| P1 | Race cannot complete, required control/browser or progression blocked | Freeze candidate, urgent fix or rollback |
| P2 | Material issue with a practical workaround | Record, prioritize, and disclose |
| P3 | Cosmetic issue without meaningful play impact | Backlog with evidence |

Privacy-neutral monitoring should cover HTTPS availability, TLS expiry, expected version text, essential asset status/content type, and a synthetic boot/race-start path. No client telemetry is included. Any future analytics or error reporting needs a separate privacy, retention, consent, security, and disable-behavior review.

## Backup and retention

Retain source tag/commit, lockfile, immutable artifact, checksum manifest, reports, asset provenance, and private logs for an owner-defined period. Keep at least one known-good predecessor and rehearse retrieval. Export host/DNS configuration or manage it as code once a provider is selected.

Player data is device-local and is not cloud-backed. Custom tracks can be exported as validated JSON. Clearing browser/site data removes local saves; support materials must say this plainly.

## Security maintenance

- Audit dependencies and review lockfile changes on every candidate and on an owner-defined post-launch cadence.
- Scan source, history, and bundles for credentials and private endpoints; client configuration is public by definition.
- Keep runtime origins same-origin unless a separately reviewed feature requires more.
- Treat editor imports and persisted data as hostile, bounded input.
- Retain CSP, service-worker, unsupported-browser, corrupt-save, and failed-asset regression tests.
- Record vulnerability exposure, mitigation, and release decision; high/critical applicable vulnerabilities block release.

## External owner actions

The codebase cannot select or access a production host, DNS, TLS identity, CI/release credentials, public support address, on-call staffing, artifact-retention duration, top-level product license, or final trademark/trade-dress approval. Those are the intentionally unresolved owner-controlled operations inputs; their owners and evidence must be added before public deployment. The neutral workspace rename is complete and is not an external blocker.
