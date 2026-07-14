# Asset and License Inventory

Source/static last audited: **2026-07-13T00:29:27+0200 (CEST)**

Audit scope: repository source and asset files, `package-lock.json`, stable visible image content, the final non-QA `dist/`, `artifacts/release-manifest.json`, and installed-Chrome production-smoke evidence. Disposable output under `coverage/`, `test-results/`, `playwright-report/`, `.vite/`, old ignored `artifacts/performance/screenshots/` captures, and `artifacts/performance/latest-production-race.png` is not shipped and is excluded. The two final headed-performance captures and three production-smoke screenshots are retained and inventoried below.

Release use: this is a point-in-time provenance record, not legal advice. Any asset, dependency, or build change requires a new audit.

## Current disposition

| Area | Result |
|---|---|
| Shipped visual files | One OpenAI-generated title background, one project-authored SVG app icon, and one original repository-generated GLB with an embedded KTX2 texture |
| Documentation concepts | Four OpenAI-generated design concepts plus one byte-identical production-title source copy |
| 3D assets | An original Meshopt-compressed Festival Trail Bike GLB with an embedded BasisLZ/ETC1S KTX2 texture, plus original runtime-created Three.js world, rider, rival, scenery, obstacle, editor, and fallback geometry |
| Third-party runtime assets | Basis Universal transcoder JS/WASM copied from pinned Three.js 0.185.1, Apache-2.0; README, full license text, and upstream NOTICE attribution ship beside them |
| Audio assets | Runtime-created Web Audio oscillator/filter cues; no audio files and no streamed audio |
| Fonts | Local/system font lookup only; no font files are stored or redistributed |
| Prohibited-brand scan | Zero source/static-scope, relative-path, or final production-bundle matches for the three expressly prohibited marks; see the separate local-folder caveat below |
| Credential scan | Zero known secret signatures and zero credential/key files in the audited repository and bundle |
| Trackers | No analytics or tracker domains/SDK identifiers found in application source or the bundle |
| Dependency vulnerabilities | `npm audit --audit-level=high --json`: 0 vulnerabilities across 320 lockfile package entries |
| Release bundle identity | Non-QA manifest passes: 21 files, 4,675,553 raw bytes, aggregate SHA-256 `d953ed1ed66f82a26043d3fbffe634ed8d35021edb8e90ee0f8f064567a70a97` |
| Clean install and installed tree | Final `npm ci` added 268 packages and audited 269 with 0 vulnerabilities; `npm ls --depth=0 --json` exits 0 with all 31 direct dependencies and no problems, missing entries, or extraneous packages |
| Commercial-release gate | **Open** for owner legal/trade-dress review, owner-selected project licensing, generated-image account provenance, and the local-folder rename; the duplicate transcoder is an accepted RC1 P2 and the pinned CSP allowances are documented below |

## OpenAI-generated original project images

The five unique PNGs below were generated specifically for this project with OpenAI image generation. Each file contains embedded C2PA data identifying `gpt-image`, `OpenAI Media Service API`, `trainedAlgorithmicMedia`, and a `2026-07-11` creation date. The shipped title copy retains that data. The repository does not contain the generation prompts or account/session receipt, and no C2PA verification utility was available in the audit environment, so the embedded signature was detected but not independently cryptographically validated.

| Asset | Distribution | Dimensions / bytes | SHA-256 | Provenance and review |
|---|---|---:|---|---|
| `public/assets/art/title-background.png` | Shipped title-screen background | 1672×941 / 2,129,759 | `292ffdf20edcb4c483b30a5a4f6882f3ecbaf8ff1f28815d8fe28a9aeb6e3e78` | OpenAI-generated original project output; visually reviewed with no obvious third-party word mark, logo, character, or branded UI |
| `docs/design/concepts/title-background-production.png` | Provenance/design source; not separately shipped | 1672×941 / 2,129,759 | `292ffdf20edcb4c483b30a5a4f6882f3ecbaf8ff1f28815d8fe28a9aeb6e3e78` | Byte-identical source copy of the shipped title background |
| `docs/design/concepts/campaign-menu.png` | Design reference only | 1672×941 / 2,264,323 | `01bc8b96b7b2dab8012c51daf2c4c9ac024fd14adb0b1c559e3f562ae184c6a9` | OpenAI-generated original project output; contains only the approved project identity and project-created track names |
| `docs/design/concepts/gameplay-desktop.png` | Design reference only | 1672×941 / 2,522,777 | `6812dd95d0047a5127d4cd7c233c1617eb09460679462a7571d4c335fe499a30` | OpenAI-generated original project output; visual review found no obvious prohibited branding |
| `docs/design/concepts/gameplay-mobile.png` | Design reference only | 941×1672 / 2,407,870 | `1a084cd1b965e4ab6f72d1ce65053910998355aa8568eee3372854ba099ea36e` | OpenAI-generated original project output; visual review found no obvious prohibited branding |
| `docs/design/concepts/track-builder.png` | Design reference only | 1672×941 / 2,099,968 | `0857516d98e8220988705f9fa68233f057f5b6ed2028fbfbeb951492e6e41fff` | OpenAI-generated original project output; visual review found no obvious prohibited branding |

