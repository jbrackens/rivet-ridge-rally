# Asset and License Inventory

Historical RC1 source/static snapshot audited: **2026-07-13T00:29:27+0200 (CEST)**

Historical audit scope: the then-current repository source and asset files, `package-lock.json`, stable visible image content, non-QA `dist/`, `artifacts/release-manifest.json`, and installed-Chrome production-smoke evidence. Disposable output under `coverage/`, `test-results/`, `playwright-report/`, `.vite/`, old ignored `artifacts/performance/screenshots/` captures, and `artifacts/performance/latest-production-race.png` was not shipped and was excluded. The two headed-performance captures and three production-smoke screenshots retained below belong to that historical snapshot.

Release use: this is a point-in-time historical provenance record, not legal advice or qualification of the current candidate. The current candidate contains changed gameplay/visual/accessibility/responsive/persistence/race-gate/offline work, uses service-worker cache generation `rivet-ridge-rally-shell-v30`, and has not had its automated suite, official release manifest, manifest-bound production smoke, or complete source/static audit rerun. Its latest changes remain **UNVERIFIED**. Any asset, dependency, source, cache, or build change requires a new audit.

## Current disposition

| Area | Result |
|---|---|
| Shipped visual files | Two OpenAI-generated raster backgrounds, one project-authored SVG app icon, and one original repository-generated GLB with an embedded KTX2 texture |
| Documentation concepts | Four OpenAI-generated design concepts plus one byte-identical production-title source copy |
| 3D assets | An original Meshopt-compressed Festival Trail Bike GLB with an embedded BasisLZ/ETC1S KTX2 texture, plus original runtime-created Three.js world, rider, rival, scenery, obstacle, editor, and fallback geometry |
| Third-party runtime assets | Basis Universal transcoder JS/WASM copied from pinned Three.js 0.185.1 under Apache-2.0, plus two official Google Fonts Barlow Condensed Latin WOFF2 subsets under SIL OFL 1.1; complete required notices ship in `THIRD_PARTY_NOTICES.txt` |
| Audio assets | Runtime-created Web Audio oscillator/filter cues; no audio files and no streamed audio |
| Fonts | Barlow Condensed 700/900 Latin WOFF2 subsets are bundled for deterministic display/HUD/canvas typography; full SIL OFL 1.1 text, source URLs, bytes, and hashes are recorded below |
| Prohibited-brand scan | Historical snapshot had zero source/static-scope, relative-path, or production-bundle matches for the three expressly prohibited marks; the canonical workspace rename is now closed, and a current-candidate rescan remains required |
| Credential scan | **Historical audited snapshot:** zero known secret signatures and zero credential/key files in its audited repository and bundle; current-candidate rescan required |
| Trackers | **Historical audited snapshot:** no analytics or tracker domains/SDK identifiers found in its application source or bundle; current-candidate rescan required |
| Dependency vulnerabilities | **Historical audited snapshot:** `npm audit --audit-level=high --json` reported 0 vulnerabilities across 320 lockfile package entries; current-candidate audit not run |
| Release bundle identity | **Historical snapshots only:** `artifacts/history/release-manifest-1.0.0-rc.1-format-1.json` records 21 files / 4,675,553 raw bytes / aggregate SHA-256 `d953ed1ed66f82a26043d3fbffe634ed8d35021edb8e90ee0f8f064567a70a97`; `artifacts/history/release-manifest-1.0.0-rc.2-earlier-snapshot-format-1.json` records 21 files / 4,689,233 raw bytes / aggregate SHA-256 `6a55c00ea36debe543ab946dee06dc5fa73cf8a13d45b047aec399469c9931a3`. Neither matches or qualifies the current working candidate. |
| Earlier source-only revision | Per-tick world coupling, conflict-safe lane-binding migration, authored-Test-Ride panorama exclusion, complete fallback-bike silhouette, candidate-specific production-smoke bundles, and deterministic bundled typography are present in source. The two font subsets add one SIL OFL 1.1 obligation that is inventoried and included in generated notices. Runtime behavior and release-candidate qualification remain **UNVERIFIED**. |
| Clean install and installed tree | **Historical audited snapshot:** final `npm ci` added 268 packages and audited 269 with 0 vulnerabilities; `npm ls --depth=0 --json` exited 0 with all 31 direct dependencies and no problems, missing entries, or extraneous packages. Current-candidate install and tree checks were not run. |
| Commercial-release gate | **Open** for owner legal/trade-dress review, owner-selected project licensing, generated-image account provenance, and a complete current-candidate re-audit; the workspace rename is closed, while the duplicate transcoder remains a historical RC1 P2 and the pinned CSP allowances are documented below |

