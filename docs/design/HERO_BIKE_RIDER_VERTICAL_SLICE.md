# RIVET RIDGE RALLY — Hero Bike and Rider Vertical Slice

## Purpose

This document is the production contract for the focal player bike and rider. The slice replaces the current generated bike plus runtime-primitive rider with one original Blender-authored presentation rig while preserving the existing simulation, collision, controls, camera, loading deadline, and procedural fallback.

The canonical visual source of truth remains `docs/design/concepts/hero-bike-rider-production-reference.png`. The later `docs/design/concepts/hero-bike-rider-modeling-reference-v2.png` directly guided the 2026-07-17 geometry revision, and `docs/design/concepts/hero-bike-rider-action-states-v3.png` supplies supplementary wheelie, airborne, landing, crash, and recovery direction. Neither supplementary sheet replaces the manifest-bound canonical reference. The gameplay concepts at `docs/design/concepts/gameplay-desktop.png` and `docs/design/concepts/gameplay-mobile.png` remain the composition references for follow-camera scale, rear silhouette, number readability, and obstacle sightlines.

The production reference is a modeling and material guide only. It must not be shipped as a texture, projected onto geometry, traced as a decal sheet, or used as a substitute for an authored 3D asset.

## Original and non-infringing art direction

Build a bright, tactile, fictional trail bike and a compact athletic motocross rider in the established coral, teal, cream, charcoal, and brushed-metal palette. The target is a readable, polished, toy-like 3D finish: molded plastics with softened bevels, dense but orderly knobby tires, visible suspension and chain-drive silhouettes, layered safety gear, clean color blocking, and enough mechanical depth to hold up in the close follow camera.

The asset must be created from project-authored Blender geometry and project-authored textures. Do not download, kitbash, scan, trace, or modify a commercial motorcycle, branded riding suit, platform-branded block avatar, marketplace model, stock texture, proprietary logo, or third-party game asset. Do not reproduce a real manufacturer's frame, plastics, engine casing, helmet shell, livery, sponsor layout, or distinctive trade dress.

Incidental pseudo-lettering, star-like decals, or sponsor-like marks visible in the generated reference are not approved artwork and must not be copied. Permitted identity is limited to the project palette, an original rivet/bolt or ridge motif, and the player number `22`. Any additional visible word mark, badge, icon, or decal requires separate provenance and owner/legal review.

### Visual priorities

1. The rear three-quarter silhouette must read immediately at the normal desktop and portrait follow-camera distances.
2. The rider's helmet, shoulder armor, back plate, gloves, knees, and boots must remain separable instead of collapsing into one flat color mass.
3. Both tires need a convincing continuous knobby profile, readable hubs/spokes, and brake hardware without photoreal micro-detail.
4. The bike needs distinct seat, tank/shroud, side-panel, engine, frame, swingarm, chain-drive, fork, fender, and exhaust masses.
5. The hands must meet the grips, boots must meet the pegs, hips must meet the seat, and articulated sections must conceal their joints throughout the existing pose range.
6. Number `22` must be readable on the rider back and rear bike plate without becoming a brand-like graphic treatment.

## Coordinate and transform contract

- Blender 4.5.11 LTS is the authoring baseline.
- One Blender unit equals one meter.
- In Blender source space, `+X` is rider-right, `+Y` is bike-forward, and `+Z` is up.
- The glTF export is Y-up. In runtime local space, `+X` remains rider-right, `+Y` is up, and `-Z` is bike-forward.
- The root origin is on the ground plane halfway between the front and rear tire contact patches.
- `RRR_HeroBikeRider`, `RRR_BikeVisual`, and `player-rider` have identity translation, rotation, and scale in the exported GLB.
- The neutral bike rests with both tire contact patches on asset-local `Y = 0` after glTF conversion. No asset child may extend materially below that plane except tire deformation clearance of at most 10 mm.
- `GameEngine` attaches the complete authored scene beneath the established player presentation root with one fixed `-0.63` metre compatibility offset. That outer placement aligns the source-local contact plane with the existing procedural wheel/track contact convention; it is presentation-only and must not change collision, suspension, terrain, or simulation values.
- Each wheel-spin pivot is centered on its axle, with local `+X` as the axle/spin axis. Runtime wheel spin remains `rotation.x`.
- Pose-pivot origins are placed at the anatomical joint they control. Mesh transforms are applied before export; negative scale and generated `.001`-style contract names are prohibited.
- The authored neutral pose is seated, hands on grips, boots on pegs, elbows slightly out, knees bent, spine inclined slightly forward, and head looking down-course.
- Cameras, lights, physics bodies, collision meshes, drivers, Blender-only constraints, and external file references are not exported.

