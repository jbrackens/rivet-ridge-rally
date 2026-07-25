# Rivet Ridge Rally Toolchain and MCP Inventory

Recorded: 2026-07-25
Project folder: `/Users/john/Sandbox/Rivet Ridge Rally`
Repository: `https://github.com/jbrackens/rivet-ridge-rally.git`
Primary branch for current work: `agent/rc2-launch-hardening`

This document describes the local software, project dependencies, graphics pipeline, and MCP/Codex tooling used to build, test, inspect, and publish Rivet Ridge Rally.

## Required local software

| Tool | Verified version / path | Why it matters |
|---|---|---|
| Node.js | `v26.4.0` at `/opt/homebrew/bin/node` | Runs the Vite app, TypeScript checks, asset scripts, tests, release tooling, and local preview server. The repo pins `26.4.0` in `.node-version`. **See the toolchain-drift warning below.** |
| npm | `11.17.0` at `/opt/homebrew/bin/npm` | Installs locked dependencies and runs the package scripts. The repo declares `packageManager: npm@11.17.0`. **See the toolchain-drift warning below.** |

### Toolchain-drift warning (recorded 2026-07-25)

The pinned Node and npm above are installed, but they are **no longer first on this machine's default `PATH`**. A plain shell resolves:

```
node -> /Users/john/.local/bin/node   v22.23.1
npm  -> /Users/john/.local/bin/npm    10.9.8
```

Run under the drifted toolchain, the release-manifest fixture suite fails closed by design:

```
not ok 2 - qualifies the installed npm package tree against a detached fixture
  Error: Release guard failed: npm package version does not match packageManager
```

That is the guard working, not a defect. Prefix release, manifest, smoke, performance, and attestation commands with the pinned toolchain:

```sh
export PATH="/opt/homebrew/bin:$PATH"
```

**Evidence produced under `v22.23.1` must not be used for release qualification.** Recorded in `docs/RC2_RECONCILIATION_2026-07-25.md` §3.

### Dependency-audit status (recorded 2026-07-25)

`npm run audit` currently **fails** at `bb10ce4` with 24 vulnerabilities (18 moderate, 6 high). Every affected package is a devDependency and none reaches the shipped browser runtime: `brace-expansion`/`minimatch` and the `@sentry/node` + `@opentelemetry/*` cluster arrive via `@danielsogl/lighthouse-mcp` and `chrome-devtools-mcp`; `sharp`/libvips arrives via `@gltf-transform/functions` in the asset optimizer. The `sharp` remediation is breaking. Details and options in `docs/RC2_RECONCILIATION_2026-07-25.md` §5; tracked as row 15 of `docs/RC2_REMAINING_GATES_CHECKLIST.md`.
| Git | Apple Git `2.50.1` at `/usr/bin/git` | Source control, release provenance, tags, branches, and review history. |
| GitHub CLI | `gh 2.94.0` at `/opt/homebrew/bin/gh` | GitHub authentication, remote status, pull request checks, and push/PR workflow support. |
| Blender | `4.5.11 LTS` at `/opt/homebrew/bin/blender` and `/Applications/Blender.app/Contents/MacOS/Blender` | Authors the original 3D assets: hero bike/rider, rival pack, and Canyon kit source `.blend` and raw GLB outputs. |
| Google Chrome | `150.0.7871.129` at `/Applications/Google Chrome.app` | Real-browser smoke, service-worker, offline, performance, and visual/debug validation. |
| Python 3 | `/usr/bin/python3` | Supports Blender Python authoring scripts and local utility scripting. |

## Runtime libraries

These dependencies ship with or directly support the browser game runtime.

| Package | Version | Role |
|---|---:|---|
| `three` | `0.185.1` | Direct Three.js/WebGL rendering, scene graph, loaders, materials, PMREM lighting, and procedural visual fallbacks. |
| `react` | `19.2.7` | Menus, HUD, settings, results, tutorial panels, and editor UI. |
| `react-dom` | `19.2.7` | Browser DOM rendering for React UI. |
| `zustand` | `5.0.14` | App state, flow state, settings, and progression state. |
| `dexie` | `4.4.4` | IndexedDB persistence for local saves, progression, settings, custom tracks, and migrations. |
| `zod` | `4.4.3` | Runtime validation for structured local/imported data and manifests. |

## Build, verification, and test tooling

