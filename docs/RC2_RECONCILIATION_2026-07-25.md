# RC2 Reconciliation Record — 2026-07-25

**Scope:** Gate 1 of `docs/RC2_REMAINING_GATES_CHECKLIST.md`. This record reconciles the repository, the release tag, the live build, and the readiness documents. It is evidence and documentation only; no product bytes were changed by the commit that introduces it.

**Reconciled commit:** `bb10ce4448bc3b4036ba832382c57b7086747400` (`agent/rc2-launch-hardening`)

**Working tree at reconciliation:** clean (`git status --porcelain` empty). No unrelated or uncommitted owner changes were present, so none were displaced.

**Readiness decision after reconciliation:** **NOT READY** (unchanged).

## 1. Repository, branch, remote, and PR identity

| Item | Handoff expectation | Observed | Result |
|---|---|---|---|
| Folder | `/Users/john/Sandbox/Rivet Ridge Rally` | Same | MATCH |
| Branch | `agent/rc2-launch-hardening` | Same, tracking `origin/agent/rc2-launch-hardening` | MATCH |
| Remote | `https://github.com/jbrackens/rivet-ridge-rally.git` | Same (fetch and push) | MATCH |
| PR | `https://github.com/jbrackens/rivet-ridge-rally/pull/1` | `#1`, OPEN, **draft**, `agent/rc2-launch-hardening` → `main`, 78 commits, head `bb10ce4` | MATCH |
| Tags | `v1.0.0-rc.1`, `v1.0.0-rc.2` | Both annotated and present locally; only `v1.0.0-rc.2` exists on `origin` | PARTIAL — see §2 |

`v1.0.0-rc.1` (annotated `160fced4…` → `25eeebe7…`) is **local only**; it is not published to `origin`. The predecessor rollback gate depends on this tag being retrievable, which is an additional reason that gate cannot close today.

## 2. Finding R1 — the tagged candidate is no longer the current source (CRITICAL)

`LAUNCH_READINESS.md` and `QA_REPORT.md` both name the candidate as the annotated `v1.0.0-rc.2` tag at `2b4069538c242da37c8c43d6581e097149fa1994`. That statement was accurate when written on 2026-07-19. **It is stale as of this reconciliation.**

Eighteen product-byte files changed between `v1.0.0-rc.2` and `bb10ce4`:

```
index.html
package.json
package-lock.json
public/assets/3d/asset-manifest.json
public/assets/art/canyon-festival-panorama.png
public/assets/art/title-background.png
public/assets/canyon/asset-manifest.json
public/assets/icons/app-icon-192.png
public/assets/icons/app-icon-512.png
public/assets/icons/app-icon-maskable-512.png
public/assets/icons/apple-touch-icon-180.png
public/assets/rivals/asset-manifest.json
src/game/engine/GameEngine.ts
src/game/engine/__tests__/aiRules.test.ts
src/game/input/InputManager.ts
src/game/input/__tests__/InputManager.test.ts
src/styles.css
src/ui/editor/TrackEditorScreen.tsx
```

Behavioural changes in that set include the Canyon-kit readiness timeout moving from 12 s to 30 s with new failure-reason diagnostics (`GameEngine.ts`), keyboard lane-tap arbitration when another input device wins the frame (`InputManager.ts`), editor confirm-dialog focus handling, pause-button placement, and lossless recompression of four shipped icon PNGs.

**Consequence.** Every release-bound artifact recorded against `2b40695` is now **HISTORICAL** with respect to `bb10ce4`:

| Evidence | Recorded status | Status vs. `bb10ce4` |
|---|---|---|
| Format-2 release manifest `artifacts/history/release-manifest-1.0.0-rc.2-format-2.json` (aggregate `e7af57d5…`) | PASS | HISTORICAL — does not describe current bytes |
| Installed-Chrome production/offline smoke (`83ea1008…`) | PASS | HISTORICAL |
| Headed performance `headed-measurement.json` (`02c1a14b…`) | PASS | HISTORICAL |
| 30-minute Rival soak `30m-soak.json` (`4e8f509d…`) | PASS | HISTORICAL |
| 7 structured QA records (`typecheck`, `lint`, `assets`, `dependencyAudit`, `unit`, `persistence`, `reliability`) | 7/10 complete | HISTORICAL — bound to the superseded manifest aggregate |

