# Hero Texture Atlas — Implementation Plan

**Prepared:** 2026-07-26
**Status:** **APPROVED 2026-07-26** — the three §11 decisions are settled; implementation may begin at Phase A

**Owner decisions, as given:**

1. **Scope — approved as recommended (§1):** the atlas carries **non-colour data only** — normal + occlusion. Base colour, roughness and metallic stay as per-material scalars in code. The material contract's factor ranges are untouched, the palette stays auditable, and the atlas contains no imagery.
2. **Byte budget — ceiling raised to 1.2 MB** for the hero runtime GLB, superseding the 900 KB figure in `MASCOT_DIRECTION_VERTICAL_SLICE_PLAN.md` §4. Rationale accepted: the whole build is ~5.5 MB gzip against a 12 MB threshold, and the hero is the most-viewed object in the game. Option 1 of §6.
3. **Phasing — approved (§10), including the stop.** Work halts after **Phase B (occlusion bake)** for owner review before any Phase C normal-map authoring. The cheap half is measured first.
**Supersedes:** the rejected tiling-detail approach in `docs/design/MASCOT_DIRECTION_VERTICAL_SLICE_PLAN.md` §2.2
**Governing docs:** `GAME_BIBLE.md`, `GAME_SPEC.md`, `docs/design/FIDELITY_LEDGER.md`, `docs/design/HERO_BIKE_RIDER_VERTICAL_SLICE.md`

This is the concrete shape of the texture work, written so it can be approved or redirected before a single UV is unwrapped. Every number below is measured from the current asset, not estimated from memory.

## 1. What the atlas will and will not carry

**Recommendation: carry only non-colour data — a normal map and an occlusion map. Leave base colour, roughness and metallic as the existing per-material scalars.**

This is the single most important decision in the plan, and it is deliberate:

| Channel | In the atlas? | Why |
|---|---|---|
| Normal (surface relief) | **Yes** | The gap the pivot actually names. Panel creases, stitch lines, tread blocks, worn edges. |
| Occlusion (crevice darkening) | **Yes** | The measured depth gap. Nothing in the current renderer darkens where parts meet; this is what makes moulded assemblies read as solid rather than stuck together. |
| Base colour | **No** | Would move the teal/coral/cream identity from auditable code constants into image data, complicating originality review and the licence inventory for no readability gain — the colour blocking already reads well. |
| Roughness / metallic | **No** | `MATERIAL_CONTRACTS` asserts per-material `roughnessFactor`/`metallicFactor` **ranges**. Texturing them forces both to `1.0` and breaks the contract. Verified during the 2026-07-25 spike. |

**Consequence for IP safety:** the atlas contains no colour, no lettering, no logo — purely geometric relief and ambient occlusion. It cannot introduce third-party visual resemblance. That keeps the existing zero-image guarantee's *intent* intact while relaxing its letter.

## 2. Measured inputs

Both tables are computed from `hero-bike-rider-raw.glb` at commit `66c5fd9` (51,820 triangles, 28 primitives, 10 materials).

**Triangles are a poor guide to atlas need — surface area and screen presence are the right ones:**

| Material | Triangles | Share | Surface area | Share |
|---|---:|---:|---:|---:|
| `RRR_MetalDark` | 12,732 | 24.6% | 6.048 m² | 11.3% |
| `RRR_MetalBright` | 11,560 | 22.3% | 10.640 m² | 19.9% |
| `RRR_Rubber` | 10,672 | 20.6% | 9.746 m² | 18.2% |
| `RRR_PlasticCoral` | 4,348 | 8.4% | 10.255 m² | 19.2% |
| `RRR_PlasticTeal` | 4,080 | 7.9% | 7.876 m² | 14.7% |
| `RRR_RiderArmor` | 3,032 | 5.9% | 3.127 m² | 5.8% |
| `RRR_PlateCream` | 2,428 | 4.7% | 3.253 m² | 6.1% |
| `RRR_NumberCream` | 1,488 | 2.9% | 1.213 m² | 2.3% |
| `RRR_RiderFabric` | 1,028 | 2.0% | 1.125 m² | 2.1% |
| `RRR_Visor` | 452 | 0.9% | 0.232 m² | 0.4% |
| **Total** | **51,820** | | **53.516 m²** | |

Two thirds of the triangles are spokes, tread blocks and mechanical hardware — dense geometry whose detail is already *modelled*. They need far less atlas space than their triangle count suggests. The plastics, plates, armour and fabric are only ~28% of triangles but dominate the visible surface at the follow camera.

