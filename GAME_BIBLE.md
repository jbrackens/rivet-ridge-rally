# RIVET RIDGE RALLY — Game Bible

**Document status:** Product direction with post-RC1 acceptance revision

**Implementation status:** Post-`1.0.0-rc.1` corrective working revision; the tagged RC1 remains historical evidence and the revised candidate must be requalified in `QA_REPORT.md`

**Release status:** NOT READY

**Latest-change validation:** `UNVERIFIED` while automated and browser qualification remains paused

## High concept

RIVET RIDGE RALLY is a fast, readable 3D arcade motocross game set in a traveling toy-diorama racing festival. Players choose among four marked lanes, manage turbo heat, shape jumps with bike pitch, and read obstacle rhythms at speed. Short races invite immediate retries, while campaign targets, rivals, and a local track editor create long-term mastery.

The game should feel generous enough for a new player to finish a first race and deep enough for an expert to improve lines, turbo timing, landings, and recovery decisions over many attempts.

## Design pillars

### Read the track, then commit

Upcoming lanes, surfaces, ramps, cooling gates, riders, and landing zones must remain legible at racing speed. A good decision should be visible before it is required.

### Expressive arcade handling

The motorcycle is intentionally authored rather than governed by generic rigid-body physics. Lane choice, wheelies, airborne pitch, clean landings, turbo timing, heat, and recovery create a compact but expressive skill set.

### Pressure without hidden cheating

Rivals follow the same visible terrain, heat, obstacle, collision, and recovery rules as the player. Difficulty changes planning quality, consistency, and recovery skill—not merely top speed. Any rubber-banding must be subtle, optional, and rule-consistent.

### Fast failure, fair recovery

Crashes and overheating have clear causes, strong audiovisual feedback, and bounded penalties. Hold-to-recover is the default. Results explain lost time and offer useful coaching. Retry and restart are immediate.

### Build locally, play safely

The editor is a complete local creative mode, not an online platform. Tracks can be saved, validated, test-played, and exported as bounded JSON without accounts, public browsing, comments, chat, or public sharing services.

Release safety follows the same honest-local principle. The shell-v35 cache is populated from fresh same-origin responses, stores one freshly fetched index response under both root entry keys, and includes the bundled display fonts, `/assets/3d/hero-bike-rider.glb`, `/assets/rivals/rival-pack.glb`, and the Canyon modular GLB; it is discarded if installation leaves a partial current-generation cache. Production smoke binds its runtime commit and browser evidence to every byte recorded by the exact format-2 release manifest, verifies served bytes before and after the journey, separately proves that the served root is the same index on the same credential-free origin, exercises cached Practice while offline, and atomically retains each run under its manifest identity instead of overwriting historical proof. Those latest safeguards are implemented in source but remain `UNVERIFIED` until the paused qualification run resumes.

## Audience and session shape

- Broad age and skill appeal, with no prerequisite genre knowledge.
- First-play tutorial target: under three minutes.
- Standard event: two laps and a short, replayable session.
- Campaign motivation: qualify, race rivals, unlock the next venue, then master Summit Showdown.
- Creator motivation: assemble and refine local tracks using the same readable modules as the campaign.

## World and tone

The Rivet Ridge Rally is a colorful festival tour built around compact handcrafted race parks. Oversized track pieces, banners, spectator props, service gantries, cooling equipment, and scenery make each location feel like a physical toy diorama. The tone is playful, energetic, and competitive without hostility.

All names, visuals, layouts, vehicles, riders, icons, music, sound, writing, and promotional material must be original or commercially licensed and recorded in `ASSET_LICENSES.md`.

## Launch tracks

Each track must have its own palette, obstacle rhythm, difficulty curve, scenery, and mastery lesson. Standard campaign races use two laps.

| Track | Theme and palette | Skill focus | Obstacle rhythm and progression role |
|---|---|---|---|
| **Canyon Kickoff** | Warm sandstone, turquoise cooling gates, cream lane paint | Fundamentals, lane reading, first wheelies, clean landings | Wide sightlines and separated hazards introduce bumps, mud, ramps, and cooling. It is the tutorial-adjacent opening venue. |
| **Pine Run** | Deep green forest, amber dirt, red trail markers | Surface choice, rapid lane changes, controlled recovery | Alternating mud pockets, roots/bumps, barriers, and staggered ramps reward deliberate lines rather than constant turbo. |
| **Coastline Clash** | Cobalt water, sunlit sand, coral accents | Heat routing, speed retention, jump timing | Longer exposed straights raise heat pressure; cooling gates compete with faster risky lines and chained coastal jumps. |
| **Foundry Flight** | Charcoal steel, orange furnace light, cyan safety paint | Complex jump chains, precision landings, rival awareness | Industrial gantries frame compact ramp sequences, lane blockers, banked changes, and high-commitment transfers. |
| **Summit Showdown** | Icy blue stone, violet dusk, high-visibility yellow | Full-system mastery under pressure | Large elevation reads, technical mud/grass tradeoffs, super-jump equivalents, pursuers, and escalating mastery modifiers form the endgame. |