| Package | Version | Role |
|---|---:|---|
| `vite` | `8.1.4` | Local dev server, production build, and preview server. |
| `@vitejs/plugin-react` | `6.0.3` | React support in Vite. |
| `typescript` | `6.0.2` | TypeScript toolchain alias. |
| `typescript-7` | `7.0.2` | Strict project typecheck command. |
| `eslint` | `10.7.0` | Static linting. |
| `@eslint/js` | `10.0.1` | ESLint JavaScript rule definitions. |
| `typescript-eslint` | `8.63.0` | TypeScript lint support. |
| `eslint-plugin-react-hooks` | `7.1.1` | React Hooks lint rules. |
| `eslint-plugin-react-refresh` | `0.5.3` | React Refresh lint support. |
| `vitest` | `4.1.10` | Unit/source-level tests. |
| `@vitest/coverage-v8` | `4.1.10` | V8 coverage reports. |
| `@playwright/test` | `1.61.1` | Browser end-to-end, visual, smoke, tutorial, editor, and offline/service-worker tests. |
| `axe-core` | `4.12.1` | Accessibility audit engine. |
| `@axe-core/playwright` | `4.12.1` | Accessibility audits inside Playwright browser tests. |
| `jsdom` | `29.1.1` | DOM-like environment for non-browser tests. |
| `@types/node` | `26.1.1` | Node TypeScript types. |
| `@types/react` | `19.2.17` | React TypeScript types. |
| `@types/react-dom` | `19.2.3` | React DOM TypeScript types. |
| `@types/three` | `0.185.1` | Three.js TypeScript types. |

## 3D graphics and asset pipeline

The current graphics direction keeps the direct Three.js renderer and improves authored production assets around it. Engine migration is intentionally deferred unless a future requirement cannot be met with the current architecture.

## Graphics tool status and adoption plan

This table separates tools that are already active in the repository from tools that are recommended for future art/VFX passes. "Adopt" here is a planning verdict, not proof that the tool is already installed, committed, or wired into the runtime.

