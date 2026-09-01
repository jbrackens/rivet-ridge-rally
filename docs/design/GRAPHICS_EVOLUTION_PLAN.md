# RIVET RIDGE RALLY — Graphics Evolution Plan

**Prepared:** 2026-08-30
**Status:** APPROVED IN PRINCIPLE, 2026-08-31. The two structural decisions (§3.1, §3.2) are made — see the OWNER DECISION notes there. Nothing is applied to code yet; Phase 0 is cleared to start. No verifier, baseline or asset has been changed by this document.
**Owner brief:** "I want to evolve the graphics, the goal is to have GTA6 level artwork, characters, and game assets."
**Operating model:** proof of concept; all authoring by AI agents, owner is the sole approver at every gate. No human hires, no purchases — see §3.2.
**Governing docs:** `AGENTS.md`, `GAME_SPEC.md`, `docs/design/FIDELITY_LEDGER.md`, `docs/design/GRAPHICS_TOOLCHAIN.md`, `docs/design/HERO_TEXTURE_ATLAS_PLAN.md`, `docs/design/ASSET_ORIGINALITY_RULE_PROPOSAL.md`
**Supersedes:** nothing. Extends `GRAPHICS_TOOLCHAIN.md` (2026-07-16) and closes the open question left by `HERO_TEXTURE_ATLAS_PLAN.md` §5c.

---

## 1. Sizing the gap, numerically

GTA 6's cumulative development spend is estimated at **$1B–$1.5B** by industry analysts cited by Business Insider (May 2026); Take-Two's CEO declined to give a figure. At a fully-loaded ~$125k per person-year that implies roughly **10,000 person-years** — about 1,400 people for seven years. Take-Two reported **9,998 development-studio employees** as of 31 March 2026. Red Dead Redemption 2 shipped **300,000 animations** and 500,000 lines of dialogue, using 1,200 SAG-AFTRA actors over six years. A single AAA hero character is 50,000–100,000 triangles with 4–8 material slots of 4K PBR maps, a 150–200-joint rig, and a MetaHuman-class face carrying ~700 joints and 710 blendshapes. Delivery is a PS5 at **10.28 TFLOPS** and **448 GB/s** of dedicated GDDR6, streaming from a 5.5 GB/s SSD into a ~175 GB install.

This game's entire shipped 3D content is **98,080 triangles in ~939 KB of GLB**, inside a build of **7,598,579 raw / ~5.15 MB gzipped** bytes against a hard **12,000,000-byte** ceiling (`scripts/performance/measure.mjs:39`), delivered to a mid-range phone at ~0.7–1.5 TFLOPS with 51–68 GB/s of memory bandwidth shared with the CPU and display, under a ~5 W thermal budget instead of ~200 W.

| Axis | GTA 6 / PS5 class | Rivet Ridge Rally | Ratio |
|---|---:|---:|---:|
| Install footprint | ~175 GB | 5.15 MB gzip | ~34,800× |
| Authored animation clips | 300,000 | 0 | ∞ |
| Facial joints / blendshapes | ~700 / 710 | 0 / 0 | ∞ |
| Scene triangles | one hero character = 80–100k | 98,080 total | ~1× (whole game = one character) |
| One 4K texture, uncompressed | 67.1 MB | whole download 5.15 MB | 13× |
| GPU peak FP32 | 10.28 TFLOPS | 0.7–1.5 TFLOPS | 7–15× |
| Memory bandwidth | 448 GB/s | 51–68 GB/s shared | 6.6–8.8× |
| Labour | ~10,000 person-years | one developer, weeks | ~10⁴× |

PS4 Kratos's **face alone** is 32,000 polygons — 69% of this game's entire hero bike and rider. Note the smallest ratio in the table: raw shader throughput, at ~10×. That is the axis this plan spends on. The 34,800× axes — bytes and authored animation — are not addressable and are not attempted.

**What is achievable:** every lever that actually produces the *impression* of premium is cheap, and none of them scale with asset count.

---

## 2. The real target

**Target: the top tier of stylized racing — `art of rally`, Hot Wheels Unleashed's material read, Forza Horizon's grading discipline — delivered in a browser at 60 fps under 12 MB.**

This is not a consolation prize, and the evidence for that is specific.

**The decisive proof.** When a modder added a chase camera to `art of rally`, the *identical assets* stopped reading as premium and became, per Jalopnik, "a little too plain, a little too undercooked." Nothing changed but viewing distance. Asset density is the most expensive axis in the medium and contributes least to perceived quality, provided the camera never permits close inspection. This game's desktop camera sits at **8.85 m trailing with a 52° FOV** — already inside the regime where the trick works.

**What actually produces the premium read**, from the reference set:

1. **Camera constraint.** Dune Casu: "having it all zoomed out, being able to see everything, that's like the core of the game." The distant camera deleted pace notes as a content pipeline and produced "an exponential drop in the number of trees you need to draw."
2. **Grading discipline.** Promit Roy's analysis names Forza Horizon 3 and Breath of the Wild as the games that get tone mapping right — low-contrast, mid-tone-focused, minimal crushed blacks — and names the unmodified ACES RRT, which "was designed as a baseline for film production workflows, not direct screen output," as the single largest "looks amateur" signal. **This engine ships stock ACES at `GameEngine.ts:3514`.**
3. **Atmosphere.** Fog is what reviewers read as "hand-painted" in `art of rally`. It separates depth planes, unifies the palette, and masks the draw-distance cut. **This engine ships linear `THREE.Fog` and nothing else.**
4. **Material honesty on few hero objects.** Hot Wheels Unleashed got a diecast read from 1:64 scale rigour and correct PBR on the cars, with ordinary rooms around them.
5. **Motion feedback.** Speed comes from FOV, camera placement, shake and particles past the camera — with an explicit "less is more" caution.

**Team-size proof.** `art of rally` was a ~3-year cycle by a team that was "so small at the start of 2020 that it was a big effort bringing on more developers"; MobyGames credits ~3 programmers and ~4 artists, with Casu credited as both. Absolute Drift was essentially one person, and its palette is white plus red. **Slow Roads** is the closest analogue: a solo developer, Three.js, in the browser, everything generated client-side, ~3.2 s average boot, 97% of users under 10 s, ~52% of players sustaining >55 fps — and the recurring player reaction was "I didn't know this was possible in the browser."