## OpenAI-generated original project images

The six unique PNGs below were generated specifically for this project with OpenAI image generation. Each file contains embedded C2PA data identifying `gpt-image`, `OpenAI Media Service API`, and `trainedAlgorithmicMedia`; the original five record a `2026-07-11` creation date and the canyon panorama records `2026-07-14`. The shipped files retain that data. The older five generation prompts and account/session receipts are not stored in the repository; the panorama's production brief, reference roles, source review, and integration constraints are retained in `docs/design/PRODUCTION_ART_PROVENANCE.md`. No C2PA verification utility was available in the audit environment, so the embedded signatures were detected but not independently cryptographically validated.

| Asset | Distribution | Dimensions / bytes | SHA-256 | Provenance and review |
|---|---|---:|---|---|
| `public/assets/art/title-background.png` | Shipped title-screen background | 1672×941 / 2,129,759 | `292ffdf20edcb4c483b30a5a4f6882f3ecbaf8ff1f28815d8fe28a9aeb6e3e78` | OpenAI-generated original project output; visually reviewed with no obvious third-party word mark, logo, character, or branded UI |
| `public/assets/art/canyon-festival-panorama.png` | Shipped Canyon/tutorial far-background layer | 1774×887 / 1,801,764 | `43b39c9075428e9bc081b3d8f216fae0027e889f89caa59586aa6097080b26a5` | Built-in OpenAI image generation using the two project gameplay concepts as style references; source inspection found layered original mesas/festival props and no road, rider, UI, text, logo, watermark, or obvious third-party branding; owner/legal similarity review and runtime acceptance remain open |
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
| Inline UI icons and CSS art | `src/ui/screens/MenuScreens.tsx`; `src/ui/game/TouchControlIcon.tsx`; `src/styles.css` | Original project-authored SVG/CSS geometry and palette; no external icon set | Compiled into JS/CSS; includes the cream lane-chevron, bike/pitch, Ride-bike/rider, and Turbo-turbine touch pictograms |
| Procedural 3D world, rivals, rider, scenery, obstacles, editor previews, and player fallback | `src/game/engine/GameEngine.ts`; `src/game/engine/CoursePresentationRoute.ts`; `src/ui/editor/EditorScene.ts` | Original project-authored composition using Three.js primitives, runtime CanvasTextures, code-defined colors/materials, flat shading, merged geometry, instancing, and per-instance colors | Includes the runtime fallback sky gradient; six-pivot procedural rider rigs; one project-authored `22`, `17`, `31`, `46`, `58`, or `73` CanvasTexture shared by each rider's jersey/rear plate; shared procedural knobby tread, brake, panel, and exhaust assemblies; separate deterministic non-color dirt-height canvas; shallow instanced lane-berm geometry; a C2 graded/laterally shaped presentation route and broad ground ribbon; vertex-colored/instanced authored high-contrast guides; distinct code-native Tabletop/Double Jump/Jump Chain/Bump Row/Offset Barrier/Sky Kicker runtime silhouettes; denser quality-bounded festival stands/crowds/service props; Pine roots/markers; Foundry panels/gantries; Summit finale equipment; deterministic bilateral Canyon cooling-gate venue pockets whose existing deck/canopy/post/spectator instances form staffed elevated watchtowers; one quality-tier instanced cream/coral/teal safety-wall batch covering both Canyon/Rider School course edges; and a two-batch code-native start treatment with four numbered lane stencils. All rider numbers, palettes, geometry, and motion are project-authored source; no external rider or rival asset was added. Painted guides remain albedo-only; authored custom courses exclude Canyon showcase treatments and the generic numbered start presentation. The separately inventoried Canyon matte is presentation-only and retains this generated sky when unavailable. The procedural player bike remains visible while the GLB loads and remains active with an explicit status caption if loading fails |
| Generated Festival Trail Bike | `scripts/build-3d-assets.mjs`; `public/assets/3d/festival-trail-bike.glb`; `public/assets/3d/festival-bike-albedo.ktx2` | Original project-authored procedural primitive composition and code-generated 128×128 festival-bolt albedo; no source model, source image, downloaded art, or reference image | The GLB replaces only the player bike visual after successful asynchronous decode. The current source-authored pass adds named spinning wheel assemblies, 14 tread blocks and a brake disc per wheel, layered side panels, an exposed rear-right exhaust/tip, and a rear-facing geometric `22`; details and hashes are recorded below |
| Runtime audio cues | `src/game/audio/AudioManager.ts` | Original project-authored Web Audio oscillators, generated noise, gains, and filters for engine, wind, terrain, music pulses, UI, landing, crash, cooling, overheat, checkpoint, finish, and crowd cues | No WAV, MP3, OGG, M4A, or streamed audio |
| Campaign tracks, palettes, writing, obstacle layouts, editor modules, and examples | `src/game/content/tracks.ts`; `src/game/editor/modules.ts`; `src/game/editor/examples.ts` | Original project-authored code/data and writing | Compiled into the game bundle; no copied course files are present |
| Bundled display font | `public/assets/fonts/barlow-condensed-700-latin.woff2`; `public/assets/fonts/barlow-condensed-900-latin.woff2`; `docs/licenses/barlow-condensed-OFL-1.1.txt`; `src/styles.css` | Barlow Condensed by The Barlow Project Authors, distributed by Google Fonts under SIL Open Font License 1.1 | 700: 14,888 bytes, SHA-256 `e3e520cb7468f2efd60bc2ce96694567c3312f4ef414fffbe605e3ad146b24e6`; 900: 13,940 bytes, SHA-256 `2036f7f4aacc7759dcf8c6be2bd5bbde873c25a860f24dca0530ad14d4937723`; complete OFL: 4,377 bytes, SHA-256 `186d750eb496a4c17a76385f82be6aea2ac1cf2de074a811d63786cf374ea73f`. CSS and CanvasTexture labels use the same family; visual/cross-browser acceptance remains paused. |

