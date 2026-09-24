# Reproducible 3D Asset Pipeline

## Scope and decision

The current production target contains three original Blender-authored 3D pipelines:

- **Hero Bike and Rider A**, the focal player presentation at `/assets/3d/hero-bike-rider.glb`;
- **Canyon Modular Kit A**, the handcrafted Canyon/Rider School presentation kit at `/assets/canyon/canyon-kit.glb`; and
- **Shared Rival Pack A**, the lower-detail five-entrant Rival/Mastery presentation at `/assets/rivals/rival-pack.glb`.

All three assets are presentation-only. TypeScript remains authoritative for fixed-step movement, collision, wheelie/barrier outcomes, landing, heat, AI, timing, progression, and replay. The complete procedural player bike/rider, five-rival field, and Canyon scenery remain explicit runtime fallbacks.

The hero asset is governed by `docs/design/HERO_BIKE_RIDER_VERTICAL_SLICE.md` and the project-specific modeling reference `docs/design/concepts/hero-bike-rider-production-reference.png`. `art-source/blender/hero-bike-rider/build_hero_bike_rider.py` authors the editable `.blend`, raw GLB, and source-review preview with Blender 4.5.11 LTS. `scripts/build-hero-bike-rider-assets.mjs` consumes those versioned inputs, preserves the required wheel and six-pivot rider hooks, joins only compatible leaf meshes, and applies required Meshopt compression and quantization. The current hero source uses project-authored geometry and solid-color glTF PBR materials: it contains no downloaded model, stock texture, external resource, proprietary add-on output, skin, baked animation, camera, or light.

The Canyon kit uses `docs/design/CANYON_VERTICAL_SLICE.md` and its project-owned production reference. `art-source/blender/canyon-kit/build_canyon_kit.py` creates 11 stable roots with Blender-native geometry and 20 solid-color PBR materials. `scripts/build-canyon-assets.mjs` joins compatible meshes within, never across, those roots and applies required Meshopt compression and quantization.

The rival pack follows `docs/design/RIVAL_PACK_VERTICAL_SLICE.md`. `art-source/blender/rival-pack/build_rival_pack.py` authors one 26-node base with 12 render primitives, five PBR materials, one embedded project-generated number-field PNG, two wheel hooks, and six rigid rider-pose hooks. Five deterministic source previews prove the authored palettes and numbers `17`, `31`, `46`, `58`, and `73`; runtime loads the base once and clones it five times while retaining the same 12 `BufferGeometry` objects.

Meshopt was selected instead of Draco so the runtime does not ship two geometry decoders for the same role. `src/game/assets/compressedAssetLoader.ts` retains renderer-detected KTX2 support and locally hosted Basis Universal transcoders. The hero and Canyon GLBs use no textures; the rival GLB embeds one small opaque PNG which runtime replaces with one generated number texture per entrant. The checked-in Basis runtime files and notices remain separately inventoried shipped inputs.

The former generated **Festival Trail Bike** and its standalone KTX2 are predecessor artifacts, not the current runtime target. They have been removed from the current public 3D directory; their exact historical bytes remain recorded in `ASSET_LICENSES.md` and must not be treated as proof of the hero source or current release candidate.

## Source and output chain

The hero source chain is:

```text
docs/design/concepts/hero-bike-rider-production-reference.png
docs/design/HERO_BIKE_RIDER_VERTICAL_SLICE.md
art-source/blender/hero-bike-rider/README.md
art-source/blender/hero-bike-rider/build_hero_bike_rider.py
art-source/blender/hero-bike-rider/generated/hero-bike-rider-source.blend
art-source/blender/hero-bike-rider/generated/hero-bike-rider-raw.glb
art-source/blender/hero-bike-rider/generated/hero-bike-rider-preview.png
scripts/build-hero-bike-rider-assets.mjs
scripts/verify-hero-bike-rider-assets.mjs
scripts/lib/png-integrity.mjs
public/assets/3d/hero-bike-rider.glb
public/assets/3d/asset-manifest.json
```

