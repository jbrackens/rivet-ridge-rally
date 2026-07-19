# RIVET RIDGE RALLY — Operations Runbook

**Candidate:** `1.0.0-rc.2` working candidate

**Application model:** static Vite site with same-origin assets and an offline service worker

**Production/staging host:** owner selection required

**Deploy, support, and incident owners:** owner assignment required

This runbook covers the code-owned release procedure. Hosting credentials, DNS/TLS, a public support address, retention policy, and final legal approval are external owner actions.

## Current qualification status

`1.0.0-rc.2` is **not qualified for deployment**. The canonical workspace uses the neutral `Rivet Ridge Rally` directory name. The current source is on an ordinary development branch and is not pinned by an annotated `v1.0.0-rc.2` tag; no clean qualified release-bound rebuild exists. Current working-tree typecheck, lint, all 450 tests/fixtures (300 Vitest, 45 release-manifest, 71 release-attestation, and 34 production-smoke/service-worker/release-scope), asset verification, zero-vulnerability high-severity audit, `npm run build`, and the scoped browser evidence recorded in `QA_REPORT.md` pass. The fresh static batch for the unchanged product files ran on `9a8abdd68090b9b7b6a616b889aa410080ec3c9e`, immediately before the documentation-only evidence update, with `npm run assets:verify && npm run typecheck && npm run lint && npm test && npm run audit && npm run audit:release-scope`; it passed, with release-scope audit covering 131 files / 15,208,175 bytes at aggregate SHA-256 `463b7d9e36d6c071efaf3c26711f05552e1aef8170033fa4dcf4d2b62028a240` and zero findings. After the normal non-QA preview was restored, the latest scoped `npm run audit:release-scope` pass covered the same 131 files / 15,208,175 bytes at aggregate SHA-256 `a8718dd150b715e4bd8e38b092a34482af49c4ab94585c87776ea75a1ca9fcf6`, with zero findings. Those results do not replace a frozen-candidate run. The annotated `v1.0.0-rc.1` source tag and recorded evidence remain immutable historical records and must not be rebuilt or relabeled; deployable predecessor artifact retrieval is separately **UNVERIFIED**.

Current cross-project scoped evidence is campaign modes 18/18 in 27.7 minutes, rival pack 2/2, 10/10 Firefox-plus-WebKit desktop functional, 6/6 WebKit lifecycle, 6/6 emulated touch matrix, and 2/2 emulated touch tutorial intro, in addition to the focused Chromium functional/reliability/tutorial/editor/input/migration/persistence/quality paths. These are working-tree runner results, not installed-browser, physical-device, frozen-candidate, or commercial-release evidence.

The current focal player asset is the original Blender-authored Hero Bike and Rider A; the shared rival pack and Canyon kit use the recorded generated/provenance chains in `ASSET_LICENSES.md`. `npm run assets:verify` passes the 49,780-triangle / 517,664-byte hero GLB (39,912 bike triangles, including 14,284 wheel triangles, plus 9,868 rider triangles), SHA-256 `538be4269927544fa91cfc405742523a60422d77d546ce9c8859f407deb2e6e8`; its 15,165-byte manifest, SHA-256 `005ed98f7c4e365abb104da79352eb78b3bc3d7340f9dc074a3e84c772918918`; source-pair UUID `31000dd4-2c42-4c74-ad5d-28b5e4aec32f`; the rival contract; Canyon 32,008 triangles / 427,028 bytes; and production art/provenance including the v3 action reference. Focused hero action integration passes 5/5, the enriched v20 headed action-state capture passes 15/15 for the current runtime with material/shadow/dust readiness checks, and rival pack passes 2/2. Offline, performance, immutable-source qualification, complete legal review, and human similarity acceptance remain pending or **UNVERIFIED**.

The runtime asset deadline is deliberately asset-specific. Hero and rival wait five seconds before releasing readiness to a complete procedural fallback, then may atomically install a valid late result; a hard failure leaves the fallback in place. Canyon kit and Canyon panorama use 12-second visual-art deadlines so cold preview loads can show the authored venue before fallback; Canyon-kit timeout is terminal and retains procedural scenery if it expires. Engine disposal rejects late mutation and disposes any late decoded resource.

The earlier v2 six-capture, v3 action-state, v8 detail, v9, and v12 hero-motion reviews remain preserved as historical evidence. The current canonical technical review is the 121,832-byte manifest at `artifacts/visual-review/hero-motion-action-states-v20-current-20260718t-mechanical-detail-qamode/manifest.json`, SHA-256 `9a6beeb30396e57054d5f5aa4500ec32cd2d9f9ca8746eb48846f2f7cca24223`; it records `PASS` for all 15 required states in headed Chromium with browser audio muted, no persisted audio-setting change, and material/shadow/dust readiness checks for the current runtime. This is still dirty-working-tree, nonbaseline technical evidence: `conceptFidelityClaimed` is false, visual acceptance is pending owner review, and baseline promotion is false. The visuals are **NOT ACCEPTED**, and owner concept-art/similarity and legal approval remain open.

Earlier exact-tip visual evidence remains retained and unresolved rather than superseded. Its prerequisite failure came from a visual-harness hybrid: `qa-fast-race` supplied 84 m gameplay distances while production decor produced a legitimate 1.8799 m structure/pocket gap under the 5.6 m guard. The corrected production-length frozen route asserts 26 pockets / 104 tiers / 1,320 safety blocks, uses 90-second test and 20-second screenshot timeouts, and passes all production-asset readiness prerequisites. The exact-tip suite still ends 5 failed / 5 skipped against 2%: desktop 633,032 pixels (about 69%), curved Canyon absent baseline, editor 196,238 (about 22%), high contrast 315,169 (about 35%), and portrait 131,538 (about 39%). Separate title checks also fail. No baseline was created, changed, promoted, or waived; operators must use the guarded owner-approval workflow below.

An earlier normal `rc.2` snapshot passed its recorded build, performance, soak, dependency-audit, format-1 manifest, and installed-Chrome smoke scopes. It does **not** match or qualify the current `dist/` or candidate. Current focused browser evidence, the zero-vulnerability working-tree audit, and `npm run build` of the latest source pass separately; the build now completes without the former Vite chunk-size advisory after the Three manual-chunk split and regenerates notices. Exact-product performance, soak, format-2 manifest, production/offline smoke, and attestation remain pending. Before any `rc.2` deployment, regenerate the complete release evidence against one clean annotated candidate.

