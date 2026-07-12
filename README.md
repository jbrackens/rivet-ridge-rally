# RIVET RIDGE RALLY

RIVET RIDGE RALLY is an original 3D arcade motocross game for desktop and mobile browsers. It ships five festival tracks, Solo and Rival campaign progression, Practice and Summit mastery, a fixed-60 Hz arcade simulation, keyboard/gamepad/touch controls, local persistence, accessibility options, procedural audio, and a local 3D track builder.

The current package version is **1.0.0-rc.1**. Release evidence and the authoritative status live in `QA_REPORT.md` and `LAUNCH_READINESS.md`; those files must be updated from executed checks before representing this candidate as releasable.

## Run and verify

Use a Node version allowed by `package.json` and the committed npm lockfile.

```sh
npm ci
npm run dev

npm run typecheck
npm run lint
npm run test
npm run test:coverage
npm run test:e2e
npm run assets:verify
npm run audit

npm run build
npm run release:manifest
npm run preview
npm run smoke:production
```

Use `npm run assets:build` only when intentionally regenerating the checked-in GLB/KTX2 pipeline, then rerun `npm run assets:verify`. The headed measurement and 30-minute Rival soak commands are documented in `docs/OPERATIONS.md`; their JSON and screenshot evidence belongs under `artifacts/performance/`.

`npm run build` produces the static production site in `dist/` and writes its complete `THIRD_PARTY_NOTICES.txt`. `npm run release:manifest` refuses QA-marked builds, source maps, missing notices, and leaked local `/Users/` paths before hashing the artifact. With that exact non-QA build running on the documented preview port, `npm run smoke:production` uses installed Google Chrome to verify boot/version, race restart, editor open, and a service-worker-controlled offline reload. Deploy `dist/` as one immutable unit at the root of a dedicated origin; do not deploy the Vite development server or mount the app below a URL prefix. The browser tests build and serve their own QA-mode candidate. Performance commands and their environment limitations are documented in `QA_REPORT.md`.

## Product scope

- Five two-lap launch tracks: Canyon Kickoff, Pine Run, Coastline Clash, Foundry Flight, and Summit Showdown.
- Solo Challenge, Rival Main Race, Practice, campaign unlocks, and seven-tier Summit mastery.
- Four-lane racing with throttle, turbo heat, cooling, wheelies, airborne pitch, landings, terrain, hazards, crashes, and asymmetric rider collisions.
- Route-following and pursuing AI with Easy, Standard, and Expert decision profiles.
- Interactive first-play tutorial, immediate retry/restart, results/coaching, and persistent personal bests.
- Keyboard, remappable controls, standard gamepad support, vibration where available, touch controls, and mirrored touch layout.
- Local 3D editor with 25 modules, 50-action undo/redo, validation, 1–9 laps, examples, safe JSON interchange, library persistence, thumbnails, and test play.
- Reduced motion/shake, high contrast, colorblind-safe signals, captions, UI scale, and separate master/music/SFX volume controls.
- No account, payments, ads, tracking, public sharing, or server dependency.

## Architecture

The game uses strict TypeScript, Vite, React for application UI, direct Three.js/WebGLRenderer for 3D presentation, Zustand for app flow, a custom fixed-step simulation, IndexedDB/Dexie for versioned local data, and Web Audio for original procedural sound. Gameplay and rendering stay outside React's render loop. Nonessential race/editor code is lazy loaded, and the generated player-bike GLB uses Meshopt geometry plus an embedded BasisLZ/ETC1S KTX2 texture.

## Documentation

- [GAME_BIBLE.md](GAME_BIBLE.md) — creative direction and player experience.
- [GAME_SPEC.md](GAME_SPEC.md) — normative behavior and acceptance criteria.
- [ARCHITECTURE.md](ARCHITECTURE.md) — runtime boundaries and data flow.
- [ASSET_LICENSES.md](ASSET_LICENSES.md) — source, rights, hashes, and bundle inventory.
- [QA_REPORT.md](QA_REPORT.md) — executed test and performance evidence.
- [LAUNCH_READINESS.md](LAUNCH_READINESS.md) — release-gate decision and remaining actions.
- [AGENTS.md](AGENTS.md) — repository contribution rules.
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — build, deploy, cache, support, backup, and rollback runbook.
- [docs/ASSET_PIPELINE.md](docs/ASSET_PIPELINE.md) — reproducible GLB/KTX2 pipeline.

## Identity and legal hygiene

Only **RIVET RIDGE RALLY** is approved shipped branding. The local workspace folder name contains a legacy third-party working-name reference; it is outside shipped relative paths and production bytes, but the owner must rename the folder before public CI logs, support exports, or source maps can reveal absolute paths. The owner must also select the repository's top-level product license and complete final legal, trademark, and trade-dress review.