| Priority | Tool | Purpose here | License | Current status | Verdict |
|---:|---|---|---|---|---|
| 1 | [Blender 4.5 LTS + official glTF exporter](https://github.com/KhronosGroup/glTF-Blender-IO) | Hero bike/rider, terrain, jumps, barriers, festival structures, animation, LODs, baking, and Geometry Nodes. | Blender GPL; exported artwork remains project-owned. Official exporter Apache-2.0. | Current and verified. Blender 4.5.11 LTS is installed locally, and the repo's Blender Python scripts call the glTF exporter for the hero, rival, and Canyon asset sources. | Adopt immediately; already active and should keep expanding. |
| 2 | [Material Maker](https://github.com/RodZill4/material-maker) | Consistent dirt, mud, rubber, painted metal, rock, grass, and track-surface PBR materials. | MIT | Planned/recommended. Not verified as installed and not currently a package/runtime dependency. | Adopt for the next material/texture pass. |
| 3 | [Krita](https://krita.org/en/about/license/) | Concept paintovers, liveries, decals, signs, VFX sprites, UI art, and color keys. | GPL; created artwork remains project-owned. | Planned/recommended. Not verified as installed and not currently required by the checked-in asset pipeline. | Adopt for concept/art-direction and texture-support work. |
| 4 | [glTF Transform](https://github.com/donmccurdy/glTF-Transform), [meshoptimizer](https://github.com/zeux/meshoptimizer), and KTX2 | Optimize Blender exports, generate LODs, compress geometry/textures, and validate assets. | MIT / Apache-family components depending on package. | Current and verified. glTF Transform, meshoptimizer, glTF validator, KTX2 encoder, and Basis runtime support are pinned in the repo. | Already present; extend the pipeline as authored content grows. |
| 5 | [Three.js PMREM / environment lighting](https://threejs.org/docs/pages/MeshStandardMaterial.html) | Real ambient/specular response across PBR materials instead of hemisphere/direct light alone. | MIT | Current and verified. `GameEngine.ts` uses Three.js `RoomEnvironment` and `PMREMGenerator`. | First runtime upgrade; already active as the baseline PBR lighting path. |
| 6 | [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing) | Subtle AO, selective emissive bloom, SMAA, and concept-matched LUT/color grading. | Zlib | Planned. Not currently installed in `package.json` and not wired into the renderer. | Adopt after IBL/material baseline is accepted. Treat as polish, not a substitute for better authored assets. |
| 7 | [three.quarks](https://github.com/Alchemist0823/three.quarks) | Batched dust, exhaust, impact dirt, cooling mist, sparks, finish effects, and celebratory particles. | MIT | Planned pilot. Not currently installed in `package.json`; current dust/VFX are custom runtime effects. | Pilot after core art and performance budgets are stable. |
| 8 | [Blockbench](https://github.com/JannisX11/blockbench) | Rapid chunky props, fencing, bleachers, crates, signs, and low-poly set dressing. | GPL-3.0; created assets remain project-owned. | Optional/recommended. Not verified as installed and not part of the current hero/Canyon/rival pipeline. | Useful selectively; avoid making the game look voxel/Minecraft-like. |
| Optional | [ArmorPaint](https://github.com/armory3d/armorpaint) | Hero bike/rider texture painting and baking. | Zlib | Deferred. Not verified as installed and not part of the current pipeline. | Defer until the hero/rider texture needs exceed the Blender/Krita path and the tool maturity risk is acceptable. |

| Tool / format | Version | Role |
|---|---:|---|
| Blender | `4.5.11 LTS` | Editable 3D source authoring for hero bike/rider, rival pack, and Canyon kit. |
| glTF / GLB | `2.0` | Runtime 3D asset format. |
| `@gltf-transform/core` | `4.4.1` | GLB/glTF optimization and verification. |
| `@gltf-transform/extensions` | `4.4.1` | Extension support for optimized GLB assets. |
| `@gltf-transform/functions` | `4.4.1` | GLB transformation utilities. |
| `meshoptimizer` | `1.2.0` | Meshopt compression and geometry optimization. |
| `gltf-validator` | `2.0.0-dev.3.10` | glTF validation. |
| `ktx2-encoder` | `0.5.3` | KTX2/Basis texture pipeline support. |
| Basis Universal transcoders | Bundled from Three.js examples | Runtime texture transcoding support for supported compressed textures. |

Planned or optional art tools recorded as useful but not currently verified as installed or required by the shipped asset pipeline:

- Krita for hand-painted masks, decals, and texture atlases.
- Material Maker for procedural dirt, rock, wood, and terrain PBR atlases.
- pmndrs/postprocessing for a later restrained post-processing pass.
- three.quarks for a later particle/VFX pilot.
- Blockbench for deliberately blocky secondary props.
- ArmorPaint as a deferred texture-painting option.
- Blender MCP for future interactive art iteration. The production workflow currently does not depend on a Blender MCP; canonical source remains checked-in `.blend`/Python/GLB pipeline files.

## MCP packages installed as project dev dependencies

| MCP package | Version | Use |
|---|---:|---|
| `@playwright/mcp` | `0.0.78` | Browser automation/control MCP for Playwright-style inspection and testing workflows. |
| `chrome-devtools-mcp` | `1.6.0` | Chrome DevTools Protocol MCP for browser inspection, performance, and debugging workflows. |
| `@danielsogl/lighthouse-mcp` | `1.3.0` | Lighthouse audit MCP for performance, accessibility, SEO, and best-practice audits. |

## Codex MCP servers and plugins

The local Codex configuration includes these relevant MCP/control entries:

| Entry | Status | Purpose |
|---|---|---|
| `node_repl` MCP server | Configured | Local JavaScript execution bridge used by Codex browser, Chrome, and in-app browser tooling. |
| `computer-use` MCP server | Configured but disabled | Optional desktop automation; not required for routine game development. |

Relevant enabled Codex plugins:

| Plugin | Use |
|---|---|
| `github@openai-curated` | Repository, branch, PR, commit/push, and review workflows. |
| `build-web-apps@openai-curated` | Web app/game implementation and local rendered-frontend testing workflows. |
| `browser@openai-bundled` | In-app browser and local web testing workflow when runtime control is exposed. |
| `sites@openai-bundled` | Optional hosting/deployment workflow. |
| `game-studio@openai-curated` | Game-development oriented workflow support. |
| `documents`, `pdf`, `spreadsheets`, `presentations`, `template-creator`, `visualize` | Supporting documentation, reports, artifacts, and planning materials. |

## Common commands

| Command | Purpose |
|---|---|
| `npm ci` | Install exact locked dependencies. |
| `npm run dev` | Start the Vite development server. |
| `npm run build` | Verify assets, typecheck, build production bytes, and write third-party notices. |
| `npm run preview` | Serve the built production output locally. |
| `npm run assets:build` | Regenerate checked-in authored GLB outputs from Blender-authored sources. |
| `npm run assets:verify` | Verify authored assets, production art, manifests, and license-bound public inputs. |
| `npm run typecheck` | Run strict TypeScript checks. |
| `npm run lint` | Run ESLint. |
| `npm test` | Run Vitest and Node fixture tests. |
| `npm run test:e2e` | Run Playwright browser tests. |
| `npm run audit` | Check for high-severity npm vulnerabilities. |

## Notes

- The active development folder is `/Users/john/Sandbox/Rivet Ridge Rally`.
- The old `/Users/john/Excitebike 2026` folder was moved to Trash and should not be used for current development.
- Tool versions above reflect the local machine and pinned project configuration at the time this document was recorded.
