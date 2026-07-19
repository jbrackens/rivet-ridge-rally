# RIVET RIDGE RALLY — Canyon Vertical Slice

## Purpose

This document is the production contract for the first authored 3D environment pass. The slice replaces the most visible Canyon festival props with a coherent Blender-authored modular kit while preserving the existing simulation, collision, track geometry, route data, and camera behavior.

The visual source of truth is:

- `docs/design/concepts/gameplay-desktop.png` for in-race composition, value grouping, and readable silhouettes.
- `docs/design/concepts/track-builder.png` for the course-module language and palette.
- `docs/design/concepts/canyon-production-asset-reference.png` for the approved modeling inventory, shapes, materials, and detail density.

The new sheet is a modeling reference only. It is not a runtime texture, background, UI layer, or substitute for an authored 3D asset.

## Art direction

Target a bright, tactile motocross diorama: chunky but purposeful proportions, softened bevels, broad color blocking, restrained surface variation, readable mechanical or structural joints, and a clear cream/coral/teal festival identity against dusty sandstone terrain. Assets should feel toy-like in clarity rather than toy-sized.

Avoid featureless primitives, photoreal scan noise, black plastic everywhere, razor-sharp edges, flat single-color silhouettes, dense micro-detail, brand marks, readable sponsor text, platform-branded block-avatar proportions, or a direct imitation of any third-party game's assets.

### Palette and materials

| Token | Approximate color | Use |
|---|---:|---|
| Festival coral | `#E45F47` | Primary gates, banners, plastics, safety accents |
| Cooling cyan | `#38C9D2` | Cooling gate energy surfaces and small technology accents |
| Deep teal | `#167C83` | Secondary structures, tents, panels, bike details |
| Warm cream | `#F2E4C4` | Safety faces, canvas, number fields, high-value trim |
| Workshop navy | `#20384A` | Frames, shadow-side panels, mechanical housings |
| Sandstone | `#B86546` | Rocks, baked terrain props, retaining forms |
| Dust brown | `#7B533D` | Timber, dirt contact surfaces, crates |
| Pine green | `#2F6A50` | Vegetation masses |
| Tire charcoal | `#25282B` | Rubber and high-contrast mechanical details |

Runtime materials use a restrained rough PBR response. Painted metal and coated structures should read around roughness `0.55–0.72`; canvas, timber, dirt, rock, and vegetation around `0.78–0.95`; rubber around `0.9`. Metallic values remain zero except for small exposed mechanical parts. Emission is reserved for the cyan cooling field and must retain a readable cyan albedo when bloom is absent.

## Modular kit inventory

The first GLB contains these named roots. Each root must be independently cloneable and positionable.

| Root name | Role | Minimum authored cues |
|---|---|---|
| `CYN_CoolingGate_A` | Signature non-colliding cooling landmark | Two structural towers, top bridge, cyan field, trim blocks, bolts/lights, base protection |
| `CYN_WheelieBarrier_A` | Gameplay-readable low barrier visual | Cream/coral face, dark base, chamfered cap, side braces, wear/dirt contact band |
| `CYN_TabletopRamp_A` | Presentation shell for existing tabletop collision | Dirt body, shaped takeoff/landing lips, colored edge boards, support/erosion detail |
| `CYN_RockCluster_A` | Repeatable sandstone breakup | Three or more distinct faceted stones, varied scale/rotation, grounded footprint |
| `CYN_Pine_A` | Canyon tree | Tapered trunk, layered asymmetric needle masses, visible root flare |
| `CYN_DesertPlants_A` | Small vegetation cluster | Branched cactus plus grass/flower accents on a sparse ground patch |
| `CYN_SpectatorStand_A` | Festival crowd structure | Tiered seating, railings, canopy, stairs/supports, abstract non-branded crowd color blocks |
| `CYN_FestivalTent_A` | Trackside shelter | Tensioned cream/coral canopy, poles, guy-line or foot details, counter/crates |
| `CYN_Workshop_A` | Service-paddock landmark | Navy/coral shell, open bay, workbench/tool silhouettes, awning, roof equipment |
| `CYN_MarshalTower_A` | Elevated course landmark | Timber/metal supports, platform, stairs/ladder, canopy, railings, signal accents |
| `CYN_ServiceProps_A` | Reusable prop cluster | Tire stack, two crate variants, small tool/fuel silhouettes without labels |