Rights basis: the project classifies these files as original OpenAI outputs, not third-party stock assets. The current [OpenAI Europe Terms of Use](https://openai.com/policies/eu-terms-of-use/) and [OpenAI Services Agreement](https://openai.com/policies/services-agreement/) state that, as between the user/customer and OpenAI and to the extent permitted by law, the user/customer owns Output. They also state that output may not be unique and place responsibility for evaluating its appropriateness on the user/customer. The owner must confirm which agreement governed the generating account and complete final similarity, trademark, trade-dress, and copyright review before commercial release.

If the production PNG is optimized or converted later, retain its SHA-256/provenance record and a source copy because conversion may remove C2PA metadata.

## Other original project assets and content

| Asset or system | Paths | Source / license classification | Distribution notes |
|---|---|---|---|
| App helmet mark | `public/assets/icons/app-icon.svg`; matching inline helmet in `src/ui/screens/MenuScreens.tsx` | Original project-authored vector paths; project-owned code/art, subject to the repository's eventual owner-selected code/content license | SVG ships; 477 bytes; SHA-256 `7d55e5fe2392a4d091f962e01e2a09dc6a21def5c1e9886a2bb39bb478f395a5` |
| Inline UI icons and CSS art | `src/ui/screens/MenuScreens.tsx`; `src/styles.css` | Original project-authored SVG/CSS geometry and palette; no external icon set | Compiled into JS/CSS |
| Procedural 3D world, rivals, rider, scenery, obstacles, editor previews, and player fallback | `src/game/engine/GameEngine.ts`; `src/ui/editor/EditorScene.ts` | Original project-authored composition using Three.js primitives, code-defined colors/materials, flat shading, instancing, and per-instance colors | The procedural player bike is named as a fallback, remains visible while the GLB loads, and remains active with an explicit status caption if loading fails |
| Generated Festival Trail Bike | `scripts/build-3d-assets.mjs`; `public/assets/3d/festival-trail-bike.glb`; `public/assets/3d/festival-bike-albedo.ktx2` | Original project-authored procedural primitive composition and code-generated 128×128 festival-bolt albedo; no source model, source image, downloaded art, or reference image | The GLB replaces only the player bike visual after successful asynchronous decode; details and hashes are recorded below |
| Runtime audio cues | `src/game/audio/AudioManager.ts` | Original project-authored Web Audio oscillators, generated noise, gains, and filters for engine, wind, terrain, music pulses, UI, landing, crash, cooling, overheat, checkpoint, finish, and crowd cues | No WAV, MP3, OGG, M4A, or streamed audio |
| Campaign tracks, palettes, writing, obstacle layouts, editor modules, and examples | `src/game/content/tracks.ts`; `src/game/editor/modules.ts`; `src/game/editor/examples.ts` | Original project-authored code/data and writing | Compiled into the game bundle; no copied course files are present |
| Font selection | `src/styles.css` | `local("Arial Narrow Bold")`, `local("Avenir Next Condensed Heavy")`, `local("Impact")`, plus `Inter`, `Arial Narrow`, UI-rounded, monospace, and system fallbacks | No font bytes are stored or shipped. Rendering depends on fonts already licensed with the user's/end user's operating system. Re-audit before bundling any webfont. |

The GLB and KTX2 files listed below are the only standalone model/texture formats in the audited source tree. No standalone shader, audio, or font files were found. The SVG XML namespace is a format declaration, not an external asset request.

## Original 3D asset pipeline and third-party transcoder

`scripts/build-3d-assets.mjs` deterministically builds the low-poly **Festival Trail Bike** from Three.js box, cylinder, and icosahedron primitives and creates its albedo pixel-by-pixel. The generated glTF metadata identifies it as an original procedural project asset and records the generator. `docs/ASSET_PIPELINE.md` documents the rebuild, verification, and integration workflow.

| File | Role and provenance | Bytes | SHA-256 | License/classification |
|---|---|---:|---|---|
| `public/assets/3d/festival-trail-bike.glb` | Runtime player-bike GLB; original generated geometry with the KTX2 embedded | 15,172 | `a748123dff38f90dbd29c476244cbffe8fe93d7c8a20de909e6c040af52d2123` | Original project asset |
| `public/assets/3d/festival-bike-albedo.ktx2` | Standalone inspection copy, byte-identical to the GLB's embedded texture | 2,236 | `a86588924b53fd51915d505d0ba23e343ac3e84a5139c687845a49f8ad8a1ba2` | Original project asset |
| `public/assets/3d/asset-manifest.json` | Generated provenance, compression, dependency, file-size, and hash record | 3,369 | `87c6d72dc21cbbb7a6700f2e8d245b2489b224ef8a130762e162c187c4ac3296` | Project metadata |
| `public/assets/transcoders/basis/basis_transcoder.js` | Runtime Basis Universal transcoder wrapper copied from Three.js 0.185.1 examples | 57,529 | `8478b5b6d6b74e7d3082b89f6417321d8d1dc0307f2b30d4484bb11b441696a1` | Apache-2.0 |
| `public/assets/transcoders/basis/basis_transcoder.wasm` | Runtime Basis Universal transcoder copied from Three.js 0.185.1 examples | 527,333 | `6cf17dc889352c42e9acf8897107978d127005fe3386c36a0e3845e27967630a` | Apache-2.0 |
| `public/assets/transcoders/basis/README.md` | Upstream Three.js Basis usage/provenance README | 1,388 | `a578df416c1e0852e9c36a1cf91b4d28d91a251294f87ce610a3bc7ca4df15e0` | Documentation distributed with transcoder |
| `public/assets/transcoders/basis/LICENSE.txt` | Full Apache License 2.0 text; exact upstream bytes preserved by the repository's `-text -diff` attribute | 9,197 | `a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47` | Apache-2.0 license text |
| `public/assets/transcoders/basis/NOTICE.txt` | Reproducibly generated readable copy of upstream Basis attribution | 917 | `42beeb6710c933778e30f62886e0790ebba120debbb0545ab46c7292d3e5a061` | Apache-2.0 §4(d) NOTICE |
| **Generated public pipeline total** | All eight files above | **617,141** | — | Mixed original project asset / Apache-2.0 runtime component |

`npm run assets:verify` passed against this snapshot. It found 12 Meshopt-compressed buffer views; required `EXT_meshopt_compression`, `KHR_mesh_quantization`, and `KHR_texture_basisu`; independently decoded 22 nodes, 9 meshes, 6 materials, and one texture; and confirmed a 128×128 ETC1S/BasisLZ KTX2 with BT.709 primaries, sRGB transfer, and eight nonempty in-bounds mip levels. Meshopt reduced the generated GLB from 22,076 to 15,172 bytes (31.3%). The pinned Khronos validator reported zero errors. Its two warnings and three informational notices are exact allowlisted limitations of that older validator's Meshopt/KTX2 support, not unreviewed validator output. A production preview returned HTTP 200 with the expected byte count and MIME type for the GLB, transcoder JS, transcoder WASM, and NOTICE. A real GPU transcode/render remains **UNVERIFIED** by this asset audit.

`src/game/assets/compressedAssetLoader.ts` configures `GLTFLoader` with Three.js's Meshopt decoder and a renderer-detected `KTX2Loader`. `GameEngine` loads `/assets/3d/festival-trail-bike.glb` asynchronously, hides the original procedural player-bike visual only after successful decoding, and keeps the procedural bike active with a visible caption if the asset fails. The rider, rivals, and world remain original procedural geometry.

The loader uses stable same-origin paths `/assets/3d/festival-trail-bike.glb` and `/assets/transcoders/basis/`. Service-worker cache `rivet-ridge-rally-shell-v7` precaches the GLB plus `basis_transcoder.js` and `basis_transcoder.wasm`; activation deletes only obsolete caches carrying the app-owned `rivet-ridge-rally-` prefix. The standalone KTX2 is not a separate runtime request because the same bytes are embedded in the GLB. Runtime cache messages and fetch handling reject cross-origin URLs. The HTML CSP permits the required same-origin fetches, WebAssembly compilation (`'wasm-unsafe-eval'`), and blob worker (`worker-src 'self' blob:`) used by the transcoder.

The stable public transcoder pair is intentionally retained for explicit same-origin/offline paths. Three.js's `KTX2Loader` also contains static default transcoder URL imports, so Vite emits an additional hashed JS/WASM pair even though the configured loader selects the stable public pair. The two pairs are byte-identical by SHA-256. This creates an intentional **584,862-byte raw duplicate** (57,529 JS + 527,333 WASM) and makes the pipeline's current production-bundle footprint **1,202,003 raw bytes** including generated metadata, standalone inspection KTX2, README, license, and NOTICE. The duplicate is accepted for `1.0.0-rc.1` as a known P2 because it preserves stable same-origin/offline paths and remains below the initial-asset budget; later bundler/loader optimization may remove it, but any change must preserve offline behavior and Apache-2.0 notices.

The current CSP retains `'unsafe-eval'` for the pinned Basis Emscripten/embind wrapper and inline styles for controlled React layout values. `connect-src` has been narrowed to same-origin and `blob:`; it no longer permits WebSocket origins.

## Derived QA screenshots

These are browser-generated captures of the project UI. They are non-shipped test and visual-review evidence derived from the project assets above, not independent source art. The stable set contains seven versioned Playwright baselines, ten curated five-track review captures, two final headed-performance captures, and three installed-Chrome production-smoke screenshots: 22 authoritative derived images in total.

| Path | Dimensions / bytes | SHA-256 |
|---|---:|---|
| `e2e/core-flow.spec.ts-snapshots/title-screen-chromium-darwin.png` | 1280×720 / 1,024,585 | `419ddeb5c8216c367e3533309384be229005df1fa9eb971d6e40235519408977` |
| `e2e/core-flow.spec.ts-snapshots/title-screen-firefox-darwin.png` | 1280×720 / 1,274,757 | `586281f495866f39b7fce0359c788464f356b4b938f6dcd0022333be0b16490d` |
| `e2e/core-flow.spec.ts-snapshots/title-screen-webkit-darwin.png` | 1280×720 / 1,359,113 | `c6f96cd2b287a9f1eeb721beab61d8ef991f00e07ef51f6a50f7b2248b190329` |
| `e2e/visual-regression.spec.ts-snapshots/editor-screen-chromium-darwin.png` | 1280×720 / 265,032 | `1faa26a1a2ac7a95be8f656a8494ea8d1cbd08c73c265db39e9dbd3818511fc1` |
| `e2e/visual-regression.spec.ts-snapshots/race-high-contrast-chromium-darwin.png` | 1280×720 / 525,040 | `51ffea80953e438785d6d08e9050c463ad27229a820e21f13fca7a7d5ff808ca` |
| `e2e/visual-regression.spec.ts-snapshots/race-mobile-mobile-chrome-darwin.png` | 412×839 / 222,377 | `fdfb4f75bae76c7e5cf5ac7a3c29f3cc37e12967cbc3590565e544d907aa3083` |
| `e2e/visual-regression.spec.ts-snapshots/race-screen-chromium-darwin.png` | 1280×720 / 546,220 | `54185a7115b57e08e3ae33a2acd471ee05589863ab205afe64121d3fa98b053c` |
| `artifacts/visual-review/canyon-kickoff.png` | 1280×720 / 637,423 | `014eb572a87654ce82586e38f6776dde91dc88c07d61c734438c8db22929bfef` |
| `artifacts/visual-review/coastline-clash.png` | 1280×720 / 608,941 | `a5a53469c6a2c3df6dd164dec37c7d066f31d5cd1433a0395ef3446acd10e50e` |
| `artifacts/visual-review/foundry-flight.png` | 1280×720 / 654,347 | `ca1447bcb06e0e0a0f4549bbdca92524ff8f1aeae83f8e5bf4be90a092a0c0ed` |
| `artifacts/visual-review/pine-run.png` | 1280×720 / 648,066 | `55cb51fc746905a37b33ab7e093b7f75f4b84d5752ee07c0fb7491a53353f325` |
| `artifacts/visual-review/summit-showdown.png` | 1280×720 / 639,522 | `6f358372cd6ac5e3fe456aa6874ed06d3f81cad86dabfa119cf130b11879c7f3` |
| `artifacts/visual-review/midcourse/canyon-kickoff.png` | 1280×720 / 645,964 | `a0322dbc72a54cc36ecfab591f7d6839006bb7d2961da0cfea983772e03e10a0` |
| `artifacts/visual-review/midcourse/coastline-clash.png` | 1280×720 / 591,122 | `4c43c5111876281d8c943fd6927b8918d164b769107b35fca4dc3d341046230b` |
| `artifacts/visual-review/midcourse/foundry-flight.png` | 1280×720 / 625,158 | `e0b202ae25168820f4b395199e923bc22cc737492e195ed35eb4b46d63e8a322` |
| `artifacts/visual-review/midcourse/pine-run.png` | 1280×720 / 638,339 | `9152c9b2f3df3d901fb4b8939b01d9bf1a78ac77e39a1f7ef2882b0bb8fbe930` |
| `artifacts/visual-review/midcourse/summit-showdown.png` | 1280×720 / 623,082 | `5fad02233326eb1d935cbe030aa6a65664d5b57dab329b3307005ba006ba9f5b` |
| `artifacts/performance/headed-screenshots/desktop-1920x1080.png` | 1920×1080 / 1,032,848 | `c9120b4a2e9dfbbdc8c6045b7fb6292c7576d93461e4385c91eade87dd577b94` |
| `artifacts/performance/headed-screenshots/mobile-390x844.png` | 780×1688 / 516,155 | `51285ec02ce0649e09908c7d192ad686dd98a1022d285daf8cbeae4b196cdf0a` |
| `artifacts/production-smoke/chrome-race.png` | 1440×900 / 624,504 | `290c8eabcf25b4c3da0fb4b516cb05d7af52693442cea96ab57b7fd9ee6794a4` |
| `artifacts/production-smoke/chrome-editor.png` | 1440×900 / 320,151 | `d8ce0ac4c9fc2678db06b2ae0d75200291d691bc8b779c7999c391d7f9bbca07` |
| `artifacts/production-smoke/chrome-offline-title.png` | 1440×900 / 1,382,789 | `05c0d42a5882effed4a9c7637d240a1e0ec3ed025a599edae3f1f0d8b56183e5` |

The mobile headed capture is a 390×844 CSS-pixel viewport at device-pixel ratio 2, hence its 780×1688 stored dimensions. The three production-smoke images correspond to the race, editor, and service-worker-controlled offline-title checkpoints in `artifacts/production-smoke/chrome-smoke.json`. The ignored older performance captures named in the audit scope and transient media attached to failed Playwright reports are not authoritative visual assets and are not counted in the 22-image set.

## Direct dependency licenses

Versions are exact values from `package.json` and the installed package manifests. `package-lock.json` is 165,779 bytes with SHA-256 `43dfce57099cd11a1081d10286578d47e0126e839ffe8c9deac2fe628430e5d3` at audit time.

### Runtime dependencies

| Package | Version | Declared license |
|---|---:|---|
| `dexie` | 4.4.4 | Apache-2.0 |
| `react` | 19.2.7 | MIT |
| `react-dom` | 19.2.7 | MIT |
| `three` | 0.185.1 | MIT |
| `zod` | 4.4.3 | MIT |
| `zustand` | 5.0.14 | MIT |

### Development dependencies

| Package | Version | Declared license |
|---|---:|---|
| `@axe-core/playwright` | 4.12.1 | MPL-2.0 |
| `@eslint/js` | 10.0.1 | MIT |
| `@gltf-transform/core` | 4.4.1 | MIT |
| `@gltf-transform/extensions` | 4.4.1 | MIT |
| `@gltf-transform/functions` | 4.4.1 | MIT |
| `@playwright/test` | 1.61.1 | Apache-2.0 |
| `@types/node` | 26.1.1 | MIT |
| `@types/react` | 19.2.17 | MIT |
| `@types/react-dom` | 19.2.3 | MIT |
| `@types/three` | 0.185.1 | MIT |
| `@vitejs/plugin-react` | 6.0.3 | MIT |
| `@vitest/coverage-v8` | 4.1.10 | MIT |
| `axe-core` | 4.12.1 | MPL-2.0 |
| `eslint` | 10.7.0 | MIT |
| `eslint-plugin-react-hooks` | 7.1.1 | MIT |
| `eslint-plugin-react-refresh` | 0.5.3 | MIT |
| `globals` | 17.7.0 | MIT |
| `gltf-validator` | 2.0.0-dev.3.10 | Apache-2.0 |
| `jsdom` | 29.1.1 | MIT |
| `ktx2-encoder` | 0.5.3 | MIT |
| `meshoptimizer` | 1.2.0 | MIT |
| `typescript` | 6.0.3 | Apache-2.0 |
| `typescript-eslint` | 8.63.0 | MIT |
| `vite` | 8.1.4 | MIT |
| `vitest` | 4.1.10 | MIT |

The `ktx2-encoder` package is MIT-licensed and bundles a build-time Basis Universal encoder WASM derived from the Apache-2.0 Basis project. That encoder does not ship in the browser bundle. The generated manifest records both layers. `meshoptimizer` and the glTF Transform packages are build/verification tools; Three.js supplies the runtime loaders and Meshopt decoder. `gltf-validator` is verification-only.

### Lockfile license summary

The 320 `node_modules/*` entries in `package-lock.json` declare the following licenses; none is undeclared:

| SPDX/license identifier | Package entries |
|---|---:|
| 0BSD | 1 |
| Apache-2.0 | 34 |
| Apache-2.0 AND LGPL-3.0-or-later | 3 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1 |
| BlueOak-1.0.0 | 2 |
| BSD-2-Clause | 8 |
| BSD-3-Clause | 6 |
| CC-BY-4.0 | 1 |
| CC0-1.0 | 1 |
| ISC | 14 |
| LGPL-3.0-or-later | 10 |
| MIT | 223 |
| MIT-0 | 2 |
| MPL-2.0 | 14 |

The CC-BY-4.0 entry is `caniuse-lite@1.0.30001805`, a transitive build/tooling dependency. MPL-2.0 entries are Axe and Lightning CSS packages/platform variants. The LGPL/composite entries are Sharp/libvips platform packages reached through `@gltf-transform/functions` → `ndarray-pixels` → `sharp`; they are asset-build tooling and do not appear in the browser bundle. Optional platform packages are counted even when not installed for the current platform.

Commercial distribution must preserve the notices and license texts required by the dependencies actually distributed. The Basis runtime directory now ships the Apache-2.0 text and a readable copy of the upstream [Basis Universal NOTICE](https://github.com/BinomialLLC/basis_universal/blob/master/NOTICE). Repository-level `THIRD_PARTY_NOTICES.md` is 2,398 bytes with SHA-256 `482f6031ca8d44717049d09a21b61ed9c746a35818adfdfb2dae52f10ec3be1e`; it describes the complete notice generated into each distribution and the direct runtime/build-tool classifications. The repository still has no root project `LICENSE`. Before release, counsel or the owner must select the project's own license and verify the final generated notice set covers the distributed dependency graph and applicable obligations.

A final clean `npm ci` completed successfully for this candidate under Node.js v26.4.0 and npm 11.17.0, adding 268 packages, auditing 269, and reporting zero vulnerabilities. The source/static audit reran `npm audit --audit-level=high --json` and confirmed zero vulnerabilities across the unchanged 320 lockfile entries. `npm ls --depth=0 --json` exits 0 and reports all 31 exact pinned direct dependencies with no `problems`, missing entries, or extraneous packages.

## Security, branding, and bundle evidence

### Prohibited terms and visual identity

- Case-insensitive byte scans of the source/static scope (excluding this audit's explanatory text and transient reports), relative repository paths, and the final non-QA production bundle for the three expressly prohibited marks returned **zero matches**.
- Human visual review of the five unique generated source PNGs, app icon, and current editor/race reference screenshots found no obvious prohibited word mark, logo, recognizable third-party character, or branded interface. This is not a professional trademark/trade-dress clearance.
- The local filesystem workspace **folder basename**, which is outside repository file contents, contains one prohibited legacy working-name reference. Its exact basename SHA-256 is `e83a1efd6ab7bb53c35814b7b538070611cb6e07fdc5121f19d307ca4bded3b8`; the name itself is intentionally not repeated in this file. It does not appear in relative repository paths or `dist/`. Rename that local folder before public builds, support logs, source maps, CI records, screenshots, or provenance exports can expose absolute paths.

### Credentials and secrets

- Source/config/docs/assets (excluding this audit's explanatory text) and final `dist/` scans found no AWS access-key signatures, private-key headers, GitHub/OpenAI/Slack/Google token signatures, Stripe live-secret signatures, or JWT-like bearer values.
- No `.env`, PEM, key, PKCS#12, certificate, or source-map files are present in the audited source tree or production bundle.
- The release source is committed on `main` and identified by annotated tag `v1.0.0-rc.1`. A complete single-commit history/deletion scan found no prohibited marks, absolute home paths, credential files, or known secret signatures.

### Network, CSP, offline, and tracker behavior

- The final non-QA bundle contains 13 literal `fetch(...)` call sites: four service-worker calls, three Three.js loader calls, one embedded-`data:` Meshopt initialization in the game-view chunk, one Vite module-preload call in the main chunk, and two in each of the byte-identical Basis wrappers. Four `XMLHttpRequest` tokens are confined to the Basis wrappers' environment/file fallback code. No WebSocket or EventSource construction and no `sendBeacon` call is present.
- Application-authored network code is confined to the service worker's four calls and enforces same-origin GET/cache URLs. The application supplies same-origin or embedded-data inputs to the remaining library loaders; no application call site targets an external host.
- Service-worker install precaches the stable GLB and both stable Basis transcoder files. It also discovers hashed entry assets from `index.html`; after first load the application warms lazy race/editor chunks and asks the worker to cache only resource URLs whose origin equals `window.location.origin`.
- Navigation falls back to cached `/index.html`; other same-origin GETs are cache-first and added to the runtime cache after successful network responses. Cross-origin and non-GET requests are ignored by the service worker.
- The meta CSP allows `default-src 'self'`, same-origin/blob connections, self/blob workers, WebAssembly compilation, and the current image sources. The remaining `'unsafe-eval'` and inline-style allowances are justified above; external HTTP and WebSocket origins are not allowed. Meta CSP cannot enforce `frame-ancestors`, so deployment still requires the HTTP framing control documented in `docs/OPERATIONS.md`.
- Application and bundle scans found zero known analytics/tracker domains or SDK imports for Google Analytics/Tag Manager, Segment, Mixpanel, Amplitude, PostHog, Sentry, Datadog, Hotjar, Meta/Facebook, DoubleClick, FullStory, New Relic, Clarity, Plausible, Matomo, or Heap. Three plain `doubleclick` text matches are React `onDoubleClick`/DOM event names, not tracker code.
- External URL literals remain inside third-party diagnostics, schema/reference text, shipped license/README/notice metadata, SVG/XML namespaces, and PNG C2PA/IPTC provenance metadata. Their normalized hosts and occurrence counts are `bit.ly` (1), `ca.trufo.ai` (2), `cv.iptc.org` (1), `gamma.cs.unc.edu` (1), `github.com` (3), `jcgt.org` (1), `json-schema.org` (3), `ocsp.trufo.ai` (2), `react.dev` (2), `tinyurl.com` (1), `trufo.ai` (1), `www.apache.org` (5), and `www.w3.org` (21). No application call site targets them; loading the files does not execute those URLs.

The game runs without accounts and no application analytics or third-party tracking was found.

### Production bundle snapshot

The final non-QA production build contains 21 files. `artifacts/release-manifest.json` records 4,675,553 raw bytes and aggregate SHA-256 `d953ed1ed66f82a26043d3fbffe634ed8d35021edb8e90ee0f8f064567a70a97`. Sizes and hashes below were independently rechecked against `dist/`; gzip is the sum of independent level-9 gzip results and is not a claim about a particular host's transfer configuration.

| Output | Raw bytes | Level-9 gzip bytes | SHA-256 |
|---|---:|---:|---|
| `dist/THIRD_PARTY_NOTICES.txt` | 38,475 | 6,881 | `c959caf9bfbb3d9b051921453e8a19132c1b40fec2ef3f3db41676d3492f84a1` |
| `dist/assets/3d/asset-manifest.json` | 3,369 | 1,212 | `87c6d72dc21cbbb7a6700f2e8d245b2489b224ef8a130762e162c187c4ac3296` |
| `dist/assets/3d/festival-bike-albedo.ktx2` | 2,236 | 1,935 | `a86588924b53fd51915d505d0ba23e343ac3e84a5139c687845a49f8ad8a1ba2` |
| `dist/assets/3d/festival-trail-bike.glb` | 15,172 | 5,667 | `a748123dff38f90dbd29c476244cbffe8fe93d7c8a20de909e6c040af52d2123` |
| `dist/assets/GameView-BCKA6P4v.js` | 210,084 | 70,108 | `6ed6d576b3977b1bba295bed2c303864ec48a90d99e40af8bacbd1fee317b261` |
| `dist/assets/TrackEditorScreen-BMHZkMEk.js` | 36,510 | 12,007 | `139ed12b9ca6b81e4c303c04979bafbf213d3ad712571678b201a688caa1bdc2` |
| `dist/assets/art/title-background.png` | 2,129,759 | 2,115,848 | `292ffdf20edcb4c483b30a5a4f6882f3ecbaf8ff1f28815d8fe28a9aeb6e3e78` |
| `dist/assets/basis_transcoder-VXdx5NbI.wasm` | 527,333 | 244,553 | `6cf17dc889352c42e9acf8897107978d127005fe3386c36a0e3845e27967630a` |
| `dist/assets/basis_transcoder-o4Hde_L7.js` | 57,529 | 15,063 | `8478b5b6d6b74e7d3082b89f6417321d8d1dc0307f2b30d4484bb11b441696a1` |
| `dist/assets/icons/app-icon.svg` | 477 | 318 | `7d55e5fe2392a4d091f962e01e2a09dc6a21def5c1e9886a2bb39bb478f395a5` |
| `dist/assets/index-7zkWWQtB.js` | 412,688 | 125,179 | `d570a23afbca97d7adbe1b655144c843fcae3f8934cb6a1550edfcb85dd8a44f` |
| `dist/assets/index-BsX4JgSA.css` | 46,626 | 11,398 | `9d64c238523852beb44564f2dccab719d82ee3ff2190db1bb833be582ec73377` |
| `dist/assets/three.module-CYIrST_y.js` | 594,445 | 148,047 | `6bcd6a28bbc79094de211f66796594a97f7ed51dc61775c2fcc800dfe633cf07` |
| `dist/assets/transcoders/basis/LICENSE.txt` | 9,197 | 3,331 | `a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47` |
| `dist/assets/transcoders/basis/NOTICE.txt` | 917 | 514 | `42beeb6710c933778e30f62886e0790ebba120debbb0545ab46c7292d3e5a061` |
| `dist/assets/transcoders/basis/README.md` | 1,388 | 702 | `a578df416c1e0852e9c36a1cf91b4d28d91a251294f87ce610a3bc7ca4df15e0` |
| `dist/assets/transcoders/basis/basis_transcoder.js` | 57,529 | 15,063 | `8478b5b6d6b74e7d3082b89f6417321d8d1dc0307f2b30d4484bb11b441696a1` |
| `dist/assets/transcoders/basis/basis_transcoder.wasm` | 527,333 | 244,553 | `6cf17dc889352c42e9acf8897107978d127005fe3386c36a0e3845e27967630a` |
| `dist/index.html` | 1,176 | 570 | `f2f858f3ff6c108abe4c58338e9dff04440ee3374e03be48cd8b35b08a753a4f` |
| `dist/manifest.webmanifest` | 398 | 253 | `21b481ea561e62e306da2072d94e87f31f83839042dc95ffc50bdb3a8d33c712` |
| `dist/sw.js` | 2,912 | 1,128 | `daa43f5ba6755dff80e5ea128af9f85961cb0758dd68a4961952dcd7efdbb8e0` |
| **Total** | **4,675,553** | **3,024,330** | Manifest aggregate above |

The generated GLB, KTX2, asset manifest, both transcoder pairs, README, license, NOTICE, title PNG, icon, and service worker in `dist/` are byte-identical to their inventoried public sources. The four non-production concept PNGs and all 22 authoritative derived QA/smoke captures are absent from `dist/`. Independent scans found zero source maps, QA runtime/build markers, local `/Users/` path bytes, or prohibited workspace-basename bytes. The complete raw bundle and summed gzip snapshot are below the 12 MB initial-asset target. Actual initial transfer is lower because race/editor code is lazy and the standalone KTX2, asset manifest, and notices are not application runtime requests, but browser network evidence—not this table—is authoritative for transfer behavior.

## Required owner actions before commercial release

1. Complete professional visual/trademark/trade-dress review of the shipped title art, icon, generated and procedural bikes/riders, track layouts, and approved project identity.
2. Confirm the OpenAI account/agreement under which each generated PNG was created and archive prompt/session or generation-receipt evidence outside the public build.
3. Rename the local workspace folder to a neutral approved project name.
4. Add the owner-selected project `LICENSE` and have counsel or the owner verify the existing shipped Basis NOTICE plus `THIRD_PARTY_NOTICES.md` against the final distributed dependency graph.
5. Preserve the accepted duplicate-transcoder P2 in release notes and backlog; any future removal requires verified offline startup and an updated inventory.
6. Revalidate the documented Basis `'unsafe-eval'` and controlled inline-style CSP allowances whenever the transcoder or UI build changes.
7. Repeat the clean-install audit, prohibited-term, secret, network/tracker, bundle, and visual scans for any source, dependency, asset, or distribution change after annotated tag `v1.0.0-rc.1`.
8. Update this file before adding or changing any model, texture, audio, font, icon, image, marketing capture, or third-party content.
