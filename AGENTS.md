# RIVET RIDGE RALLY — Contributor and Agent Instructions

These instructions apply to the repository root and all descendants unless a more specific `AGENTS.md` is added later. They guide implementation work; they do not override direct user instructions.

## 1. Current state

The repository contains a playable RC candidate with five campaign tracks, complete race modes and progression, a fixed-step Three.js game, local IndexedDB saves, procedural audio, responsive controls/accessibility, and the 25-module 3D editor. It also contains unit, cross-browser Playwright, axe, visual-regression, persistence, failure-path, editor, tutorial, gamepad-emulation, and performance harnesses. Treat `QA_REPORT.md` and `LAUNCH_READINESS.md` as the authority for which checks have actually passed and which physical environments remain unverified.

The approved shipped title is **RIVET RIDGE RALLY**. The local workspace folder name contains a prohibited third-party game name. Do not copy that local path name into package metadata, source identifiers, UI, assets, screenshots, marketing, or release artifacts. The owner should rename the local folder before public release work.

## 2. Source of truth

Read these files before substantial work:

1. `README.md` for current repository status and sequence.
2. `GAME_BIBLE.md` for creative intent and player experience.
3. `GAME_SPEC.md` for normative feature and acceptance requirements.
4. `ARCHITECTURE.md` for runtime boundaries and technical constraints.
5. `QA_REPORT.md` for current evidence and open defects.
6. `LAUNCH_READINESS.md` for release gates.
7. `ASSET_LICENSES.md` before adding or modifying assets.
8. `docs/OPERATIONS.md` before changing build/deploy behavior.

When documents disagree, do not silently choose a convenient interpretation. Preserve the strict commercial/QA requirement, record the conflict, and request an owner decision if it materially changes scope.

## 3. Non-negotiable product boundaries

- Create only original or commercially usable identity, art, audio, writing, tracks, vehicles, riders, UI, and promotional material.
- Do not include prohibited third-party game/company names, copied layouts, recognizable characters, trade dress, music, sprites, UI, icons, sounds, or assets in shipped content or metadata.
- Record every asset in `ASSET_LICENSES.md` before it enters a release build.
- Do not add accounts, payments, ads, third-party tracking, public chat, public track browsing, comments, open UGC sharing, multiplayer, or server leaderboards without a separate explicit requirement and architecture/security review.
- Never trust browser-submitted scores for any future leaderboard.

## 4. Required implementation architecture

- Use TypeScript with strict checking and keep the dependency lockfile committed.
- Pin the selected current stable Three.js version exactly.
- Use direct Three.js and `WebGLRenderer` for production rendering.
- Use React only for menus, HUD, settings, results, and editor panels.
- Keep simulation, AI, rendering, and high-frequency input out of React rendering.
- Advance bike handling, jumps, heat, terrain, collisions, AI, and race time through a custom fixed 60 Hz simulation.
- Treat Three.js objects as presentation, never authoritative gameplay state.
- Use one rules path for player, AI, editor test play, and replay-compatible state.
- Use Rapier only for justified static queries; do not delegate vehicle feel to generic rigid-body physics.
- Use versioned IndexedDB repositories and tested sequential migrations.
- Use glTF/GLB, compressed textures/geometry, pooling, instancing, LODs, and lazy loading where the measured content warrants them.

Do not introduce an ECS, game engine, alternate renderer architecture, database, monorepo, or speculative framework unless a documented requirement cannot be met more simply.

## 5. Milestone order and gates

Every stage must leave the project runnable. Do not conceal a broken main path behind unfinished feature branches or documentation claims.

### Stage 0 — foundation

Establish Git, Vite, strict TypeScript, pinned dependencies, a minimal WebGL shell, React app shell, CI-safe scripts, and loading/error states.

**Required proof:** clean install, strict typecheck, lint, unit test, production build, local production preview, and browser smoke test.

### Stage 1 — playable core

Implement title, first-play tutorial, Canyon Kickoff, keyboard input, four-lane riding, throttle/turbo/heat, pitch/wheelies/landings, hazards/cooling, finish/results, local save, pause, refresh/continue, and immediate retry/restart.

**Required proof:** fresh browser profile completes the real loop and Playwright covers it without console, request, or accessibility failures.

Do not prioritize five-track content expansion, visual polish, editor work, or optional technology before this gate passes.

### Stage 2 — full race feature set

Complete all tracks, modes, campaign/mastery progression, shared-rule AI, three difficulty levels, collision rules, gamepad/touch/remapping, accessibility, and responsive layouts.

### Stage 3 — editor and production content

Complete the mandatory local 3D editor, safe interchange, three example tracks, and production-quality original/licensed art and audio.