## Exact scene and node contract

The GLB contains one scene named `RRR_HeroBikeRiderScene` and one scene root named `RRR_HeroBikeRider`. Every name in the hierarchy below is unique and required.

```text
RRR_HeroBikeRider
├── RRR_BikeVisual
│   ├── Bike_ChassisShell
│   ├── Bike_TankAndRadiator
│   ├── Bike_Seat
│   ├── Bike_RearFender
│   ├── Bike_LeftSidePanel
│   ├── Bike_RightSidePanel
│   ├── Bike_Engine
│   ├── Bike_Exhaust
│   ├── Bike_ChainDrive
│   ├── bike-steering-pivot
│   │   ├── Bike_Handlebar
│   │   ├── Bike_FrontFork
│   │   ├── Bike_FrontFender
│   │   ├── NumberPlate
│   │   └── bike-front-suspension-pivot
│   │       └── FrontTire
│   │           ├── FrontTireRing
│   │           ├── FrontTreadRing
│   │           ├── FrontHub
│   │           ├── FrontSpokes
│   │           └── FrontBrakeDisc
│   ├── bike-rear-suspension-pivot
│   │   ├── Bike_Swingarm
│   │   └── RearTire
│   │       ├── RearTireRing
│   │       ├── RearTreadRing
│   │       ├── RearHub
│   │       ├── RearSpokes
│   │       └── RearBrakeDisc
│   ├── RearNumberPanel
│   │   └── RearNumber22
│   ├── bike-seat-anchor
│   ├── bike-left-hand-anchor
│   ├── bike-right-hand-anchor
│   ├── bike-left-boot-anchor
│   └── bike-right-boot-anchor
└── player-rider
    ├── rider-torso-pivot
    │   ├── Rider_Torso
    │   ├── Rider_ChestArmor
    │   ├── Rider_BackPlate
    │   │   └── JerseyNumber22
    │   ├── rider-head-pivot
    │   │   ├── Rider_Head
    │   │   ├── Rider_Helmet
    │   │   ├── Rider_Visor
    │   │   └── Rider_HelmetPeak
    │   ├── rider-left-arm-pivot
    │   │   └── Rider_LeftArm
    │   └── rider-right-arm-pivot
    │       └── Rider_RightArm
    ├── Rider_Hips
    ├── rider-left-leg-pivot
    │   └── Rider_LeftLeg
    └── rider-right-leg-pivot
        └── Rider_RightLeg
```

`FrontTire`, `RearTire`, `player-rider`, and the six `rider-*-pivot` names deliberately preserve the current runtime hook names. The four `bike-*-anchor` hand/boot empties and `bike-seat-anchor` are verification references; they are not physics or inverse-kinematics authorities. Steering and suspension pivots ship in their neutral transforms until a separately reviewed runtime pass drives them.

Leaf meshes may be joined during optimization only when all required semantic nodes and pivot boundaries above remain intact. Optimization must not move a wheel, rider pivot, number, anchor, or root, and must not merge a spinning or articulated child into a static parent.

## Material and texture contract

Export exactly these ten opaque glTF materials with the semantic names and response ranges below. Every visible `22` glyph uses `RRR_NumberCream`; `RRR_PlateCream` is reserved for number fields and non-glyph trim.

