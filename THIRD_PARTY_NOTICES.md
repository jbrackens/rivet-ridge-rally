# Third-Party Notices

RIVET RIDGE RALLY includes open-source runtime components. Exact dependency versions are pinned in `package-lock.json`; asset provenance is recorded in `ASSET_LICENSES.md` and the hero, rival, and Canyon manifests at `public/assets/3d/asset-manifest.json`, `public/assets/rivals/asset-manifest.json`, and `public/assets/canyon/asset-manifest.json`.

## Shipped distribution notice

`npm run build` deterministically writes `dist/THIRD_PARTY_NOTICES.txt`. Before writing, the generator requires every exact `package.json` runtime dependency to have exactly one same-version `runtime-dependency` inventory entry and rejects stale, missing, duplicate, or non-exact declarations. It retains explicit classifications for embedded runtime packages, vendored decoders, and the shipped font, verifies expected installed versions, and includes each component name, version, classification, declared license, use, source file, and complete license/notice text.

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
| KTX-Parse | 1.1.0 installed license source; Three.js embedded runtime self-identifies as v1.0.1 | MIT |
| zstddec | 0.2.0, embedded by Three.js | MIT and BSD-3-Clause |
| Basis Universal transcoder | bundled with Three.js 0.185.1 | Apache-2.0 LICENSE and NOTICE |
| Barlow Condensed | Google Fonts v13 static Latin subsets, weights 700 and 900 | SIL Open Font License 1.1 |

The installed package licenses are read directly from `node_modules`. Three.js's embedded KTX-Parse module self-identifies as v1.0.1; the installed v1.1.0 package supplies the unchanged MIT license text and is inventoried separately from that embedded runtime identity. Three.js embeds `zstddec` without installing its package, so its exact upstream `0.2.0` license is preserved at `docs/licenses/zstddec-0.2.0-LICENSE.txt`; `docs/licenses/README.md` records the registry archive, archive hash, upstream member, and local-file hash. Basis license and NOTICE text come from the shipped `public/assets/transcoders/basis` inventory. Barlow Condensed comes from the official Google Fonts distribution; its complete upstream OFL text is preserved at `docs/licenses/barlow-condensed-OFL-1.1.txt` and included verbatim in the generated distribution notice.

`npm run release:manifest` refuses to certify ambient output. It captures clean `HEAD`, reads/revalidates package, lock, and Node inputs in a detached checkout, preserves the exact annotated tag object/type, and resolves the npm launcher to pinned `npm` package metadata and canonical `bin/npm-cli.js`. A deterministic full-package-tree digest covers the root, directories, regular file bytes, and safe internal relative symlinks while exposing no absolute install path; unsafe links and special entries fail closed. Launcher and package-tree identity are rechecked after version/install/build, manifest creation, and cleanup. Empty npm user/global configs keep install scripts enabled, and unexpected ignored inputs fail at pre-install/post-install/post-build boundaries. The guard then accepts only regular files from its own sanitized non-QA build and applies notice/map/QA guards plus exact source/temp/worktree paths, common macOS/Linux/Windows home and file-URL markers, PEM private-key headers, and high-confidence live-token prefixes. Recursive fail-closed cleanup covers both `dist/` and file-or-directory sidecar output. This hardening and its fixture source remain **UNVERIFIED** until the paused checks resume.

## Source-only tools

Vite, TypeScript, ESLint, Vitest, Playwright, axe-core, jsdom, glTF Transform, `ktx2-encoder`, and other pinned build/test dependencies are not browser runtime code. Their license declarations and distribution classifications are inventoried in `ASSET_LICENSES.md`; any future distribution of source or tooling must preserve the obligations applicable to that artifact.

This notice does not license the original game code, art, audio, writing, or generated project assets. The owner must select the top-level product license and obtain final legal approval before commercial distribution.