## 3. Resolution, justified by the actual camera

At 1280×720 the bike and rider occupy roughly 300 px of screen height for about 2.5 m of subject.

The 53.5 m² total includes hidden interiors — spoke backs, tread inner faces, undersides. Realistically about **20 m² is ever visible**, and only that gets atlas islands.

A 1024×1024 atlas over 20 m² of packed islands gives roughly **52,000 texels/m², about 230 texels per linear metre**. A 0.5 m panel therefore receives ~115 texels while covering ~60 screen px — comfortably above 1 texel/pixel, with headroom for closer framing in results and menu shots.

| Option | Verdict |
|---|---|
| 2048² | **Rejected.** ~4× the bytes for detail that lands below one pixel at this camera. |
| **1024² normal + 512² occlusion** | **Recommended.** Above 1 texel/pixel on visible surfaces; occlusion is low-frequency by nature and does not need matching resolution. |
| 512² only | **Rejected.** ~115 texels/m linear; panel detail lands under half a pixel and reads as mush. |

## 4. Atlas allocation

Islands are allocated by visible area and screen importance, not triangle count. Hidden faces get no space.

| Region | Share of atlas | Rationale |
|---|---:|---|
| Bike plastics — shrouds, tank, fenders, side panels (`PlasticCoral`, `PlasticTeal`) | ~34% | Largest visible surface and the closest thing to a "hero panel". Carries moulding creases, edge wear, vent relief. |
| Rider — armour, fabric, boots, gloves (`RiderArmor`, `RiderFabric`) | ~22% | Directly facing the camera at all times. Carries stitch lines, panel quilting, strap relief. |
| Tyres and grips (`Rubber`) | ~16% | Tread sidewall lettering-free block relief; the top of the rear tyre is permanently in frame. |
| Plates and number fields (`PlateCream`, `NumberCream`) | ~12% | Must stay crisp — the `22` is an identity element. Gets a slightly higher effective density. |
| Metal hardware (`MetalBright`, `MetalDark`) | ~14% | Fork tubes, exhaust, engine cases, rotors. Brushed direction and bolt-recess occlusion only. |
| Visor | ~2% | Minimal; near-smooth by design. |

## 5. Unwrap strategy

The existing quantization contract already requires `TEXCOORD_0` to be `VEC2`, `componentType 5123`, **normalized** — i.e. UVs in `[0,1]`. **A packed `0–1` atlas satisfies that contract natively**, which is exactly why tiling failed and this approach does not. No quantization change is needed.

1. Unwrap in the Blender authoring script, **before** `consolidate_render_geometry()`, so each semantic part is unwrapped in isolation and merged afterwards.
2. Use angle-based unwrap with explicit seams on the large panels; cube projection for the mechanical hardware where orientation is predictable.
3. Pack per-material into the allocation in §4 with a fixed margin, so an added part cannot silently reflow the whole atlas.
4. Bake occlusion in Blender from the source geometry; author the normal detail procedurally in-script, consistent with the project's existing deterministic-generation precedent (`build_rival_pack.py` already generates and embeds its number field this way).
5. Keep the unwrap deterministic and re-runnable — no manual UV editing that cannot be reproduced from the script.

**Expected geometry cost:** UV seams split vertices. The spike measured +60% on raw geometry for a badly-seamed projection; a packed atlas unwrap with deliberate seams should land nearer **+15–25%**, i.e. roughly **+50–80 KB** on the current 318 KB runtime GLB.

## 5a. Phase A executed 2026-07-26 — measured, and it changes §6

Phase A was implemented, measured, and then reverted, because the unwrap cannot land on its own (see "Why nothing was committed" below). Its purpose was to replace the §6 estimate with a number, and it did.

**Implementation.** A deterministic `unwrap_into_atlas()` step in `build_hero_bike_rider.py`, running immediately after `consolidate_render_geometry()` when each render mesh carries exactly one material. Angle-based `smart_project` at a 66° limit with a 0.02 island margin per mesh, then each mesh remapped into its material's band — bands ordered largest-share-first for reproducibility, sized by the §4 allocation, and split into columns by measured polygon area.

**Measured results.**