Three additional polished example tracks must be created with the shipping editor. They are separate from the five handcrafted campaign tracks and must demonstrate the editor's validation, winding checkpoint-authored centerline, elevation range, and module vocabulary.

## Modes and progression

### Solo Challenge

- No direct AI interference.
- Shows current lap, lap and checkpoint splits, final time, personal best, best time, and a visible third-place qualification target. A completed Solo run keeps its current timings visible beside signed comparisons with the standing personal-best lap/split timings; only a faster final time replaces that saved timing set.
- Beating the third-place target unlocks that track's Rival Main Race.
- Production targets are calibrated against a clean standard-Ride two-lap reference with human margin rather than an impossible maximum-speed fantasy. Current Solo targets are 190, 208, 224, 239, and 259 seconds in campaign order; tighter values require recorded full-course deterministic qualification.

### Rival Main Race

- A readable AI field using normal route followers and pressure-building pursuers.
- Shows live position, lap, timing, and final classification.
- Finishing third or better unlocks the next campaign track.

### Practice

- Available for every unlocked track.
- Supports learning lines and mechanics without campaign pressure.
- Provides quick restart and return paths.

### Summit mastery

Summit Showdown remains replayable after campaign completion with escalating, clearly disclosed goals or modifiers. Mastery must not rely on hidden rule changes. One shared configuration supplies both the HUD and progression gate: the seven current targets are 257, 255, 253, 251, 249, 248, and 247 seconds while starting heat rises from 35% to 65%.

## Core riding language

### Four lanes

Four clearly marked lanes create discrete, intentional choices. Lane changes are quick enough to react but committed enough to matter. Lanes differentiate passing space, mud, bumps, ramps, barriers, cooling gates, and landing options.

### Throttle, turbo, and heat

- Standard Ride approaches a fixed 62% safe heat ceiling without exceeding it on its own.
- Turbo provides an obvious speed advantage and continuously adds heat.
- Turbo can push beyond that safe ceiling into warning and overheat territory.
- Turbo remains controllable for at least 11 seconds from cold and at least 4 seconds from the normal 62% operating ceiling before lockout.
- A prominent meter and escalating visual/audio warnings precede overheating; gamepad warning feedback is optional where supported.
- Overheating forces a short, readable loss-of-control or recovery state until cooling completes.
- Cooling zones are visible before entry and reduce heat immediately.
- Turbo before ramps and hazards must offer a tactical advantage rather than a cosmetic speed effect.

### Pitch, wheelies, and landings

- Pulling back raises the front wheel; pushing forward lowers it.
- Airborne pitch changes trajectory, landing angle, retained speed, and crash risk.
- Short wheelies clear small bumps; holding them too long becomes unsafe.
- A controlled grounded wheelie clears a striped barrier but retains only 60% of entry speed; a front-wheel-down barrier hit still causes a crash, for player and rivals alike.
- Clean two-wheel landings preserve momentum.
- Bad landings cause a readable crash or meaningful speed penalty.

### Terrain and recovery

Dirt is the racing baseline. Grass and track edges slow the bike, mud slows it more sharply, and bumps, ramps, jump chains, barriers, cooling gates, large jumps, and high-risk super jumps create the track vocabulary. Crashes default to hold-to-recover; the prompt names the active device's recovery control and reports recovery progress semantically as well as visually. Rapid tapping may exist only as an optional retro setting.

## Rival rules

- Route-following rivals choose sensible lines through visible obstacles.
- Pursuers apply pressure from behind without ignoring terrain or heat.
- The player striking another rider from behind crashes the player.
- A pursuer striking the player's rear wheel crashes the AI rider.
- Rivals also collide with one another after every live and official-classification fixed step: for each grounded same-lane rear impact inside one symmetric forgiveness distance, the faster rider arriving from behind crashes, independent of field ordering, and an already disabled or finished rider cannot retrigger the pair.
- Collision forgiveness, animation, camera, and sound must explain contact clearly.
- Easy, Standard, and Expert difficulty change route planning, consistency, decision quality, and recovery skill.
- Results summarize time, target gap, position, crashes, overheats, and optional coaching.

## First-play tutorial

The interactive tutorial begins paused behind an input-adaptive rider-school map for Ride, Turbo, lanes, pitch, recovery, and pause. Rider School always opens its canonical Canyon training route, including when the player returns directly from an editor Test Ride. It is one lap, must take under three minutes, and requires the player to complete these 12 guided riding lessons in a safe sequence:

1. Hold Ride to build usable speed and read the run/position, lap/time, and target HUD; Turbo alone does not clear the foundational Ride lesson.
2. Release Ride and Turbo to coast; the game has no separate brake action.
3. Commit one lane per left/right press.
4. Use Turbo to gain speed and reach the critical heat warning.
5. Release Turbo and pass through a cyan, snowflake-marked cooling gate.
6. Hold a controlled wheelie over a bump.
7. Command nose-up and nose-down airborne pitch, then release toward neutral.
8. Land nearly level on both wheels.
9. Read the named striped lane-choice barrier and either move to an open lane for full speed or use a controlled wheelie to clear it with heavy speed loss; an unrelated avoided hazard does not count.
10. Experience mud slowdown.
11. Experience grass/off-track slowdown and return to the marked dirt.
12. Lower the front wheel, hit the final training barrier, and hold Recover through a real crash-and-recovery cycle.

Each riding lesson requires fresh evidence after that lesson becomes active; an earlier lane move, jump input, surface touch, or crash may remain in the recap but cannot clear a later lesson. Multi-part lessons enforce their stated order. A completed lesson freezes the simulation for the 550 ms presentation handoff without discarding held Ride or Turbo input, so the next release-based lesson still requires the player to release the control deliberately.

Every active riding lesson also offers **Retry this lesson**. It returns the bike to the training start with fresh lesson evidence and reusable one-shot obstacles while preserving every earlier completed marker and the cumulative recap. This focused retry clears locally held keyboard/touch commands; the separate pause-menu restart still resets the full route and checklist.

Two contact-rule drills follow the riding lessons. Prompts and the final six-control recap cover Ride, Turbo, lanes, pitch, recovery, and pause; they adapt to the active keyboard, remapped keyboard binding, gamepad, or touch scheme and never rely on color alone. Pause freezes the lesson; the training pause surface offers resume, a full route/checklist restart, and a return path explicitly labeled as skipping training. The first finish crossing therefore either reaches the fully earned completion action or restarts the incomplete route/checklist with an explanation. Completing or explicitly skipping training persists, while replay remains available through the main-menu Rider School action.

## Controls philosophy

- Keyboard, gamepad, phone touch, and tablet touch are first-class play methods.
- Fresh keyboard profiles use `ArrowLeft` and `ArrowRight` for lane changes and `ArrowUp` and `ArrowDown` for pitch. `A` and `D` are not default lane controls, but remain valid explicit remap choices.
- Only the exact historical stored pair `A`/`D` migrates to the arrow-key lane defaults; a player-customized pair is preserved.
- Menus are fully keyboard navigable.
- Pause/resume is always reachable during gameplay.
- Remapping is supported where practical and conflicts are explained.
- Touch controls include a left-handed/mirrored layout.
- Portrait touch controls use an original cream pictogram set: broad lane chevrons, bike-plus-pitch arrows, a bike/rider Ride mark, and a turbine Turbo mark. Ride and Turbo retain visible text, and every button retains its explicit accessible name.
- Touch controls remain real buttons for pointer, keyboard, and assistive-technology activation. Held controls communicate `aria-pressed`, and Pitch Up/Pitch Down behave as one exclusive direction so a stale release cannot cancel the newer choice.
- Gamepad prompts update by device family where reliable; vibration is optional and never the only warning.

## Track editor fantasy

Players operate a readable 3D build camera and place lane-aware modules on a four-lane route surface. Checkpoints can shape a smooth local turn and rise; the Builder surface, lane guides, modules, camera, saved thumbnail, and Test Ride must consume the same deterministic centerline. The editor offers at least 19 original modules spanning ramps, bumps, jump chains, mud, cooling, barriers, curves/banks, and a high-risk super jump. Placement preview, duplicate, delete, rename, thumbnail, one-to-nine laps, 50-action undo/redo, confirmation-based clear, validation, save, test play, and a local library are mandatory. Invalid red-preview or keyboard candidates never enter the draft. A keyboard-only rider can choose a module, route-view position, and lane and place it without the canvas. Phone layouts retain Export/Import, inspection/repair controls, validation detail, and live notices rather than hiding core authoring or recovery paths. If device saving becomes unavailable, a valid draft still launches as an in-memory Test Ride while the editor keeps its session-mode and Export guidance honest.

Import/export is intentionally defensive: corrupt, malicious, oversized, incompatible, overlapping, or otherwise invalid JSON is rejected with actionable errors. Imported content never executes code or loads arbitrary network resources.

## Visual direction