**Why the target is genuinely impressive:** it is a bar essentially nobody clears on the web. The measured envelope here is 5.15 MB gzip, 60 fps at 2.03 ms mean desktop frame work, offline-capable, no install, and it already holds 60 fps under a 30-minute soak. A graded, fogged, atmospherically-lit version of exactly the geometry that ships today would sit alongside Slow Roads and above almost everything else in the browser. That is a defensible product claim; "GTA 6 in a browser tab" is not.

**What the target explicitly is not:** photoreal humans, facial performance, dialogue, or 175 GB of streamed world. Those are ruled out on the numbers in §1 and are not revisited anywhere below.

---

## 3. The two structural decisions

Everything downstream is gated on these two. Both need an owner answer before Phase 2 starts.

### 3.1 The no-skinning contract

**The current state.** Skins, bones, `SkinnedMesh`, animations and morph targets are all hard-asserted to zero (`GameEngine.ts:2216-2217, 2288-2292, 2432-2433`; `verify-hero-bike-rider-assets.mjs:235-236`). Runtime motion is code-driven pivots — six on the rider — and the frozen canvas attribute records `riderPoseStyle = "action-state-six-pivot"`.

**Recommendation: keep the no-skinning ban. Raise the node, mesh-bearing-node and render-primitive caps instead, and buy the deformation quality with rig segmentation plus analytic IK.**

> **OWNER DECISION 2026-08-31 — ACCEPTED.** Keep the no-skinning ban. Split the rider's 6 pose pivots to ~16 (elbows, wrists, knees, ankles) and add two-bone analytic IK so the rider folds on landings. No skinning, no clip library, no new bytes. The revisit condition at the end of this section stands.

Reasoning, in order of weight:

1. **Skinning does not solve the actual problem; authored animation does, and that is the one thing that cannot be afforded.** A skinned rider with no clip library is a rigid rider with extra runtime cost. RDR2's 300,000 clips at ~1.5 h average cleanup is ~225 person-years. The blocker named in `HERO_TEXTURE_ATLAS_PLAN.md` §5c is identical in kind: *the pipeline is solved and cheap; what is missing is authored content.*
2. **`SkinnedMesh` cannot batch through `InstancedMesh`.** Six riders means six skeletons and six bone textures with no instancing, against a measured emulated-mobile mean of 178.38 draw calls that is already 3.5× the ~50-call mobile guidance. The 198-spectator crowd is worse: skinned, it is 198 draw calls, which is not viable at any tier.
3. **Segmentation gets most of the readability for ~10 draw calls and zero new content.** Splitting the rider's 6 pivots to 16 (elbow, wrist, knee, ankle, chest, neck) adds **no triangles, no materials, no skins and no clips** — the geometry already exists on both sides of every joint. Two-bone analytic IK (~80 lines, no dependency) onto the five `bike-*-anchor` empties that are already in the contract makes the per-frame `frontSuspensionCompression` / `rearSuspensionCompression` values — computed today and moving nothing but a wheel's Y — visible as elbow and knee fold on every landing.
4. **There is a compliant route to real animation that does not touch the ban at all.** Vertex-animation textures ship zero skins and zero clips: bake a Mixamo loop to a ~128×64 texture and play it as a vertex-shader offset on the existing `InstancedMesh` crowd path. 198 animated spectators in ~2 draw calls.

**Cost of the decision:** `HERO_ASSET_MAX_NODES` 96 → ~120, `MAX_MESH_BEARING_NODES` 28 → ~40, `MAX_RENDER_PRIMITIVES` 28 → ~40 (`GameEngine.ts:298-300`, mirrored in `verify-hero-bike-rider-assets.mjs:72-80` and tabled at `HERO_BIKE_RIDER_VERTICAL_SLICE.md:139-151`), plus the 58-name `HERO_ASSET_PARENT_BY_NAME` map and the exact e2e pins at `e2e/reliability.spec.ts:9-17`.

**Revisit condition, stated so it is not re-litigated ad hoc:** lift the ban only if *both* (a) a physical mid-range Android measurement shows ≥6 ms of sustained frame headroom after thermal throttle, and (b) a licensed rigged humanoid **with a usable clip library** has been acquired. Skinning without (b) is cost without benefit.

### 3.2 Where art comes from

**The current state is a three-way contradiction.** `AGENTS.md:28`/`:143` and `GAME_SPEC.md:348` permit "original **or commercially licensed**" art. The per-asset contracts forbid it — `HERO_BIKE_RIDER_VERTICAL_SLICE.md:19` requires "project-authored Blender geometry and project-authored textures". The build scripts are narrower still: `build-hero-bike-rider-assets.mjs:525-531` pins one `.py` file's SHA-256 and the exact string `"4.5.11 LTS"`, so a Blender upgrade fails the build.

**This is a proof of concept: all authoring is done by AI agents, with the owner as the sole approver at every gate. No human is hired or contracted, and nothing is purchased for delivery. Every route below is agent-executable.**

**Recommendation: generate judgement cheaply and let the owner pick. Keep geometry procedural and project-authored. Reject marketplace packs for shipping. Use generative 3D as a bake source only.**

> **OWNER DECISION 2026-08-31 — ACCEPTED.** Agent-generated variant loop for look/grading, with the owner picking each pass. Procedural Blender pipeline stays the default for geometry. Generative 3D (TRELLIS / TripoSR, both MIT) is a bake source only, fed the project's own renders, never shipped raw. No marketplace packs, shipped or referenced-into-a-candidate.

Concretely, in priority order:

| Route | Verdict | Reasoning |
|---|---|---|
| **Agent-generated look-dev variant loop** | **DO THIS FIRST** | Instead of one hand-authored specification, an agent implements the grading path and generates 15–20 complete variants — tone curves, fog densities, key/rim angles, replacement `WORLD_VISUAL_PROFILES` entries — captures a frame of each through the existing `scripts/capture-baseline-candidates.mjs` path, and presents the set for the owner to choose. Lower ceiling than a professional art director, but iterative, free, and the owner is the judge either way, which is the operating model. Everything it produces is code constants and GLSL — no external asset, clean provenance. |
| **Procedural / project-authored (current pipeline)** | **KEEP AS DEFAULT** | It is the one path all three governance tiers already agree on, it needs no renegotiation, and the world is generated in code — which means "baking lighting" costs vertex attributes rather than UVs and texture bytes. Agent-authored Blender Python is the established workflow here already. |
| **Tileable PBR sets, agent-authored (Material Maker graphs or procedural bake)** | **DO** | Environment surfaces take triplanar projection and need no UV puzzle, so the measured **+75% unwrap penalty** from the hero atlas does not apply. ~0.9–1.5 MB of the 6.83 MB headroom, generated from noise/pattern graphs rather than hand-painted. |
| **Licensed marketplace packs (Synty, KayKit, Quaternius, Kenney)** | **REJECT for shipping; permit as non-shipped reference/blockout** | Forbidden by all three per-asset contracts, and Synty's style is recognisable across thousands of titles — a brand-identity problem, and it destroys the single-palette discipline that produces the premium read. Also breaches `GAME_SPEC.md:350` (no generic placeholder art in a candidate). |
| **Generative 3D (TRELLIS / TripoSR-MIT)** | **BAKE SOURCE ONLY, gated** | Output is soft and blobby with no crisp mechanical edges: usable as a high-poly sculpt to bake normal/AO from onto the existing low-poly — the exact use `HERO_TEXTURE_ATLAS_PLAN.md` §5c named as missing — useless as shipped geometry. Feed it the project's own Blender renders so provenance starts from original art. `TRELLIS` (MIT) and `stabilityai/TripoSR` (MIT) are usable; the hosted **tripo3d.ai free tier cannot ship at all** (retains all rights §5.2.1; no IP indemnity). Requires the mandatory pre-promotion similarity check drafted at `ASSET_ORIGINALITY_RULE_PROPOSAL.md:85-89`. |
| **Agent-driven hero-bike pass (generative bake source + procedural refinement)** | **DO LAST** | Closes `FIDELITY_LEDGER` item 1. An agent generates a bake-source sculpt from the project's own bike render, bakes normal/AO onto a re-authored low-poly in Blender Python, and hand-tunes the frame and engine-casing edges procedurally. Scope **bike only** — at 8.85 m and 52° the bike carries the silhouette. Held until after Phase 1, because the chase-cam evidence says a graded, fogged scene with today's hero reads more premium than an ungraded scene with a new one. |

**The contract renegotiation package** (Phase 0 — "contract" here means the asset-validation rules in the governance `.md` files, not a hire) is the enabling prerequisite for three of these: adopt the originality-rule proposal, relax the Blender-version pin to a recorded minimum, convert the zero-texture assertions to budgets of ≤3, widen the extension `deepEqual` to a superset test admitting `KHR_texture_basisu`, and convert the exact e2e triangle equalities to `<=` budgets.

---

## 4. The phased plan

Ordering principle: **global, code-only, zero-byte, all-tier changes first; measurement before spending; authored content last.** The grade and the atmosphere multiply everything that comes after them, so they go first even though they are the least visible on paper.

Effort figures are solo-developer weeks with agent assistance.

---

### Phase 0 — Instrumentation and permission (Week 1)

**Ships:** no visual change whatsoever.

- Wire `EXT_disjoint_timer_query_webgl2` into `capturePerformance` (`GameEngine.ts:~4770`) and surface GPU milliseconds alongside the existing CPU frame-work field in `scripts/performance/measure.mjs`. **The "enormous headroom" claim currently has no GPU number behind it.**
- Run the existing headed-measurement harness against a **physical mid-range Android** (Adreno 720 / Mali-G715 MP7 class) on the current clean build, held 10–15 minutes so thermal throttle engages. Every mobile number in the release attestation is scoped `emulated-mobile-local-technical-floor-not-physical-device-proof`.
- Fix the three stale `ASSET_LICENSES.md` rows (hero GLB recorded at 517,664 B / `538be426…` against a shipping 317,936 B / `e26ff81a…`; panorama and title background likewise). This violates `AGENTS.md:30` today and must be clean before any new row is added.
- Put the contract renegotiation package (§3.2) to the owner as a single yes/no.

**Why first:** two of the three most expensive downstream decisions are gated on a number that does not exist yet, and the permission package has a lead time measured in owner availability, not developer hours.

**Cost:** 1 week. **Artist:** no.

**What the owner sees:** a GPU-millisecond figure for the first time; a real-phone sustained-FPS curve with throttle visible; a clean asset inventory; one decision document requiring a signature.

---

### Phase 1 — Colour, tone and atmosphere (Weeks 2–3)

**Ships (all code-only, ~10 KB gzip total, works on every tier including Low):**

1. **Authored tone curve replacing stock ACES.** Swap `THREE.ACESFilmicToneMapping` (`GameEngine.ts:3514`) for `THREE.CustomToneMapping` with a globally-overridden `tonemapping_pars_fragment` exposing toe lift, shoulder strength, linear-section slope and white point. Re-tune the five per-venue exposures (1.08/1.13/1.17/1.12/1.08 at `:716-787`) against the new curve and add a per-venue white point.
2. **Fix the two surfaces that bypass tone mapping entirely.** The dust material (`:6076`) and the player contact shadow (`:3353-3362`) both set `toneMapped: false` — they render in a different colour response from every other pixel in the frame. Decide that deliberately rather than by accident.
3. **Exponential-squared height fog with sun inscatter.** Override `fog_fragment` / `fog_pars_fragment` once at module scope — one edit reaching every `MeshStandardMaterial`, no extra pass, no extra draw call. Add a world-height term so valleys hold haze while ridgelines clear, and tint toward the venue sun colour by `pow(dot(viewDir, sunDir), k)`. ~8–12 ALU per opaque fragment; **zero bandwidth**, which is the correct side of the tile-GPU trade.
4. **Replace `RoomEnvironment` with a procedural venue sky for IBL.** `createPbrEnvironment()` (`:3725-3748`) currently PMREMs a *box room with area lights* and uses it as the image-based lighting for five outdoor venues including a canyon and a coastline. This is the largest single IBL error in the renderer. `PMREMGenerator.fromScene` over a sky dome built from each venue's existing background/fog/sun colours plus a ground bounce costs one init-time render and zero per-frame work — and it finally makes the per-material `envMapIntensity` tuning (1.72 metals, 1.55 visor, 0.5 rubber at `:2106-2116`) mean something, because the metals will reflect sky instead of a studio ceiling.
5. **Yaw-tracking backdrop dome.** The Canyon panorama is screen-locked: `updateEnvironmentTextureTransform()` (`:4683`) aspect-fits it to the viewport and it does not move when the camera yaws, which is exactly why it reads as a painted flat. An inward-facing cylinder (radius ~900, 48 segments, `BackSide`, `depthWrite: false`, `fog: false`) parented to camera position but not rotation parallaxes with yaw and holds still under pitch. **+1 draw call.**

