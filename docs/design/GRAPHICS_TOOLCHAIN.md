# RIVET RIDGE RALLY — Graphics Toolchain Decision

**Decision date:** 2026-07-16

## Chosen path

Keep the existing Three.js renderer and improve the authored content pipeline around it. The repository already has the right web delivery foundation—glTF, Meshopt, KTX2, sRGB output, ACES tone mapping, shadows, fog, instancing, and quality tiers. Rewriting the game in PlayCanvas, Babylon, Godot, React Three Fiber, or a hosted game platform would discard working simulation/editor/release infrastructure without solving the main gap: the game lacked authored production geometry and cohesive materials.

The first vertical slice therefore uses:

| Layer | Tool | Current role |
|---|---|---|
| Modeling and editable source | Blender 4.5.11 LTS | Installed locally; creates the original Canyon, hero bike/rider, and shared rival-pack `.blend` and raw GLB sources |
| Runtime format | glTF 2.0 / GLB | Stable named roots and PBR materials |
| Geometry optimization | glTF Transform 4.4.1 + meshoptimizer 1.2.0 | Existing pinned build dependencies; join compatible meshes, quantize, and require Meshopt |
| Texture delivery | Existing KTX2/Basis pipeline | Retained for later authored texture atlases; the Canyon and hero assets use solid-color PBR materials, while the rival pack uses one small embedded project-authored number field |
| Lighting | Three.js PMREM + `RoomEnvironment` | Added with 64/128/256 quality sizes and direct-light fallback; no new dependency |
| Runtime | Three.js 0.185.1 | Retained; separate bounded hero, Canyon, and shared rival-pack loaders with complete procedural fallbacks |
| Raster paint/cleanup | Krita | Recommended when hand-painted masks, decals, or texture atlases become necessary; not required or installed for the current authored slices |
| Procedural materials | Material Maker | Recommended for later dirt/rock/wood PBR atlases; not required or installed for the current authored slices |
| Blockout/voxel props | Blockbench | Optional for a deliberately blocky prop subset; not the hero bike/rider pipeline |

## MCP decision

A Blender MCP can accelerate interactive art iteration, but it is not a renderer upgrade and is not required to generate or ship assets. Common Blender MCP servers can execute arbitrary Python in Blender and may expose optional network asset or AI integrations. That is appropriate only with a pinned source revision, localhost-only transport, telemetry disabled, no API keys, no external asset integrations, and review of every generated change.

The current source uses a versioned headless Blender procedure instead. It is easier to audit, reproduce conceptually, keep under Git, and run without opening a remote-control socket. No Blender MCP is configured in the production workflow yet. If one is piloted later, it must remain a developer-only convenience; canonical source stays in `.blend`/Python files and the normal Node optimizer/verifier remains the release boundary.

The connected GitHub plugin is useful for repository and pull-request work but does not alter graphics quality or enter the shipped runtime.

## Deferred tools

- A post-processing library is deliberately deferred until the authored Canyon slice is rendered and accepted. Bloom, color grading, SSAO, or depth effects cannot compensate for incorrect modeling, scale, or composition and can easily harm obstacle/HUD readability.
- `three.quarks` or another particle system is a later VFX pass for dust, cooling mist, landing bursts, and crowd accents after the environment/bike material baseline is stable.
- A full engine migration remains rejected unless a future requirement cannot be met by Three.js and the migration's gameplay/editor/offline/release cost is explicitly accepted.

## Next art passes

1. Continue beyond the technically passing enriched 15-state hero matrix; review the Canyon kit, authored hero, and five shared-rig rivals at all three quality tiers, with side/three-quarter framing that visibly distinguishes wheelie, airborne pitch, landing compression, crash separation, and recovery.
2. Correct any scale, orientation, overlap, material exposure, number readability, pose attachment, or density issue in the versioned Blender sources.
3. Compare native-size race captures with the approved concept references and record explicit owner/legal acceptance; source previews alone do not establish in-game fidelity.
4. Build a small KTX2 atlas only where solid-color materials cannot deliver necessary dirt wear, fabric, timber grain, or mechanical readability.
5. Add restrained post-processing or VFX only after gameplay silhouettes, accessibility, draw-call, memory, and frame-time budgets pass.

Scoped runtime qualification has resumed: headed hero action integration passes 5/5, the v7 15-state dirty-working-tree manifest passes with authored Canyon-kit/panorama readiness and browser audio muted, targeted reliability passes its scoped paths, and earlier headed desktop/mobile normal/stress profiles remain near 60 FPS with 1.6–2.6 ms p95 frame work. The 2026-07-18 hero source pass improves side/rear number readability, helmet/rider panel separation, and close-camera handlebar silhouette while staying within the 28-render-primitive contract. The captured blocky/flat proportions/materials, simplified mechanics, rear-camera occlusion, and weak landing/crash/recovery fidelity remain below the concept target. Quality-tier, accessibility, memory/long-duration, offline frozen-candidate, physical-device, and owner/legal acceptance therefore remain **INCOMPLETE / NOT ACCEPTED / UNVERIFIED**.