| Metric | Baseline | Phase A | Delta |
|---|---:|---:|---:|
| Triangles | 51,820 | 51,820 | **unchanged** |
| Render primitives / materials | 28 / 10 | 28 / 10 | unchanged |
| Mesh vertices | 40,104 | 54,552 | **+14,448 (+36%)** |
| Raw interchange GLB | 1,269,932 B | 2,089,456 B | +819,524 (+65%) |
| **Optimized runtime GLB** | **317,936 B** | **555,216 B** | **+237,280 (+75%)** |
| Atlas regions | — | 28 across 10 materials | — |
| UVs inside `[0,1]` | — | **all** | contract satisfied |

**Confirmed: §5's central premise holds.** Every UV lands inside `[0,1]`, so a packed atlas satisfies the normalized-unsigned-16-bit `TEXCOORD_0` contract natively. The rule that made tiling structurally impossible is not an obstacle here.

**The estimate in §5 was wrong.** It predicted seams would add 15–25%, i.e. 50–80 KB. The real figure is **+75%, 237 KB** — roughly three times the prediction. Seam-driven vertex splitting is far more expensive than assumed, and no amount of packing skill changes it: vertex count is driven by where seams fall, not by island placement.

**Also discovered: the optimizer prunes unused UVs.** With the default `prune({ keepLeaves, keepExtras })`, `TEXCOORD_0` is stripped because no material references it, and the build then fails its own source-versus-optimized attribute-inventory check. The 555,216 B figure was obtained with `keepAttributes: true` set temporarily — which is exactly the state that will exist naturally once a map references the UVs, so the measurement is a valid forecast rather than an artefact.

**Why nothing was committed.** The unwrap is not independently landable. Without a map, either the build breaks (UVs pruned, inventory check fails) or it ships 237 KB of attributes nothing reads. It must land in the same commit as at least one map. The Blender code and its measurements are recorded here so Phase B can re-apply the approach directly.

### Revised byte budget

| Item | Encoding | Figure |
|---|---|---:|
| Geometry incl. atlas UVs | Meshopt | **555,216 B (measured)** |
| Normal 1024² | KTX2 UASTC + zstd | 400–600 KB (estimate) |
| Occlusion 512² | KTX2 ETC1S | 60–100 KB (estimate) |
| **Total, both maps** | | **≈ 1,015,000 – 1,255,000 B** |

**That is at or over the 1.2 MB ceiling.** The approved ceiling was set against a 830 KB–1.1 MB projection built on the wrong seam estimate.

Options, with the geometry figure now fixed:

| Option | Projected total | Verdict |
|---|---:|---|
| Occlusion only (512²) | **≈ 615–655 KB** | Comfortable. Already the approved Phase B, and it lands the unwrap with a map that uses it. |
| Occlusion + normal 768² | ≈ 805–905 KB | Fits with margin. |
| Occlusion + normal 1024² | ≈ 1,015 KB – 1.26 MB | At or over ceiling. Not recommended without raising it again. |
| Coarser unwrap (fewer seams) | reduces the 237 KB | Trades UV distortion for bytes; only worth exploring if the normal map proves essential at 1024². |

**Recommendation:** proceed with Phase B exactly as approved — occlusion only — which is comfortably inside budget and answers whether crevice depth alone closes most of the perceived gap. Defer the normal-map resolution decision to the Phase B review, when there is something to look at rather than another estimate.

## 6. Byte budget

| Item | Encoding | Estimate |
|---|---|---:|
| Normal 1024² | KTX2 UASTC + zstd | 400–600 KB |
| Occlusion 512² | KTX2 ETC1S (single channel, compresses well) | 60–100 KB |
| Added UV attribute + seam splits | Meshopt | 50–80 KB |
| **Added total** | | **510–780 KB** |
| **Projected hero runtime GLB** | current 317,936 B | **~830 KB – 1.1 MB** |

**This is the plan's main tension and needs your decision.** `MASCOT_DIRECTION_VERTICAL_SLICE_PLAN.md` §4 sets a 900 KB hero ceiling. The mid estimate lands at or slightly over it.

Options, in the order I would take them:

1. **Raise the hero ceiling to 1.2 MB.** The whole build is currently ~5.5 MB gzip against a 12 MB threshold, so there is real headroom. The hero is the single most-looked-at object in the game.
2. Drop the normal map to 768² (~250–350 KB) and accept slightly softer relief.
3. Ship occlusion only (~60–100 KB) as a first stage, measure the improvement, and decide on the normal map afterwards.

Option 3 is the cheapest way to test whether crevice depth alone closes most of the perceived gap, and I would happily start there if you prefer evidence before spend.

## 7. Contract and tooling changes required

All were hit and verified during the spike, so this list is complete rather than anticipated:

| File | Change |
|---|---|
| `scripts/build-hero-bike-rider-assets.mjs` | Replace the blanket `images/textures/samplers === 0` assertions with a strict allowlist: exact image count, exact dimensions, expected MIME, non-colour usage, and each image's SHA-256 recorded in the manifest. Replace `listTextures().length === 0` likewise. |
| `scripts/verify-hero-bike-rider-assets.mjs` | Mirror every one of those assertions independently. |
| Asset manifest (schema v2) | Add an `images` block binding name, dimensions, encoding, byte length and SHA-256 per map. |
| `e2e/reliability.spec.ts` | `data-hero-bike-texture-count` `0` → the new exact count. |
| `src/game/engine/GameEngine.ts` | Hero contract validation: assert the expected texture count and that maps are bound to the expected slots. |
| `ASSET_LICENSES.md` | Inventory both generated maps: origin (project-authored, procedurally generated + Blender-baked), licence, hashes, shipped path. |
| `art-source/blender/hero-bike-rider/README.md` and `docs/design/HERO_BIKE_RIDER_VERTICAL_SLICE.md` | Replace the "no-texture solid-colour PBR contract" wording. **Both are manifest-hash-bound**, so they must be edited and re-bound in the same commit as the asset rebuild (finding R4). |

## 8. Verification

1. `npm run assets:build` then `npm run assets:verify` — new allowlist passes, budgets hold.
2. Triangle regions unchanged: bike ≤ 40,000, wheels ≤ 18,000, rider ≤ 30,000, total ≤ 70,000.
3. `npm run typecheck`, `lint`, `npm test`, `audit:release-scope`, `VITE_QA_MODE=0 npm run build`.
4. `e2e/reliability.spec.ts` full file — 13/13, including the corrupted-asset fallback path.
5. Headed performance on hardware-backed WebGL: desktop High ≥ 58 FPS mean, p95 frame work ≤ 16.67 ms; emulated mobile Low ≥ 30 FPS. Record GPU memory delta — an atlas adds VRAM, not just bytes.
6. Before/after captures at 1280×720 in the same Canyon Practice frame, plus a portrait frame and a Low-quality frame (KTX2 transcode differs per tier).
7. Cold-load timing: KTX2 transcode happens on the main thread on first use and can stall the pre-race gate. Must be measured, not assumed.

## 9. Risks, and what I would do about each

| Risk | Mitigation |
|---|---|
| Atlas seams visible on large panels | Place seams on existing panel breaks and silhouette edges; review the bake before wiring it into the runtime. |
| KTX2 transcode stalls the race gate | Measure cold load (§8.7). The hero already has a 12 s readiness deadline and a complete procedural fallback, so a stall degrades gracefully rather than breaking. |
| Bytes exceed the ceiling | Decision in §6 taken up front, not discovered late. |
| Occlusion bake looks dirty rather than deep | Bake at low strength and review in isolation before combining with the normal map. |
| Unwrap not reproducible | Everything in-script; no manual UV editing. Re-running the build must give the same layout. |
| Rebuilds are not byte-identical | Already true today — the authoring script stamps a fresh provenance UUID per run, so byte-diffing rebuilds is not a valid check. Verify by contract and hashes, not by rebuild equality. |

## 10. Phasing

| Phase | Work | Reviewable output |
|---|---|---|
| A | Unwrap + packed atlas layout, no maps yet. Prove `[0,1]` UVs pass quantization and measure the real geometry cost. | Measured byte delta; go/no-go on §6. |
| B | Occlusion bake only, wired through the new allowlist. | Before/after captures; the cheap-depth test. |
| C | Normal map authoring. | Before/after captures at all three quality tiers. |
| D | Contracts, manifest, verifier, e2e, licences, docs re-bound. | Full gate batch green. |
| E | Owner review package. | Hash-bound captures + measured budgets. |

Phases A and B are individually reversible and each answers a real question. **I would not start C before B has been looked at.**

## 11. What I need from you

1. **Approve or redirect the scope in §1** — non-colour only (normal + occlusion), leaving colour and roughness as code constants. This is the load-bearing decision.
2. **Pick a byte option from §6** — raise the ceiling to 1.2 MB, drop to 768², or start with occlusion only.
3. **Confirm the phasing in §10** is acceptable, in particular stopping after Phase B for a look.

No work starts until those three are answered. Nothing in this plan promotes a visual baseline; owner acceptance of the resulting look remains a separate gate.