**Why this order:** it is the only phase that improves the Low tier, where all three hero lights are currently exactly 0. It changes zero bytes and zero assets, so it needs no contract, no service-worker bump and no licence row. And it is the multiplier — every later phase looks better through a good grade and worse through a bad one.

**Cost:** 2 weeks, agent-executed. **Authoring:** none required — the agent-generated variant loop (§3.2) feeds items 1 and 3 as parameter tables. Land an agent-tuned version first; the winning variant replaces the constants without touching the code.

**What the owner sees:** the same six baseline captures the review process already uses, side by side, old curve and new. Same geometry, same triangle counts, same download size — a materially different-looking game. This is the phase where "competent but flat" (recorded independently in `RC2_RECONCILIATION_2026-07-25.md` §10 and `FIDELITY_LEDGER.md:287-288`) stops being true.

---

### Phase 2 — Motion: camera, rig, particles, trackside (Weeks 4–7)

**Ships:**

1. **Speed-reactive camera.** `CAMERA_PRESENTATION_PROFILES` (`:691`) are two frozen constant blocks; the only speed response in the entire camera is `speedLift` adding ≤0.58 of height. Convert every field to a speed-evaluated function: FOV 50→62, trailing 8.85→10.2, look-ahead 19.2→26, lateral offset easing to centre at speed. Add a turbo FOV punch with slow release, a landing dip on the existing `cameraShake` accumulator, and a roll coupled to the already-computed `steeringRoll`. Reduced Motion must degrade to a **fixed** FOV, not a slower lerp.
2. **Rider rig: 6 pivots → 16, plus two-bone analytic IK.** Per §3.1. Elbow, wrist, knee, ankle, chest, neck; IK driving gloves onto `bike-*-hand-anchor` and boots onto `bike-*-boot-anchor` in bike-local space, so steering and suspension propagate automatically. ~+10 draw calls on the hero, **zero added triangles**.
3. **Per-joint critically-damped springs replacing cross-fades**, ~12 authored poses over the new joints (tuck, lean L/R, wheelie, three air attitudes, hard landing, two crash silhouettes, recovery hold, get-up), and a deterministic crash ragdoll seeded from the impact impulse so replays and ghosts stay reproducible. Extend `src/game/engine/__tests__/poseSeparation.test.ts` to the new joints and raise its threshold in the same commit — it is already built as a ratchet.
4. **Rival field variation.** Five rivals are clones driven by one pose function in lockstep. A deterministic per-entrant phase offset and per-joint amplitude scalar, plus staggered action-state thresholds, is a few dozen lines, zero bytes and zero draw calls. Skip IK on rivals entirely.
5. **Single-draw GPU dust replacing the per-particle-material pool.** `createDustPool()` (`:6062-6078`) constructs a `MeshBasicMaterial` **inside** the allocation loop, so 34 High-tier particles are 34 draw calls that cannot batch, each CPU-billboarded by `lookAt` at three sites. One `Points`/`InstancedMesh` with vertex-shader billboarding is **one** draw call and lifts the ceiling to 200–400 particles at lower cost than 34 today. Then add the emitters the game has none of: rear-wheel roost scaled by throttle and surface, wheel spray distinguishing mud/grass/dirt, landing puffs at both contact points, speed debris. Preserve `data-grounded-dust-burst-count` and the `reducedMotion` early-outs verbatim.
6. **Instanced vertex-shader trackside motion.** One shared `uTime` uniform via `onBeforeCompile` plus per-instance attributes: wind on grass tufts / agaves / trees with a height mask so bases stay planted and gust strength scaling with player speed; two-axis flap on the existing banner `InstancedMesh` (`:9007`); crowd bob-and-cheer phase with a burst amplitude hooked to the existing `captionEvent(..., "crowd")` sites. Zero CPU per object.

**Why this order:** motion is the second-cheapest premium signal after grading, it is entirely code, and the dust fix is *net negative* on cost — roughly −33 draw calls off a 327-call desktop mean. Item 2's cap raise is the only contract touch, and it is the cheap half of the §3.1 decision.

**Cost:** 3–4 weeks. **Artist:** no.

**What the owner sees:** this phase must be reviewed **in video, not stills** — its entire value is in motion. A landing where the rider's knees and elbows actually fold; a rooster tail; a field of five rivals that are no longer five copies of one puppet; grass and banners that move; a camera that opens up at speed.

---

### Phase 3 — Reclaim the budget (Weeks 8–10)

**Ships:**

1. **Corridor ring-buffer instancing across all 79 `InstancedMesh` sites.** Every scenery instance for the whole course currently exists and is submitted every frame — the reason the desktop mean is 327 draws with a soak peak of 423, and why the emulated-mobile 178 is already 3.5× the mobile guidance. Keep placements in a typed array sorted by course progress; each frame write only the corridor window into the matrix buffer and set `mesh.count`. Phase 1's fog hides the far cut, so the window can be tight — fogFar for silhouette classes, 60–80 m for tufts and pebbles. **Scenery density stops being a per-tier constant and becomes a local density: the same submitted count, several times denser where the camera can see.**
2. **A real LOD chain.** There is exactly **one** `THREE.LOD` in 9,661 lines (`festival-signal-tower-lod`, `:9138`). Add a two-level chain for the eleven Canyon kit roots switching at ~70 m to merged single-material silhouettes generated in the same Blender build script.
3. **Texture and download reclamation.** Recompress the Canyon panorama (1,668,228 gzip bytes of PNG) to KTX2 ETC1S at 2048×1024: expect 250–400 KB on disk and **~8.4 MB → ~1.4 MB of GPU memory**, because a PNG fully decompresses to RGBA in VRAM while KTX2 stays block-compressed. The decoder is already shipped and wired (`src/game/assets/compressedAssetLoader.ts:9`). De-duplicate the Basis wasm, currently shipping twice at 244,541 gzip bytes each. Convert `title-background.png` (2,030,905 gzip bytes for an image that is never a GPU texture) to AVIF q60.

