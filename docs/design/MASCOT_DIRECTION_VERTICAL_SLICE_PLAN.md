# Mascot-Racer Direction — Vertical Slice Plan

**Prepared:** 2026-07-25
**Reconciled commit:** `bb10ce4448bc3b4036ba832382c57b7086747400`
**Status:** PLAN ONLY — not implemented, not captured, not accepted
**Governing docs:** `GAME_BIBLE.md`, `GAME_SPEC.md`, `docs/design/FIDELITY_LEDGER.md`, `docs/design/GRAPHICS_TOOLCHAIN.md`, `docs/RC2_RECONCILIATION_2026-07-25.md`

This plan defines the smallest contained change that can prove — or disprove — whether the revised original mascot-kart-racer direction is achievable inside the existing Three.js architecture. It is written to be reviewable before any art or code is produced.

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