The current non-QA local `dist/` served on `127.0.0.1:4173` contains 33 files totaling 7,999,709 raw bytes. `index.html` is 1,632 bytes with SHA-256 `c732e3be89777272a36de5085b63968b9f58c41260296f914ba642b29fca2c04`; `assets/3d/hero-bike-rider.glb` is 517,664 bytes with SHA-256 `538be4269927544fa91cfc405742523a60422d77d546ce9c8859f407deb2e6e8`; the inventory aggregate is `4a6535f70c54175e8773ec5cff66a60a5a808c4d194b25268b5bf577fcdfe23f`; and the 43,872-byte notices have SHA-256 `f837ed705667d0f3976bbd419f42d8c63844a3eb4b52f76db88ed3a1d6e270c2`. A live HTTP sanity check confirmed the preview serves the rebuilt `assets/index-DQ5Q0Bt0.js`, `assets/index-C2e4audF.css`, `assets/GameView-DkftA9Dl.js`, `assets/TrackEditorScreen-CWKaRXcf.js`, and `assets/CoursePresentationRoute-LBO5a2ec.js` bytes. A scoped live non-QA Playwright smoke at `/tmp/rrr-live-editor-smoke-f5882c9-rerun/result.json` proved runtime commit `f5882c9ccb921fda6dd3b7e5b51e4f3b833a80ee` with `dirty=false`, absent QA/performance APIs, authored bike readiness, visible Rider School lesson progress, campaign menu access, Track Builder entry, visible Save/Test Ride/Fit Route/Route Complete controls, and no page/request/HTTP/unexpected-console failures; only known browser `ReadPixels` and title-preload warnings were recorded. This is a local working-tree checkpoint, not a format-2 manifest, installed/offline production smoke, immutable artifact, or release qualification.

The current headed diagnostic at `artifacts/candidate-evidence/diagnostic/performance/current-f5882c9-headed-restored-20260719T0738Z.json` reports clean source/runtime binding to `f5882c9`, stable served bytes, authored hero readiness, and no request, HTTP, console, or page errors. The 396,747-byte artifact has SHA-256 `26aec8a441332f0cb5a34f4e4e8b003b2fdc7c6bc6099d8b445493e653c1a109`; desktop normal/stress measured 60.00/60.01 FPS with 4.0/2.6 ms p95 synchronous frame work; emulated-mobile normal/stress measured 120.00/120.00 FPS with 1.6/1.5 ms p95. Its overall status is `FAIL` only because the required format-2 release manifest does not exist yet. It is diagnostic evidence, not schema-4 release performance qualification or physical-device proof.

The latest permitted build also contains one quality-tier instanced safety-wall batch along both Canyon Kickoff and Rider School edges, with 8/6/4 m Low/Medium/High spans, x ±7.70 placement, and explicit authored-course exclusion. Current functional/quality/editor/tutorial runs exercise the scenes without reported runtime failure, while dedicated diagnostics, accepted appearance, renderer draw calls, and performance remain **UNVERIFIED**.

The corrected Canyon composition reuses the existing five festival batches and deterministically preserves the full High layout at 22 route pockets plus four cooling watchtowers—26 pockets / 104 tiers—while enforcing at least 5.6 m clearance. Authored marshal towers and the workshop were relocated, and authored structural decor fails closed if it remains within 5.6 m of a festival pocket. Targeted unit tests pass 3/3; quality-preset plus authored-Canyon runtime checks pass 2/2. A normal nonqualifying local preview reported QA API false, ready bike/Canyon/environment state, 42 Canyon-kit placements, 26 pockets, 104 tiers, advancing time, and working pause/resume. Do not treat that preview as production smoke, offline evidence, performance evidence, or an official artifact. Draw-call, memory/frame-time, and owner acceptance remain **UNVERIFIED**.

Across split resumed Chromium tutorial runs, Settings continuity and gamepad prompts passed first; the three formerly failing later-copy, deterministic **Retry this lesson**, and comprehensive-journey cases then passed together headed 3/3 and individually headless. The comprehensive assertion passed below three in-game minutes, and long functional cases use Low quality separately from High-quality visual QA. Emulated touch tutorial introduction passes 2/2, the broader touch matrix passes 6/6, and working-tree unit coverage passes. Physical devices, screen-reader/manual accessibility, a single full post-fix invocation, and frozen-candidate acceptance remain **UNVERIFIED**.

Fresh current tutorial evidence: `npx playwright test e2e/tutorial.spec.ts -g "a new rider completes the comprehensive tutorial without skipping" --config <temporary isolated QA-port config> --project chromium` passed 1/1 in 3.7 minutes on isolated QA dev port 4178. It left the live 4173 preview and current `dist/` untouched. The flow covers the full earned Rider School lesson path, rival-contact quizzes, replayability, and the under-three-minute in-game recap assertion. Preserve this as scoped QA-browser evidence only; repeat it against the final frozen candidate before any release claim.

Release-provenance hardening is implemented in source and remains **UNVERIFIED** as a real candidate gate. The guard captures clean `HEAD`, creates its detached checkout, validates the exact annotated tag, npm package tree, Node identity, clean inputs, and isolated output, and fails closed on unsafe/special entries or mutation. It now validates clean source, tag, and isolated build prerequisites before replacing root release outputs, so early failures preserve the currently launched `dist/`; later failures after root replacement begins still clean the incomplete candidate bytes. Current `npm run test:release-manifest` passes 45/45, including symlinked output-parent protection and the early-failure root-output-preservation regression. A real dirty-tree `npm run release:manifest` preflight on 2026-07-19 correctly exited 1 with `Release guard failed: Git working tree is not clean`; `dist/` still contained runtime marker `f5882c9ccb921fda6dd3b7e5b51e4f3b833a80ee` / `dirty=false`, and the launched 4173 preview still returned HTTP 200. Historical format-1 evidence remains unchanged. A real `npm run visual:candidate` attempt on 2026-07-18 correctly exited 1 with `Release guard failed: Git working tree is not clean`, and a later clean-branch attempt exposed and corrected an overbroad binary token-prefix false positive. The latest clean `a9a97ef98f5004a4fcca78074b9d93283bcb8331` source produced visual QA candidate aggregate `f8005e5bf9f1e3991b4fa90c1a1259b2842f5fb492e32a0e4e12c659a3c5661f`, candidate manifest SHA-256 `9d0b13c2084ee421d8059af36cc57e298b4c0c739f23ae5996ec7b8b19026813`, and `artifacts/visual-review/rc2-current-a9a97ef-20260719t082620z/manifest.json` records 11/11 `PASS` with SHA-256 `5866dc0888245224a2e2c85f5883b3dfe07c5300b8d9034fe802ab5775761610`.

The current focused browser suite exercises the safe Ride/heat path, PB/results flow, campaign/Rider School start, portrait/sub-680 presentation, touch/Recovery semantics, and responsive UI in its stated scopes. Campaign modes pass 18/18 in 27.7 minutes, rival pack passes 2/2, and the complete working-tree unit/fixture command passes. Accepted visuals, exact-product performance, frozen-candidate repetition, and physical devices remain **UNVERIFIED**.