This does **not** mean the work was wasted or that the records should be deleted; they remain valid for the bytes they name. It means the release candidate must be re-frozen — either by re-tagging a new candidate from a chosen commit or by explicitly deciding that `2b40695` is the shipping candidate and that the post-tag product changes are deferred. **That is an owner decision and is recorded as OWNER BLOCKED.**

The three missing structured QA records (`browser`, `accessibility`, `visual`) therefore cannot be generated meaningfully until the candidate question is settled; generating them against `bb10ce4` would produce records bound to a manifest aggregate that does not exist.

## 3. Finding R2 — local toolchain drift (resolved for this session, unresolved on the machine)

`docs/TOOLCHAIN.md` records Node `v26.4.0` and npm `11.17.0` as required, and `.node-version` pins `26.4.0`.

The default interactive `PATH` on this machine now resolves:

```
node -> /Users/john/.local/bin/node   v22.23.1
npm  -> /Users/john/.local/bin/npm    10.9.8
```

The pinned toolchain is still installed at `/opt/homebrew/bin/node` (`v26.4.0`) and `/opt/homebrew/bin/npm` (`11.17.0`), but it is no longer first on `PATH`.

Run under the drifted toolchain, the release-manifest fixture suite **fails closed** as designed:

```
not ok 2 - qualifies the installed npm package tree against a detached fixture
  Error: Release guard failed: npm package version does not match packageManager
```

That is the guard working correctly, not a product defect. All gate evidence in §4 was therefore re-run with `PATH="/opt/homebrew/bin:$PATH"`, under which the fixture passes 45/45.

**Action required:** any future release, manifest, smoke, or attestation run must explicitly select the pinned toolchain. Evidence produced under `v22.23.1` must not be used for release qualification.

## 4. Verified command-gate evidence at `bb10ce4`

Clean tree, `PATH="/opt/homebrew/bin:$PATH"`, Node `v26.4.0`, npm `11.17.0`. Log: `gate-batch-pinned-bb10ce4.log` (session scratchpad; not committed).

| Command | Result | Detail |
|---|---|---|
| `npm run assets:verify` | **VERIFIED** | Hero 49,780 triangles / 28 mesh-bearing nodes / 28 render primitives / 517,664 bytes; rival pack passed; Canyon kit 32,008 triangles / 62 meshes / 20 materials / 427,028 bytes; production art/provenance passed |
| `npm run typecheck` | **VERIFIED** | Strict project check clean |
| `npm run lint` | **VERIFIED** | Whole-repo ESLint clean |
| `npm test` | **VERIFIED** | 456 checks: 303 Vitest across 32 files, 45 release-manifest fixtures, 71 release-attestation fixtures, 37 production-smoke/service-worker/release-scope fixtures. (The readiness docs still say 452 checks / 302 Vitest / 34 smoke fixtures — superseded counts.) |
| `npm run audit` | **FAILED** | See §5 |
| `npm run audit:release-scope` | **VERIFIED** | 131 files / 14,916,760 bytes / aggregate SHA-256 `ceff8bedb6b88393786ddfafac55b8cb395642b37ba014dc9c103ecada0fe3b7` / zero findings |
| `VITE_QA_MODE=0 npm run build` | **VERIFIED** | Asset verification, strict typecheck, Vite production build, notices regenerated at 43,872 bytes / SHA-256 `f837ed705667d0f3976bbd419f42d8c63844a3eb4b52f76db88ed3a1d6e270c2`. No chunk-size warning. |

These are current-source static, unit, and build results for a clean tree. They are **not** a frozen-candidate release pass, a manifest-bound artifact, production/offline smoke, performance qualification, or any owner/manual/legal approval.

## 5. Finding R3 — the dependency-audit gate now FAILS

`npm audit --audit-level=high` exits non-zero at `bb10ce4`:

```
24 vulnerabilities (18 moderate, 6 high)
```