The GLB and KTX2 files listed below are the only standalone compressed 3D model/texture-pipeline formats in the audited source tree; the two shipped raster backgrounds and two shipped WOFF2 fonts are inventoried separately above. No standalone shader or audio files were found. The SVG XML namespace is a format declaration, not an external asset request.

The 2026-07-14 cooling-gate venue and continuous safety-wall revisions changed only source-authored runtime geometry and placement records. They added no raster, model, texture, audio, font, dependency, or network asset, did not regenerate the GLB/KTX2 pipeline, and left the inventoried Canyon panorama byte-identical.

The 2026-07-15 Canyon grandstand/watchtower revision reuses the existing project-authored platform geometry/material batch as scaled timber deck and tier instances, raises only the existing cooling-gate deck/canopy/post instances, and repositions existing procedural spectators onto tier tops or staffed decks. It adds no raster, model, texture, audio, font, dependency, geometry type, visible draw batch, or network asset; the GLB, KTX2, and Canyon panorama provenance records remain unchanged.

The later 2026-07-15 course-grade, obstacle-module, venue-signature, and schema-v2 authored-route pass changes only project-authored TypeScript-defined geometry, normals, transforms, contact metadata, instancing, per-instance color, and route/editor data. It adds no external raster, model, texture, audio, font, dependency, or network asset and does not regenerate the GLB, KTX2, title art, icon, fonts, or Canyon panorama. The latest permitted normal build ran from 10:26:16 to 10:26:21 CEST and confirmed those inventoried bytes remain unchanged; runtime visual/similarity review is still paused and **UNVERIFIED**.