Current focused persistence, reliability, editor-session, migration, and touch paths plus the complete working-tree unit/fixture command exercise unavailable/corrupt/newer storage, retained Test Ride snapshots, recovery/export/import, editor bounds, and input precedence. True cross-tab/replay races, storage pressure, destructive recovery rehearsal, and frozen-candidate repetition remain open; operators must continue recommending track export before site-data recovery.

Later source closes additional local-data findings around delta-merged profile queues, reset/retry ordering, divergent track conflict copies, exact-base deletion, editor operation guards, and immutable mounted Test Ride snapshots. Current focused single-context browser paths and working-tree unit qualification pass; true two-tab/retry/reset/delete races and frozen-candidate repetition remain **UNVERIFIED**.

Production smoke is manifest-bound in source. It requires a readable, internally consistent format-2 sidecar, validates source/toolchain/build provenance, and binds each raw file byte count/SHA-256 plus deterministic gzip level-9 byte count/SHA-256. It fetches every listed served file with revalidation headers and recomputes the complete raw/gzip inventory both before and after the installed-Google-Chrome boot/race/editor/offline journey. It also requires exact Chrome/channel/version/viewport, runtime title/version/commit, and `shell-v35` cache identity; opens a cached Practice race while offline; and promotes the completed evidence bundle atomically. The source cache generation is now `shell-v35`; install separately fetches core—including `/assets/3d/hero-bike-rider.glb`, `/assets/rivals/rival-pack.glb`, `/assets/canyon/canyon-kit.glb`, the SVG app icon, and the 192/512/maskable/Apple PNG icon set—and index-discovered build assets with `cache: reload`, rejects unsuccessful, non-static/cross-origin-final, `no-store`, and `Vary: *` responses, populates the current cache only after all fetches resolve, and deletes that current cache without calling `skipWaiting` if installation fails. Runtime warming accepts at most 128 static-shell/`/assets/` URLs per message, validates final URLs, and shares a serialized 192-entry current-cache ceiling with generic static misses, so shared-origin API paths and unbounded repeated growth are excluded. Rejected, cross-origin-final, and 5xx navigations fall back to a complete cached shell without masking a same-origin 4xx. The 34 production-smoke/service-worker/release-scope fixtures pass; the real manifest/smoke/install/activation/offline transition did not run, so no artifact, installed-icon, or offline pass is claimed.

Current source exposes a combined Support / Privacy / Accessibility / About screen from the title footer. Focused browser coverage exercises its rendered entry, keyboard path, responsive surface, and automated accessibility assertions. Public support contact, operator identity, host privacy policy, retention/deletion commitments, screen-reader/manual review, and legal approval remain owner-blocked or **UNVERIFIED**.

Current focused tutorial/gameplay paths pass the intended raised-front-wheel barrier clear with speed cost and the slower heat journey, and working-tree unit/integration coverage passes. Source-level complete-field Rookie/Rider/Ace AI calibration and production-length representative-player completion also pass across all five launch tracks. Physical/manual fairness, frozen-candidate repetition, and manual collision/visual review remain **UNVERIFIED**.

Latest live rendered fallback smoke: Browser control was listed but unavailable for use because the required execution tool was not exposed by discovery, so a Playwright fallback targeted the already running `http://127.0.0.1:4173/` preview. The page title was `Rivet Ridge Rally`, the Rider School UI was nonblank, no framework overlay appeared, hero/Canyon/environment attributes were ready, Lesson 1 start plus held `W` moved tutorial position from `0.0` to `1.9` and advanced visible copy to Lesson 3. Page errors, failed requests, and HTTP errors were zero; only browser WebGL `ReadPixels` performance warnings appeared. The focused source input/tutorial command `npx vitest run src/game/input/__tests__/InputManager.test.ts src/game/engine/__tests__/tutorialLessonGate.test.ts src/game/engine/__tests__/tutorialHeatPath.test.ts` passed 29/29. Because the stale-arrow spec requires QA-only diagnostics, it was rerun on isolated QA dev port 4177 rather than the live non-QA preview: `npx playwright test e2e/tutorial.spec.ts -g "a later lesson requires fresh evidence" --config <temporary isolated QA-port config> --project chromium` passed 1/1 in 47.2 seconds and proved the active lane lesson requires a fresh ArrowRight after earlier stale ArrowLeft evidence.

Latest hero-readability runtime smoke after the 2026-07-19 authored-asset revision: the stale reliability helper counters were updated to the manifest-verified 49,780 / 39,912 / 9,868 / 14,284 hero triangle split. A throwaway config built QA bytes into `/tmp/rrr-qa-dist-4185` and served port 4185 without touching `dist/` or the launched 4173 preview; `npx playwright test e2e/reliability.spec.ts -g "authored Canyon kit replaces" --config /tmp/rrr-reliability-hero-4185.config.cjs --project chromium` passed 1/1 in 57.4 seconds. A separate public non-QA smoke against `http://127.0.0.1:4173/` started Rider School Lesson 1, proved the QA API absent, authored hero/Canyon/environment ready, the same hero counters, `pmrem-three-point`, `pcf-contact`, and zero console/page/request/HTTP failures, with evidence at `/tmp/rrr-live-smoke/hero-readability-current-rider-school.json` and screenshot `/tmp/rrr-live-smoke/hero-readability-current-rider-school-1280x720.png`. Its runtime build marker is still dirty (`8f94960`), so this remains current served-asset smoke rather than clean release identity.

The current guard prepends the active Node executable directory to the isolated child `PATH`, repeatedly verifies source/toolchain/tag/npm-tree identity, and production smoke binds a credential-free dedicated root to every format-2 manifest byte. The corresponding release-manifest, release-attestation, production-smoke, and service-worker fixtures pass; real release paths remain **UNVERIFIED** pending a clean annotated candidate.

The current normal working-tree build generates and verifies its notices without the former Vite chunk-size advisory after the Three manual-chunk split. Production-smoke source rejects unsafe screenshot names, binds screenshot bytes/hashes, checks evidence-root symlink ancestors before writes, and the release bundle guard rejects local paths, private-key headers, live-token prefixes, unsafe output parents, and root-output deletion before replacement is viable. Fixture coverage passes, but no real format-2 manifest, production smoke, or attestation exists for the current working tree.

Current focused browser coverage passes the exact legacy A/D-to-arrow migration, authored Test Ride isolation, and hero/rival/panorama fallback behavior; working-tree static/unit gates also pass. Exact-product smoke/offline, frozen-candidate repetition, and visual acceptance remain **UNVERIFIED**.