The preview PNG is an isolated Blender source-review render, not a game screenshot or fidelity acceptance artifact. The modeling reference is not sampled, projected, embedded, or shipped as a runtime texture.

The rival source chain is:

```text
docs/design/RIVAL_PACK_VERTICAL_SLICE.md
art-source/blender/rival-pack/README.md
art-source/blender/rival-pack/build_rival_pack.py
art-source/blender/rival-pack/generated/rival-pack-source.blend
art-source/blender/rival-pack/generated/rival-pack-raw.glb
art-source/blender/rival-pack/generated/rival-pack-preview.png
art-source/blender/rival-pack/generated/rival-pack-preview-{17,31,46,58,73}.png
art-source/blender/rival-pack/generated/rival-pack-variants-contact-sheet.png
scripts/build-rival-pack-assets.mjs
scripts/verify-rival-pack-assets.mjs
scripts/lib/png-integrity.mjs
public/assets/rivals/rival-pack.glb
public/assets/rivals/asset-manifest.json
```

These renders are source-review evidence only. They do not establish in-game scale, motion, draw cost, frame time, fidelity, or owner/legal acceptance.

From a clean checkout with Node `26.4.0` from `.node-version` and npm `11.17.0` from `packageManager` available, the intended qualification sequence is:

```sh
npm ci --ignore-scripts
npm run assets:build
npm run assets:verify
npm run typecheck
npm run build
```

`assets:build` is intended to write these generated public outputs:

- `public/assets/3d/hero-bike-rider.glb`
- `public/assets/3d/asset-manifest.json`
- `public/assets/rivals/rival-pack.glb`
- `public/assets/rivals/asset-manifest.json`
- `public/assets/canyon/canyon-kit.glb`
- `public/assets/canyon/asset-manifest.json`

The versioned Basis transcoder JS/WASM, README, license, and NOTICE remain required runtime files but are not regenerated by any current Blender-asset optimizer.

The Canyon optimizer has an inventoried output: 32,008 source/runtime triangles, 62 optimized production meshes, 427,028 runtime GLB bytes, and SHA-256 `283be67d91cce4b0dc7b0f7e291811c62c77384f5e3f226cca71d41ce890ff7d`. Its 4,909-byte schema-v2 manifest has SHA-256 `7da4a7291711f0ca2d3ff4099cac50d6134599c5dfab3e5a050c435511208653` and recursively binds source-pair UUID `6d3823dd-f118-42fb-8bed-6cb2e3b2becf`, the current authoring-script hash, production reference, contract, README, Blender procedure, optimizer, independent verifier, PNG inspector, package manifest, scrubbed editable source, raw GLB, and runtime GLB.

The isolated hero optimizer completed on 2026-07-17 and refreshed the current two-file public directory:

| Hero output | Bytes | SHA-256 |
|---|---:|---|
| Editable Blender source | 2,279,291 | `e9138c0ca9d76a7fefca514ea768694e31ff52ee33e0df74a2b6530d5b8e4226` |
| Raw interchange GLB | 2,353,516 | `a81c7984442c3dcaa0b6dd5c4fba76994f3b66949e39e3abf779b7f5f965c976` |
| 1280×900 source-review preview | 1,293,907 | `5374f38ee466f879343bc5e6b74fce95ed86d31f1271ed4a519ce39dfb8f2c43` |
| Four manifest-bound 640×450 source-review panels | 1,507,097 total | Individual byte/hash records in the schema-v2 manifest |
| 1280×900 source-review contact sheet | 1,510,445 | `27ecc1c63703a978e5571ed6c74231089976404eb27109461a2b657cec9ca55a` |
| Meshopt runtime GLB | 511,736 | `5537ba34639053a1b28b40978853ceade33f9d3ac40d2d2c477e59ce206c024a` |
| Hero asset manifest | 15,164 | `1d75490d8b2af28b12c2b53fb9b85ba7b7d365c668f7c5e0ffbf8f32eb7997b7` |