| Material | Intended response |
|---|---|
| `RRR_PlasticTeal` | Painted molded plastic, roughness `0.48–0.62`, metallic `0` |
| `RRR_PlasticCoral` | Painted molded plastic, roughness `0.48–0.62`, metallic `0` |
| `RRR_PlateCream` | Number fields and small high-value trim, roughness `0.58–0.72`, metallic `0` |
| `RRR_Rubber` | Tire, grip, and flexible black parts, roughness `0.86–0.96`, metallic `0` |
| `RRR_MetalDark` | Frame, engine shadow masses, chain and fasteners, roughness `0.38–0.62`, metallic `0.45–0.85` |
| `RRR_MetalBright` | Fork, hubs, rims, exhaust and exposed hardware, roughness `0.25–0.48`, metallic `0.65–0.95` |
| `RRR_RiderFabric` | Suit panels, roughness `0.76–0.9`, metallic `0` |
| `RRR_RiderArmor` | Helmet shell, chest/back armor, pads and boots, roughness `0.5–0.72`, metallic `0` |
| `RRR_Visor` | Dark non-transparent visor, roughness `0.18–0.32`, metallic `0.05–0.18` |
| `RRR_NumberCream` | Rider and bike `22`, roughness `0.62–0.78`, metallic `0` |

The asset may use at most three 1024×1024 KTX2 textures with complete mip chains: one sRGB base-color atlas, one linear packed occlusion/roughness/metallic atlas, and one linear tangent-space normal atlas. A smaller atlas is preferred when visual inspection proves it sufficient. Textures must be project-authored, embedded in the runtime GLB, independently inventoried, and free of baked lighting, reference-sheet pixels, logos, pseudo-lettering, watermarks, or external URLs.

Strong geometry, bevels, normals, and material separation do most of the visual work. Dirt, wear, seams, and fabric breakup remain restrained and large enough to survive mip reduction. Transparent materials are prohibited in this first slice; the visor is opaque dark PBR so ordering and mobile overdraw remain bounded.

## Geometry, node, draw, and delivery budgets

| Budget | Hard ceiling |
|---|---:|
| Complete optimized bike and rider | 70,000 triangles |
| Bike, including both wheels | 40,000 triangles |
| Rider, including helmet and gear | 30,000 triangles |
| Both wheel/tread assemblies combined | 18,000 triangles |
| Exported glTF materials | 10 |
| Exported nodes | 96 |
| Mesh-bearing nodes after optimization | 28 |
| Render primitives/draws for the installed hero | 28 |
| KTX2 textures | 3 at no more than 1024×1024 each |
| Meshopt-compressed runtime GLB | 3 MiB |

The model is a single focal player asset, so silhouette and articulation quality take priority over indiscriminate polygon reduction. Hidden faces, duplicated internal shells, subdivision that does not affect the gameplay-camera silhouette, and geometry smaller than a stable screen pixel are removed. Knobbies, spokes, chain, levers, and cables may be selectively simplified, joined, or represented through normal/atlas detail as long as wheels and mechanical depth remain convincing from the accepted views.

No source or optimized mesh may produce non-manifold export failures, degenerate triangles, missing normals, invalid tangents, unbounded dimensions, duplicate node names, or a glTF validator error. Meshopt and KTX2 optimization occur after the editable `.blend` and raw GLB are versioned; optimized runtime output never replaces the editable source.

## Runtime installation and atomic fallback

The existing TypeScript simulation remains gameplay authority. The GLB supplies presentation only and must not change acceleration, heat, wheelie clearance, ramp impulse, crash rules, rider collision, lane position, camera values, or shadow contact logic.

The procedural player bike and rider remain visible and fully usable while the hero GLB loads. The current isolated compressed-asset loader and five-second readiness deadline remain in force. A successful load is installed atomically:

1. Decode into a detached scene and reject a disposed engine before mutating canvas diagnostics or the live scene.
2. Validate the one-scene/one-root contract, identity roots, unique names, required nodes, wheel/pivot/anchor transforms, materials, dimensions, and absence of unapproved cameras, lights, skins, animations, and external resources.
3. Resolve `RRR_BikeVisual`, `player-rider`, `FrontTire`, `RearTire`, and all six rider pose pivots before changing any existing `userData` reference.
4. Add the complete authored root, bind `bikeVisual`, `riderVisual`, `frontWheel`, `backWheel`, and `riderPoseRig`, and only then hide both procedural presentation groups in the same frame.
5. Mark `data-bike-asset="ready"` only after the complete handoff. Record the validated root and pose-pivot counts for QA diagnostics.

Missing nodes, invalid bounds, decode failure, timeout, or any pre-handoff exception leaves both procedural groups visible and marks `data-bike-asset="fallback"`. Timeout aborts only this loader, disposes KTX2 resources, and defensively disposes a late decoded scene. Disposal during loading must not overwrite diagnostics on a later engine that reuses the canvas. A partially installed or bike-only/rider-only authored state is prohibited.

