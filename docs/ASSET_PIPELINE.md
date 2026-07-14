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

Meshopt was selected instead of Draco because the mission permits Meshopt **or** Draco, and shipping both decoders for one small asset would add redundant runtime weight. The asset uses no downloaded model, stock texture, or reference image. Geometry and the 128×128 festival-bolt albedo are created entirely by `scripts/build-3d-assets.mjs`.

## Rebuild and verify

From a clean checkout with the pinned Node/npm versions available:

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
| Meshopt/KTX2 GLB | 15,172 | `a748123dff38f90dbd29c476244cbffe8fe93d7c8a20de909e6c040af52d2123` |
| Standalone ETC1S KTX2 | 2,236 | `a86588924b53fd51915d505d0ba23e343ac3e84a5139c687845a49f8ad8a1ba2` |
| Asset manifest | 3,369 | `87c6d72dc21cbbb7a6700f2e8d245b2489b224ef8a130762e162c187c4ac3296` |
| Basis transcoder JS | 57,529 | `8478b5b6d6b74e7d3082b89f6417321d8d1dc0307f2b30d4484bb11b441696a1` |
| Basis transcoder WASM | 527,333 | `6cf17dc889352c42e9acf8897107978d127005fe3386c36a0e3845e27967630a` |
| Basis README | 1,388 | `a578df416c1e0852e9c36a1cf91b4d28d91a251294f87ce610a3bc7ca4df15e0` |
| Apache-2.0 license | 9,197 | `a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47` |
| Basis NOTICE | 917 | `42beeb6710c933778e30f62886e0790ebba120debbb0545ab46c7292d3e5a061` |
| **Total generated pipeline files** | **617,141** | — |

The same KTX2 bytes are embedded in the GLB and emitted standalone for inspection. Meshopt reduces the GLB from 22,076 bytes to 15,172 bytes (31.3%). `npm run build` runs `assets:verify` automatically before TypeScript and Vite compilation.

The pinned Apache-2.0 license keeps its upstream CRLF bytes. A path-specific `-text -diff` Git attribute prevents checkout-time line-ending conversion from changing its recorded size or hash.

The generated manifest records byte sizes, SHA-256 hashes, formats, and tool licenses. Rebuilding twice on the same supported toolchain should produce identical hashes. Basis encoding is not promised to be byte-identical across different operating systems or encoder/WASM versions, so the package and lockfile remain pinned.

`assets:verify` performs four independent checks:

1. Parses the GLB container and asserts required Meshopt and Basis extensions.
2. Parses the KTX2 header and asserts 128×128 ETC1S/BasisLZ with eight mip levels.
3. Confirms the standalone KTX2 is byte-identical to the texture embedded in the GLB.
4. Runs Khronos `gltf-validator` and decodes the Meshopt GLB through glTF Transform.

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

Automated Chromium production-preview and offline-reload flows assert that the integrated GLB and transcoder load without the fallback caption, required-request failure, page error, or console error. Structural validation, KTX2 header validation, embedded-byte comparison, Meshopt decode, TypeScript compilation, and production bundling are also automated. Browser automation proves this host's GPU/software path; additional physical device/GPU combinations remain part of the documented hardware matrix.

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
