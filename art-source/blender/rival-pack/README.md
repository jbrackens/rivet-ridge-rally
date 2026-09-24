# Shared rival pack source

This directory contains the original scripted Blender source for the lower-detail Rival and Mastery field. It exports one presentation-only base rig; runtime code clones the same geometry for all five entrants and changes only project-authored palette materials and the opaque seven-segment number field.

## Regeneration

Authoring baseline: Blender 4.5.11 LTS.

```sh
/opt/homebrew/bin/blender --background \
  --python art-source/blender/rival-pack/build_rival_pack.py \
  -- \
  --output-dir art-source/blender/rival-pack/generated
```

The generator stamps one UUIDv4 source-pair identifier into the uncompressed editable source and exported root. Before saving, its Blender 4.5.11-pinned workspace scrub clears machine-local file-browser paths and stale studio-light selectors from the canonical `.blend`. It then writes:

- `generated/rival-pack-source.blend` — canonical editable source;
- `generated/rival-pack-raw.glb` — unoptimized interchange GLB;
- `generated/rival-pack-preview.png` — 1280×900 base-number source render;
- `generated/rival-pack-preview-{17,31,46,58,73}.png` — fixed variant renders; and
- `generated/rival-pack-variants-contact-sheet.png` — deterministic 1920×900 five-variant review sheet.

The authored base has exactly 26 nodes, 12 mesh-bearing nodes/render primitives, five semantic materials, 19,588 triangles, and a 2.36 m wheelbase. It contains one project-generated 128×64 opaque number-field texture, no downloaded model or texture, no external resource, and no animation, skin, camera, light, physics body, driver, or constraint.

Generate the isolated runtime asset and manifest with:

```sh
node scripts/build-rival-pack-assets.mjs
```

That optimizer does not start the application or qualify runtime behavior. `scripts/verify-rival-pack-assets.mjs` is an independent release gate and remains deferred while testing is paused.

## Runtime contract

- Source space is metric, `+Y` forward, `+X` rider-right, and `+Z` up; glTF runtime space remains `+Y` up and `-Z` forward.
- `RRR_RivalPackBase`, `RRR_RivalBikeVisual`, and `rival-rider` remain identity roots.
- `FrontTire` and `RearTire` expose local `+X` wheel-spin axes.
- The stable pose hooks are `rider-torso-pivot`, `rider-head-pivot`, `rider-left-arm-pivot`, `rider-right-arm-pivot`, `rider-left-leg-pivot`, and `rider-right-leg-pivot`.
- The base materials are `RRR_RivalPrimary`, `RRR_RivalAccent`, `RRR_RivalHardware`, `RRR_RivalWheel`, and `RRR_RivalNumberField`.
- Approved variants are `17`, `31`, `46`, `58`, and `73`, mapped to the existing original AI entrant colors.
- Geometry is presentation-only. TypeScript remains authoritative for AI route choice, collision, speed, wheelie, crash, recovery, timing, and results.

## Deferred acceptance

Source generation and isolated optimization are authoring evidence only. Runtime load success, malformed/failure/timeout fallback, shared-geometry proof in the renderer, five-bike pose integrity, desktop/portrait gameplay composition, offline restart, performance, memory, and owner/legal review all remain paused and unverified.