A final gameplay, accessibility, editor, and persistence audit found no P0 defects and 16 corrected P1 defects. Current focused E2E covers the scoped HUD/results, crash/recovery, focus/responsive, editor placement/import/recovery, persistence startup, and session paths, and the working-tree unit/component gates pass. Operators must still treat frozen-candidate repetition, manual accessibility, cross-tab/storage-pressure, physical-device, and exact-product evidence as **UNVERIFIED**.

## Operating model

RIVET RIDGE RALLY has no application server, account, remote database, analytics, ads, payments, or public UGC. The production unit is the complete `dist/` directory. Profiles, settings, progression, replay samples, and custom tracks are stored locally in versioned IndexedDB. Custom-track JSON export is the player-controlled backup path.

The site requires HTTPS in production for normal service-worker behavior. All runtime requests are same-origin. Deploy it at the URL root of a dedicated origin: application assets use absolute root paths and the service worker owns root scope. Do not mount the build below a path prefix or share its origin with unrelated applications or service workers. WebGL is the rendering baseline; unsupported WebGL, asset decode failure, offline startup, and corrupt local data have explicit recovery paths.

## Locked toolchain and clean verification

Use Node `26.4.0` from `.node-version` and npm `11.17.0` from `packageManager`; record both reported versions with the candidate. First freeze the untagged visual-review commit: inventory and track every required source, asset, provenance record, release tool/fixture, Node pin, and retained historical record; commit them; confirm `git status --short` is empty; and record that commit. Untracked files are not available to the detached visual or release build and therefore cannot be treated as candidate inputs or durable evidence. Follow **Visual baseline approval and promotion** below while this commit is clean and untagged—the visual-candidate guard intentionally rejects the version tag—then commit exactly the two guarded promotion outputs. That descendant is the final product commit.

Run the complete pre-tag qualification from that clean final product commit:

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

`npm run test` executes Vitest plus the Node release-manifest, release-attestation, production-smoke-support, production-smoke-flow, and service-worker-install fixtures. `npm run test:coverage` is a separate Vitest-only coverage report; it does not cover the Node fixtures or replace browser coverage.

After every required pre-tag gate and the guarded owner review/promotion pass, create the annotated local tag `v1.0.0-rc.2` at that exact commit and verify that the tag peels to the recorded commit. Performance, soak, and production smoke are post-tag gates: their evidence binds the annotated tag and the format-2 manifest, so they cannot run as qualifying pre-tag evidence. Do not move or reuse a published tag. The manifest guard requires that exact annotated tag at `HEAD` and a clean tree:

```sh
git tag -a v1.0.0-rc.2 -m "RIVET RIDGE RALLY 1.0.0-rc.2"
npm run release:manifest
```

`npm run build` writes review bytes only. The manifest command captures clean `HEAD`, deletes stale outputs through guarded recursive cleanup, creates a detached checkout, and reads package/lock/Node inputs there. Empty temporary user/global npm configs, an isolated cache, `ignore_scripts=false`, `NODE_ENV=production`, and `VITE_QA_MODE=0` prevent inherited configuration or QA mode from defining release bytes. Strict ignored-entry checks bracket install and build; exact input bytes, both checkouts, the annotated tag object/type, the npm launcher identity/hash, and the deterministic full npm package tree are revalidated. Both release and pre-tag visual-candidate manifests include the same path-private `npmPackage` schema. Only regular files from this isolated `dist/` replace root output and receive the existing content checks and hashes. Any failure removes root output; cleanup always prunes the worktree. Preserve the ignored passing sidecar with the artifact.

For local inspection of those exact bytes:

```sh
npm run preview -- --host 127.0.0.1 --port 4173
```

Do not qualify or deploy the development server. Do not rebuild the same version/tag with different bytes.

With that preview still running, execute the installed-Chrome production smoke against the exact non-QA bytes:

```sh
npm run smoke:production -- --base-url http://127.0.0.1:4173 --manifest artifacts/release-manifest.json
```

The command exits unsuccessfully unless installed Google Chrome, its channel/version/fixed viewport, the visible version, runtime title/Git commit, clean-build marker, absence of the QA API, and exact `rivet-ridge-rally-shell-v35` identity match the manifest-bound candidate; a Practice race starts and restarts; the 3D editor opens; the production service worker controls a reload; the title reloads offline; a cached Practice race reaches `racing` offline; every served manifest raw/gzip record is reverified after that journey; and no required request, HTTP, page, or unexpected console failure occurs. It stages one run and then atomically promotes a fresh bundle under `artifacts/production-smoke/candidates/<full-manifest-SHA>/runs/<timestamp>-<UUID>/` rather than overwrite the tracked schema-1 historical smoke. Schema-5 source records `run.startedAt`, treats `createdAt` as the completed-run timestamp, and rejects completion before start. It records each safe screenshot path, byte count, and SHA-256 plus a deterministic path-sorted screenshot aggregate. Retain the resulting JSON and only the screenshot records named and hash-matched by that JSON with the candidate. The 34 production-smoke/service-worker/release-scope fixtures pass; this real schema-5 exact-product path remains pending.

### Evidence-only post-tag attestation

The product tag must remain byte-immutable even though manifest and production-smoke evidence can only be produced after that tag exists. Use this finalization sequence:

1. Keep `v1.0.0-rc.2` local and unchanged while generating the format-2 manifest and production-smoke bundle. Do not amend its commit, move its tag, or rebuild its bytes.
2. If any post-tag gate fails, do not publish or relabel the candidate. Preserve failure evidence if useful, fix forward under a new version/commit/tag, and leave the rejected tag identity untouched or delete only the unpublished local tag.
3. After every gate passes, copy `artifacts/release-manifest.json` byte-for-byte to `artifacts/history/release-manifest-1.0.0-rc.2-format-2.json`. Copy the qualifying schema-4 measurement and soak from the ignored, product-commit-keyed staging tree into the exact unignored directory `artifacts/release-attestations/v1.0.0-rc.2-evidence/performance/`, and retain the candidate-specific schema-5 smoke run with every screenshot it names. Create all ten canonical candidate-bound structured QA-check records and their exact command logs, followed by structured QA, accessibility, and legal decisions plus only sanitized supporting records; the QA decision must hash-bind the final `QA_REPORT.md`, `LAUNCH_READINESS.md`, `docs/design/RACE_CURVED_CANYON_BASELINE_APPROVAL.json`, and the promoted Canyon PNG, and prose alone is not an approval. Also record the predecessor's annotated tag/commit, full source-bound format-2 manifest, credential-free archive locator ending in `/sha256/<aggregate>/bundle.tar.zst`, exact positive archive byte count and archive SHA-256, structured successful retrieval evidence, structured staged rollback smoke with complete raw/gzip served inventories before and after at one dedicated root URL, and its referenced rollback data-safety proof from that same root. A predecessor format-1 checksum list is insufficient. Then write the exact schema-v3 record at `artifacts/release-attestations/v1.0.0-rc.2.json` as specified by `docs/RELEASE_ATTESTATION.md`. Use the product tag—not the later evidence commit—to derive the staging key:

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

   Compare those printed hashes with the manifest and qualifying performance records before writing the attestation JSON. The named `v1.0.0-rc.2-evidence` directory is intentionally not ignored and must appear in the evidence-only commit. Every schema-v3 file reference must record its exact positive byte count and lowercase SHA-256.