The readiness documents record "zero high-severity npm audit vulnerabilities" from 2026-07-19. That was true then. New advisories have since been published against dependencies that were already installed; the lockfile did not change.

Every affected package is a **devDependency**, and none is reachable from the shipped browser runtime (`three`, `react`, `react-dom`, `zustand`, `dexie`, `zod`):

| High-severity advisory | Path into the tree | Ships to browser? |
|---|---|---|
| `brace-expansion` DoS (GHSA-mh99-v99m-4gvg) | `@sentry/node` → `lighthouse` → `@danielsogl/lighthouse-mcp`; also top-level dev tooling | No |
| `sharp` / libvips CVE-2026-33327, -33328, -35590, -35591 (GHSA-f88m-g3jw-g9cj) | `sharp` → `ndarray-pixels` → `@gltf-transform/functions` (asset build pipeline) | No |

Moderate findings cluster in `@opentelemetry/*` and `@sentry/node`, pulled in by the Lighthouse and Chrome DevTools MCP dev packages.

Remediation options, both of which change `package-lock.json` and therefore invalidate any manifest binding:

1. `npm audit fix` — non-breaking; expected to clear `brace-expansion`/`minimatch`.
2. `sharp` requires `npm audit fix --force`, which downgrades `@gltf-transform/functions` to `3.4.2` — a **breaking** change to the authored-asset optimizer that would need the full `assets:build` / `assets:verify` chain re-run and re-hashed. Not attempted.

**Classification: FAILED (dev-tooling scope, no shipped-runtime exposure).** Deliberately not remediated inside this reconciliation commit, because changing the lockfile mid-reconciliation would invalidate the evidence recorded above and is entangled with the unresolved candidate question in §2.

## 6. Live build confirmation

`npm run preview` served the freshly built non-QA `dist/` on `http://127.0.0.1:4173/`.

| Check | Observed |
|---|---|
| Runtime commit marker | `data-build-commit="bb10ce4448bc3b4036ba832382c57b7086747400"` |
| Dirty marker | `data-build-dirty="false"` |
| Service-worker shell | `rivet-ridge-rally-shell-v35`, `data-offline-ready="true"` |
| QA / performance APIs | absent (`__RRR_QA__`, `__RRR_PERFORMANCE__` both `undefined`) — correct for a non-QA build |
| Authored assets | `bikeAsset=ready`, `canyonKitAsset=ready`, `environmentAsset=ready` (panorama 1774×887, 204 ms) |
| Hero contract | `RRR_HeroBikeRider`, 88 nodes, 28 meshes, 28 primitives, 10 materials, 0 textures, 49,780 triangles, `presentation-only` |
| Rendering | `three.js r185`, `pbrEnvironment=pmrem`, `heroBikeMaterialResponse=pmrem-three-point`, `heroBikeShadowStyle=pcf-contact`, `groundedDustStyle=soft-speed-reactive-twin-wheel-plume` |
| Canyon dressing | 76 route banners + 76 poles (4 texture variants), 22 route-crowd rail groups / 198 spectators, 78 shoulder shelves / 184 rocks / 52 agave, 132 start-crowd spectators, 4 per-lane open cooling arches |
| Console errors | none |

**This is the first evidence in the project that binds a live runtime to `bb10ce4`.** Prior live-smoke records in the readiness documents name `0b4413f`, `f5882c9`, `466dd80`, and `36fec40`; all are historical.

## 7. Gameplay behaviour that had to be preserved — verified against `bb10ce4`