An earlier 2026-07-15 gameplay/accessibility/release revision added only project-authored TypeScript, CSS, service-worker code, smoke-support code, and documentation. The numbered `1`–`4` start treatment is built from existing Three.js box geometry and instancing and is intentionally absent from authored Test Rides. The heat, AI collision, portrait-selection, semantic `aria-pressed` pitch controls, adaptive recovery `progressbar`, 320–780 px/140% layout clamps, format-2 served-byte binding, and historical shell-v28 reload/partial-cache cleanup introduced no raster, model, texture, audio, font, third-party dependency, or new license obligation.

The 03:36 source slice added only app-authored standing-PB data fields/results copy, AI scheduling rules, responsive CSS, release/toolchain verification code, service-worker response cloning, and deferred regression source. It changed no shipped art or audio bytes and introduced no dependency or license obligation; its GLB, KTX2, and Canyon panorama hashes remain unchanged. The later bundled-font slice supersedes the old notice bytes and adds the OFL obligation recorded above. Runtime behavior, human visual review, complete source/license audit, official manifest, and release qualification remain **UNVERIFIED**.

The Barlow Condensed files were retrieved on 2026-07-15 from the official Google Fonts v13 static endpoints: `https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B46r2z3bWuYMBYro.woff2` (700) and `https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B45L0z3bWuYMBYro.woff2` (900). The official source directory is `https://github.com/google/fonts/tree/main/ofl/barlowcondensed`; the retained OFL was last changed there at commit `a9741353ee641360301367de69a23234c0843ed9`. The files are unmodified Google Fonts outputs, not derivatives, and no Reserved Font Name is claimed for project branding.

## Original 3D asset pipeline and third-party transcoder

`scripts/build-3d-assets.mjs` deterministically builds the low-poly **Festival Trail Bike** from Three.js box, cylinder, and icosahedron primitives and creates its albedo pixel-by-pixel. The generated glTF metadata identifies it as an original procedural project asset and records the generator. `docs/ASSET_PIPELINE.md` documents the rebuild, verification, and integration workflow.

| File | Role and provenance | Bytes | SHA-256 | License/classification |
|---|---|---:|---|---|
| `public/assets/3d/festival-trail-bike.glb` | Runtime player-bike GLB; original generated geometry with the KTX2 embedded; current proportions use a faceted tank, a dedicated thin rear fender, merged knobby low-poly tread rings with hubs/brake discs, layered side plastics, a separated seat/engine silhouette, a merged rear-facing `22`, and an exposed exhaust/tip | 29,132 | `8668d05f42f3b8303c0825b8d4aa4b9c66a8ef64acba18f2df70b69f9a8f595b` | Original project asset |
| `public/assets/3d/festival-bike-albedo.ktx2` | Standalone inspection copy, byte-identical to the GLB's embedded texture | 2,236 | `a86588924b53fd51915d505d0ba23e343ac3e84a5139c687845a49f8ad8a1ba2` | Original project asset |
| `public/assets/3d/asset-manifest.json` | Generated provenance, compression, dependency, file-size, and hash record | 3,369 | `ebd431902d7177bfdaad64733eedf246bb8c31f132a3e063a61188412ae244e7` | Project metadata |
| `public/assets/transcoders/basis/basis_transcoder.js` | Runtime Basis Universal transcoder wrapper copied from Three.js 0.185.1 examples | 57,529 | `8478b5b6d6b74e7d3082b89f6417321d8d1dc0307f2b30d4484bb11b441696a1` | Apache-2.0 |
| `public/assets/transcoders/basis/basis_transcoder.wasm` | Runtime Basis Universal transcoder copied from Three.js 0.185.1 examples | 527,333 | `6cf17dc889352c42e9acf8897107978d127005fe3386c36a0e3845e27967630a` | Apache-2.0 |
| `public/assets/transcoders/basis/README.md` | Upstream Three.js Basis usage/provenance README | 1,388 | `a578df416c1e0852e9c36a1cf91b4d28d91a251294f87ce610a3bc7ca4df15e0` | Documentation distributed with transcoder |
| `public/assets/transcoders/basis/LICENSE.txt` | Full Apache License 2.0 text; exact upstream bytes preserved by the repository's `-text -diff` attribute | 9,197 | `a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47` | Apache-2.0 license text |
| `public/assets/transcoders/basis/NOTICE.txt` | Reproducibly generated readable copy of upstream Basis attribution | 917 | `42beeb6710c933778e30f62886e0790ebba120debbb0545ab46c7292d3e5a061` | Apache-2.0 §4(d) NOTICE |
| **Generated public pipeline total** | All eight files above | **631,101** | — | Mixed original project asset / Apache-2.0 runtime component |