- Chunky, readable low-poly forms and deliberate per-track palettes.
- Strong hierarchy between dirt, grass, lane paint, mud, cooling gates, hazards, riders, and scenery.
- Original bikes and riders with silhouettes readable at gameplay distance.
- Essential HUD only: position, lap, timer, target, heat, and actionable feedback.
- Camera framing prioritizes the rider silhouette, marked lanes, upcoming obstacles, and landing zones from its first rendered frame. The protected portrait presentation applies whenever the viewport is taller than wide or narrower than 680 CSS pixels.
- Each venue uses its own lighting, exposure, fog distance, and scenery-density profile rather than a single global atmosphere.
- Canyon Kickoff and Rider School use an original, provenance-recorded red-rock/festival far-background matte behind the live Three.js course. It should deepen the sky and venue silhouette across desktop and portrait crops without flattening the readable 3D lanes, hazards, riders, or trackside props into backdrop art.
- Canyon's two unique cooling-gate showcase locations use live bilateral, staffed elevated watchtowers beyond the course fence, with mirrored teal/coral roofs and two, three, or four deck spectators on Low, Medium, or High. The raised silhouettes should make the cyan gate corridor read as a staffed festival venue on both desktop and portrait layouts while preserving the full gate silhouette, lane reads, snowflake cues, and landing sightline; they remain decorative rather than a second hazard or cooling affordance.
- The dirt color layer, non-color surface relief, and lane-divider geometry remain separate: painted guides stay flat and readable while shallow ruts, clods, and sculpted grass berms catch light without changing bike physics.
- High-contrast cues belong to the visible route: campaign stripes clear sculpted berms, while custom-course stripes follow authored curves, banks, heights, and rotations and preserve fallback cues wherever an authored strip is buried.
- Terraced course edges, sculpted lane ridges, and denser theme-specific scenery make the route read as a built festival diorama instead of a road floating through sparse props. Canyon Kickoff and Rider School use a continuous cream/coral/teal modular safety wall with the timber fence behind it; other handcrafted venues retain shorter festival-zone runs, while editor-authored courses omit this straight campaign treatment.
- `docs/design/concepts/track-builder.png` is the Track Builder composition reference: the live Builder and Test Ride must read as one compact, connected, winding four-lane diorama, with gates, lane guides, modules, camera focus, and elevation attached to the same route rather than independent props on an endless straight.
- Handcrafted tracks and Rider School open on a code-native four-lane start stencil numbered `1`–`4`; authored Test Rides exclude it so the builder's saved Start Grid remains visually authoritative.
- Mobile lane/pitch and Ride/Turbo controls use stronger scale, contrast, depth, and separation plus the original rally pictogram set while retaining safe reach, readable Ride/Turbo labels, explicit accessible names, and mirrored layout support.
- At the 320 CSS-pixel fallback with UI scale at 140%, the steering, throttle, and heat groups must remain in-bounds and non-overlapping in both handed layouts, with 44×44 CSS-pixel minimum touch targets.
- Avoid generic dashboard cards, default engine UI, excessive gradients, stock-icon misuse, random rounded panels, and visibly temporary meshes.

The desktop and mobile gameplay concepts remain references for composition, hierarchy, richness, rider readability, track depth, and control presence, not pixel-accurate screenshots. The owner rejected the previous blanket acceptance of materially coarser and less-dense output. The post-RC1 rendering changes therefore reopen concept fidelity: they are proposed improvements, not accepted evidence, until renewed side-by-side owner review is recorded.

## Audio direction

Original or properly licensed audio must cover engine load/turbo, landing quality, crashes, overheating, cooling, wind, terrain, crowds, UI, and music. Gameplay-critical cues receive captions or equivalent visual indicators. Master, music, and SFX volumes are separate.

## Accessibility and comfort

- Reduced motion and reduced screen shake are independent settings.
- High contrast and colorblind-safe redundant indicators preserve hazard readability.
- UI scaling supports comfortable use from narrow phones through ultrawide displays. At maximum scale, the race HUD and controls remain separated through the 320–780 px touch range, and short-phone Rider School cards retain a vertically scrollable action area.
- Critical sound cues have captions/subtitles.
- No essential information depends on color, vibration, audio, or motion alone.

## Out of scope for RC1

- Accounts, cloud profiles, payments, ads, third-party tracking, public chat, public track browsing, comments, and open UGC sharing.
- Server-trusted leaderboards or multiplayer infrastructure.
- WebGPU as a production requirement. It may be investigated only behind a flag after WebGL parity.
- A generic vehicle physics model that determines game feel.

## Creative acceptance bar

The game is not creatively complete when systems merely exist. Each track must be finishable, readable, visually coherent, meaningfully distinct, and accepted against the relevant concept direction; controls must invite mastery; feedback must make mistakes understandable; and every shipped asset must have recorded provenance. Automated screenshot stability cannot substitute for concept-fidelity or first-time-player comprehension review. These criteria require browser playtesting and renewed owner acceptance and cannot be marked complete from this document alone.
