# Mascot-Racer Direction — Vertical Slice Plan

**Prepared:** 2026-07-25
**Reconciled commit:** `bb10ce4448bc3b4036ba832382c57b7086747400`
**Status:** PLAN ONLY — not implemented, not captured, not accepted
**Governing docs:** `GAME_BIBLE.md`, `GAME_SPEC.md`, `docs/design/FIDELITY_LEDGER.md`, `docs/design/GRAPHICS_TOOLCHAIN.md`, `docs/RC2_RECONCILIATION_2026-07-25.md`

This plan defines the smallest contained change that can prove — or disprove — whether the revised original mascot-kart-racer direction is achievable inside the existing Three.js architecture. It is written to be reviewable before any art or code is produced.

## 0. Pivot statements for the three asset contracts

`docs/design/HERO_BIKE_RIDER_VERTICAL_SLICE.md`, `docs/design/RIVAL_PACK_VERTICAL_SLICE.md`, and `docs/design/CANYON_VERTICAL_SLICE.md` are **hash-bound production contracts**: each is recorded by exact byte count and SHA-256 inside its asset's schema-v2 manifest, so editing one breaks `npm run assets:verify` until `npm run assets:build` regenerates the manifest — a product-bytes change (reconciliation record finding R4).

> **LANDED 2026-07-27.** This text now lives in all three contracts and the manifests were
> re-bound in the same commit. The section is retained as the drafting record; the
> contracts themselves are authoritative.
>
> The deferral was lifted because its reason expired: the text was being held to avoid
> invalidating the hash-bound owner review package at `2d0376d`, and that package was
> superseded anyway by finding R10 (Foundry Flight venue identity). Landing R4 before the
> re-freeze means one candidate re-freeze captures everything.
>
> **The re-bind was verified to be hash-only.** A no-op `npm run assets:build` on an
> unchanged tree was run first and left the tree completely clean, proving the pipeline is
> deterministic. After the doc edits, `assets:verify` failed as predicted (exit 1),
> `assets:build` re-bound, and `assets:verify` passed. The resulting diff is exactly two
> lines per manifest — the contract document's `bytes` and `sha256`. **No GLB, texture, or
> other asset binary changed.**

The pivot text intended for them was therefore held here until the slice ran `assets:build`, at which point it moved into those documents and the manifests re-bound in the same commit. `GAME_BIBLE.md` and `GAME_SPEC.md` already carried the pivot normatively and outranked these per-asset contracts in the meantime.

**Applies to all three.** The owner moved the visual target away from Roblox-adjacent, blocky, cube-first, primitive-heavy forms and toward an original, polished mascot-kart-racer level of charm, material finish, and animation readability. "Mascot-kart-racer" is a quality and readability reference only; it is not permission to copy Mario Kart, Nintendo, or Roblox expression. Every originality guardrail already in those contracts stays in force unchanged.

- **Hero** — rounded, appealing silhouettes with real bevelled volume, shaped plastics, and authored base-colour/ORM/normal material depth replacing the current flat solid-colour PBR treatment. The canonical reference sheet already embodies the target, so the design goal is unchanged; the required fidelity of the delivered asset rises.
- **Rival pack** — follows the hero to the same standard, reusing its material atlases, while keeping the lower detail budget and the supporting role behind the hero.
- **Canyon** — supersedes the "chunky but purposeful proportions … toy-like in clarity" wording in that contract's *Art direction* section. The target becomes rounded, softened volumes with authored surface detail rather than flat colour blocking. Palette, festival identity, readability contract, and originality rules are unaffected.

## 1. Why a slice, and why this slice

`docs/RC2_RECONCILIATION_2026-07-25.md` §10 assessed the live `bb10ce4` runtime directly. The environment layer has improved substantially and now reads as a coherent, readable arcade course. The unmet part of the pivot is **asset-level finish**: silhouettes built from boxes and cylinders, ten flat solid-colour PBR materials with **zero texture maps**, and no authored surface detail anywhere in the hero.