`npm run assets:verify` passed against the current asset inputs through the latest permitted normal build run from 2026-07-15 10:26:16 to 10:26:21 CEST. It found 22 Meshopt-compressed buffer views; required `EXT_meshopt_compression`, `KHR_mesh_quantization`, and `KHR_texture_basisu`; independently decoded 34 nodes, 15 meshes, 7 materials, and one texture; and confirmed one merged 14-block tread mesh per wheel, one merged 10-segment rear number, the named wheel/plate/panel/exhaust composition, and a 30-mesh-bearing-node ceiling, plus a 128×128 ETC1S/BasisLZ KTX2 with BT.709 primaries, sRGB transfer, and eight nonempty in-bounds mip levels. Meshopt reduced the generated GLB from 54,868 to 29,132 bytes (46.9%). The pinned Khronos validator reported zero errors; its two warnings and three informational notices are exact allowlisted limitations of that older validator's Meshopt/KTX2 support. The same build contract matched the 1,801,764-byte Canyon panorama's exact SHA-256, PNG signature/chunk bounds, 1774×887 8-bit opaque RGB header, image data/IEND, single C2PA `caBX` chunk, and embedded generation/provenance markers. It also pinned both Barlow Condensed WOFF2 files by length, `wOF2` signature, and SHA-256 and pinned the retained OFL by length, SHA-256, copyright marker, and SIL OFL 1.1 marker. That build also passed the independent exact-manifest/directory, shipped/source-title, and app-icon contracts. This structural result is not a cryptographic C2PA verification or human similarity/legal/visual acceptance. Pre-final scripted headless installed-Chrome captures predate the current bike, panorama integration, bundled typography, and route/editor work and remain visual comparison evidence only; the complete automated browser, source, license, and static audits remain open while the owner's automated-test pause is active.

`src/game/assets/compressedAssetLoader.ts` configures `GLTFLoader` with Three.js's Meshopt decoder and a renderer-detected `KTX2Loader`. `GameEngine` loads `/assets/3d/festival-trail-bike.glb` asynchronously, hides the original procedural player-bike visual only after successful decoding, and keeps the procedural bike active with a visible caption if the asset fails. The six-pivot rider, five palette/number-specific rivals, their shared detail assemblies, runtime number canvases, and the world remain original procedural geometry/material output; this source slice adds no standalone file or third-party asset.