**Targets, measured, before any later phase is allowed to spend:** desktop p95 under **220** draw calls, physical-mobile p95 under **90**, download down ~**3 MB**.

**Why this order:** Phases 4–6 all spend frame budget and bytes. This phase creates the budget they spend, and it does so while the changes are still cheap to validate. Do not do Phase 5 before this.

**Cost:** 2–3 weeks. **Artist:** no.

**What the owner sees:** a before/after draw-call chart from the on-screen HUD (`renderer.info.render.calls`, surfaced at `GameView.tsx:1116`), a download that dropped by roughly 3 MB, and — visibly — noticeably denser scenery near the road at a lower cost than today's sparse-everywhere placement.

---

### Phase 4 — One merged composite pass (Weeks 11–12) — **gated on Phase 3 measurement**

**Ships:** an `EffectComposer` built from three's own bundled `examples/jsm/postprocessing/*` (**not** a new `pmndrs/postprocessing` dependency), with exactly **two** passes: `RenderPass` into an offscreen RT, then one `RRRCompositePass` doing everything else in a single fragment shader and a single DRAM round-trip — bloom composited **before** tone mapping (which is the whole reason for moving the curve off the renderer), the Phase 1 tone curve, a per-venue 32³ LUT sampled tetrahedrally from a procedurally-generated `DataTexture` (zero shipped bytes), vignette, grain, and the radial speed-blur / chromatic-aberration terms from Phase 2 folded in as extra taps on the same input.

Bloom is dual-filter (Kawase) at ¼ resolution — ARM measures this as smoother than an optimized Gaussian at the same cost, in the sub-1 ms class rather than the ~3 ms class of a stock bloom chain.

**Tier policy, enforced and asserted via a `data-post-chain` canvas attribute:** High/desktop gets RGBA16F with `samples: 4` (recovering the MSAA lost by leaving the default framebuffer); Medium gets RGBA8 with tone mapping still in-material; **Low keeps today's direct render untouched**. RGBA16F is High-only because at Medium's 527×1139 / DPR 1.35 a half-float pass is ~9.6 MB/frame ≈ 576 MB/s, above ARM's entire observed 200–400 MB/s mobile envelope.

**Why gated:** this is the only phase that *adds* bandwidth, and mobile bandwidth is the binding constraint. It also requires the owner to formally reverse `GRAPHICS_TOOLCHAIN.md`'s "Deferred tools" decision. **Answer that decision's reasoning rather than ignore it:** obstacle-silhouette contrast and HUD legibility become explicit pass/fail acceptance criteria on the new baselines. Grid Legends is the cautionary case — a complete post-processing feature list that "looks almost identical to GRID 2019." A post chain is table stakes, not distinction; it is here to composite bloom pre-tonemap and to host the LUT, not as a checklist.

**Budget:** ≤1.5 ms added on Medium, ≤0.8 ms on desktop High, ¼-res bloom chain under 1 ms. **Bytes:** under 20 KB gzip.

**Cost:** 1.5–2 weeks, agent-executed. **Authoring:** the LUT is the winning output of the §3.2 variant loop.

**What the owner sees:** highlight bloom that reads as light rather than as a filter, per-venue colour identity, and — measured — the GPU-millisecond delta on the physical phone from Phase 0's harness.

---

### Phase 5 — Authored surfaces (Weeks 13–19)

**Ships:**

1. **4–6 tileable 1024² KTX2 PBR sets** (dirt, rock face, timber, banner fabric, painted metal) authored in Material Maker, applied with triplanar blending and stochastic sampling — the Slow Roads technique for getting more apparent detail from smaller sources. This targets `FIDELITY_LEDGER` items 2 and 3 (flat repeating terrain, stacked-box canyon walls), which cover far more screen pixels than the hero does, and the +75% unwrap penalty **does not apply** because environment surfaces take planar projection. Net GPU-memory win: replaces runtime 2D-canvas rasters that decode to raw RGBA with block-compressed KTX2 (Khronos measured 78–82% GPU savings on that swap).
2. **Vertex-colour terrain wear plus a decal ribbon.** Low-frequency noise written into a `COLOR` attribute at ribbon-build time — sun-bleached crowns, damp inside-of-corner shadow, darker wear down the racing line — kills the visible tiling at zero texture cost. Then one alpha-tested decal ribbon at +0.002 m sampling a 512² UASTC atlas of eight authored marks (racing-line polish, braking ruts, berm scuff, ramp chevrons, grid paint, puddle, gravel scatter, chalk), placed from a per-track `{progress, lane, index, scale, rotation}` array so marks land on the corners that matter. **Never displace the dirt ribbon** — it is gameplay-adjacent; the grass ribbon only.
3. **Canyon kit v2:** swept-profile cut banks with noise-displaced top edges and a 0.15–0.3 m bevel on every silhouette edge (a bevel is the cheapest thing that stops a procedural mesh reading as a primitive, because it gives every edge a specular highlight), plus vertex-colour strata bands and AO-to-vertex-colour. Needs the owner to raise the 70-mesh ceiling at `scripts/build-canyon-assets.mjs:249` to ~110 and the kit byte ceiling to ~900 KB.
4. **Four painted 2048×1024 KTX2 backdrops** for Pine, Coastline, Foundry and Summit, which currently fall back to a 128×512 canvas gradient with a radial sun blob — which is why four of five venues have no horizon identity. ~350 KB each, driven through the existing panorama load path with its working timeout and fallback. Paid for by Phase 3's reclamation: net **−0.14 MB** for five venues with painted horizons versus one today.
5. **VAT crowd.** 3–4 project-authored low-poly spectators (400–900 tris), auto-rigged through Mixamo, 4–6 loops baked to ~128×64 vertex-animation textures and played as vertex-shader offsets on the existing instanced path. Ships **zero skins and zero clips**, so it does not touch the §3.1 ban. Replaces 198 route + 132 start unanimated capsules — the one deficiency a trailing camera cannot hide, because static figures at 8.85 m read as dead scenery.

**Cost:** 5–7 weeks, agent-executed. **Authoring:** items 1 and 3 are agent-generated procedural graphs and vertex-colour bakes; items 2 and 4 are agent-generated (decal atlas and horizon backdrops), with the owner selecting from a batch of candidates rather than commissioning a painter.