| Owner requirement | Verified how | Result |
|---|---|---|
| Left/right steering on arrow keys | `InputManager.ts` defaults `laneLeft: ArrowLeft`, `laneRight: ArrowRight`; live Rider School card renders `Lanes ← Left / → Right`; live buttons expose `Move one lane left` / `Move one lane right` | **VERIFIED** |
| Arrow-key control scheme for pitch | Defaults `pitchUp: ArrowUp`, `pitchDown: ArrowDown`; live card renders `Pitch ↑ Up / ↓ Down` | **VERIFIED** |
| Tutorial covers the essential mechanics | `TUTORIAL_LESSON_SIGNAL_REQUIREMENTS` defines 12 gated lessons — ride, coast, lane change, critical heat, cooling release, training-bump wheelie, airborne pitch (up/down/neutral), clean landing, choice-barrier avoidance, mud slowdown, grass slowdown/return, recovery-barrier crash and recover — plus `TUTORIAL_COLLISION_DRILL_COUNT = 2`. Live intro reads "12 lessons + 2 contact drills". | **VERIFIED** |
| Overheating forgiving enough to play | `PHYSICS`: `turboHeatPerSecond: 8` up to `turboWarningHeat: 78`, then `turboCriticalHeatPerSecond: 4` to `maximumHeat: 100`; `passiveCoolingPerSecond: 14`; `overheatRecoveryHeat: 35`. The warning-to-overheat band is deliberately half-rate. | **VERIFIED (source + unit scope)** |
| Lifted front wheel clears a barrier with a speed penalty rather than always crashing | `GameEngine.ts:106` `FRONT_WHEEL_CLEAR_PITCH = 0.18`; `hasFrontWheelClearance()` returns `bike.wheelie \|\| bike.pitch >= 0.18`, i.e. clearance is granted below the full `wheeliePitch: 0.28` latch. Retained-speed penalty applies instead of a crash. | **VERIFIED (source + unit scope)** |
| Controls, tutorial prompts, and behaviour agree | Live tutorial card, live button accessible names, and `InputManager` defaults all state the same bindings | **VERIFIED** |

### Open question O1 — "forward/backward on the arrow-key scheme"

The goal text asks that "forward and backward controls remain on the arrow-key control scheme". In the current implementation, **forward throttle is `W` (`throttle: "KeyW"`)**, not an arrow key; `ArrowUp`/`ArrowDown` are bound to front-wheel pitch, and the game has no reverse.

These are mutually exclusive on the same two keys. Rebinding throttle to `ArrowUp` would collide with pitch-up, which the tutorial teaches as a distinct airborne mechanic. No change was made.

**Classification: OWNER BLOCKED.** Required decision: either (a) confirm the current split is what was meant — lanes and pitch on the arrow cluster, throttle on `W` — or (b) specify the intended remapping and what pitch should move to.

## 8. Documentation accuracy corrections identified

| Statement | Where | Correction |
|---|---|---|
| Candidate is `v1.0.0-rc.2` at `2b40695` | `LAUNCH_READINESS.md` header, `QA_REPORT.md` header | Accurate for the tag; stale as the description of current source. See §2. |
| "452 checks: 302 Vitest … 34 production-smoke fixtures" | `LAUNCH_READINESS.md`, `QA_REPORT.md` | Now 456 checks: 303 Vitest, 45 release-manifest, 71 release-attestation, 37 production-smoke/service-worker/release-scope |
| "zero high-severity npm audit vulnerabilities" | `LAUNCH_READINESS.md`, `QA_REPORT.md` | No longer true at `bb10ce4`. See §5. |
| Latest live-smoke runtime marker is `0b4413f` | `LAUNCH_READINESS.md`, `QA_REPORT.md` | Superseded by the `bb10ce4` live confirmation in §6 |
| `v1.0.0-rc.1` supports rollback | `LAUNCH_READINESS.md`, `QA_REPORT.md` | Already `UNVERIFIED`; additionally the tag is **local-only and unpublished**, so even source retrieval from the remote is currently impossible |

Historical statements are retained. Corrections are recorded as current-state supplements rather than edits over prior evidence.

## 9. Creative-pivot coverage audit (gate 2 input)

