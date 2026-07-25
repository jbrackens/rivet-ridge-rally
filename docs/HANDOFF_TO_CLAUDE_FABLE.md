# Handoff to Claude Fable — Rivet Ridge Rally RC2 Closure

Prepared: 2026-07-25
Project folder: `/Users/john/Sandbox/Rivet Ridge Rally`
Repository: `https://github.com/jbrackens/rivet-ridge-rally.git`
Active branch: `agent/rc2-launch-hardening`
Open PR: `https://github.com/jbrackens/rivet-ridge-rally/pull/1`
Current release status: **NOT READY**

## Handoff mission

Pick up the paused RC2 launch-hardening goal and close the remaining release-candidate gates honestly. Do not restart the project, do not migrate engines, and do not relabel scoped/dirty/historical evidence as final release evidence.

The first task is to reconcile `LAUNCH_READINESS.md`, `QA_REPORT.md`, `docs/RC2_REMAINING_GATES_CHECKLIST.md`, and the current repository state, then execute the remaining gates checklist.

The owner also changed the desired visual target on 2026-07-25: move away from 3D Roblox-style/blocky toy assets and pursue an original, polished mascot-kart-racer level of charm, color, material finish, and track spectacle. This is a quality/readability target, not permission to copy Mario Kart or Nintendo-controlled expression.

This document is the durable operating brief for the goal. The Claude goal condition should remain concise and point here rather than duplicating this entire runbook. The goal remains active across milestones until the documented RC2 gates are closed or explicitly classified as owner/manual/legal blocked.

## Current product direction

Rivet Ridge Rally is an original browser motocross game. It may take high-level arcade motocross inspiration from old lane/jump/heat racing games, but shipped branding, assets, code, UI, audio, tracks, and marketing must remain original and legally distinct.

Creative pivot: the project should no longer aim for Roblox-style blocky 3D assets. Future visual work should push toward rounded, glossy, expressive, premium arcade-racer assets and richer course dressing, while preserving motocross mechanics and the four-lane readability contract.

The current architecture is:

- TypeScript + Vite.
- React only for menus, HUD, settings, results, and editor UI.
- Direct Three.js/WebGLRenderer for 3D game presentation.
- Custom fixed-step arcade simulation for bike handling, heat, jumping, collisions, AI, timing, and recovery.
- Zustand for app/game flow state.
- Dexie/IndexedDB for local persistence.
- Web Audio/procedural audio.
- Blender-authored GLB assets with glTF Transform, Meshopt, KTX2/Basis support, and verification scripts.

Engine migration is intentionally rejected unless a future requirement cannot be met with the current Three.js architecture and the gameplay/editor/offline/release cost is explicitly accepted by the owner.

## Do not do these without owner approval

- Do not migrate to Godot, Bevy, Babylon.js, PlayCanvas, React Three Fiber, or a hosted game engine.
- Do not copy Mario Kart, Nintendo characters, items, course layouts, UI, vehicle silhouettes, sounds, music, iconography, branding, or trade dress.
- Do not delete historical evidence or rewrite release history.
- Do not move or recreate published release tags casually.
- Do not claim `READY`, `RC READY`, or `launch-ready` unless `LAUNCH_READINESS.md` and `QA_REPORT.md` gates are actually satisfied.
- Do not add third-party art, sounds, models, textures, fonts, or marketplace assets without inventorying source, license, hashes, and shipped/retained status.
- Do not mark owner/legal/manual acceptance as complete using automated test output.

## Latest local/Git state at handoff

Recent commits on `agent/rc2-launch-hardening`:

- `e852dcf docs: prepare Claude handoff for RC2 creative pivot`
- `d4e24b9 docs: add Claude Fable handoff`
- `37bd64d docs: clarify current versus planned graphics tools`
- `7686bf7 docs: record graphics tool adoption plan`
- `a953af4 docs: add toolchain and MCP inventory`

The old duplicate folder `/Users/john/Excitebike 2026` was moved to Trash and should not be used. The active project is `/Users/john/Sandbox/Rivet Ridge Rally`.

## Important source-of-truth documents

After this file, read these in order:

1. `docs/RC2_REMAINING_GATES_CHECKLIST.md` — operational checklist for the remaining release gates.
2. `LAUNCH_READINESS.md` — current commercial readiness decision and remaining gates.
3. `QA_REPORT.md` — evidence ledger and test status.
4. `docs/OPERATIONS.md` — release, visual approval, deployment, cache, support, backup, and rollback procedures.
5. `GAME_BIBLE.md` — product identity, experience, and creative direction.
6. `GAME_SPEC.md` — gameplay, presentation, accessibility, and acceptance requirements.
7. `docs/design/GRAPHICS_TOOLCHAIN.md` — renderer/tooling decision record and why engine migration is deferred.
8. `docs/design/FIDELITY_LEDGER.md` — current visual-fidelity gaps, evidence, and the updated creative target.
9. `docs/TOOLCHAIN.md` — current tools, planned tools, MCPs, and local development commands.
10. `ASSET_LICENSES.md` — source/license/hash inventory for assets.
11. `AGENTS.md` — repo contribution/agent rules.

Read `docs/ASSET_PIPELINE.md`, `THIRD_PARTY_NOTICES.md`, and `docs/RELEASE_ATTESTATION.md` before changing assets, dependencies, or release evidence.

## What is already done or substantially progressed

The project has extensive scoped evidence for:

- Arrow-key lane controls replacing A/D as the primary lane-change defaults.
- Comprehensive Rider School/tutorial work, including contact drills and under-three-minute in-game recap assertions.
- Heat tuning so the bike does not overheat too abruptly after warning.
- Wheelie/barrier behavior and crash/slowdown mechanics work.
- Track editor, local persistence, campaign progression, and built-in track coverage.
- Blender-authored hero bike/rider, rival pack, and Canyon kit with Meshopt GLB verification.
- PMREM/RoomEnvironment material lighting.
- Production/offline smoke, performance, and 30-minute soak evidence for a tagged RC2 candidate.
- Toolchain/MCP documentation in `docs/TOOLCHAIN.md`.

These are not all final release gates. Many are scoped, historical, dirty-working-tree, diagnostic, or not yet bound to the final required attestation.

## Current verified or active tools

Current/verified:

- Blender 4.5.11 LTS.
- Blender official glTF export path via the repo's Blender Python scripts.
- glTF Transform.
- meshoptimizer.
- KTX2/Basis support.
- Three.js PMREM / `RoomEnvironment`.
- Vite, TypeScript, React, Three.js, Zustand, Dexie, Zod.
- Vitest, Playwright, axe-core, ESLint.
- Project dev MCP packages: `@playwright/mcp`, `chrome-devtools-mcp`, `@danielsogl/lighthouse-mcp`.

Planned/recommended, not currently confirmed as active dependencies:

- Material Maker.
- Krita.
- `pmndrs/postprocessing`.
- `three.quarks`.
- Blockbench.
- ArmorPaint.

Do not present the planned/recommended tools as already in use.

## Visual development contract

Do not begin with a game-wide visual rewrite. First build one representative, reviewable vertical slice that proves the revised direction within the current Three.js architecture.

The slice should include, where the current implementation permits:

- One hero bike and rider presentation with rounded, appealing silhouettes and readable animation.
- One representative track section with terrain, surface materials, and at least one jump or barrier interaction.
- Trackside props and festival dressing that establish an original Rivet Ridge Rally identity.
- Environment lighting and atmosphere.
- Dust, exhaust, impact, motion, and cooling feedback.
- Representative HUD integration and obstacle readability.
- Performance and delivered-asset measurements for the supported browser/device profile.

Evaluate the slice for originality, silhouette quality, material quality, animation readability, gameplay clarity, cohesion, performance, asset size, and compatibility with the fixed-step simulation. Prepare clear comparison captures for owner review. Do not promote visual baselines until the owner explicitly accepts the direction and the reviewed captures are hash-bound.

## Gameplay behavior to preserve and verify

Do not assume earlier changes remain correct. Verify the current implementation and prevent regressions in these owner-requested behaviors:

- Left/right steering uses the arrow keys rather than A/D as the primary defaults.
- Forward/backward controls remain on the arrow-key control scheme.
- Rider School comprehensively explains movement, steering, jumping, wheelies, heat/overheating, barriers, recovery, and other essential mechanics.
- Overheating is forgiving enough to support enjoyable play.
- A correctly timed front-wheel lift permits barrier traversal with a speed penalty rather than always causing a crash.
- Tutorial prompts, settings labels, automated assertions, and actual gameplay behavior agree.

## Evidence classifications

Every readiness result must be labeled accurately as one of:

- `VERIFIED`
- `FAILED`
- `INCOMPLETE`
- `HISTORICAL`
- `DIAGNOSTIC ONLY`
- `OWNER BLOCKED`
- `MANUAL-REVIEW BLOCKED`
- `LEGAL/OPERATIONAL BLOCKED`

Evidence is valid only for the exact commit, build, configuration, browser, device, byte identity, and scope recorded with it. Automated tests do not constitute owner, manual, accessibility, legal, or operational approval.

## Milestone reporting contract

After each completed milestone, report:

1. What changed and why.
2. Files and assets affected.
3. Tests and reviews performed, with exact results and evidence locations.
4. Performance, bundle-size, and delivered-asset impact where relevant.
5. Remaining risks or regressions.
6. Decisions still requiring owner/manual/legal approval.
7. Commit hash and push status.
8. The next recommended milestone.

Use small, reviewable commits on the existing branch and push them to the existing PR. Do not force-push, rewrite history, merge the PR, or publish a release without explicit owner approval.

## Stop and request owner direction when

- An engine or architecture migration appears necessary.
- The creative target requires a material scope or schedule expansion.
- Copyrighted or ambiguously licensed third-party assets would be needed.
- Owner visual acceptance or a subjective product decision is required.
- Legal, privacy, hosting, public-support, or operator information is missing.
- Existing owner changes conflict with the proposed work.
- Release evidence cannot be tied to the current candidate.
- An action would rewrite Git history, move a release tag, merge the PR, or publish publicly.

## Remaining high-level blockers

As of this handoff, `LAUNCH_READINESS.md` still marks the game **NOT READY**. The main remaining blockers are:

1. Owner visual acceptance is incomplete.
2. Visual baselines have not been promoted.
3. Physical-device/manual accessibility/fairness review remains open.
4. Rollback proof is incomplete.
5. Public support, hosting, privacy, license, and legal/trademark approvals remain incomplete or owner-dependent.
6. Schema-v3 release attestation is incomplete.
7. Structured release-QA evidence is incomplete. The readiness doc says 7/10 mandatory records exist; missing records are:
   - `browser`
   - `accessibility`
   - `visual`

## Recommended first Claude Fable task

Do this before implementing anything new:

1. Read `LAUNCH_READINESS.md` completely.
2. Read `QA_REPORT.md` sections for current RC2 evidence and remaining gates.
3. Read `docs/OPERATIONS.md` sections for visual approval, release manifest, production smoke, attestation, rollback, and deployment.
4. Verify and update `docs/RC2_REMAINING_GATES_CHECKLIST.md`, which maps each open gate to:
   - exact source doc section;
   - required command or manual action;
   - required output file/artifact;
   - whether it can be completed by code/test automation or requires owner/manual/legal input;
   - whether it changes product bytes or only evidence/docs.

## Suggested next execution order

1. Reconcile docs and current Git state.
2. Verify the creative pivot reached every governing design/style document.
3. Define and implement the smallest representative visual vertical slice.
4. Prepare the owner visual-review package for the revised target.
5. Close or explicitly owner-block the missing structured QA records:
   - browser;
   - accessibility;
   - visual.
6. Only after owner approval, promote visual baselines using the guarded repo workflow.
7. Complete manual/physical-device accessibility and fairness review, or mark blocked with the exact unavailable devices or inputs.
8. Complete rollback proof and data-safety rehearsal evidence.
9. Close or explicitly classify public support, privacy, hosting, licensing, and legal gates.
10. Complete schema-v3 release attestation.
11. Update `LAUNCH_READINESS.md` and `QA_REPORT.md` truthfully.

## Useful commands

Run from `/Users/john/Sandbox/Rivet Ridge Rally`.

```sh
git status -sb
npm run assets:verify
npm run typecheck
npm run lint
npm test
npm run audit
npm run audit:release-scope
npm run build
npm run test:e2e
```

Before running expensive or destructive release flows, read `docs/OPERATIONS.md` and verify whether the command is supposed to operate on a clean tagged candidate, a working tree, or an evidence-only commit.

## Practical warning

The project has many historical, scoped, and diagnostic passes. Treat each evidence item as valid only for the exact scope and byte identity documented beside it. The remaining work is not “make tests green in general”; it is to bind the final readiness claim to one frozen candidate, accepted visuals, required manual/physical reviews, rollback proof, and the final attestation.
