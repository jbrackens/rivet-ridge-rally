# RIVET RIDGE RALLY — Operations Runbook

**Candidate:** `1.0.0-rc.2` working candidate

**Application model:** static Vite site with same-origin assets and an offline service worker

**Production/staging host:** owner selection required

**Deploy, support, and incident owners:** owner assignment required

This runbook covers the code-owned release procedure. Hosting credentials, DNS/TLS, a public support address, retention policy, and final legal approval are external owner actions.

## Current qualification status

`1.0.0-rc.2` is **not qualified for deployment**. The annotated `v1.0.0-rc.1` source, artifact, and evidence remain immutable historical records and must not be rebuilt or relabeled as evidence for the changed candidate.

The documented `npm run assets:build` pipeline normalized only `public/assets/transcoders/basis/LICENSE.txt` from a 9,141-byte LF variant to the already-inventoried output copied from pinned TypeScript: 9,197 bytes with SHA-256 `a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47`. The repository marks that one pinned file `-text -diff` so Git preserves its exact upstream bytes across platforms. No GLB, KTX2, or asset-manifest content changed. `npm run assets:verify` now passes.

The final normal `npm run build` passed asset verification, strict typechecking, Vite production compilation, and notice generation. `dist/THIRD_PARTY_NOTICES.txt` is 38,475 bytes with SHA-256 `c959caf9bfbb3d9b051921453e8a19132c1b40fec2ef3f3db41676d3492f84a1`. The headed local performance measurement passed its desktop and emulated-phone targets, the continuous 30-minute Rival soak passed all automated release criteria, `npm audit` found 0 vulnerabilities, the final non-QA manifest records 21 files / 4,689,233 bytes with aggregate SHA-256 `6a55c00ea36debe543ab946dee06dc5fa73cf8a13d45b047aec399469c9931a3`, and installed Google Chrome 150 passed the production/offline smoke. Before any `rc.2` deployment, complete explicit visual acceptance, the final cross-browser/physical-device matrix, and immutable-source checks described below.

## Operating model

RIVET RIDGE RALLY has no application server, account, remote database, analytics, ads, payments, or public UGC. The production unit is the complete `dist/` directory. Profiles, settings, progression, replay samples, and custom tracks are stored locally in versioned IndexedDB. Custom-track JSON export is the player-controlled backup path.

The site requires HTTPS in production for normal service-worker behavior. All runtime requests are same-origin. Deploy it at the URL root of a dedicated origin: application assets use absolute root paths and the service worker owns root scope. Do not mount the build below a path prefix or share its origin with unrelated applications or service workers. WebGL is the rendering baseline; unsupported WebGL, asset decode failure, offline startup, and corrupt local data have explicit recovery paths.

## Locked toolchain and clean verification

Use a Node version allowed by `package.json`; record `node --version` and `npm --version` with the candidate. From a clean source checkout:

```sh
npm ci
npm run assets:verify
npm run typecheck
npm run lint
npm run test
npm run test:e2e
npm run audit
npm run build
npm run release:manifest
```

`npm run build` verifies generated assets, type-checks, writes production bytes to `dist/`, and deterministically generates `dist/THIRD_PARTY_NOTICES.txt` from pinned installed/vendored license evidence. `npm run release:manifest` first removes any stale manifest, then refuses a build with a missing notice, source map, QA marker, or local `/Users/` path bytes. A passing run writes sorted per-file SHA-256 hashes plus one aggregate hash to `artifacts/release-manifest.json`. Retain the test reports, performance JSON, QA documents, lockfile, source revision, generated notice, and manifest with the immutable artifact.

For local inspection of those exact bytes:

```sh
npm run preview -- --host 127.0.0.1 --port 4173
```

Do not qualify or deploy the development server. Do not rebuild the same version/tag with different bytes.

With that preview still running, execute the installed-Chrome production smoke against the exact non-QA bytes:

```sh
npm run smoke:production -- --base-url http://127.0.0.1:4173 --output artifacts/production-smoke/chrome-smoke.json --screenshots-dir artifacts/production-smoke
```

The command exits unsuccessfully unless the visible version and absence of the QA API are proven, a Practice race starts and restarts, the 3D editor opens, the production service worker controls a reload, the title reloads offline, and no required request, HTTP, page, or unexpected console failure occurs. Retain its JSON and three screenshots with the candidate.

## Performance qualification

Build the QA-only performance candidate and serve it on the harness's isolated port first:

```sh
VITE_QA_MODE=1 npm run build
npm run preview -- --host 127.0.0.1 --port 4373
```

In another shell, run the measurement and soak. After they finish, stop the QA preview and run the normal `npm run build` again before generating the release manifest or production smoke evidence.

```sh
npm run perf:measure -- --headed --output artifacts/performance/final-headed-measurement.json
npm run perf:soak -- --minutes 30 --sample-interval 10 --mode rival --output artifacts/performance/final-30m-soak.json
```