The existing procedural bike/rider remain the permanent Low-risk fallback until the authored asset passes loading, visual, memory, and performance qualification. Failure fallback must remain playable, numbered, articulated, and compositionally complete.

## Existing motion hooks

The first slice uses the current code-driven presentation and exports no baked animation or skin:

- `FrontTire.rotation.x` and `RearTire.rotation.x` receive the existing speed-derived wheel spin.
- The outer player root continues to receive route yaw, course pitch, airborne pitch, steering roll, lane position, height, and whole-bike crash presentation.
- `player-rider` receives bounded root translation/rotation for speed tuck, landing compression, crash separation, and the recovering blend.
- `rider-torso-pivot`, `rider-head-pivot`, both arm pivots, and both leg pivots receive the code-resolved neutral, tuck, left/right lean, wheelie, airborne up/down/neutral, landing, crash, and recovery rotations.
- Genuine airborne/landing simulation transitions drive a short presentation-only compression pulse. The front and rear suspension pivots move by bounded visual offsets without changing collision, trajectory, contact, or replay authority.
- Reduced Motion zeros nonessential tuck, cadence, lean compensation, landing compression, and wheelie pose offsets while preserving crash/recovery state communication.
- `bike-steering-pivot` remains neutral. The two suspension pivots are stable presentation hooks only and must not become physics authorities.

The neutral authored mesh must tolerate every existing pose without visible detached hands, elbows, shoulders, hips, knees, boots, armor, number plates, or helmet parts. Any pose range that cannot be supported by the rigid six-pivot rig must be corrected in the asset or explicitly approved as a later armature migration; silently reducing gameplay motion is not acceptable.

## Source and delivery layout

The intended source/runtime chain is:

```text
docs/design/concepts/hero-bike-rider-production-reference.png
docs/design/concepts/hero-bike-rider-modeling-reference-v2.png
docs/design/concepts/hero-bike-rider-action-states-v3.png
docs/design/HERO_BIKE_RIDER_VERTICAL_SLICE.md
art-source/blender/hero-bike-rider/README.md
art-source/blender/hero-bike-rider/build_hero_bike_rider.py
art-source/blender/hero-bike-rider/generated/hero-bike-rider-source.blend
art-source/blender/hero-bike-rider/generated/hero-bike-rider-raw.glb
scripts/build-hero-bike-rider-assets.mjs
scripts/verify-hero-bike-rider-assets.mjs
public/assets/3d/hero-bike-rider.glb
public/assets/3d/asset-manifest.json
```

The manifest records the reference, contract, Blender version, coordinate convention, exact roots, source/raw/runtime hashes, triangle/node/mesh/material/texture metrics, compression, dependencies, and original project-authored provenance. The Basis transcoder, Meshopt decoder, same-origin loader, service-worker precache, failure-route tests, and asset/license inventory must be updated as one reviewed change.

The current runtime review evidence is `artifacts/visual-review/hero-motion-action-states-v9-headed-20260718t163425z/manifest.json` (115,700 bytes; SHA-256 `eb675b2e4f5aad20a88dc931787f57001cb7d37c4dc1dfc4c56d0eb71a857e79`). It is a format-3 `hero-motion-action-state-review` manifest with status `PASS` and 15/15 captures: neutral, tuck, both leans, wheelie, airborne up/down/neutral, clean landing, crash, recovery hold, recovering transition, Reduced Motion, portrait touch wheelie, and forced hero fallback. Every capture is an independent public-UI Canyon Practice run, bracketed by matching passive snapshots, with no query/state injection, relocation, freeze, or baseline promotion. Headed Chromium used browser-level muted audio; all normal frames require the authored hero, Canyon kit, and panorama to report ready, while the final frame deliberately fails only the hero GLB request. The manifest explicitly records `conceptFidelityClaimed: false`, `visualAcceptance: PENDING_OWNER_REVIEW`, and dirty-working-tree/nonbaseline scope.

The hero GLB initially replaces only the player. Rival bikes and riders remain a separate follow-up asset/variant decision; Rival and Mastery acceptance must explicitly assess the resulting player-versus-pack quality difference rather than treating the focal model as proof that the whole field is visually complete.