The schema-v2 manifest records source-pair UUID `793e14d9-b198-45c0-b1ee-c5c4b0748953` and a 78.3% raw-to-runtime GLB reduction while preserving 49,312 triangles, 88 nodes, 28 mesh-bearing nodes, 27 optimized meshes, 28 render primitives, 10 exact opaque PBR materials, and zero textures, cameras, skins, or animations. Regional triangle accounting records 39,984 for the bike including wheels, 9,328 for the rider, and 14,428 for the wheels. It binds the production reference, contract, authoring source, same-run scrubbed editable source/raw export pair, primary preview, all four fixed-angle panels, contact sheet, optimizer, independent verifier, PNG integrity inspector, package manifest, runtime output, and exact pinned Basis runtime files. PNG inspection validates the chunk sequence, chunk CRCs, bounded decompression, scanline filters, and decoded dimensions/color format rather than trusting only the header. The optimizer completed and internally round-trip validated hierarchy/pivot preservation, required Meshopt/quantization, exact material semantics/opacity, ground-contact bounds, and regional triangle subbudgets. On 2026-07-18, `npm run assets:build` and `npm run assets:verify` exited 0 after accepting 49,312 triangles, 28 mesh-bearing nodes/render primitives, and 511,736 bytes; the full asset chain also passed. These exact asset results remain working-tree evidence rather than immutable-source qualification.

Runtime qualification has also resumed. Hero action integration passed 5/5, targeted reliability previously passed 4/4, production smoke passed in its scoped run, and the 121,832-byte enriched action-state manifest at `artifacts/visual-review/hero-motion-action-states-v20-current-20260718t-mechanical-detail-qamode/manifest.json` passed 15/15 with SHA-256 `9a6beeb30396e57054d5f5aa4500ec32cd2d9f9ca8746eb48846f2f7cca24223` for the current hero/material/dust runtime. After the latest mechanical-detail, lane-change readability, and landing-pulse pass, the non-QA preview on `127.0.0.1:4173` was rebuilt and restarted; a scoped Playwright smoke observed the 49,312-triangle hero counters, PMREM material-response diagnostics, contact-shadow diagnostics, ready Canyon/environment assets, and zero console errors or failed requests. The rendered public-control v20 capture records browser-level audio muting, authored hero/Canyon/environment readiness, all required motion states, Reduced Motion, touch wheelie, deliberate hero fallback, visible public-button activation, and no state injection. The earlier six-frame pass-v2, v3 action-state, and v8/v9/v10/v11/v12/v18/v19 detail records remain historical. Headed diagnostics recorded desktop normal/stress profiles at 59.97/59.99 FPS with 2.2/2.6 ms p95 frame work, and mobile normal/stress profiles at 59.95/59.92 FPS with 1.6/1.9 ms p95 frame work. That performance diagnostic fails only on dirty/source binding; the commercial release remains **NOT READY** because physical-device/frozen-candidate qualification, a promoted visual baseline, owner/legal approval, and concept fidelity remain open. The latest source pass improves raised tank/fender graphics, brake rotor/hub detail, rear shock coil and mount detail, chain rollers, radiator hoses, exhaust/fork hardware, handguard inserts, rider armor/boot segmentation, helmet goggle/vent framing, arrow-key lane-change lean readability, PMREM-backed material response, contact-shadow readability, and pooled rough-landing/crash/recovery dust bursts while preserving the 28-render-primitive hero budget, but the hero remains blocky and flat against the concept and still needs accepted side-by-side runtime review. Visual fidelity remains **NOT ACCEPTED**.