The loaders use stable same-origin paths `/assets/3d/festival-trail-bike.glb`, `/assets/art/canyon-festival-panorama.png`, `/assets/fonts/`, and `/assets/transcoders/basis/`. The historical audited bundle used an earlier app-owned service-worker generation. The current working candidate uses `rivet-ridge-rally-shell-v30`. Its latest permitted normal build ran from 2026-07-15 10:26:16 to 10:26:21 CEST; it passed strengthened exact 3D manifest/directory, shipped/source-title, app-icon, panorama, font, and font-license verification and produced 24 files / 6,679,904 raw bytes. The generated 43,825-byte `THIRD_PARTY_NOTICES.txt` has SHA-256 `5fa8f7b4aaf95b4cc28b9b36a10c7f451e0ef83e6ac959d530ed3fdceacb60d0`; the 5,722-byte `dist/sw.js` has SHA-256 `f5cc9b23c2d507b9cede7a11cd72f62d05549c4ae72888853b5191d4cb6b78ca`; and the 1,418-byte `dist/index.html` has SHA-256 `4252cb572300d9e2dd838b7e39f8440b8b40b6762556e17cd9f3d7b44690f433`. The 282,888-byte game chunk is `GameView-Cy_z8oq_.js`, SHA-256 `3517031f108f19e570938c10d31fb6e58af56ecb8859ea25a09355b6ef575bd4`; the 612,073-byte shared route chunk is `CoursePresentationRoute-CMRHtjX1.js`, SHA-256 `87e856adf652bb8a49b45ed3d96256221a360ca7edff9a94341a17fa63af71b8`; and the 56,935-byte editor chunk is `TrackEditorScreen-niBUL8yv.js`, SHA-256 `6c800124e378c8e16dc420210b1e696e3418d4843c537ebab3218e3797b1f5f0`. Strict typecheck, 142-module Vite production compilation, and notices verification also completed; this is build-scope evidence only and does not bind or qualify an official release candidate. The current format-2 release manifest, precache accounting, served-byte binding, and offline production smoke remain **UNVERIFIED** until the paused checks resume. Shell-v30 install reload-fetches every core and HTML-discovered build asset before committing the batch and deletes its partial current cache on any install failure. Runtime warming reload-fetches same-origin URLs but may retain an already cached usable response if the refresh fails. Cache lookup prefers v30 and retains only the immediately previous app-owned generation for open-tab transitions; activation removes older app caches and leaves unrelated origin caches untouched. The standalone KTX2 is not a separate runtime request because the same bytes are embedded in the GLB. The Canyon panorama and both font files are precached runtime requests. The panorama is excluded from editor-authored Test Rides, uses a bounded `ImageBitmapLoader`, quality-tier decode sizes, responsive centered cover cropping, engine-owned texture/bitmap disposal, and the existing generated sky as its no-network fallback; a quality change is applied on the next engine attempt rather than reallocating a live background. Runtime cache messages and fetch handling reject cross-origin URLs, and the page claims offline readiness only after an exact current-controller v30 acknowledgement. The HTML CSP permits the required same-origin fetches, WebAssembly compilation (`'wasm-unsafe-eval'`), and blob worker (`worker-src 'self' blob:`) used by the transcoder. A compressed-bike load that remains unsettled for five seconds cancels its dedicated loading manager, terminates the KTX2 loader, leaves the complete original built-in bike active, and defensively disposes any late decoded result; the panorama independently settles or falls back within five seconds and closes any late/disposed bitmap. Release-evidence hardening source changes notice generation and release/smoke guards only; it is outside the client compilation, was not executed by this build, and remains **UNVERIFIED**.

Any later service-worker `controllerchange` clears the page's readiness claim immediately; the conservative offline state remains until the replacement controller acknowledges `rivet-ridge-rally-shell-v30`. Production-smoke source now validates one format-2 manifest, binds the runtime commit, no-store fetches and verifies every listed served byte plus the aggregate before and after the browser journey, and opens cached Practice offline. Real install/activation/cache-transition behavior, offline Practice, and manifest-to-served-byte binding remain **UNVERIFIED** while automated qualification is paused.

The stable public transcoder pair is intentionally retained for explicit same-origin/offline paths. Three.js's `KTX2Loader` also contains static default transcoder URL imports, so Vite emits an additional hashed JS/WASM pair even though the configured loader selects the stable public pair. The two pairs are byte-identical by SHA-256. This creates an intentional **584,862-byte raw duplicate** (57,529 JS + 527,333 WASM) and makes the pipeline's current production-bundle footprint **1,215,963 raw bytes** including generated metadata, standalone inspection KTX2, README, license, and NOTICE. The duplicate is accepted for `1.0.0-rc.2` as a known P2 because it preserves stable same-origin/offline paths and remains below the initial-asset budget; later bundler/loader optimization may remove it, but any change must preserve offline behavior and Apache-2.0 notices.

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

