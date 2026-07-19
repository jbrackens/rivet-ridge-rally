# Canyon modular kit source

This folder contains the editable, scripted Blender source for the first RIVET RIDGE RALLY Canyon environment slice. Its art and transform contract is defined in `docs/design/CANYON_VERTICAL_SLICE.md`; its visual reference is `docs/design/concepts/canyon-production-asset-reference.png`.

## Rebuild

Authoring baseline: Blender 4.5.11 LTS.

From the repository root:

```sh
/opt/homebrew/bin/blender --background \
  --python art-source/blender/canyon-kit/build_canyon_kit.py \
  -- \
  --output-dir art-source/blender/canyon-kit/generated
```

The authoring script stamps the current authoring-procedure SHA-256 and one UUIDv4 source-pair identifier into both outputs. Before saving, its Blender 4.5.11-pinned workspace scrub clears machine-local file-browser paths and stale studio-light selectors from the canonical `.blend`. It then writes:

- `generated/canyon-kit-source.blend` — editable canonical Blender source.
- `generated/canyon-kit-raw.glb` — unoptimized glTF 2.0 interchange output.

The generated GLB is an authoring output, not a production runtime asset. It must pass source inspection, glTF validation, optimization, runtime loading/fallback integration, concept comparison, memory/performance checks, and asset-inventory updates before a copy may enter `public/`.

`npm run assets:build` uses the versioned raw GLB as input to `scripts/build-canyon-assets.mjs`. That separate step rejects a mismatched authoring hash or source-pair UUID, preserves the scene provenance in the optimized GLB, joins compatible child meshes within each stable asset root, applies required Meshopt compression and quantization, and writes the production file and schema-v2 manifest under `public/assets/canyon/`. Re-running Blender may produce byte-level differences in modifier/export serialization even when the authored geometry and root contract are unchanged, so production provenance pins the exact accepted source and output hashes rather than claiming byte-identical Blender rebuilds.

## Runtime boundary

Each `CYN_*` root is an independently placeable presentation asset. The current TypeScript simulation, obstacle contacts, course surfaces, and cooling triggers remain gameplay authority. No collider, physics body, camera, light, or external asset is exported from this source.

The source intentionally uses only project-authored geometry and solid-color glTF PBR materials. It does not depend on a downloaded model, stock texture, online service, or proprietary Blender add-on.