| Document | Carries the 2026-07-25 pivot? | Action |
|---|---|---|
| `GAME_BIBLE.md` | Yes — normative target plus explicit "avoid Roblox-adjacent block avatars, cube-first bodies, default-engine primitive props" | None |
| `GAME_SPEC.md` | Yes — normative visual-identity requirement | None |
| `docs/design/GRAPHICS_TOOLCHAIN.md` | Yes | None |
| `docs/design/FIDELITY_LEDGER.md` | Yes | None |
| `docs/TOOLCHAIN.md` | Yes | None |
| `docs/HANDOFF_TO_CLAUDE_FABLE.md` | Yes | None |
| `docs/design/CANYON_VERTICAL_SLICE.md` | **No — contradicts it.** Line 17 sets the style target as "chunky but purposeful proportions … Assets should feel toy-like in clarity". | **BLOCKED — see R4** |
| `docs/design/HERO_BIKE_RIDER_VERTICAL_SLICE.md` | No pivot statement (its "blocky" mentions are gap findings, which are correct) | **BLOCKED — see R4** |
| `docs/design/RIVAL_PACK_VERTICAL_SLICE.md` | No pivot statement | **BLOCKED — see R4** |
| `README.md`, `docs/ASSET_PIPELINE.md`, `docs/UI_UX_POLISH_PLAN.md` | "blocky"/"chunky" occurrences are gap findings or intentional HUD styling language, not style targets | None |

### Finding R4 — the three asset-contract documents are hash-bound and cannot be edited in isolation

The first attempt at this gate edited all three `docs/design/*_VERTICAL_SLICE.md` files to carry the pivot. That **broke the asset verification chain**, and the error was pushed before it was caught:

```
AssertionError: docs/design/HERO_BIKE_RIDER_VERTICAL_SLICE.md manifest record
  actual:   { bytes: 25595, sha256: '619e905a…' }   # value recorded in the manifest
  expected: { bytes: 26610, sha256: '619e…'      }   # freshly computed from the edited file
```

`node scripts/verify-hero-bike-rider-assets.mjs`, `…-rival-pack-…`, and `…-canyon-…` all failed, which also fails `npm run assets:verify` and therefore `prebuild` and `npm run build`. Only `verify-production-art.mjs` still passed.

**Cause.** Each of those three documents is the `contract` provenance record inside its asset's schema-v2 manifest — `public/assets/3d/asset-manifest.json`, `public/assets/rivals/asset-manifest.json`, and `public/assets/canyon/asset-manifest.json` — bound by exact byte count and SHA-256 (`scripts/build-hero-bike-rider-assets.mjs:1159`, `scripts/build-rival-pack-assets.mjs:297`, `scripts/build-canyon-assets.mjs:272`). They are **production contracts, not commentary**. This is correct and deliberate design: the document that specifies an asset is bound to the asset it specifies.

**Consequence.** Amending any of the three requires re-running `npm run assets:build`, which re-authors the GLBs through Blender and rewrites the manifests — a **product-bytes change**. That cannot be done inside a documentation-only reconciliation, and it is entangled with the unresolved candidate question in §2.

**Resolution taken.** All three files were reverted to their `bb10ce4` content and the verifiers confirmed passing again. The pivot statements intended for them are recorded instead in `docs/design/MASCOT_DIRECTION_VERTICAL_SLICE_PLAN.md` §0, which is not hash-bound, and re-binding the contracts is folded into the slice's deliverables where an `assets:build` run is required anyway.

**Classification: gate 2 is complete for every document that can be changed without touching product bytes, and BLOCKED for the three asset contracts.** Governing intent is not lost — `GAME_BIBLE.md` and `GAME_SPEC.md` both carry the pivot normatively and outrank the per-asset contracts.

**Process note.** The regression reached `origin` because `npm run assets:verify` was not re-run after the documentation edits. Any change to a `docs/design/*_VERTICAL_SLICE.md` file must be treated as an asset-pipeline change and re-verified before commit.

## 10. Current visual shortcomings — assessed directly, not inherited

Assessed by comparing the newest controlled capture (`artifacts/visual-review/rc2-current-466dd80-20260719T110548Z/`, commit `466dd80`, historical) and the live `bb10ce4` runtime against `docs/design/concepts/gameplay-desktop.png` and `docs/design/concepts/hero-bike-rider-production-reference.png`.

