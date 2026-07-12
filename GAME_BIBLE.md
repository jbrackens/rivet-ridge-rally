# RIVET RIDGE RALLY — Game Bible

**Document status:** Phase 1 product direction

**Implementation status:** Playable `1.0.0-rc.1` candidate; final release gates are tracked in `QA_REPORT.md`

**Release status:** NOT READY

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

Three additional polished example tracks must be created with the shipping editor. They are separate from the five handcrafted campaign tracks and must demonstrate the editor's validation and range.

## Modes and progression

### Solo Challenge

- No direct AI interference.
- Shows current lap, lap splits, final time, personal best, best time, and a visible third-place qualification target.
- Beating the third-place target unlocks that track's Rival Main Race.

### Rival Main Race

- A readable AI field using normal route followers and pressure-building pursuers.
- Shows live position, lap, timing, and final classification.
- Finishing third or better unlocks the next campaign track.

### Practice

- Available for every unlocked track.
- Supports learning lines and mechanics without campaign pressure.
- Provides quick restart and return paths.

### Summit mastery

Summit Showdown remains replayable after campaign completion with escalating, clearly disclosed goals or modifiers. Mastery must not rely on hidden rule changes.

## Core riding language

### Four lanes

Four clearly marked lanes create discrete, intentional choices. Lane changes are quick enough to react but committed enough to matter. Lanes differentiate passing space, mud, bumps, ramps, barriers, cooling gates, and landing options.

### Throttle, turbo, and heat

- Standard throttle approaches a safe temperature ceiling.
- Turbo provides an obvious speed advantage and continuously adds heat.
- A prominent meter and escalating visual/audio warnings precede overheating; gamepad warning feedback is optional where supported.
- Overheating forces a short, readable loss-of-control or recovery state until cooling completes.
- Cooling zones are visible before entry and reduce heat immediately.
- Turbo before ramps and hazards must offer a tactical advantage rather than a cosmetic speed effect.

### Pitch, wheelies, and landings

- Pulling back raises the front wheel; pushing forward lowers it.
- Airborne pitch changes trajectory, landing angle, retained speed, and crash risk.
- Short wheelies clear small bumps; holding them too long becomes unsafe.
- Clean two-wheel landings preserve momentum.
- Bad landings cause a readable crash or meaningful speed penalty.

### Terrain and recovery

Dirt is the racing baseline. Grass and track edges slow the bike, mud slows it more sharply, and bumps, ramps, jump chains, barriers, cooling gates, large jumps, and high-risk super jumps create the track vocabulary. Crashes default to hold-to-recover; rapid tapping may exist only as an optional retro setting.

## Rival rules

- Route-following rivals choose sensible lines through visible obstacles.
- Pursuers apply pressure from behind without ignoring terrain or heat.
- The player striking another rider from behind crashes the player.
- A pursuer striking the player's rear wheel crashes the AI rider.
- Collision forgiveness, animation, camera, and sound must explain contact clearly.
- Easy, Standard, and Expert difficulty change route planning, consistency, decision quality, and recovery skill.
- Results summarize time, target gap, position, crashes, overheats, and optional coaching.

## First-play tutorial

The interactive tutorial must take under three minutes and require the player to demonstrate, in a safe sequence:

1. Standard throttle.
2. Turbo and its speed benefit.
3. Heat warnings and a cooling zone.
4. Lane changes.
5. A controlled wheelie over a bump.
6. Airborne pitch.
7. A clean landing.
8. Mud and off-track slowdown.
9. Rival collision rules.

Prompts adapt to the active keyboard, gamepad, or touch scheme and never rely on color alone.

## Controls philosophy

- Keyboard, gamepad, phone touch, and tablet touch are first-class play methods.
- Menus are fully keyboard navigable.
- Pause/resume is always reachable during gameplay.
- Remapping is supported where practical and conflicts are explained.
- Touch controls include a left-handed/mirrored layout.
- Gamepad prompts update by device family where reliable; vibration is optional and never the only warning.

## Track editor fantasy

Players operate a readable 3D build camera and place lane-aware modules on a snap grid. The editor offers at least 19 original modules spanning ramps, bumps, jump chains, mud, cooling, barriers, curves/banks, and a high-risk super jump. Placement preview, duplicate, delete, rename, thumbnail, one-to-nine laps, 50-action undo/redo, confirmation-based clear, validation, save, test play, and a local library are mandatory.

Import/export is intentionally defensive: corrupt, malicious, oversized, incompatible, overlapping, or otherwise invalid JSON is rejected with actionable errors. Imported content never executes code or loads arbitrary network resources.

## Visual direction

- Chunky, readable low-poly forms and deliberate per-track palettes.
- Strong hierarchy between dirt, grass, lane paint, mud, cooling gates, hazards, riders, and scenery.
- Original bikes and riders with silhouettes readable at gameplay distance.
- Essential HUD only: position, lap, timer, target, heat, and actionable feedback.
- Camera framing prioritizes upcoming obstacles and landing zones.
- Avoid generic dashboard cards, default engine UI, excessive gradients, stock-icon misuse, random rounded panels, and visibly temporary meshes.

## Audio direction

Original or properly licensed audio must cover engine load/turbo, landing quality, crashes, overheating, cooling, wind, terrain, crowds, UI, and music. Gameplay-critical cues receive captions or equivalent visual indicators. Master, music, and SFX volumes are separate.

## Accessibility and comfort

- Reduced motion and reduced screen shake are independent settings.
- High contrast and colorblind-safe redundant indicators preserve hazard readability.
- UI scaling supports comfortable use from narrow phones through ultrawide displays.
- Critical sound cues have captions/subtitles.
- No essential information depends on color, vibration, audio, or motion alone.

## Out of scope for RC1

- Accounts, cloud profiles, payments, ads, third-party tracking, public chat, public track browsing, comments, and open UGC sharing.
- Server-trusted leaderboards or multiplayer infrastructure.
- WebGPU as a production requirement. It may be investigated only behind a flag after WebGL parity.
- A generic vehicle physics model that determines game feel.

## Creative acceptance bar

The game is not creatively complete when systems merely exist. Each track must be finishable, readable, visually coherent, and meaningfully distinct; controls must invite mastery; feedback must make mistakes understandable; and every shipped asset must have recorded provenance. These criteria require browser playtesting and cannot be marked complete from this Phase 1 document alone.