Versions below are the exact values from `package.json` and the installed package manifests at the historical audit. That audited `package-lock.json` was 165,779 bytes with SHA-256 `43dfce57099cd11a1081d10286578d47e0126e839ffe8c9deac2fe628430e5d3`. The current lockfile SHA-256 is `f7a93ecd87533eeddd70b21352e77aecdc0b8b1c8f76cc423da3cac553fae44b`; it has not yet received the clean-install, license, vulnerability, and bundle re-audit required for current-candidate qualification.

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

Commercial distribution must preserve the notices and license texts required by the dependencies actually distributed. The Basis runtime directory now ships the Apache-2.0 text and a readable copy of the upstream [Basis Universal NOTICE](https://github.com/BinomialLLC/basis_universal/blob/master/NOTICE). Repository-level `THIRD_PARTY_NOTICES.md` is 3,212 bytes with SHA-256 `e88e344e0ac72b9f82c0edb891a16cec173d7180c669ce8faf3e0f6fa69a0abc`; it describes the complete notice generated into each distribution and the direct runtime/build-tool classifications. The repository still has no root project `LICENSE`. Before release, counsel or the owner must select the project's own license and verify the final generated notice set covers the distributed dependency graph and applicable obligations.

A final clean `npm ci` completed successfully for the historical audited snapshot under Node.js v26.4.0 and npm 11.17.0, adding 268 packages, auditing 269, and reporting zero vulnerabilities. That source/static audit reran `npm audit --audit-level=high --json` and confirmed zero vulnerabilities across its 320 lockfile entries. `npm ls --depth=0 --json` exited 0 and reported all 31 exact pinned direct dependencies with no `problems`, missing entries, or extraneous packages. These results have not been rerun for the current lockfile/candidate.

## Security, branding, and bundle evidence

### Prohibited terms and visual identity

- Case-insensitive byte scans of the source/static scope (excluding this audit's explanatory text and transient reports), relative repository paths, and the final non-QA production bundle for the three expressly prohibited marks returned **zero matches**.
- Human visual review of the five unique generated source PNGs, app icon, and current editor/race reference screenshots found no obvious prohibited word mark, logo, recognizable third-party character, or branded interface. This is not a professional trademark/trade-dress clearance.
- The canonical workspace uses the neutral `Rivet Ridge Rally` directory name, and the prohibited legacy working-name folder is absent. An earlier post-build case-insensitive focused scan found no prohibited mark or stale legacy absolute path in its then-current source scope or `dist/`; it predates the 08:57 build and the later release-evidence hardening source. Local evidence, dependency trees, Git history, secret signatures, and the complete release inventory still require the paused final audit before candidate qualification.

### Credentials and secrets

- Source/config/docs/assets (excluding this audit's explanatory text) and final `dist/` scans found no AWS access-key signatures, private-key headers, GitHub/OpenAI/Slack/Google token signatures, Stripe live-secret signatures, or JWT-like bearer values.
- No `.env`, PEM, key, PKCS#12, certificate, or source-map files are present in the audited source tree or production bundle.
- The historical audited release source was committed on `main` and identified by annotated tag `v1.0.0-rc.1`. A complete single-commit history/deletion scan found no prohibited marks, absolute home paths, credential files, or known secret signatures in that snapshot. The current `rc.2` source snapshot is tracked by the commit containing this record but has no annotated `v1.0.0-rc.2` tag or clean release-bound rebuild, so source-identity and history qualification remain open.

### Network, CSP, offline, and tracker behavior

- The final non-QA bundle contains 13 literal `fetch(...)` call sites: four service-worker calls, three Three.js loader calls, one embedded-`data:` Meshopt initialization in the game-view chunk, one Vite module-preload call in the main chunk, and two in each of the byte-identical Basis wrappers. Four `XMLHttpRequest` tokens are confined to the Basis wrappers' environment/file fallback code. No WebSocket or EventSource construction and no `sendBeacon` call is present.
- Application-authored network code is confined to the service worker's four calls and enforces same-origin GET/cache URLs. The application supplies same-origin or embedded-data inputs to the remaining library loaders; no application call site targets an external host.
- Service-worker install precaches the stable GLB and both stable Basis transcoder files. It also discovers hashed entry assets from `index.html`; after first load the application warms lazy race/editor chunks and asks the worker to cache only resource URLs whose origin equals `window.location.origin`.
- Shell-v30 uses `cache: "reload"` for install and runtime-warm fetches. Install stages all required responses before populating the current cache and deletes that cache if any install step fails, preventing a failed installation from leaving a partial v30 shell.
- Navigation falls back to cached `/index.html`; other same-origin GETs are cache-first and added to the runtime cache after successful network responses. Cross-origin and non-GET requests are ignored by the service worker.
- The meta CSP allows `default-src 'self'`, same-origin/blob connections, self/blob workers, WebAssembly compilation, and the current image sources. The remaining `'unsafe-eval'` and inline-style allowances are justified above; external HTTP and WebSocket origins are not allowed. Meta CSP cannot enforce `frame-ancestors`, so deployment still requires the HTTP framing control documented in `docs/OPERATIONS.md`.
- Application and bundle scans found zero known analytics/tracker domains or SDK imports for Google Analytics/Tag Manager, Segment, Mixpanel, Amplitude, PostHog, Sentry, Datadog, Hotjar, Meta/Facebook, DoubleClick, FullStory, New Relic, Clarity, Plausible, Matomo, or Heap. Three plain `doubleclick` text matches are React `onDoubleClick`/DOM event names, not tracker code.
- External URL literals remain inside third-party diagnostics, schema/reference text, shipped license/README/notice metadata, SVG/XML namespaces, and PNG C2PA/IPTC provenance metadata. Their normalized hosts and occurrence counts are `bit.ly` (1), `ca.trufo.ai` (2), `cv.iptc.org` (1), `gamma.cs.unc.edu` (1), `github.com` (3), `jcgt.org` (1), `json-schema.org` (3), `ocsp.trufo.ai` (2), `react.dev` (2), `tinyurl.com` (1), `trufo.ai` (1), `www.apache.org` (5), and `www.w3.org` (21). No application call site targets them; loading the files does not execute those URLs.

The game runs without accounts and no application analytics or third-party tracking was found.

### Historical production bundle snapshot

The historical `1.0.0-rc.1` non-QA production build contained 21 files. Its preserved `artifacts/history/release-manifest-1.0.0-rc.1-format-1.json` records 4,675,553 raw bytes and aggregate SHA-256 `d953ed1ed66f82a26043d3fbffe634ed8d35021edb8e90ee0f8f064567a70a97`. Sizes and hashes below were independently rechecked against the historical `dist/`; gzip is the sum of independent level-9 gzip results and is not a claim about a particular host's transfer configuration. These values are intentionally preserved as history and must not be read as current `dist/` or release evidence.

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
3. Add the owner-selected project `LICENSE` and have counsel or the owner verify the existing shipped Basis NOTICE plus `THIRD_PARTY_NOTICES.md` against the final distributed dependency graph.
4. Preserve the accepted duplicate-transcoder P2 in release notes and backlog; any future removal requires verified offline startup and an updated inventory.
5. Revalidate the documented Basis `'unsafe-eval'` and controlled inline-style CSP allowances whenever the transcoder or UI build changes.
6. After the paused test run is resumed, repeat the clean-install audit, prohibited-term, secret, network/tracker, bundle, font/OFL, visual, service-worker `shell-v30`, format-2 release-manifest, served-byte binding, and production-smoke checks against one exact final candidate.
7. Update this file before adding or changing any model, texture, audio, font, icon, image, marketing capture, or third-party content.