**What the owner sees:** ground that reads as raced-on rather than modelled, canyon walls that read as rock, five venues with distinct horizons, and a crowd that moves.

---

### Phase 6 — The hero bike, agent-rebuilt (Months 5–7)

**Ships:** a re-detailed hero bike inside the existing 40,000-triangle bike budget with an agent-authored UV layout and a 1024² KTX2 basecolor + packed ORM + normal atlas, baked from a generative sculpt of the project's own bike render (§3.2, generative-as-bake-source) and refined in Blender Python, delivered as `.blend` plus GLB. **Bike only, not bike+rider.**

**Cost:** agent-executed over the phase window; no purchase. Hero GLB goes 317,936 B → ~700–900 KB, inside the owner-raised 1.2 MB ceiling.

**Why last:** the chase-cam evidence is unambiguous — a graded, fogged, well-lit scene with the *current* hero reads more premium than an ungraded scene with a new one. Doing this first buys the least. It also breaks the most contract surface of any lever, so Phase 0's package must have landed.

**Hard constraint:** the rebuild must reproduce `GameEngine.ts:192-255` (58 required node names with parents, `+X` spin on `FrontTire`/`RearTire`, identity transforms on three roots, neutral rotation/scale on 13 hooks) and `:277-292` (10 material names with roughness/metallic ranges) **verbatim**, or it fails `npm run assets:verify`. The agent authoring the Blender Python builds the node map first and validates against the verifier before detailing — the node contract is the acceptance test, not an afterthought.

**What the owner sees:** the object that carries the silhouette, finally matching the concept.

---

### Cumulative ledger

All phases are agent-executed. The column below is where the owner's eye is
needed — where an agent generates candidates and the owner picks — versus pure
infrastructure the owner only signs off.

| Phase | Weeks | Owner picks a look | Δ gzip bytes | Δ desktop draws | Contract touched |
|---|---:|---|---:|---:|---|
| 0 Instrumentation | 1 | no (decision gate only) | 0 | 0 | package put to owner |
| 1 Colour + atmosphere | 2 | **yes** — grade/fog variants | +~10 KB | +1 | none |
| 2 Motion | 3–4 | yes — feel tuning | +~15 KB | −20 net | hero node/primitive caps |
| 3 Budget reclaim | 2–3 | no (infra) | **−3.0 MB** | **−110** | canyon mesh ceiling |
| 4 Composite pass | 1.5–2 | **yes** — final LUT | +~20 KB | +0 (2 passes) | reverses toolchain deferral |
| 5 Authored surfaces | 5–7 | **yes** — surfaces, backdrops, crowd | +~1.5 MB net −0.1 | +2 | canyon ceilings, licence rows |
| 6 Hero bike | 8–12 | **yes** — the bike | +~0.5 MB | 0 | hero method rule, e2e pins |

Ending position: roughly **4.5–5.5 MB gzip** against the 12,000,000-byte ceiling, desktop draws near 220, physical-mobile draws near 90.

---

## 5. What was refuted — do not attempt these

| Claim / approach | Verdict | Why |
|---|---|---|
| "GTA 6 level artwork on this platform" | **Impossible**, not merely hard | §1. The binding ratios are 34,800× on footprint and ∞ on authored animation. No engineering choice moves them. |
| Tiling detail normals on the hero | **Structurally impossible** | Optimized `TEXCOORD_0` must be normalized unsigned 16-bit and cannot exceed [0,1]. Recorded at `FIDELITY_LEDGER.md:322-336`. |
| Baked occlusion atlas on the hero | **Works, and is imperceptible** | glTF `occlusionTexture` becomes Three.js `aoMap`, which attenuates *indirect* light only — and this hero is dominated by the direct three-point rig. Shipped end-to-end, measured, reverted (`HERO_TEXTURE_ATLAS_PLAN.md` §5b). |
| Procedurally-generated normal map on the hero | **Works, and looks worse** | Machined ribbing on metal, corduroy on the rider, the `22` plate obscured — because the angle-based per-mesh UV layout carries no semantic relation to the part's form. No amplitude or feature-size adjustment fixes it (§5c). |
| Any UV atlas on the hero as a cheap win | **Costs +75%, not +15–25%** | Measured: 317,936 → 555,216 B for the unwrap **alone**, three times the plan's own prediction. |
| WebGPU migration as a fidelity lever | **Reject** | `AGENTS.md:36-48` pins WebGLRenderer and three@0.185.1; WebGPU is 85.6% coverage vs WebGL2's 95.7%, skewing to cheap Android and old Safari; naive ports routinely *regress* (a Babylon user measured 20 fps WebGPU vs 50 fps WebGL2 on the same scene). WebGPU wins only when you restructure around compute — which nothing here needs. |
| Engine migration (PlayCanvas / Babylon / Godot / Unity) | **Already decided against** | `GRAPHICS_TOOLCHAIN.md` (2026-07-16). Unity's *own* manual labels its WebGPU backend "Experimental… not recommended to use for production". |
| Marketplace asset packs, shipped | **Reject** | Forbidden by all three per-asset contracts; Synty's style is recognisable across thousands of titles; breaches `GAME_SPEC.md:350`; destroys palette discipline. Reference/blockout use only, untracked. |
| Tripo free tier | **Cannot ship** | Tripo retains all rights (§5.2.1). No IP indemnity; the user indemnifies Tripo. |
| Generative 3D for the bike | **Reject** | Image-to-3D output is soft with no crisp mechanical edges. It cannot produce the frame, plastics or engine casing — the exact parts the ledger complains about. |
| Skinned riders / skinned crowd | **Reject at current budget** | `SkinnedMesh` cannot batch through `InstancedMesh`. 198 skinned spectators = 198 draw calls against a ~50-call mobile guidance. See §3.1 for the revisit condition. |
| Full-res SSR | **Reject** | three.js consensus: the single biggest post-processing performance killer, "can totally kill performance for many devices". |
| TAA, full-res SSAO, motion blur, full-res DoF | **Reject on mobile** | Each is an extra full-screen pass = a DRAM round-trip on tile-based GPUs, where the entire observed envelope is 3.4–6.5 MB **per frame**. |
| Depth-aware soft particles | **Reject for now** | Needs a depth texture, i.e. an extra pass or MRT; neither survives the Medium bandwidth budget. A slightly hard particle intersection is the correct trade. |
| A complete post-processing feature checklist | **Not a differentiator** | Grid Legends exposes the full AAA settings list and "looks almost identical to GRID 2019". |
| "$2 billion GTA 6 budget" | **Unsourced** | Originates from a hacker claim and forum speculation, not a filing. |
| "WebGPU gives 15× performance"; "Unity 7 ships WebGPU as the default web target"; "Poki requires <8 MB initial" | **Failed primary-source verification** | All three appear only in the AI-generated SEO cluster and are contradicted by, or absent from, vendor documentation. |