The isolated rival optimizer reduced the 1,281,044-byte raw GLB to a 193,884-byte required-Meshopt runtime GLB (84.9%; SHA-256 `09043547981c80d66fca23aa208971b6b2f457890cafabeed4258dbc0fdbb805`) without changing its 19,588 triangles, 26 nodes, 12 mesh-bearing nodes/render primitives, five materials, or one embedded texture. Its 6,661-byte schema-v2 manifest (SHA-256 `122518c2552685af9a9e9469368c232c503fd5d8c53de4973e0fc299d751329a`) binds source-pair UUID `c7b02b0e-1ae0-46ef-abc9-73547f432967`, the same-run scrubbed `.blend`/raw-GLB pair, source previews, contract, authoring procedure, optimizer, independent verifier, PNG integrity inspector, and `package.json`; it also requires the package `assets:build` and `assets:verify` commands to include the rival stages. On 2026-07-18 under Node v26.4.0/npm 11.17.0, `node scripts/verify-rival-pack-assets.mjs` exited 0 for this exact working-tree contract. On 2026-07-18, the focused Chromium QA runtime gate `npx playwright test e2e/rival-pack.spec.ts --config .playwright-focused-4176.config.ts --project chromium` passed 2/2 in 1.1 minutes on isolated port 4176, covering the authored five-variant shared-geometry install and the hard-failure procedural fallback. Performance, immutable-source, and owner/legal qualification remain **UNVERIFIED**.

## Verification contract

`npm run build` invokes `assets:verify` before TypeScript and Vite. The current verification source is intended to:

1. require the exact hero directory entries `asset-manifest.json` and `hero-bike-rider.glb`, and independently require the exact rival directory entries `asset-manifest.json` and `rival-pack.glb`;
2. bind the hero reference, contract, authoring procedure, README, editable source, raw interchange GLB, preview, runtime GLB, optimizer, independent verifier, PNG inspector, package manifest, pinned Basis runtime files, and manifest by exact recorded bytes and SHA-256, with one source-pair UUID shared by the same-run editable source/raw export;
3. validate both PNG inputs by exact chunk sequence and CRCs, bounded decompression, scanline filters, decoded dimensions, bit depth, and color type, then parse the source and runtime glTF containers and reject external resources, textures, cameras, lights, skins, animations, duplicate names, invalid transforms, or missing contract nodes;
4. preserve the exact scene/root hierarchy, wheel-spin nodes, six rider-pose pivots, and five verification anchors through optimization;
5. enforce the documented triangle, material, node, mesh-bearing-node, draw, dimensions, and three-MiB runtime ceilings;
6. require `EXT_meshopt_compression` and `KHR_mesh_quantization`, decode the runtime GLB independently, and require no unexpected Khronos validator issue;
7. verify the rival source/runtime pair, 26-node hierarchy, two wheel hooks, six pose hooks, five variant previews, 15,000–20,000-triangle/8–12-primitive budgets, one embedded opaque PNG, shared-geometry contract, and manifest-bound build tooling independently;
8. verify the Canyon kit independently without allowing one asset's manifest to authorize another; and
9. verify the production public-asset inventory, separately inventoried panorama, title art, icon, bundled font subsets, and font-license inputs.

On 2026-07-16 under Node v26.4.0/npm 11.17.0, the independent hero, rival, Canyon, and production-art commands each exited 0, and `npm run assets:verify` repeated all four gates and exited 0. The Canyon gate accepted 32,008 triangles, 62 meshes, 20 materials, and 427,028 bytes; the production-art gate accepted the Canyon panorama, both modeling references, shipped/source title identity, SVG plus four raster icons, both WOFF2 fonts, and the OFL. A separate read-only recursive audit checked all 50 manifest-bound file records with zero byte/hash mismatches. These are current working-tree static results, not an immutable-candidate claim; strict typecheck, Vite build, generated notices, and runtime qualification have not yet been established for this slice. The retired `scripts/build-3d-assets.mjs` predecessor writer is excluded from the current pipeline and stops before any public write unless an operator deliberately sets `RRR_ALLOW_RETIRED_FESTIVAL_PUBLIC_WRITE=1`; that override is only for explicit historical reproduction because the script targets the current public 3D directory.

