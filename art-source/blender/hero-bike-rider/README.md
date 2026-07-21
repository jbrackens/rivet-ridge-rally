# Hero bike and rider source

This folder contains the editable, scripted Blender source for the RIVET RIDGE RALLY focal bike-and-rider pass. The primary modeling reference is `docs/design/concepts/hero-bike-rider-production-reference.png`; the v2 mounted-pose sheet and v3 action-state sheet are supplementary source-only references, while `docs/design/concepts/gameplay-desktop.png` and `docs/design/concepts/gameplay-mobile.png` define the required rear-gameplay silhouette and portrait readability. These images are art-direction references only, not runtime textures or geometry to trace.

## Regeneration

Authoring baseline: Blender 4.5.11 LTS.

From the repository root:

```sh
/opt/homebrew/bin/blender --background \
  --python art-source/blender/hero-bike-rider/build_hero_bike_rider.py \
  -- \
  --output-dir art-source/blender/hero-bike-rider/generated
```

The authoring procedure stamps one UUIDv4 source-pair identifier into the uncompressed editable source and exported root. Before saving, its Blender 4.5.11-pinned workspace scrub clears machine-local file-browser paths and stale studio-light selectors from the canonical `.blend`. It then writes:

- `generated/hero-bike-rider-source.blend` — editable canonical Blender source.
- `generated/hero-bike-rider-raw.glb` — unoptimized glTF 2.0 interchange output.
- `generated/hero-bike-rider-preview.png` — reproducible 1280×900 source-review render; not a runtime screenshot or acceptance artifact.
- `generated/hero-bike-rider-preview-{rear-right,right-profile,left-profile,front-left}.png` — fixed 640×450 review angles.
- `generated/hero-bike-rider-preview-contact-sheet.png` — deterministic 1280×900 four-angle sheet ordered rear-right, right profile, left profile, then front-left.

The raw GLB is an authoring output, not an accepted production asset. Produce the reviewable runtime copy and its provenance manifest separately with:

```sh
node scripts/build-hero-bike-rider-assets.mjs
```

That isolated asset build does not start the game or qualify runtime behavior. The current authored revision contains 88 nodes, 28 mesh-bearing nodes/render primitives, all 10 contracted semantic materials, 49,780 triangles, and a 2.58 m wheelbase. It keeps the no-texture solid-color PBR contract while adding gameplay-distance saddle ribs, grip-end flashes, boot toe/latch accents, and a visor split; the wheel tread count is deliberately reduced within contract so the bike remains under its 40,000-triangle region budget. Manifest schema 2 checks source-pair UUID `31000dd4-2c42-4c74-ad5d-28b5e4aec32f`, records the 517,664-byte Meshopt runtime GLB, and binds the source, raw export, primary preview, all four fixed-angle panels, contact sheet, runtime, canonical reference, optimizer, independent verifier, PNG inspector, package-manifest, and Basis-support hashes. Blender exporter serialization may differ byte-for-byte between rebuilds even when the visible geometry and named-root contract are unchanged, so any accepted revision must refresh and review that manifest.

## Coordinate and pivot contract

- One Blender unit equals one metre.
- In Blender authoring space, `+Y` points forward along the bike, `+X` points to rider-right, and `+Z` points up.
- `RRR_HeroBikeRider` is the identity top-level root. Its origin is on the source ground plane at the longitudinal midpoint between the two tire contact patches.
- `RRR_BikeVisual` and `player-rider` are independent identity child roots so runtime replacement and fallback can treat the complete racer atomically.
- `FrontTire` and `RearTire` originate at their axle centres. Their local `+X` axes are the wheel-spin axes.
- `bike-steering-pivot` originates at the steering head and owns the front fork, handlebar, and front-wheel hierarchy.
- `bike-front-suspension-pivot` originates at the front suspension reference point; `bike-rear-suspension-pivot` originates at the rear swingarm pivot. Suspension presentation must remain bounded and must not become simulation authority.
- The rider exposes exactly six stable runtime pose roots: `rider-torso-pivot`, `rider-head-pivot`, `rider-left-arm-pivot`, `rider-right-arm-pivot`, `rider-left-leg-pivot`, and `rider-right-leg-pivot`. Left and right are always named from the rider's perspective. Mesh children may refine the silhouette without changing those six public roots.
- Source-local tire contact is `Y = 0` after glTF conversion. Runtime attaches the complete scene beneath the existing player presentation root with the fixed `-0.63` metre compatibility offset; that offset aligns the authored source ground plane to the established track contact plane and does not alter collision or simulation authority.
- Stable contract roots use identity scale, applied mesh transforms, and no negative scale. No exported child may require a Blender-only constraint, modifier, driver, light, camera, physics body, or external file.
- The asset is presentation-only. Fixed-step handling, pitch, wheelie clearance, collisions, landing rules, AI, timing, and replay state remain TypeScript authority.

## Originality and provenance

The bike, rider, rig, materials, number `22`, panel motifs, and any later atlas must be original project-authored work. This source may not include a downloaded model, stock texture, sponsor mark, manufacturer badge, readable third-party branding, proprietary add-on output, or externally linked asset. The rider must retain stylized human motocross proportions and must not use platform-branded block-avatar proportions, branded trade dress, or a recognizable third-party character design.

Before shipping, inventory the editable source, generation procedure, raw GLB, optimized GLB, textures, dependencies, byte sizes, and SHA-256 hashes in the repository's asset/provenance records. Human similarity, trademark, and legal review remain required; scripted provenance does not replace that review.

## Runtime qualification status

Source generation alone does not qualify the hero pass. The current working-tree gate records passing independent/full asset verification, a headed five-case action integration suite, and the 15-frame `artifacts/visual-review/hero-motion-action-states-v3-headed-20260717t095050z/manifest.json` (114,426 bytes; SHA-256 `79b9b19f441c7368e1ba495e7903c6a9e3c934eb3348b55a298cb0ab790cc47a`). That format-3 manifest covers neutral, tuck, both leans, wheelie, airborne up/down/neutral, clean landing, crash, recovery hold, recovering transition, Reduced Motion, portrait touch wheelie, and complete procedural fallback after a forced hero request failure. Each capture uses the public UI, passive snapshots only, headed Chromium with browser audio muted, and requires the authored Canyon kit and panorama to be ready. It explicitly remains dirty-working-tree QA evidence, not an immutable release, promoted baseline, or owner acceptance.

Earlier headed current-build diagnostics produced clean desktop normal/stress profiles at 59.97/59.99 FPS with 2.2/2.6 ms p95 frame work and mobile normal/stress profiles at 59.95/59.92 FPS with 1.6/1.9 ms p95 frame work. They are not frozen-candidate evidence. Runtime and visual acceptance remain **INCOMPLETE / NOT ACCEPTED / OWNER UNVERIFIED** pending all of the following:

- repetition from one exact frozen candidate, including structural, bounded-loading, fallback, disposal, offline, and long-duration checks;
- stronger complete-wheel, steering/suspension, six-pivot, crash-separation, recovery, shadow, and Reduced Motion readability across the already captured action matrix;
- side/three-quarter native-size wheelie/barrier, airborne, clean/hard landing, crash, and recovery comparison plus Low/Medium/High and cool/dark-venue review;
- rear-number, tire, fender, exhaust, armor, helmet, grip, peg, lane, obstacle, and landing-zone readability at gameplay distance;
- complete draw-call, memory, frame-time, load-time, physical-device, high-contrast, and UI-scale evidence; and
- explicit owner visual acceptance and final human originality/legal review.

No generated file in this folder is launch-ready merely because Blender exports it successfully.