That is the highest-leverage and highest-risk unknown. If an authored, textured, rounded hero cannot be delivered inside the current 28-render-primitive / 40,000-triangle contract and the measured frame budget, the direction is not reachable without renegotiating those budgets — and the owner needs to know that before a game-wide overhaul begins.

The slice is therefore **hero-first**, with exactly enough environment and VFX context to judge it in situ.

**Non-goals.** No five-venue overhaul. No rival-pack rework. No editor visual work. No engine or renderer migration. No baseline promotion. No changes to simulation, collision, AI, timing, replay, or persistence.

## 2. Slice contents

### 2.1 Hero bike and rider — the core of the slice

Re-author the existing Blender source (`RRR_HeroBikeRider`) toward the already-approved original reference `docs/design/concepts/hero-bike-rider-production-reference.png`. That reference is itself the target: an original teal / coral / cream motocross livery with number 22, rounded plastics, and a posed rider. It resembles no Nintendo, Mario Kart, or Roblox property, so pursuing it carries no new IP risk.

Required changes:

| Area | Current | Slice target |
|---|---|---|
| Rider head | Capsule with a flat visor plate | Shaped helmet with a chamfered shell, recessed goggle port, peak, and vent forms |
| Rider torso and limbs | Slab and rectangular prisms | Tapered, bevelled forms with shoulder, elbow, and knee volume; layered chest armour |
| Bike plastics | Flat panels | Curved shrouds, rounded tank, swept fenders with edge thickness |
| Tyres | Low-relief cylinders | Visible sidewall shoulder, rim depth, spoke gaps |
| Materials | 10 flat solid-colour PBR, **0 textures** | Introduce authored base-colour + ORM + normal atlases (see §2.2) |

Bevels and rounded silhouettes are what "reads as mascot-racer" at gameplay distance; they cost triangles, so §4 sets explicit budgets.

### 2.2 First authored texture atlas — the pipeline unknown

> **2026-07-25 spike result — the approach is now decided, and one option is ruled out.**
>
> A tiling detail-normal-map approach was prototyped end to end and **rejected on evidence**. Findings, in the order they were hit:
>
> 1. **Roughness must stay a scalar.** `MATERIAL_CONTRACTS` in the build and verify scripts assert per-material `roughnessFactor`/`metallicFactor` *ranges*. Driving roughness from an image forces those factors to `1.0` and breaks the contract. Any texture pass must therefore either keep roughness scalar or deliberately renegotiate that contract.
> 2. **The hero forbids images by design.** `assertSerializedRestrictions` asserts zero images, textures and samplers, and `listTextures().length === 0`. This is an IP-safety guarantee, not an oversight. Adding textures requires replacing that blanket ban with a strict allowlist — exactly one image, fixed dimensions, non-colour, normal-map use only, hash-bound in the manifest — rather than simply relaxing it.
> 3. **Decisive: the asset contract requires `[0,1]` UVs.** Optimized `TEXCOORD_0` must be `VEC2`, `componentType 5123` (unsigned 16-bit) **and normalized**. Normalized `u16` cannot represent values outside `[0,1]`, so **tiling UVs are structurally incompatible with the shipped quantization contract**. The pipeline is built for a properly unwrapped `0–1` atlas.
> 4. **Cost was moving the wrong way.** Box-projected UVs introduce a seam at every projection-axis change, re-splitting vertices that the smooth-shading pass had just welded: the raw GLB went from 1,269,932 back up to 2,026,120 bytes (+60%) before optimization.
> 5. **Wrong detail scale for the camera.** At 7 tiles/metre the noise repeats roughly 14 times across a 2 m bike. At the gameplay camera the bike is a few hundred pixels tall, so that detail lands near or below one pixel — it reads as shimmer, not material.
>
> **Conclusion.** Micro-detail tiling is the wrong lever for this game's camera distance, and the existing quantization contract already points at the right one: a real UV unwrap into a `0–1` atlas carrying **larger-scale authored features** — panel creases, stitch lines, tread blocks, worn edges, baked occlusion in crevices — at a scale that survives the follow camera. Constraint 1 also means the atlas should carry base colour and normal, leaving roughness/metallic as the existing per-material scalars, unless the material contract is explicitly renegotiated.
>
> That is a materially larger job than "add a texture": unwrapping the 28 consolidated primitives, authoring the atlas, then extending the image allowlist, manifest schema, verifier, e2e assertions, and `ASSET_LICENSES.md`. It should be scoped and estimated before it is started. The spike was reverted; the tree carries none of it.