### Stage 4 — RC hardening

Run the complete browser/device, performance, soak, security, asset, accessibility, persistence, operations, and rollback plan. Close all P0/P1 defects.

## 6. Change discipline

- Make the smallest change that satisfies a named requirement and acceptance test.
- Preserve unrelated user changes and avoid opportunistic refactors.
- Keep data flow explicit and favor pure rules over hidden scene/UI side effects.
- Do not add abstractions for a single use or future possibilities.
- Update relevant tests and documentation in the same milestone as behavior changes.
- Do not edit or commit generated caches such as `.vite/deps`.
- Do not commit production builds, local device data, credentials, tokens, or private source maps unless repository policy explicitly requires a safe artifact location.
- Treat editor imports, URL parameters, local saves, and asset metadata as untrusted input.

## 7. Command contract

The root manifest exposes this command interface:

```text
npm run dev
npm run typecheck
npm run lint
npm run test
npm run test:e2e
npm run test:coverage
npm run build
npm run preview
npm run audit
npm run assets:build
npm run assets:verify
npm run perf:measure
npm run perf:soak
npm run release:manifest
```

Do not infer current status from the existence of a script. Record the exact executed candidate, environment, command, outcome, and artifact in `QA_REPORT.md`.

## 8. Testing rules

- Vitest covers deterministic rules and state transitions.
- Playwright covers real-browser user journeys and screenshots.
- Axe covers applicable UI; manual checks still cover gameplay, focus, captions, color redundancy, touch, motion, and camera readability.
- Any bug fix should begin with a reproducer or a clearly recorded manual procedure and end with regression evidence.
- Assert no unexpected console errors, page errors, failed required requests, or missing assets in browser tests.
- Use stable semantic locators/test IDs rather than timing-dependent selectors.
- Do not loosen thresholds, delete tests, or update screenshots solely to make CI green; first explain the intended change.
- Performance tests must name device, OS, browser/version, build, quality setting, duration, and metrics.
- Real hardware gaps are `UNVERIFIED`; simulated mobile viewports do not prove mobile performance or touch ergonomics.

## 9. QA status hygiene

Only use the statuses defined in `QA_REPORT.md`:

- `PASS` requires executed evidence.
- `FAIL` records absent behavior, failed checks, or defects.
- `UNVERIFIED` names an unavailable required environment/device.
- `EXTERNAL BLOCKER` is limited to owner credentials, legal decisions, publishing access, or third-party approval.

Never turn a planned item, code review, mock, unit test alone, or emulator result into a broader gameplay/browser/device pass. Add build IDs, environments, commands/procedures, and artifact paths to the report.

Never write `RC1 READY`, “launch ready,” “ready to ship,” or equivalent while mandatory checks fail or known P0/P1 defects remain.

## 10. Asset workflow

Before adding an asset:

1. Confirm it is original, public-domain, or commercially licensed for the intended distribution.
2. Record its source/creator, license, proof location, attribution, modifications, and intended shipped path in `ASSET_LICENSES.md`.
3. Optimize a working copy through the documented pipeline; preserve provenance evidence outside destructive transforms.
4. Verify the build references only inventoried assets and that attribution obligations are met.
5. Reject unclear, “free” without terms, editorial-only, noncommercial, scraped, or brand-derived material.

Generated assets require documented tool/source terms and human review for third-party resemblance before shipping.

## 11. Documentation updates by change type

| Change | Required documentation |
|---|---|
| Gameplay/rules/content | `GAME_SPEC.md`, tests, and `QA_REPORT.md`; update `GAME_BIBLE.md` if player-facing intent changes |
| Architecture/dependency | `ARCHITECTURE.md`, manifest/lockfile, tests, and operations when relevant |
| Asset | `ASSET_LICENSES.md` and any content/performance evidence |
| Build/deploy/cache | `docs/OPERATIONS.md`, README command section, and release evidence |
| Accessibility/input | `GAME_SPEC.md`, automated/manual QA rows, responsive screenshots |
| Readiness status | `QA_REPORT.md` first, then `LAUNCH_READINESS.md` using only that evidence |

## 12. Completion handoff

A milestone handoff should state:

- implemented scope and explicit non-scope;
- exact commands executed and their results;
- browser/device environments exercised;
- screenshots, traces, reports, or logs produced;
- open defects and severities;
- documentation changed;
- the next stage gate.

Commercial RC1 handoff additionally requires exact run/test/build/deploy commands, documentation paths, QA/performance results, browser/device coverage, P2-or-lower known issues, external owner actions, and a direct status supported by `LAUNCH_READINESS.md`.