## Acceptance matrix

| Gate | Required evidence | Current status |
|---|---|---|
| Original source and provenance | Versioned `.blend`, authoring script, raw GLB, texture sources, hashes, manifest, license inventory, and human review for prohibited marks or recognizable third-party trade dress | **SOURCE/RAW/PREVIEW/OPTIMIZED GLB/MANIFEST AND THREE REFERENCE RECORDS COMPLETE; HUMAN REVIEW OPEN** |
| Static asset contract | Independent verifier proves exact hierarchy, identity roots, unique required names, pivot/anchor locations, budgets, embedded KTX2 properties, Meshopt decode, and zero unexpected glTF issues | **OPTIMIZER AND INDEPENDENT VERIFIER PASS (WORKING TREE); RELEASE UNVERIFIED** |
| Atomic successful install | Runtime evidence shows both authored groups appear together, both procedural groups hide only after validation, all `userData` hooks bind, and readiness diagnostics settle once | **HEADED HERO ACTION INTEGRATION 5/5 AND V9 AUTHORED CAPTURE PASS (SCOPED); RELEASE UNVERIFIED** |
| Failure, malformed asset, and timeout | Failed request, missing-node fixture, stalled request, restart, and disposed-engine paths preserve the complete fallback without leaks or stale canvas mutation | **TARGETED RELIABILITY 4/4 AND FORCED-FAILURE FALLBACK CAPTURE PASS (SCOPED); COMPLETE FROZEN-CANDIDATE MATRIX UNVERIFIED** |
| Wheel and course motion | Live review at start, acceleration, maximum normal speed, turbo, lane change, wheelie, airborne pitch, landing, and curved/graded course sections | **V9 PUBLIC-CONTROL MATRIX CAPTURES TUCK, ±0.17 LEANS, WHEELIE, AIRBORNE UP/DOWN/NEUTRAL, AND CLEAN LANDING; TECHNICAL PASS / VISUAL ACCEPTANCE OPEN** |
| Rider pose integrity | Grounded, tuck, cadence, lean, wheelie, airborne up/down/neutral, clean landing, crash, recovery, and Reduced Motion frames show intact joints and contact points | **15/15 STATES TECHNICALLY CAPTURED; CRASH SEPARATION, RECOVERY READABILITY, LANDING COMPRESSION, AND JOINT CONTACT REMAIN VISUALLY INSUFFICIENT / OWNER UNVERIFIED** |
| Desktop composition | Start and midcourse captures at the accepted desktop viewport show complete wheels/rider, readable `22`, mechanical depth, clear obstacles, and no HUD collision | **13 AUTHORED ACTION FRAMES PLUS ONE FORCED FALLBACK AT 1280×720; REAR CAMERA HIDES MECHANICAL DETAIL AND SOME STATE DIFFERENCES; NOT ACCEPTED** |
| Portrait composition | Start and midcourse captures at the accepted portrait viewport show the same focal quality without touch-control, heat-meter, road, or obstacle conflicts | **TOUCH WHEELIE CAPTURED AT 390×844; PHYSICAL-DEVICE AND VISUAL ACCEPTANCE OPEN** |
| Concept fidelity | Direct `view_image` comparison of the production reference, gameplay concepts, and latest native-size renders covers silhouette, proportions, palette, gear layering, tire detail, material response, and follow-camera presence | **V9 RUNTIME COMPARED; NUMBER READABILITY, PANEL SEPARATION, AND CHAIN-DRIVE SILHOUETTE IMPROVED, BUT FLAT SOLID-COLOR MATERIALS, BLOCKY ANATOMY, SIMPLIFIED BRAKES/SUSPENSION, SUBTLE LANDING/AIRBORNE POSES, AND TANGLED CRASH/RECOVERY REMAIN; NOT ACCEPTED / OWNER UNVERIFIED** |
| Low/Medium/High quality | Each tier loads the same readable asset with appropriate shadows/filtering and no missing material, texture, or number detail | **PAUSED / NOT RUN** |
| Lighting and shadows | Canyon plus at least one cool/dark venue demonstrate stable PBR response, grounded focal shadows, no crushed visor/engine values, and no shimmering spokes or treads | **PAUSED / NOT RUN** |
| Offline and lifecycle | Exact current service-worker generation precaches the runtime GLB/transcoder; online-to-offline restart and repeated engine disposal show no late requests, worker leaks, or retained decoded scenes | **PRODUCTION SMOKE AND TARGETED RELIABILITY PASS; FROZEN-CANDIDATE OFFLINE/LIFECYCLE QUALIFICATION UNVERIFIED** |
| Performance and memory | Desktop and representative mobile evidence records GLB transfer/decode time, draw calls, triangles, texture/GPU memory, frame time, sustained FPS, and 30-minute lifecycle behavior against release budgets | **HEADED CURRENT-BUILD DESKTOP/MOBILE NORMAL/STRESS DIAGNOSTICS PASS; LONG-DURATION AND FROZEN-CANDIDATE QUALIFICATION OPEN** |
| Accessibility/readability | High Contrast, Reduced Motion, reduced shake, UI scaling, desktop, portrait, and failure fallback retain rider/road/hazard separation and necessary gameplay cues | **REDUCED MOTION / DESKTOP / PORTRAIT TOUCH / FALLBACK CAPTURED; NEUTRAL AND REDUCED-MOTION FRAMES ARE VISUALLY OBSCURED BY THE GO OVERLAY; HIGH CONTRAST / UI SCALE / PHYSICAL DEVICE OPEN** |
| Owner and legal acceptance | Owner approves visual fidelity and a qualified human reviews originality, branding, similarity, licensing, and commercial-use records | **OPEN / NOT ACCEPTED** |