The project has a full KTX2/Basis path that has **never carried an authored texture**. The hero is the right place to prove it end to end.

- Author base-colour, ORM (occlusion / roughness / metallic), and normal atlases for the hero pair.
- Tool: Krita for hand-painted decals, livery, and number plates; Material Maker for the procedural rubber, painted-metal, and fabric bases. Both are **currently unverified as installed** (`docs/TOOLCHAIN.md`) — installing and pinning them is part of this slice, and their versions must be recorded before any authored map is committed.
- Deliver through the existing glTF Transform → Meshopt → KTX2 chain.
- Record every new source and output in `ASSET_LICENSES.md` with source, licence, author, and hash before it enters a build.

**This is the single largest technical risk in the slice.** If KTX2 delivery, transcoding, or memory cost proves unworkable, the fallback is a small uncompressed PNG atlas, and that outcome must be reported rather than hidden.

### 2.3 Track section — one Canyon segment

Reuse the existing Canyon Kickoff start-to-500 m stretch. No new venue. Required within it:

- One jump or barrier interaction already present in the route, captured in the wheelie-clearance state so the preserved barrier rule (§7 of the reconciliation record) is visible.
- Terrain treatment upgraded from painted-only to a shallow real cross-section at the route shoulder, so berms read as geometry rather than paint.
- Existing festival dressing retained as-is — banners, rail bleachers, cooling arches, shoulder rock. It is already the strongest part of the current frame and does not need rework to judge the hero.

### 2.4 Lighting and atmosphere

Keep PMREM + `RoomEnvironment` as the ambient base. Add an authored key light with a deliberate warm Canyon direction and a cool bounce, so the hero's new normal maps have something to respond to. No time-of-day system.

### 2.5 Motion and VFX feedback

Retain the existing `soft-speed-reactive-twin-wheel-plume`. Add, scoped to this slice only, exhaust haze and a landing impact puff. `three.quarks` is a **candidate** here, but it is not installed and adding a runtime dependency has bundle and licence consequences — evaluate the existing custom pooled-particle path first and only adopt `three.quarks` if the custom path measurably cannot deliver. Record whichever is chosen.

### 2.6 Post-processing

**Deliberately excluded from this slice.** Per `docs/design/GRAPHICS_TOOLCHAIN.md`, AO / bloom / grading must not be used to compensate for modelling and material work, and they can harm obstacle and HUD readability. Revisit only after the slice is accepted.

### 2.7 HUD

Unchanged. The HUD appears in captures for readability judgement only. Any HUD change would confound the comparison.

## 3. Evaluation criteria

The slice is judged against all of the following. Failing any one of these is a reportable result, not something to tune away silently.

| # | Criterion | How it is judged |
|---|---|---|
| 1 | Originality | Side-by-side similarity review against the reference sheet and against Nintendo / Roblox trade dress. Must remain distinctly Rivet Ridge Rally. |
| 2 | Silhouette quality | Rear-camera gameplay framing at racing speed, not source-viewport renders |
| 3 | Material quality | Authored maps must be visible at gameplay distance, not only in close-up |
| 4 | Animation readability | Wheelie, airborne, landing, crash, and recovery must be distinguishable from the race camera |
| 5 | Gameplay clarity | Four-lane readability, hazard legibility, and landing reads must not regress |
| 6 | Visual cohesion | The new hero must not look pasted onto the existing environment |
| 7 | Performance | §4 budgets |
| 8 | Asset size | §4 budgets |
| 9 | Simulation compatibility | Presentation-only; `heroBikeGameplayAuthority` must stay `presentation-only` and the fixed-step simulation must be untouched |