The pinned Basis runtime license is a byte-stable complete Apache-2.0 text; it satisfies the license-copy requirement but is not represented as the differently formatted upstream Basis file. A path-specific `-text -diff` Git attribute prevents checkout-time line-ending conversion from changing its recorded size or hash. Three.js r185's bundled runtime identifies its source update as Basis Universal v1.50.0; the retired predecessor writer verifies this checked-in license hash and no longer copies an unrelated package's license file. Blender exporter serialization is not claimed byte-identical after a fresh authoring rebuild; an accepted revision must pin the exact editable source, raw export, optimized output, manifest, and supporting files.

## Runtime loader and fallback

`src/game/assets/compressedAssetLoader.ts` configures `GLTFLoader` with `MeshoptDecoder` and a renderer-detected `KTX2Loader`. `GameEngine` gives the hero bike/rider, shared rival pack, and Canyon kit separate bounded loader instances so one timeout cannot abort another.

The hero loader targets `/assets/3d/hero-bike-rider.glb`. It decodes and validates a detached scene before live-scene mutation, resolves the complete bike, rider, wheel, pose-pivot, and anchor contract, installs the authored pair atomically, and only then hides both procedural presentation groups. Missing, malformed, failed, canceled, timed-out, late, or partially resolvable output leaves the complete procedural bike and rider visible. The GLB does not replace simulation, collision, course, camera, or shadow-contact authority.

Successful Canyon decode clones quality-bounded `CYN_*` roots as course-anchored presentation scenery while retaining procedural gameplay authority. Authored Test Rides exclude the Canyon kit. Any Canyon failure leaves the corresponding procedural scenery visible.

Rival and Mastery create all five procedural bikes/riders before requesting `/assets/rivals/rival-pack.glb`. The loader validates the full base off-scene, prepares all five numbered/material variants, verifies shared geometry and every wheel/pose hook, then swaps the complete field atomically. Any missing, malformed, failed, canceled, timed-out, late, or partially prepared result leaves all procedural rivals visible and usable. Successful source materials/textures are released while the cloned field retains the shared decoded geometries.

`rivet-ridge-rally-shell-v35` source precaches all three runtime GLBs, both bundled display fonts, the Canyon panorama, the complete SVG/PNG install-icon set, and the stable Basis transcoder files. The service-worker fixtures and scoped asset success/failure/timeout, browser-rendering, disposal, and performance paths pass on the working tree. A real installed-browser activation/cache transition, exact-product offline race, long-duration memory evidence, physical devices, and frozen-candidate qualification remain **UNVERIFIED**.

## Dependencies and licenses

| Package/component | Pinned version | License | Distribution role |
|---|---:|---|---|
| `@gltf-transform/core` | 4.4.1 | MIT | Build and verification only |
| `@gltf-transform/extensions` | 4.4.1 | MIT | Build and verification only |
| `@gltf-transform/functions` | 4.4.1 | MIT | Build only |
| `ktx2-encoder` | 0.5.3 | MIT | Retained build dependency; wraps Basis Universal encoder WASM |
| Basis Universal encoder WASM in `ktx2-encoder` | packaged with 0.5.3 | Apache-2.0 | Build only |
| `meshoptimizer` | 1.2.0 | MIT | Build and verification only |
| `gltf-validator` | 2.0.0-dev.3.10 | Apache-2.0 | Verification only |
| `three` | 0.185.1 | MIT | Runtime rendering, procedural fallback, and loaders |
| Basis Universal transcoder from Three.js examples | bundled with Three 0.185.1 | Apache-2.0 | Shipped runtime JS/WASM |

The copied Basis runtime directory includes Three.js's upstream README, a full byte-stable Apache-2.0 license text, and a readable Basis attribution NOTICE. `THIRD_PARTY_NOTICES.md` aggregates repository-level attribution, while `ASSET_LICENSES.md` records the shipped/historical inventory and open owner/legal actions.