---

## 6. What this does not solve

- **Photoreal characters, faces, or performance capture.** No facial rig, no blendshapes, no lip sync, no dialogue. Not attempted; see §1.
- **Authored animation volume.** Even with 16 pivots, springs and IK, this game has zero authored clips against RDR2's 300,000. Rider motion remains procedural. The VAT crowd is the single exception and it is four loops.
- **The hero bike's hard-surface silhouette**, until Phase 6. Phases 1–5 make the bike better *lit* and better *framed*; they do not make it better *modelled*. The ledger's item 1 stays open until the agent-driven hero-bike pass runs.
- **The rider's anatomy** beyond joint segmentation. A parametric rebuild inside the existing Blender pipeline (`ring_shell` lofts, Subsurf level 1 with creases on fabric regions only, per-region smoothing angles) is available and has headroom — the rider is 11,908 triangles against a 30,000 cap — but it is not scheduled above, because it competes directly with Phase 6 for the same review attention.
- **Device coverage beyond the one phone measured.** Phase 0 retires the "emulated only" caveat for a single mid-range Android part. It says nothing about iOS Safari's ~300–500 MB WebGL heap, its 224–256 MB canvas ceilings, or its context-loss history under memory pressure. That needs its own pass.
- **Owner acceptance.** Every phase from 1 onward invalidates the visual baselines. `GAME_SPEC.md:389` requires side-by-side review against the concepts before promotion, and no plan can pre-authorise that. Batch promotions per phase, not per commit.
- **The rc.3 review package.** The Phase 0 contract edits re-bind the hash-bound contract `.md` files into their asset manifests, which is a product-bytes change and invalidates the package currently awaiting signature. It will need re-signing either way; better to absorb that once, at the start.
- **Gameplay, simulation, audio, or UI.** Out of scope. The one adjacent item worth naming: `title-background.png` at 2,030,905 gzip bytes is half the download and belongs to the UI workstream, but Phase 3 claims it because nobody else has.

---

## 7. First week — concrete

Nothing below changes a pixel, and none of it is throwaway.

**Day 1 — GPU timing.** Wire `EXT_disjoint_timer_query_webgl2` into `capturePerformance` (`GameEngine.ts:~4770`); surface GPU ms next to the existing CPU frame-work field in `scripts/performance/measure.mjs`. Run the desktop rendering and stress profiles. Record the first GPU number this project has ever had.

**Day 2 — physical device baseline.** Run the existing headed-measurement harness against a mid-range Android over the current clean build, held 10–15 minutes so throttle engages. Record drawCalls, frame work and sustained FPS as a curve, not a mean. Budget the result against **15–20 ms**, not 16.67 — throttling costs 30–50% within 5–15 minutes. This is the go/no-go number for Phases 2, 4 and 5.

**Day 3 — clean the inventory.** Correct the three stale `ASSET_LICENSES.md` rows against `shasum -a 256` on the shipping files. Verify `npm run assets:verify` and `scripts/verify-production-art.mjs` still exit 0.

**Day 4 — the tone curve, behind an A/B.** Create `src/game/engine/render/toneCurve.ts` exporting the GLSL chunk and its constants; wire it at `GameEngine.ts:3514`. Run `scripts/capture-baseline-candidates.mjs` twice — stock ACES and authored curve — so the comparison is the same signed frames the owner already reviews under the 41 frozen attributes. No new harness needed.

**Day 5 — the two decisions, in writing.** Put §3.1 (keep the no-skinning ban; raise the caps to ~120/40/40) and §3.2 (agent-generated variant loop; procedural default; no shipped packs; generative as bake source only; hero-bike pass last) to the owner as two yes/no questions, with the Day 4 A/B attached as the evidence that Phase 1 is worth two weeks. State plainly that Phase 5 and Phase 6 cannot start until the contract package (the asset-validation rules) lands, and that the rc.3 package needs re-signing either way.

**Parallel — kick off the variant loop.** Run `npm run visual:capture` for the six native-resolution reference frames, then have an agent produce the first batch of 15–20 graded/fogged variants of Day 4's frame set for the owner to react to. This is the §3.2 look-dev route running immediately, in-house, at no cost — the loop tightens over the following week from the owner's picks.

---

## 8. Acceptance discipline

Three rules, so this plan cannot quietly become a series of unreviewed baseline promotions:

1. **Every phase promotes baselines once, at its end**, under `GAME_SPEC.md:389` side-by-side review. Not per commit.
2. **Every phase that touches the frame reports a GPU-millisecond delta on the physical phone**, from the Phase 0 harness. A phase that cannot show its cost does not ship.
3. **Obstacle-silhouette contrast and HUD legibility are pass/fail acceptance criteria** from Phase 4 onward, because that is the specific risk `GRAPHICS_TOOLCHAIN.md` named when it deferred post-processing, and reversing a decision means answering its reasoning, not ignoring it.

---

## 9. Overnight autonomous run — 2026-08-31 → 09-01 (capture-the-flag)

Owner directive: "capture the flag mode, keep going until 9am CEST." Agents-only,
owner as sole approver. Everything below is committed to `agent/rc2-launch-
hardening` and pushed. Every change was capture-verified or gate-verified; no
change was committed on a claim I could not show.

### Landed (5 commits)