## 4. Budgets — pass/fail, measured not estimated

| Budget | Current at `bb10ce4` | Slice ceiling |
|---|---|---|
| Hero triangles | 49,780 total (39,912 bike / 9,868 rider) | ≤ 65,000 total; bike must stay under its existing 40,000 cap unless the cap is explicitly renegotiated |
| Hero render primitives | 28 | ≤ 34 |
| Hero materials | 10 | ≤ 12 |
| Hero runtime GLB | 517,664 bytes | ≤ 900,000 bytes including KTX2 texture payload |
| Total gzip delivery | 5,463,640 bytes (last recorded) | < 12,000,000 bytes (existing release threshold) |
| Desktop High FPS | 60.01 mean / 2.5 ms p95 (historical, `2b40695`) | ≥ 58 mean, p95 frame work ≤ 16.67 ms |
| Emulated mobile Low FPS | 59.95 mean / 3.4 ms p95 (historical) | ≥ 30 mean, p95 frame work ≤ 33.33 ms |
| Draw calls | 241 mean / 301 max (historical Canyon High) | ≤ 340 max |

Measurement must use the pinned toolchain (Node `26.4.0` / npm `11.17.0`) on headed hardware-backed WebGL. Headless SwiftShader is not acceptable for this measurement.

## 5. Deliverables

1. Updated Blender source and regenerated GLB via `npm run assets:build`, passing `npm run assets:verify`.
2. The §0 pivot statements moved into the three `*_VERTICAL_SLICE.md` contracts, with their asset manifests re-bound in the **same** commit so `assets:verify` never lands broken.
2. First authored KTX2 texture atlas set, fully inventoried in `ASSET_LICENSES.md`.
3. Krita and Material Maker versions recorded in `docs/TOOLCHAIN.md`, moved from "planned" to "current" **only if actually installed and used**.
4. A capture matrix at fixed 1280×720, non-QA build, commit-bound: neutral, lean left, lean right, wheelie, barrier clearance, airborne, clean landing, crash, recovery, Reduced Motion, portrait — each paired with the equivalent `bb10ce4` frame as a before/after.
5. A headed performance measurement against §4.
6. An owner-review package (§6).
7. A written result — including negative results — appended to `docs/design/FIDELITY_LEDGER.md`.

## 6. Owner-review package

- Before/after pairs at native size, hash-bound to the exact commit.
- The reference sheet alongside, so the owner judges against the agreed target rather than against memory.
- The measured budget table from §4 with actual figures.
- An explicit, plainly worded statement of what the slice did **not** achieve.
- A non-accepting approval draft. It stays non-accepting until the owner personally authors the acceptance. Per `docs/design/FIDELITY_LEDGER.md`, `authentication: "external-manual-trust-boundary"` proves internal consistency only and never authenticates a person.

**No baseline is promoted before the owner accepts.** `npm run visual:promote:canyon` is the only permitted promotion path and must not be run before acceptance exists.

## 7. Prerequisite — blocked before implementation starts

**The candidate question (reconciliation record §2, blocker B1) should be settled before the slice is implemented.** The slice changes product bytes and shipped assets. Producing it against an unresolved candidate would add a third byte-set to a project that already has a superseded tag and a diverged branch tip.

If the owner prefers to proceed anyway, the slice can be built on the branch and the candidate re-frozen afterwards — but that ordering must be an explicit decision, not a default.

## 8. Sequencing after acceptance

1. Rival pack to the same standard, reusing the hero's material atlases.
2. Canyon terrain and rock forms.
3. Crowd and prop authoring.
4. Remaining four venues.
5. Restrained post-processing.
6. Editor and Test Ride presentation.

Each stage repeats the §3 criteria and §4 budgets. None begins before the previous is accepted.