Run both commands against a production preview built with `VITE_QA_MODE=1` so deterministic automation controls are available. The headed measurement is the qualifying FPS, frame-work, draw-call, load, restart, and editor timing capture. The headless 30-minute Rival run is long-duration stability, memory, input-latency, fixed-step, restart, and crash/console evidence; its FPS is diagnostic because offscreen browser scheduling may throttle animation. A headed long soak may supplement it when the window can remain visible and undisturbed. Record browser build, viewport, host hardware, quality level, duration, FPS/frame work, draw calls, memory delta, input lag, first-race load, restart, and editor test-play timings in `QA_REPORT.md`.

The soak JSON records failed requests and HTTP error responses, separates Chromium's known headless `ReadPixels` driver diagnostic from unexpected console/page messages, and reports memory, input-latency, and fixed-step trends. Dropped fixed-step time is retained both as the original per-attempt HUD samples and as a cumulative value across race restarts. Each accelerated Rival attempt has a 90-second observation window: this is nearly three times the observed roughly 32-second average, leaving room for measurement and headless scheduling overhead while still detecting a stuck race. A timed-out attempt is restarted through the QA race path, remains recorded, and still fails the zero-timeout release criterion.

Operational harness exceptions are serialized in the artifact after resource cleanup and fail the `no-harness-error` criterion. The command exits unsuccessfully unless active race workload reaches 30 minutes and the requested duration, at least one race completes, no race times out, no required network request fails, no HTTP error response or unexpected console/page message occurs, and every scheduled sample contains the required telemetry. A passing automated gate does not replace review of the named trend fields for runaway memory, accumulating input lag, or worsening dropped-time behavior; no numeric limit is inferred where the product specification does not define one.

## Release artifact contract

Every uploaded candidate must have:

- product version plus immutable source commit/tag;
- exact lockfile and Node/npm versions;
- the one-time-built `dist/` directory, its `THIRD_PARTY_NOTICES.txt`, and `artifacts/release-manifest.json`;
- current `QA_REPORT.md`, `LAUNCH_READINESS.md`, and `ASSET_LICENSES.md`;
- passing typecheck, lint, unit, browser, accessibility, visual, persistence, reliability, asset, and dependency checks;
- performance and 30-minute soak artifacts;
- a retained previous known-good production artifact for rollback.

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

- fingerprinted assets: `Cache-Control: public, max-age=31536000, immutable`;
- `index.html`, `manifest.webmanifest`, and `sw.js`: revalidate or short cache;
- GLB, KTX2, WASM, JS, JSON, PNG, SVG, TXT, and manifest files: correct MIME type and compression where applicable;
- old fingerprinted assets: retain through the rollback and service-worker transition window.

Service worker cache `rivet-ridge-rally-shell-v8` precaches the shell, stable bike GLB, and stable Basis transcoders, discovers hashed entry assets, and cache-fills same-origin runtime chunks. The `v8` cache generation ensures existing installs fetch the `rc.2` controls, tutorial, and renderer instead of continuing to serve the historical `rc.1` shell. Activation deletes only older caches with the app-owned `rivet-ridge-rally-` prefix, never unrelated origin caches. Navigation can fall back to cached `index.html`; non-GET and cross-origin requests are ignored. A changed cache name forces the next version's installation. During rollback, preserve both generations' assets: clients may keep an older active worker until reload/activation. If a worker is corrupt, clear site storage or unregister it, reload online, and confirm the expected visible version.

## Rollback

Rollback triggers include boot failure, widespread asset 404s, mixed-version caches, save corruption, crash/restart loops, runaway memory, required-input/browser regressions, or a security exposure.

1. Freeze deployment, name an incident lead, and preserve logs plus the current aggregate artifact hash.
2. Confirm the previous immutable artifact still matches its retained manifest.
3. Atomically repoint production to that artifact; never rebuild or patch it.
4. Revalidate/purge only `index.html`, `sw.js`, and other short-cache shell paths. Keep old and new fingerprinted assets available.
5. Smoke test the public origin, including visible version, required assets, service-worker transition, race start, and local-save read.
6. Record impact, versions, hashes, UTC duration, user guidance, and follow-up defect.
7. Fix forward under a new version/build identity.

IndexedDB migrations require special care: schema v4 is forward-migrated in place, including a targeted update of the exact legacy default lane-key pair while preserving custom remaps. Before rolling back across this or any future schema change, prove the retained build safely reads the migrated database or shows a non-destructive incompatibility message. Never use rollback code that silently deletes local progress or tracks.

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

The codebase cannot select or access a production host, DNS, TLS identity, CI/release credentials, public support address, on-call staffing, artifact-retention duration, top-level product license, or final trademark/trade-dress approval. Those are the only intentionally unresolved operations inputs; their owners and evidence must be added before public deployment.