| Commit | What | Evidence |
|---|---|---|
| `04adec6` | **Authored display grade** replacing stock ACES — Khronos PBR Neutral base + punch (S-contrast, saturation, warm/cool split). `?tone=custom\|neutral\|agx\|aces` switch. | 4-variant Canyon capture; custom clearly most premium, agx milky, aces washed. typecheck/lint/vitest/assets:verify all 0. |
| `b6d8a55` | **Cinematic vignette** — subtle radial corner darkening added to the HUD scrim. Frames the scene, reinforces HUD legibility. | Before/after capture; tasteful, zero cost/bytes. |
| `a4eaaab` | **Speed FOV kick** — camera widens 52°→~59° with speed (eased, reduced-motion-suppressed, zero at frozen start). Velocity in the body. | Stationary vs at-speed capture; base/frozen unaffected. 106 engine tests pass. |
| `dcdcff1` | **ASSET_LICENSES reconciliation** — 15 stale rows (hero pipeline, package.json, 3 manifests, 2 art PNGs, concept source) updated to shipped bytes/SHA. AGENTS.md §3 compliance. | Full re-scan: 0 stale tracked rows. assets:verify=0. |
| `0ff5d51` | **GPU frame timing** — `EXT_disjoint_timer_query_webgl2` wrapper, exposed on HUD + canvas `data-gpu-frame-ms`. The measurement Phase 0 was blocked on. | `data-gpu-timing="available"`, zero console errors in a real WebGL2 context. 358 tests pass. |

The grade is the marquee win — it lifts every frame. Vignette and FOV compound
it. Net effect: a noticeably more premium, more dynamic-feeling game, with **zero
new bytes and zero asset churn**.

### Tried and rejected (honestly, so they are not re-attempted)

- **Exponential (FogExp2) fog** — imperceptible versus the tuned linear fog. The
  camera is low and the track is long, so exp2 hazes the mid-track as much as the
  distance, which is exactly why the original author used linear with a protected
  `near` plane. Reverted. Real atmosphere gain needs a custom height-fog shader
  (Phase 4-class, risky), not a swap.
- **Hero light boost / low-tier enable** — imperceptible on the desktop frames;
  the rear chase camera does not see the spotlights' effect, and sun+hemisphere
  dominate. Low-tier enable adds unmeasurable mobile GPU cost. Reverted.
- **WebP for the two big PNGs (3.56 MB → 0.26 MB, measured)** — **blocked by a
  governance control, not infeasible.** `verify-production-art.mjs` requires
  shipped generative art to carry a C2PA `caBX` provenance chunk (a PNG feature);
  WebP strips it. This is an owner decision (see below), not something to bypass
  overnight. Fully reverted, tree clean.

### Deferred as owner-gated (not attempted overnight)

- **Rider anatomy / rig segmentation.** The bike renders genuinely well; the
  rider is the blocky element. Two paths, both deferred: (a) elbow/knee
  segmentation touches ~10 synchronized fail-closed surfaces (node contract, pose
  solver, validator caps, e2e triangle pins, manifest, ASSET_LICENSES) and its
  payoff is motion-transient; (b) reshaping the rider geometry has 20k triangles
  of headroom (rider is 9,868 of a 30,000 cap) but is subjective and churns the
  hero GLB (new hashes → invalidates the release package, needs a re-sign). Both
  are the exact thing the owner is the approver for and rejected once. Blender
  rebuild + preview render is confirmed working headless, so this is ready to do
  **with the owner in the loop**, fast, via the preview-render feedback cycle.

### Owner decisions that now gate further progress

1. **Tone mode** — pick the final `?tone=` (custom shipped as default; neutral is
   the tamer alternative). One capture away.
2. **Provenance format for compressed art** — to unlock the measured 3.3 MB WebP
   win, either accept C2PA-in-WebP (XMP), relax the `caBX` requirement for
   re-encoded derivatives of already-provenanced sources, or keep PNG. This is
   the single biggest byte lever and it is a governance call.
3. **Rider approach** — segmentation vs geometry reshape vs leave-as-is, and
   acceptance that either regen invalidates the current release package.

### Clean resume point

Tree is clean, all gates green, 5 commits pushed. The grade's `?tone=` switch and
the GPU timer are the two hooks a next session builds on: the variant loop to
finalise the look, and the first real GPU number to gate any Phase-2+ render cost.

## 10. Cinematic grade run — owner-gate #1 resolved (2026-09-01)

The owner rejected the first six `custom-*` variants and the three `cine-teal/
noir/golden` follow-ups as "too subtle — they all look the same", then asked for
a "moodier / cinematic" look. Root cause: every one of those grades was a small
nudge (±6 % contrast/saturation) of the same bright daylight LUT.

Method (multi-agent, ultracode):
- **Design panel** — 10 agents, one per film reference (Blade Runner 2049, Mad
  Max, The Matrix, Sin City, Dune, John Wick, Se7en, O Brother, Sicario, Tron),
  each authoring a *bold* GLSL grade (real desaturation, deep contrast, strong
  casts, exposure drops), then a hardening pass to validate the GLSL and push any
  timid ones. All 10 compiled and rendered on the Canyon frame.
- **Judge panel** — 3 diverse lenses (cinematographer, game-UX/legibility,
  brand) scored all 11 looks from the render montage. Consensus top-3: Dusk
  Patrol (Sicario), Neon Night (John Wick), Dystopian Dusk (Blade Runner).
  Unanimous **avoid**: Basin City noir, Tron, Matrix — bold but legibility 1.7–2.0,
  the lanes/rival bikes vanish at racing speed.
- **Owner pick:** Neon Night, gated on "verify across all 5 venues first". The
  five-venue pass found Neon Night's 0.62 exposure drop crushes the already-dark
  **Foundry** (and Pine); a lifted **v2** (exposure 0.62 → 0.76, shadow pivot
  0.30 → 0.33, palette unchanged) recovered legibility on the dark venues while
  keeping the night mood everywhere.

**Decision:** `DEFAULT_TONE_MODE = "cine-night"` (Neon Night v2). Shipped
variants trimmed to a clean set: the `custom` family (previous bright look, still
selectable via `?tone=custom…`) plus `cine-night` (default), `cine-dusk`
(Sicario), `cine-blade` (Blade Runner). The other seven experimental grades were
not shipped; their GLSL recipes live in the design/judge workflow transcripts and
regenerate in seconds if a marketing-only look (e.g. noir) is later wanted.

**Downstream consequence (owner-gated):** flipping the default changes every
rendered frame, so the checked-in visual-regression baselines will fail until
re-promoted through `visual:promote:canyon` — a governed step, not done here.