## Current QA and launch-readiness statement

The canonical and supplementary generated references may guide source authoring, but neither approves the model, establishes runtime fidelity, or qualifies a release candidate. The resumed scoped checks below establish only their named technical evidence.

The current Blender source, raw GLB, isolated source-review previews/contact sheet, and Meshopt optimization/manifest chain use source-pair UUID `793e14d9-b198-45c0-b1ee-c5c4b0748953`. The optimizer retains 58 public contract nodes, 88 total nodes, 28 mesh-bearing nodes, 28 render primitives, all ten contracted opaque PBR materials, and 49,312 triangles while reducing the 2,353,516-byte raw GLB by 78.3% to a 511,736-byte runtime GLB (SHA-256 `5537ba34639053a1b28b40978853ceade33f9d3ac40d2d2c477e59ce206c024a`). Regional counts are 39,984 bike triangles including 14,428 across both wheels and 9,328 rider triangles. The 15,164-byte schema-v2 manifest inventories the exact canonical reference, contract, authoring/output chain, optimizer, independent verifier, PNG integrity inspector, package manifest, and pinned Basis runtime support; its exact hash is recorded in the non-bound asset inventory and QA/operations docs rather than repeated inside this manifest-bound contract. The separately verified v2/v3 supplementary references remain noncanonical source-only inputs.

Independent/full asset verification, the headed hero action integration 5/5, the enriched v20 15/15 capture matrix for the current asset, focused unit/type/lint checks, and the earlier scoped reliability/performance checks pass their named dirty-working-tree scopes. The v20 evidence also requires the authored Canyon kit and panorama to be ready and proves the complete hero fallback through one deliberately failed GLB request. After the latest mechanical-detail revision, `npm run assets:build && npm run assets:verify`, `npm run build`, a non-QA live preview smoke, and the v20 headed action matrix with `VITE_QA_MODE=1` on isolated QA port 4174 passed. No baseline was promoted. The 2026-07-18 geometry passes improve side/rear number readability, helmet striping, rider panel separation, handlebar silhouette, tire sidewalls, visible engine depth, radiator louvering, engine cover bolts, brake rotor/hub detail, rear shock banding, chain rollers, the left-side chain-drive silhouette, and raised cream lightning/star graphics on the bike plastics, fork guards, fenders, and rider limbs. Flat solid-color materials, blocky rider anatomy, rear-camera occlusion, subtle landing/airborne differences, and tangled crash/recovery framing keep visual fidelity **NOT ACCEPTED / OWNER UNVERIFIED / RELEASE UNVERIFIED**. Frozen-candidate performance/soak/device/offline qualification and owner/legal review remain open; source integration retains the complete procedural bike/rider as the atomic load-failure fallback.