4. Update `QA_REPORT.md` and `LAUNCH_READINESS.md` with only the evidence actually produced. Only when both reports truthfully say READY, add their candidate-bound structured markers and exact file references to the QA approval record. The Canyon approval record and PNG are already product-tag files: reference their product bytes but do not add, modify, or replace them in the evidence commit. Create a separate evidence-only commit containing only the other canonical files referenced by the attestation. The product commit must be its ancestor. Copies, deletions, renames, unreferenced files, product source, dependency inputs, assets, release tools, either product-bound visual file, and tagged `dist/` changes fail verification.
5. Annotate that evidence commit with `attestation/v1.0.0-rc.2`. The attestation tag pins the final reports and evidence; the product tag continues to pin source and build identity. Do not rerun the release-manifest command from the evidence commit or treat its commit as the product source.
6. From the clean tagged evidence checkout, run `npm run release:attestation:verify -- --attestation artifacts/release-attestations/v1.0.0-rc.2.json`. It fails closed on tag movement or non-ancestry; non-evidence diff paths; untracked/changed/symlinked evidence; raw/gzip inventory mismatch; non-recomputable render/soak summaries; sparse/cadence-broken samples; substituted or missing mandatory QA commands/logs; unstructured, stale, or misbound report/approval decisions; incomplete or fabricated embedded visual-candidate/capture schemas; owner/capture/QA chronology mismatch; any product change after review except the two canonical promotion outputs; a missing, malformed, resized, or hash-mismatched Canyon baseline; smoke completion before start or any QA/accessibility/legal approval before completed mandatory evidence; incomplete Chrome/runtime/cache/served identity; non-PNG or undersized smoke screenshots; noncanonical or mutable rollback locators; source-unbound predecessor manifests; rollback archive byte-count/SHA mismatch; incomplete, substituted, or wrong-root rollback served inventories; wrong native predecessor version; and vacuous, incomplete, or destructive rollback data-safety records. The source command's 71 release-attestation fixtures pass; the real verifier has not run because no candidate attestation exists.
7. Publish the product and attestation tags together only after the verifier passes and owner acceptance is recorded. Deploy only the manifest-recorded bytes produced from the product tag, never a rebuild from the attestation commit.

This avoids a false claim that post-tag reports live inside the product tag while preserving an immutable, reviewable chain from product commit → manifest/served hashes → smoke bundle → evidence commit/tag.

## Visual baseline approval and promotion

Playwright is permanently configured with `updateSnapshots: 'none'`. The visual-regression file also checks the effective configuration in `beforeEach`, so `--update-snapshots` cannot silently create a missing image or replace an existing one. Do not use Playwright snapshot-update flags as a baseline workflow.

After all prerequisite runtime gates pass, create and capture the review candidate with these separate commands from a clean, committed checkout:

```sh
npm run visual:candidate
npm run visual:capture -- --output-dir artifacts/visual-review/<exact-run>
```

`visual:candidate` reuses the isolated release build orchestration with `VITE_QA_MODE=1`, but writes a distinct ignored format-1 candidate and exact raw/gzip inventory at `artifacts/candidate-evidence/visual/current/`; it does not replace or qualify the production release manifest. `visual:capture` requires `--output-dir` to name a fresh direct child of `artifacts/visual-review/`, loads only the fixed candidate manifest, starts its own exact-byte loopback server, fails if its dedicated port is occupied, and emits schema-v3 screenshot evidence whose actual Chromium response bodies and final URLs are bound to the candidate inventory. It never updates an earlier review bundle. The latest current-source run is recorded below.

Latest visual-candidate rehearsal: `npm run visual:candidate` was attempted on 2026-07-18 and failed before writing candidate bytes because the working tree was not clean. A later clean-branch attempt reached the isolated `dist/` scan and exposed an overbroad `ghp_` byte-prefix check against the binary Canyon GLB. The follow-up `npm run test:release-manifest` passed 45/45 after adding the short-token-prefix regression. The latest clean `a9a97ef` `visual:candidate` produced a 33-file / 8,004,212-byte visual QA candidate with aggregate `f8005e5bf9f1e3991b4fa90c1a1259b2842f5fb492e32a0e4e12c659a3c5661f`; `visual:capture` wrote `artifacts/visual-review/rc2-current-a9a97ef-20260719t082620z/manifest.json`, passed 11/11, and recorded manifest SHA-256 `5866dc0888245224a2e2c85f5883b3dfe07c5300b8d9034fe802ab5775761610`. The correct next action is owner/legal visual review plus guarded baseline promotion, not another blind capture retry.

The only authorized source mutation for the currently missing curved-Canyon baseline is:

```sh
npm run visual:promote:canyon -- \
  --approval /absolute/path/outside-the-repository/canyon-owner-approval.json \
  --capture-manifest artifacts/visual-review/<exact-run>/manifest.json
```

Before asking the owner to review, an operator may create a non-acceptance external draft populated with the exact capture, candidate, and screenshot hashes:

```sh
npm run visual:approval:draft -- \
  --capture-manifest artifacts/visual-review/<exact-run>/manifest.json \
  --output /absolute/path/outside-the-repository/canyon-owner-approval.draft.json
```

The draft helper writes outside the repository, extracts the Canyon Practice 500 baseline-candidate screenshot, and intentionally sets `decision: "PENDING_OWNER_REVIEW"`, a placeholder timestamp, and a placeholder reviewer name. The promotion tool rejects that draft until the product owner manually reviews the exact PNG, changes `decision` to `ACCEPT`, sets a fresh UTC `approvedAt`, and replaces `reviewer.name` with a real non-placeholder product-owner attribution. Do not change candidate or screenshot hash fields while converting the draft into the owner-authored approval file.

Run promotion only after runtime qualification passes. Before mutation, the command requires a clean checkout at the exact approved capture commit, an absent target and approval record, a non-placeholder owner attribution/timestamp and explicit `ACCEPT`, a valid 1280×720 PNG, and matching hashes throughout this chain. Promotion must occur after capture and no later than 24 hours after `approvedAt`:

- the format-1 `visual-qa-candidate` manifest at the fixed `artifacts/candidate-evidence/visual/current/manifest.json` path for a clean `VITE_QA_MODE=1` build, reloaded through the shared candidate loader and matched exactly to a fresh inventory of the adjacent on-disk `dist/`;
- a schema-v3 PASS `five-track-controlled-visual-review` manifest whose source identity, package/candidate version, local inventories, served inventories, loopback root, candidate-manifest SHA-256, runtime commit, and Chromium settings are independently revalidated rather than inferred from self-reported checks;
- the exact unique 11-entry matrix: five Practice starts at 0 m, five Rival midcourse frames at 650/720/790/825/900 m, and one Canyon Practice curved-baseline candidate at 500 m, all High quality, 1280×720 at device scale factor 1, with PASS status and empty diagnostics; every referenced PNG must be a distinct contained regular file with no symlink/hard-link alias, and its actual positive bytes, SHA-256, PNG structure, and dimensions are revalidated before the manifest can be embedded;
- frozen/ready hero and exact runtime/track/distance state on every capture, ready rival assets on every Rival capture, and ready Canyon kit/panorama plus Canyon replacement diagnostics on every Canyon capture;
- a PASS response set on every capture with service workers blocked, cache disabled, no unexpected responses, the exact distance query, same-origin non-redirected final URLs, and every actual raw/gzip response occurrence bound to the re-inventoried QA candidate.

The external approval must be manually owner-authored; the promotion tool does not generate acceptance or authenticate authorship. It uses this exact schema, with real values copied from the reviewed capture evidence:

```json
{
  "schemaVersion": 1,
  "kind": "rivet-ridge-rally-visual-baseline-owner-approval",
  "authentication": "external-manual-trust-boundary",
  "decision": "ACCEPT",
  "approvedAt": "2026-07-16T12:34:56.789Z",
  "reviewer": { "name": "REAL REVIEWER NAME", "role": "product-owner" },
  "statement": "I reviewed the exact Canyon Practice 500 capture against the approved concept art and accept it as the checked-in visual regression baseline.",
  "candidate": {
    "commit": "EXACT 40-OR-64-CHARACTER GIT COMMIT",
    "aggregateSha256": "EXACT QA CANDIDATE AGGREGATE SHA-256",
    "captureManifestSha256": "EXACT CAPTURE MANIFEST SHA-256"
  },
  "screenshot": {
    "path": "curved-baseline-candidate/canyon-kickoff-practice-1280x720.png",
    "bytes": 1,
    "sha256": "EXACT SCREENSHOT SHA-256",
    "project": "chromium",
    "viewport": { "width": 1280, "height": 720, "deviceScaleFactor": 1 },
    "mode": "practice",
    "trackId": "canyon-kickoff",
    "distance": 500,
    "quality": "high",
    "readiness": {
      "visualState": "frozen",
      "bikeAsset": "ready",
      "canyonKitAsset": "ready",
      "environmentAsset": "ready",
      "visualDistance": 500,
      "ariaLabel": "Live 3D race on Canyon Kickoff",
      "runtimeBuild": { "commit": "SAME EXACT GIT COMMIT", "dirty": false }
    }
  }
}
```

The placeholder strings and byte count above are documentation only and are intentionally rejected by the tool. `authentication: "external-manual-trust-boundary"` is a disclosure, not a signature: the tool can prove internal consistency among files, hashes, timestamps, source identity, and captured bytes, but it cannot authenticate a person or prove that the named product owner performed the review. Genuine owner authorship and concept review remain a manual **EXTERNAL BLOCKER**; do not invent a key, signature, or automated identity claim.

Draft rehearsal evidence on 2026-07-19: `npm run visual:approval:draft -- --capture-manifest artifacts/visual-review/rc2-current-a9a97ef-20260719t082620z/manifest.json --output /tmp/rrr-canyon-owner-approval-draft-a9a97ef-20260719T083300Z.json` wrote a non-acceptance external draft binding source `a9a97ef98f5004a4fcca78074b9d93283bcb8331`, candidate aggregate `f8005e5bf9f1e3991b4fa90c1a1259b2842f5fb492e32a0e4e12c659a3c5661f`, capture manifest SHA-256 `5866dc0888245224a2e2c85f5883b3dfe07c5300b8d9034fe802ab5775761610`, and Canyon Practice 500 screenshot SHA-256 `5f31240535d0c38569e9680dcef9846cecddbf92f797dcbab89dae2c004da3c3`. The draft remains `decision: "PENDING_OWNER_REVIEW"`, proving the helper does not bypass owner review. The `/tmp` draft is not committed evidence and expires operationally with the owner-review window.

After complete validation, promotion first writes `docs/design/RACE_CURVED_CANYON_BASELINE_APPROVAL.json`, embedding the complete validated capture manifest and complete re-inventoried candidate manifest so ignored evidence cannot disappear, and then copies the macOS Chromium PNG baseline. Ordinary failures roll both outputs back and successful completion verifies both. A hard process or machine interruption between those two exclusive writes can leave only the uncommitted approval record. If that happens, confirm that the baseline target is absent, manually delete only the orphaned `docs/design/RACE_CURVED_CANYON_BASELINE_APPROVAL.json`, return to the clean approved commit, and rerun the promotion command with the same still-fresh external approval. If an interruption leaves both outputs but no success message, treat completion as unknown: remove both uncommitted outputs, restore the clean approved commit, and rerun guarded promotion. If the 24-hour window has expired, obtain a new owner review and approval. Never copy or promote the baseline manually.

Commit only the two promoted outputs, then create the final annotated product tag. The final attestation independently requires the reviewed clean commit to be an ancestor of that product commit and rejects the tag unless the complete diff is exactly the canonical approval record plus promoted PNG. Because that promotion commit is later than the reviewed capture commit, the review capture is approval input rather than final-candidate QA. Rebuild and rerun `npx playwright test e2e/visual-regression.spec.ts` from the clean final tag; the run remains non-mutating and must pass against the promoted bytes before release evidence can call the baseline qualified.

## Performance qualification

Reuse the isolated non-QA format-2 release candidate generated exactly once by the locked sequence above. Do not invoke `release:manifest` a second time. Stop any earlier preview without changing `dist/`, then serve those exact product bytes on the harness's isolated port:

```sh
npm run preview -- --host 127.0.0.1 --port 4373
```

In another shell, run the measurement and soak. Do not rebuild between manifest generation, performance, soak, and production smoke; each stage must qualify the same manifest-recorded `dist/` bytes.