1. **Hero bike and rider are the dominant mismatch.** The reference sheet is already an appealing, original, rounded mascot-racer design (teal/coral/cream livery, number 22). The runtime asset reads as boxes and cylinders: a capsule head with a flat visor plate, a slab torso, rectangular limbs, a plate-like number panel, and tyres without visible sidewall or spoke depth. All 10 materials are flat solid-colour PBR with **zero textures** — no base-colour, normal, or ORM atlases exist.
2. **Terrain is a flat plane with painted detail.** `layered-rut-pebble-v3` supplies 512×512 colour and height maps, but the surface has no real displacement, no berm cross-section, no contact deformation, and repeats visibly down the sightline.
3. **Canyon walls are stacked boxes.** The mesas read as extruded rectangles with hard 90° corners; the concept has eroded, layered rock with silhouette variety.
4. **Crowd and props are placeholder primitives.** 198 route spectators and 132 start spectators are capsule/box figures with no animation. The concept has posed, varied, layered crowds.
5. **No post-processing.** No AO, bloom, or grading; `pmndrs/postprocessing` is not installed. Contact darkening is limited to `pcf-contact` shadows.
6. **VFX are custom and sparse.** The twin-wheel dust plume works, but there is no exhaust, no spark, no cooling mist, no impact debris. `three.quarks` is not installed.
7. **Lighting is competent but flat.** PMREM + `RoomEnvironment` gives correct ambient response; there is no authored key-light drama, no time-of-day identity, and no atmospheric depth cue beyond fog.

The environment layer has genuinely improved and now reads as a coherent, readable arcade course. The **asset-level finish** — silhouettes, materials, animation richness — is where the pivot target is not met.

## 11. Missing release evidence, restated for `bb10ce4`

- No frozen candidate. §2 must be resolved first.
- No format-2 release manifest for current bytes.
- No manifest-bound production/offline smoke for current bytes.
- No performance measurement or 30-minute soak for current bytes.
- Structured QA records: 7/10 exist, all bound to the superseded aggregate; `browser`, `accessibility`, `visual` have never existed.
- No promoted visual baseline; `race-curved-course-canyon-chromium-darwin.png` correctly remains absent.
- No rollback rehearsal, archive locator, or data-safety record. `v1.0.0-rc.1` is unpublished.
- No schema-v3 attestation JSON and no `attestation/v1.0.0-rc.2` tag.
- `npm run audit` currently FAILS (§5).

## 12. Owner / manual / legal blockers

| # | Blocker | Class |
|---|---|---|
| B1 | Which commit is the RC2 candidate — re-tag from current source, or freeze at `2b40695` and defer post-tag changes? (§2) | OWNER BLOCKED |
| B2 | Is the throttle-on-`W` / pitch-on-arrows split correct? (§7 O1) | OWNER BLOCKED |
| B3 | Owner visual acceptance of the revised direction, hash-bound to reviewed captures | OWNER BLOCKED |
| B4 | Trademark, trade-dress, copyright, and generated-output review | LEGAL/OPERATIONAL BLOCKED |
| B5 | Top-level product `LICENSE` selection | OWNER BLOCKED |
| B6 | Generated-image account/agreement provenance | LEGAL/OPERATIONAL BLOCKED |
| B7 | Production hosting, DNS/TLS, security headers, deployment target | LEGAL/OPERATIONAL BLOCKED |
| B8 | Named public support / release / rollback / incident owners | OWNER BLOCKED |
| B9 | Physical devices, gamepad, installed Safari/Firefox/Edge, assigned human reviewers | MANUAL-REVIEW BLOCKED |
| B10 | Manual screen-reader and accessibility review | MANUAL-REVIEW BLOCKED |
| B11 | Subjective gameplay fairness and balance acceptance | MANUAL-REVIEW BLOCKED |
| B12 | `v1.0.0-rc.1` is unpublished, blocking predecessor-archive retrieval | OWNER BLOCKED |

## 13. Conclusion

The repository, branch, remote, and PR match the handoff. The current source is healthy: it typechecks, lints, passes 456 checks, builds, audits clean for release scope, and runs in a browser with every authored asset ready and no console errors. Every gameplay behaviour the owner asked to preserve is present and verified.

Three things are not as the readiness documents describe: the tagged candidate has been superseded by later product commits (§2), the machine's default toolchain has drifted off the pin (§3), and the dependency-audit gate has begun failing on newly published advisories in dev-only tooling (§5).

The release remains **NOT READY**. No gate was closed by this reconciliation, no evidence was deleted, no baseline was promoted, and no tag was moved.
