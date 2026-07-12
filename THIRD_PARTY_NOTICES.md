# Third-Party Notices

RIVET RIDGE RALLY includes open-source runtime components. Exact dependency versions are pinned in `package-lock.json`; asset provenance is recorded in `ASSET_LICENSES.md` and `public/assets/3d/asset-manifest.json`.

## Shipped distribution notice

`npm run build` deterministically writes `dist/THIRD_PARTY_NOTICES.txt`. The generator verifies the expected installed versions and includes each component name, version, declared license, use, source file, and complete license/notice text.

| Distributed component | Version/source | License text included |
|---|---|---|
| React | 19.2.7 | MIT |
| React DOM | 19.2.7 | MIT |
| Scheduler | 0.27.0 | MIT |
| Three.js | 0.185.1 | MIT |
| Zustand | 5.0.14 | MIT |
| Zod | 4.4.3 | MIT |
| Dexie | 4.4.4 | Apache-2.0 LICENSE and NOTICE |
| Meshoptimizer | 1.2.0 installed; runtime decoder embedded by Three.js reports upstream build 1.1 | MIT |
| KTX-Parse | 1.1.0 installed; runtime copy embedded by Three.js | MIT |
| zstddec | 0.2.0, embedded by Three.js | MIT and BSD-3-Clause |
| Basis Universal transcoder | bundled with Three.js 0.185.1 | Apache-2.0 LICENSE and NOTICE |

The installed package licenses are read directly from `node_modules`. Three.js embeds `zstddec` without installing its package, so its exact upstream `0.2.0` license is preserved at `docs/licenses/zstddec-0.2.0-LICENSE.txt`; `docs/licenses/README.md` records the registry archive, archive hash, upstream member, and local-file hash. Basis license and NOTICE text come from the shipped `public/assets/transcoders/basis` inventory.

`npm run release:manifest` refuses to certify a distribution if the generated notice is absent, a source map is present, the QA runtime marker is present, or local `/Users/` path bytes leaked into any file.

## Source-only tools

Vite, TypeScript, ESLint, Vitest, Playwright, axe-core, jsdom, glTF Transform, `ktx2-encoder`, and other pinned build/test dependencies are not browser runtime code. Their license declarations and distribution classifications are inventoried in `ASSET_LICENSES.md`; any future distribution of source or tooling must preserve the obligations applicable to that artifact.

This notice does not license the original game code, art, audio, writing, or generated project assets. The owner must select the top-level product license and obtain final legal approval before commercial distribution.
