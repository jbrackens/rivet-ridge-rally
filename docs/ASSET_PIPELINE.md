# Reproducible 3D Asset Pipeline

## Scope and decision

This repository contains one original, repository-generated low-poly sample asset: **Festival Trail Bike**. It proves the production path while retaining the live procedural renderer as an explicit fallback:

- GLB packaging;
- `EXT_meshopt_compression` geometry compression;
- `KHR_mesh_quantization` for Meshopt's compact vertex attributes;
- a genuine KTX2 ETC1S/BasisLZ texture with a full mip chain;
- required `KHR_texture_basisu` integration;
- Three.js Meshopt and KTX2 runtime loader setup; and
- locally hosted Basis Universal transcoders.

Meshopt was selected instead of Draco because the mission permits Meshopt **or** Draco, and shipping both decoders for one small asset would add redundant runtime weight. The asset uses no downloaded model, stock texture, or reference image. Geometry and the 128×128 festival-bolt albedo are created entirely by `scripts/build-3d-assets.mjs`. The current composition includes named animated wheel roots, 14 tread blocks and a brake disc per wheel, layered side panels, an exposed rear-right exhaust and tip, and a rear-facing five-segment `22` over the generated plate texture.

## Rebuild and verify

From a clean checkout with Node `26.4.0` from `.node-version` and npm `11.17.0` from `packageManager` available:

```sh
npm ci --ignore-scripts
npm run assets:build
npm run assets:verify
npm run typecheck
npm run build
```

`assets:build` writes only these generated outputs:

- `public/assets/3d/festival-trail-bike.glb`
- `public/assets/3d/festival-bike-albedo.ktx2`
- `public/assets/3d/asset-manifest.json`
- `public/assets/transcoders/basis/basis_transcoder.js`
- `public/assets/transcoders/basis/basis_transcoder.wasm`
- `public/assets/transcoders/basis/README.md`
- `public/assets/transcoders/basis/LICENSE.txt`
- `public/assets/transcoders/basis/NOTICE.txt`

Current pinned output snapshot:

| Output | Bytes | SHA-256 |
|---|---:|---|
| Meshopt/KTX2 GLB | 29,132 | `8668d05f42f3b8303c0825b8d4aa4b9c66a8ef64acba18f2df70b69f9a8f595b` |
| Standalone ETC1S KTX2 | 2,236 | `a86588924b53fd51915d505d0ba23e343ac3e84a5139c687845a49f8ad8a1ba2` |
| Asset manifest | 3,369 | `ebd431902d7177bfdaad64733eedf246bb8c31f132a3e063a61188412ae244e7` |
| Basis transcoder JS | 57,529 | `8478b5b6d6b74e7d3082b89f6417321d8d1dc0307f2b30d4484bb11b441696a1` |
| Basis transcoder WASM | 527,333 | `6cf17dc889352c42e9acf8897107978d127005fe3386c36a0e3845e27967630a` |
| Basis README | 1,388 | `a578df416c1e0852e9c36a1cf91b4d28d91a251294f87ce610a3bc7ca4df15e0` |
| Apache-2.0 license | 9,197 | `a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47` |
| Basis NOTICE | 917 | `42beeb6710c933778e30f62886e0790ebba120debbb0545ab46c7292d3e5a061` |
| **Total generated pipeline files** | **631,101** | — |

The same KTX2 bytes are embedded in the GLB and emitted standalone for inspection. Meshopt reduces the GLB from 54,868 bytes to 29,132 bytes (46.9%). `npm run build` runs `assets:verify` automatically before TypeScript and Vite compilation. That command verifies this 3D pipeline, the separately inventoried production panorama, the shipped and retained-source title artwork, the app icon, and the two separately sourced bundled display-font subsets plus their license; `assets:build` does not generate or rewrite the panorama, title artwork, icon, or fonts.

The pinned Apache-2.0 license keeps its upstream CRLF bytes. A path-specific `-text -diff` Git attribute prevents checkout-time line-ending conversion from changing its recorded size or hash.

The generated manifest records byte sizes, SHA-256 hashes, formats, and tool licenses. Verification compares it with an independent in-script contract, so editing or omitting manifest entries cannot authorize changed assets; an intentional regeneration requires review and an explicit contract update. Rebuilding twice on the same supported toolchain should produce identical hashes. Basis encoding is not promised to be byte-identical across different operating systems or encoder/WASM versions, so the package and lockfile remain pinned.

`assets:verify` performs nine independent checks across its 3D and production-art verifiers:

1. Enforces the exact shipped `public/assets` top-level, art, font, icon, transcoder, and 3D directory entries with the expected file/directory types; pins the 3D manifest's own bytes/SHA-256; and compares its complete data against an independent authoritative provenance, dependency, compression, path, byte, and hash contract.
2. Parses the GLB container and asserts required Meshopt and Basis extensions.
3. Parses the KTX2 header and asserts 128×128 ETC1S/BasisLZ with eight mip levels.
4. Confirms the standalone KTX2 is byte-identical to the texture embedded in the GLB.
5. Runs Khronos `gltf-validator` and decodes the Meshopt GLB through glTF Transform.
6. Asserts the named wheel hierarchy, 28 tread blocks, brake discs, side panels, textured front/rear plates, ten cream rear-number segments, exposed exhaust placement/materials, and the 30-mesh-bearing-node ceiling so a focal-silhouette regression cannot pass on broad object counts alone.
7. Verifies `public/assets/art/canyon-festival-panorama.png` by exact byte count/SHA-256, PNG signature and chunk bounds, 1774×887 8-bit opaque RGB header, image data/IEND, one retained C2PA `caBX` chunk, and the embedded `c2pa`, `gpt-image`, `OpenAI Media Service API`, and `trainedAlgorithmicMedia` markers.
8. Verifies the shipped and retained-source title PNGs remain byte-identical at their pinned byte count/SHA-256 and retain their 1672×941 opaque RGB structure and C2PA generation markers; it also pins the complete app-icon SVG bytes/hash and accessible project identity.
9. Verifies the Barlow Condensed 700/900 Latin WOFF2 files and complete SIL OFL 1.1 text by exact byte count/SHA-256, WOFF2 signature, copyright marker, and license marker.

The pinned validator reports zero errors. It emits two warnings and three informational notices because that validator build does not understand KTX2 image MIME data or the Meshopt/Basis extensions. The verifier allowlists those five exact code/pointer pairs and fails on any additional issue.

## Runtime loader

`src/game/assets/compressedAssetLoader.ts` configures `GLTFLoader` with `MeshoptDecoder` and a renderer-detected `KTX2Loader`. `GameEngine` loads the GLB asynchronously, swaps the player visual after a successful decode, and keeps the procedural bike visible with an explicit caption if loading fails.

```ts
import {
  createCompressedAssetLoader,
  FESTIVAL_TRAIL_BIKE_URL,
} from "../assets/compressedAssetLoader";

const assetLoader = createCompressedAssetLoader(renderer);
const gltf = await assetLoader.load(FESTIVAL_TRAIL_BIKE_URL);
gltf.scene.position.set(0, 0, 0);
scene.add(gltf.scene);

// When the owning scene is disposed:
assetLoader.dispose();
```

The GLB declares both compression extensions as required and has no PNG fallback. Browsers without an available compressed GPU target are handled by Three.js/Basis transcoding. Asset-load failure leaves the project's own procedural bike active and surfaces a temporary status caption.

The Canyon/tutorial panorama is generated production art, not an `assets:build` output. Its prompt brief, reference roles, source inspection, rights classification, and open human-review gates are recorded in `docs/design/PRODUCTION_ART_PROVENANCE.md` and `ASSET_LICENSES.md`. `GameEngine` loads it through a bounded `ImageBitmapLoader`, decodes quality-appropriate sizes, applies a responsive centered cover crop as a 2D scene background, and retains the generated sky if loading is unavailable, rejected, canceled, or late. The texture and bitmap are engine-owned presentation resources and never enter simulation or lighting authority.

Playwright regression source covers successful integrated asset/offline loading plus explicit bike and panorama failure fallbacks. Those browser checks are currently paused and therefore provide no current-candidate pass. The permitted 2026-07-15 10:26:16–10:26:21 CEST normal build passed the current build-time contracts for the exact 3D manifest and directory, KTX2 header and embedded-byte comparison, Meshopt decode, Canyon panorama byte/PNG/provenance markers, shipped/source title-art identity, app-icon identity, bundled-font files, and retained font license; strict TypeScript compilation and production bundling also completed. That scoped build evidence does not prove browser rendering, offline behavior, failure fallbacks, cryptographic C2PA validity, visual acceptance, or additional physical device/GPU combinations, which remain open in the documented QA matrix.

## Dependencies and licenses

| Package/component | Pinned version | License | Distribution role |
|---|---:|---|---|
| `@gltf-transform/core` | 4.4.1 | MIT | Build only |
| `@gltf-transform/extensions` | 4.4.1 | MIT | Build/verification only |
| `@gltf-transform/functions` | 4.4.1 | MIT | Build only |
| `ktx2-encoder` | 0.5.3 | MIT | Build only; wraps Basis Universal encoder WASM |
| Basis Universal encoder WASM in `ktx2-encoder` | packaged with 0.5.3 | Apache-2.0 | Build only |
| `meshoptimizer` | 1.2.0 | MIT | Build and verification only |
| `gltf-validator` | 2.0.0-dev.3.10 | Apache-2.0 | Verification only |
| `three` | 0.185.1 | MIT | Primitive generation and runtime loaders |
| Basis Universal transcoder from Three.js examples | bundled with Three 0.185.1 | Apache-2.0 | Shipped runtime JS/WASM |

The copied Basis runtime directory includes its upstream README, a full Apache-2.0 license text, and the required readable upstream NOTICE. `THIRD_PARTY_NOTICES.md` aggregates repository-level attribution, while `ASSET_LICENSES.md` records the final shipped inventory and owner legal actions.