The hero bike and rider remain a separate asset pass because their animation pivots, wheel-spin contract, rider rig, and screen prominence require their own acceptance gate.

## Coordinate and transform contract

- Blender 4.5 LTS is the authoring baseline.
- One Blender unit equals one meter.
- `+Y` is forward along the course, `+X` is rider-right, and `+Z` is up.
- Each asset root has identity rotation and scale, with its origin at the center of its ground-contact footprint.
- Mesh transforms are applied before export. Negative scale is not permitted.
- Names are stable and semantic; generated suffixes such as `.001` are not part of the runtime contract.
- Each root may contain child meshes, but no child may depend on a Blender-only constraint, modifier, driver, light, camera, or external file at runtime.

## Gameplay and collision separation

Authored models are presentation shells. Existing TypeScript simulation values and code-native collision/contact records remain authoritative. The GLB must not introduce physics bodies, invisible collision meshes, or gameplay-trigger metadata. Runtime placement must be derived from the same course records already used by the procedural visuals so a missing or late asset cannot alter play. A successful install must cover every applicable obstacle on every race lap, validate that each corresponding procedural visual set exists, add the complete authored group, and only then hide the superseded procedural structure. Failure before that atomic handoff must leave the complete procedural course visible.

The wheelie barrier must visually agree with the existing clearance rule: a raised front wheel may clear it with a speed penalty, while an insufficient wheelie still crashes. The cooling gate must remain visually large but non-blocking through the ride line; replacement preserves the existing direct snowflake cue even while it hides the older structural shell. The tabletop root replaces the preferred medium-ramp visual (falling back to small/large only when necessary), scales from the authoritative lane span, resolved contact length, and visual height, and never changes the existing ramp contact or impulse data.

## Export and delivery contract

- Version the editable `.blend` source and scripted Blender Python authoring procedure under `art-source/blender/canyon-kit/`.
- Export one vertical-slice GLB with the named roots above; do not export cameras or lights.
- Use glTF 2.0 PBR materials and embedded geometry/material data. Texture images, if introduced later, must be separately sourced and inventoried before compression.
- Preserve the current Meshopt/KTX2-capable loader. Optimization is a post-export step, never a destructive replacement for the `.blend` source.
- Initial target: no more than 70,000 triangles for the complete source kit, no more than 20 material slots, and no individual environment prop above 18,000 triangles without review.
- Repeated scenery must remain cloneable or instanced by the runtime. Do not bake an entire course into one model.
- The existing procedural world remains the failure fallback until authored assets pass visual, loading, memory, and performance qualification.

## Vertical-slice acceptance gate

The slice is ready for owner review only when all of the following are true:

1. The Canyon start area shows at least the authored cooling gate, barrier, ramp shell, stand, tent, workshop/tower landmark, vegetation, and rock breakup together.
2. The result is recognizably derived from the approved concept palette and material language at gameplay camera distance.
3. Missing/failed GLB loading preserves a playable and visually complete fallback.
4. Asset loading has a bounded deadline and disposal path consistent with the current compressed-bike loader.
5. Desktop and portrait compositions keep the ride line, obstacles, rider, HUD, and cooling gate readable.
6. Low/Medium/High quality tiers remain within their existing renderer and instancing budgets.
7. Source, generated output, hashes, licenses, and build tooling are recorded in the asset inventory.

Asset generation and source authoring may proceed during the owner's test-run pause. After correction of a wrong optimized-generator assertion, an unintended build-wrapper invocation completed the full current asset-verification chain successfully, then stopped in strict TypeScript before Vite on a source-corrected Canyon reduction inference. Typecheck/build were not rerun. Runtime launch, build completion, automated checks, browser captures, performance measurement, and visual acceptance remain **PAUSED / UNVERIFIED** and must be completed after that pause is lifted.