```sh
PRODUCT_COMMIT="$(git rev-parse HEAD)"
EVIDENCE_ROOT="artifacts/candidate-evidence/$PRODUCT_COMMIT"
npm run perf:measure -- --headed --manifest artifacts/release-manifest.json --output "$EVIDENCE_ROOT/performance/headed-measurement.json"
npm run perf:soak -- --headed --minutes 30 --sample-interval 10 --mode rival --manifest artifacts/release-manifest.json --output "$EVIDENCE_ROOT/performance/30m-soak.json"
```

The `artifacts/candidate-evidence/` tree is intentionally ignored. Both producers reject JSON output—and the measurement producer rejects screenshot output—outside that tree before starting browser work. A tentative producer PASS is also checked by the same schema-4 manifest/source/configuration/raw-sample validator used by final attestation; any manifest load or final-contract failure is recorded as a harness failure and changes the output to FAIL. Qualifying runs therefore keep the product-tag checkout clean while evidence is staged and cannot pass a configuration that final attestation would reject. This producer-time check does not replace the later evidence-commit/tag and tag-object verification. Do not overwrite the tracked historical `artifacts/performance/final-*.json` files. After the product manifest and smoke pass, copy only the hash-reviewed qualifying files into `artifacts/release-attestations/v1.0.0-rc.2-evidence/performance/` with the exact commands above, then include that unignored directory in the separate evidence-only attestation commit; that commit may change `HEAD`, but it must not move or rebuild the product tag.

Both commands drive only the public product UI. In each fresh browser context the harness completes onboarding, waits for the asynchronous save, validates the complete native-v60 progress record, writes a schema-valid Canyon qualification with a valid best Solo time, reloads, and verifies that Rival is visibly enabled before using Ride → Practice or Ride → Rival. The product must expose neither `__RRR_QA__` nor `__RRR_PERFORMANCE__`; the release-manifest scan also rejects those markers and the injected `__RRR_PERF_CAPTURE__` marker in shipped bytes. The harness inventories and hashes local `dist/`, including deterministic gzip level-9 size/SHA per file, verifies the complete raw/gzip served inventory and `/` before and after the run, records source commit/tag/dirty state, and requires the build-time runtime commit marker to match that clean source.

Quality is never left at `auto`: qualifying measurement is fixed to High desktop and Low emulated mobile; qualifying soak must use High desktop or Low mobile for its recorded profile. `navigation.shellReadyMs` runs from the initial navigation immediately after capture installation to the first visible title action (`Ride` or `Skip training`); it excludes onboarding completion, progress mutation, reload, and Rival verification, while `navigation.timing` records that same initial navigation. `firstRaceLoadMs` runs from the selected mode click to the engine-ready `countdown` gate; it excludes Ride/menu traversal and the fixed three-second countdown, although the flow still waits for racing plus a nonzero draw before continuing. Before navigation, the schema-4 measurement injects a bounded `requestAnimationFrame` wrapper. It groups callbacks that share one browser frame timestamp, sums their synchronous callback CPU work, retains every raw frame in each normal/stress five-second window, derives mean FPS from raw timestamp coverage, and computes p95 from raw callback-work samples. This metric excludes style/layout, paint, GPU work, workers, and microtasks. Overflow, invalid timestamp/cadence/coverage, or any loss of page visibility fails qualification. The verifier independently recomputes the raw metrics before applying desktop normal/stress mean ≥58 FPS with p95 work ≤16.67 ms, emulated-mobile normal/stress mean ≥30 FPS with p95 work ≤33.33 ms, and manifest-bound gzip bytes <12,000,000. Emulated mobile is a local technical floor only and never substitutes for representative physical mid-range mobile proof.

The schema-4 30-minute Rival soak binds its exact artifact/sample/attempt/gate shape, desktop/mobile viewport, DPR, touch/mobile emulation, selected quality, runtime version, and public progress setup. Rival qualification fails before browser launch without `--headed`, and both the producer and final attestation reject SwiftShader, llvmpipe, or another identified software rasterizer. Keep the visible browser window unobscured and unminimized. Its clock accrues only while `.game-shell[data-race-gate-phase="racing"]` is present, stops across Results/restart/loading/countdown, and fails if page visibility is lost. The harness runs until at least 30 active racing minutes; each unmodified production Rival attempt receives a 12-minute stuck-race ceiling beginning only after the racing gate. The attestation cross-checks total duration against start/completion chronology, requires one positive restart timing per completed race, recomputes the restart summary, and requires the complete diagnostic gate plus one contiguous per-attempt fixed-step record for every completed race and the terminal deadline attempt. The soak must also meet its duration-derived sample minimum with no gap over two configured intervals and recompute memory, input-latency, and fixed-step summaries/trends from raw records. HUD FPS remains diagnostic. Record browser build, viewport, host OS/CPU/memory/GPU fields, effective quality, active and wall duration, raw/recomputed metrics, compressed inventory, memory delta, input lag, first-race load, restart, and editor test-play timings in `QA_REPORT.md`.

The soak JSON records failed requests and HTTP error responses, separates Chromium's known headless `ReadPixels` driver diagnostic from unexpected console/page messages, and reports memory, input-latency, and fixed-step trends. Dropped fixed-step time is retained both as the original per-attempt HUD samples and as a cumulative value across race restarts. A timed-out attempt returns through Escape → Festival menu and restarts through the public mode screen; it remains recorded and fails the zero-timeout release criterion.

Operational harness exceptions are serialized in the artifact after resource cleanup and fail the `no-harness-error` criterion. Measurement and Rival soak stdout summaries also include the bounded `harnessErrors` list plus a direct `releaseContractError` field when the final manifest/source/schema contract rejects the run, so operators can distinguish a missing or invalid format-2 manifest from a browser-side product regression without opening the full JSON artifact. Measurement and Rival soak commands exit unsuccessfully when their automated gates fail, including candidate/source/runtime binding, request, HTTP, page, console, quality, and telemetry criteria. A release `PASS` is possible only for a Rival workload with at least 30 minutes of active race time and the requested duration; `--mode practice` always reports release status `DIAGNOSTIC` and can only pass its separate diagnostic gate. A passing automated gate does not replace review of the named trend fields for runaway memory, accumulating input lag, or worsening dropped-time behavior; no numeric limit is inferred where the product specification does not define one.

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
- stable shell and asset paths must revalidate on every online request (`Cache-Control: no-cache` or an equivalent policy): `/`, `/index.html`, `/manifest.webmanifest`, `/sw.js`, `/assets/icons/app-icon.svg`, `/assets/icons/app-icon-192.png`, `/assets/icons/app-icon-512.png`, `/assets/icons/app-icon-maskable-512.png`, `/assets/icons/apple-touch-icon-180.png`, `/assets/art/title-background.png`, `/assets/art/canyon-festival-panorama.png`, both `/assets/fonts/*.woff2` files, `/assets/3d/hero-bike-rider.glb`, `/assets/rivals/rival-pack.glb`, `/assets/canyon/canyon-kit.glb`, and the stable Basis transcoder JS/WASM paths; apply the same rule to any served release-manifest sidecar;
- GLB, KTX2, WASM, JS, JSON, PNG, SVG, TXT, and manifest files require correct MIME type and compression where applicable; a file extension alone does not authorize immutable caching;
- old fingerprinted assets: retain through the rollback and service-worker transition window.

The current source uses service-worker cache generation `rivet-ridge-rally-shell-v35`; the current dirty-tree `npm run build` and scoped live preview smoke pass, while the release artifact and installed/offline smoke remain ungenerated for the latest candidate. Compilation and the 31 passing production-smoke/service-worker fixtures do not prove a real service-worker install, activation, cache transition, offline journey, installed icon, or exact-product runtime. The core cache source includes `/assets/3d/hero-bike-rider.glb`, `/assets/rivals/rival-pack.glb`, `/assets/canyon/canyon-kit.glb`, `/assets/art/canyon-festival-panorama.png`, both `/assets/fonts/*.woff2` files, and all five SVG/raster app-icon paths listed above. Its precache and offline behavior are **UNVERIFIED** until one clean frozen candidate receives a fresh manifest and production/offline smoke. After both lazy race/editor entry points import, the page claims cached-race readiness only when the current controller acknowledges this exact cache identity; a stale acknowledgement, import failure, controller mismatch, or timeout leaves readiness unset and the offline banner conservative. A controller change clears readiness synchronously and requests one guarded preparation pass; a change received during active preparation records one pending rerun, and a later reconnect retries while the current generation is not ready. Fetches prefer the current cache and may fall back only to the immediately previous app-owned transition cache. Activation keeps that one prior generation for already-open tabs, removes older app-owned generations, and never touches unrelated origin caches. Navigation falls back to current-or-transition `index.html` after a rejected, cross-origin-final, or 5xx network response; same-origin 4xx responses remain visible. Non-GET/cross-origin requests and same-origin paths outside root/index/manifest/`/assets/` are ignored by runtime caching; warming rejects invalid or oversized batches, validates the final URL, and shares a 192-entry current-cache cap with generic static misses. A changed cache name forces the next version's installation. Deployments and rollbacks must preserve both transition generations' fingerprinted server assets because clients may retain an older active worker or open page until reload/activation. If a worker is corrupt, unregister only the app service worker and remove only app-owned `rivet-ridge-rally-*` Cache Storage entries, then reload online and confirm the expected visible version and cache identity. Do not clear all site storage as worker recovery: that also deletes IndexedDB progress and tracks. A full site-data reset is a destructive last resort requiring an explicit irreversible-loss warning and custom-track export first where the application remains usable.

Install fetches every core and index-discovered build asset with `cache: reload`, rejects unsuccessful, non-static/cross-origin-final, `Cache-Control: no-store`, and `Vary: *` responses, and populates `rivet-ridge-rally-shell-v35` only after all fetches settle successfully. Ordinary CDN `Vary` headers remain installable because variance-insensitive matching is allowed only for the strict query-free static URL set. Any install failure deletes that partial current-generation cache, rethrows, and does not call `skipWaiting`. This fail-closed path and the real reload transition remain **UNVERIFIED**.

Every page-level `controllerchange` now invalidates the visible readiness claim synchronously, notifies the offline-status UI, and requests one guarded preparation pass. If preparation is already active, one rerun is remembered; a later `online` event also retries while readiness is absent. A newly controlling worker must provide a fresh exact `rivet-ridge-rally-shell-v35` acknowledgement before cached-race language returns. The synthetic regression source covers immediate invalidation, same-controller re-preparation, and reconnect retry only; real install, activation, cache eviction, and rollback transitions remain open production/offline gates.

## Rollback

Rollback triggers include boot failure, widespread asset 404s, mixed-version caches, save corruption, crash/restart loops, runaway memory, required-input/browser regressions, or a security exposure.

The current predecessor rollback gate is **UNVERIFIED**. An annotated source tag, historical reports, and a format-1 checksum list are not a deployable rollback archive. This repository does not currently record a full source-bound format-2 manifest, safe canonical aggregate-addressed archive locator, exact archive byte count/SHA-256, structured retrieval/staged-smoke evidence with complete pre/post raw-and-gzip served inventories at one dedicated root, or the required native-60→native-30 data-safety record for `v1.0.0-rc.1`. Before deployment, the release owner must provide those records for the retained immutable predecessor bytes, retrieve the exact archive, verify its size and SHA-256, verify every extracted and staged raw/gzip record before and after the journey, and rehearse the downgrade without clearing site data. Until then, do not describe predecessor rollback as `PASS` or promise immediate rollback.

1. Freeze deployment, name an incident lead, and preserve logs plus the current aggregate artifact hash.
2. Confirm the previous immutable archive still matches its recorded byte count and SHA-256, then confirm its extracted and served raw/gzip inventory matches the retained format-2 manifest.
3. Atomically repoint production to that artifact; never rebuild or patch it.
4. Revalidate/purge only `index.html`, `sw.js`, and other short-cache shell paths. Keep old and new fingerprinted assets available.
5. Smoke test the public origin, including visible version, required assets, service-worker transition, race start, and local-save read; recapture the complete served inventory afterward and require the same root URL and manifest match.
6. Record impact, versions, hashes, UTC duration, user guidance, and follow-up defect.
7. Fix forward under a new version/build identity.

IndexedDB migrations require special care: current source declares Dexie schema v6, which maps to native IndexedDB version 60, and custom tracks use schema v2. Version 6 adds a sparse replay `courseKey` index without relabeling or rewriting legacy replay bytes; the version-5 custom-track migration remains unchanged. Structurally valid v1 tracks that satisfy current semantics upgrade by changing only `schemaVersion`; legacy v1 tracks needing the stricter full-parent-footprint repair remain stored, normalize to editable v2 data in memory, and are not quarantined, while save/Test Ride/export remain blocked until repair. The immutable `v1.0.0-rc.1` predecessor declares only Dexie schemas v1–v3, so its actual downgrade target is native IndexedDB version 30. Rolling back to that Dexie-v3/native-30 predecessor after v6 has opened is a version downgrade barrier, not an ordinary migration. Before deployment, rehearse the retained predecessor against a database already opened by v6 and prove it either reads safely or shows a non-destructive incompatibility path. The schema-v3 attestation requires at least one seeded progress record, custom track, and replay; exact matching before/after counts and persisted-state snapshot hashes; the native 60/30 precondition; and no site-data clearing or destructive recovery. The release-attestation fixtures for this source contract pass, but no real predecessor data-safety record exists. Never clear or silently delete local progress, tracks, or replays to make rollback appear successful.

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
