# RIVET RIDGE RALLY — Game Specification

**Status:** Normative RC1 requirements; implementation tracked in `QA_REPORT.md`

**Current milestone:** Phase 1 documentation baseline

**Current release decision:** NOT READY

This document defines the behavior required for RC1. “Must” and “shall” statements are acceptance requirements, not claims about the current workspace. Evidence and current results belong in `QA_REPORT.md`.

## 1. Product boundaries

RIVET RIDGE RALLY shall be an original, commercially launchable 3D browser motocross game. It shall run without an account, payment, advertising, public chat, public track discovery, public UGC services, or third-party tracking by default.

The shipping renderer shall use direct Three.js scene/gameplay code and `WebGLRenderer`. React may render menus, HUD, settings, results, and editor panels, but shall not own simulation, AI, rendering, or high-frequency input loops.

## 2. Race lifecycle

The application shall implement an explicit flow equivalent to:

`boot → load profile → title → mode/track selection → loading → countdown → racing ↔ paused → finished → results → retry/restart/menu`

Failure branches shall cover unsupported browsers, offline state where needed, asset failure, recoverable save corruption, and retry. A race restart shall reset simulation deterministically without requiring a page reload or unnecessary menu traversal.

Standard races shall run for two laps. The start/finish line and ordered checkpoints shall prevent shortcut completion and duplicate lap credit.

## 3. Launch tracks

The build shall contain five handcrafted tracks:

| Order | Track | Theme | Primary skill |
|---:|---|---|---|
| 1 | Canyon Kickoff | Open sandstone festival canyon | Fundamentals, lane reading, clean landings |
| 2 | Pine Run | Dense forest trail park | Surface choice, rapid lane changes, recovery |
| 3 | Coastline Clash | Sunlit coastal course | Heat routing, cooling choices, jump timing |
| 4 | Foundry Flight | Industrial foundry arena | Jump chains, precision, rival awareness |
| 5 | Summit Showdown | High-altitude dusk finale | Combined-system mastery and modifiers |

Each shall have a unique layout, obstacle rhythm, difficulty curve, visual identity, palette, scenery set, and skill focus. All shall have valid ordered checkpoints and be completable in every applicable mode.

## 4. Modes and progression

### 4.1 Solo Challenge

- Shall contain no direct AI interference.
- Shall display current lap, current time, lap splits, final time, personal best, best time, and a continuously visible third-place qualification target.
- Beating the track's third-place target shall unlock its Rival Main Race.
- Personal bests and splits shall persist locally.

### 4.2 Rival Main Race

- Shall include a readable field of AI riders.
- Shall display live position, current lap, timing, and complete finishing results.
- Finishing third or better shall unlock the next campaign track.
- Results shall show time, target gap where applicable, position, crashes, overheats, and optional coaching.

### 4.3 Practice

- Shall be available for all unlocked tracks.
- Shall preserve the full handling model while removing qualification pressure.
- Shall expose immediate restart and return controls.

### 4.4 Campaign and mastery

- Initial progression shall make Canyon Kickoff available.
- Solo qualification unlocks that track's Rival Main Race.
- A top-three Rival finish unlocks the next track.
- Unlock transactions shall be idempotent and survive refresh and browser restart.
- Summit Showdown shall remain replayable with escalating, visible mastery goals or modifiers.

## 5. Simulation and handling

### 5.1 Timing

- Gameplay simulation shall advance at a fixed 60 Hz (`1/60` second steps).
- Input shall be sampled independently of React rendering.
- Rendering may interpolate between the latest completed simulation states.
- Large frame gaps shall be clamped and the number of catch-up steps bounded to prevent a spiral of death.
- Pause shall stop gameplay time without corrupting timers, input state, or interpolation.

### 5.2 Lanes

- Every race surface shall present four marked, readable lanes.
- Lane changes shall be quick, intentional, bounded, and meaningful for passing, mud avoidance, jump setup, barriers, and cooling zones.
- Lane occupancy and transitions shall be represented in simulation state, not inferred from React or visual position alone.

### 5.3 Throttle, turbo, and heat

- Standard throttle shall accelerate the bike while approaching a safe temperature ceiling.
- Turbo shall create a measurable speed advantage and continuously add heat.
- The HUD shall show a prominent heat meter.
- Escalating visual and audio warnings shall occur before overheating; vibration may supplement but never replace them.
- Overheating shall force a bounded recovery or loss-of-control state until the bike cools.
- Visible cooling zones shall reduce heat immediately on valid contact.
- Turbo timing before ramps and hazards shall change attainable trajectory or speed retention enough to support tactical choice.

### 5.4 Pitch, jumps, and wheelies

- Pull-back input shall raise the front wheel; push-forward input shall lower it.
- Airborne pitch shall influence jump height/distance, landing angle, retained speed, and crash risk.
- Releasing pitch input while airborne shall return the bike progressively toward a level attitude rather than leaving the last commanded angle fixed.
- A controlled wheelie shall clear small bumps.
- In ordinary race modes, keeping pull-back held while the bike remains in a wheelie for 1.4 seconds shall become unstable and cause a readable, recoverable crash; releasing pull-back or lowering the front wheel shall reset that continuous-hold window.
- A clean two-wheel landing shall preserve momentum.
- A bad landing shall cause either a readable crash or substantial speed loss according to a documented landing envelope.

### 5.5 Surfaces and obstacles

The launch content shall include dirt, grass/track-edge slowdown, mud slowdown, small bumps, ramps, jump chains, large jumps, barriers, cooling zones, and a high-risk super-jump equivalent. Curves or banked terrain shall be used where appropriate. Surface and obstacle effects shall be deterministic enough for reproducible QA.

### 5.6 Crashes and recovery

- Crashes shall communicate cause through animation, camera response, sound, caption/visual feedback, and results telemetry.
- Hold-to-recover shall be the default input.
- Recovery duration and respawn placement shall be fair and shall not create a repeat-crash loop.
- Rapid-tap recovery, if offered, shall be optional and disabled by default.

## 6. AI and rider collisions

### 6.1 Behaviors

At least two behavior families shall ship:

- **Route followers:** select and execute obstacle-aware lane plans.
- **Pursuers:** create pressure from behind while obeying the same world rules.

AI riders shall use the same terrain modifiers, collision rules, heat model, obstacle consequences, and recovery constraints as the player.

### 6.2 Collision outcomes

- If the player strikes another rider from behind, the player shall crash.
- If a pursuing rider strikes the player's rear wheel, the AI rider shall crash.
- Forgiveness windows shall prevent visually ambiguous grazing contact from producing severe outcomes.
- Contact response shall remain understandable through pose, effect, sound, camera, and results data.

### 6.3 Difficulty

Easy, Standard, and Expert shall vary decision quality, consistency, route planning, obstacle anticipation, and recovery skill. Speed-only scaling is insufficient. Any rubber-banding shall be optional, subtle, disclosed in settings, and constrained by visible game rules.

## 7. Tutorial and input

### 7.1 Tutorial

The first-play tutorial shall be interactive and use its dedicated 1,200-unit production Canyon training course in both normal and QA builds. It shall not depend on a QA-only compressed race. The course shall safely sequence a cooling gate, wheelie bump, launch ramp and landing, mud, a lane-choice obstacle, and grass/off-track terrain, with enough remaining route that crossing the finish cannot bypass the contact drills.

The tutorial shall retain cumulative mechanic demonstrations across lesson changes and advance only after the current requirement has been observed. In order, the player shall demonstrate:

1. Standard throttle and usable forward speed.
2. Turbo, its speed benefit, and the critical heat warning.
3. Releasing turbo and passing through a cooling gate.
4. A committed lane change.
5. A controlled wheelie over a bump.
6. Airborne pitch control, including returning toward level with neutral pitch input.
7. A clean landing.
8. Mud slowdown followed by grass/off-track slowdown.
9. Both Rival collision rules: the rider who strikes from behind crashes, whether that rider is the player or a pursuing rival.

Tutorial mode shall use the same fixed-step handling rules as normal racing except that its continuously held wheelie window shall be 6 seconds rather than the ordinary 1.4 seconds. The longer finite window shall allow a first-time player to demonstrate the mechanic without making excessive wheelies permanently safe.

The complete sequence, including both contact drills, shall reach the training-cleared state in under three minutes during recorded QA without skipping any lesson.

Tutorial completion shall persist, while replay shall remain available.

### 7.2 Input methods

- Keyboard play and keyboard-only menu navigation shall be complete.
- Gamepads shall support appropriate prompts and optional vibration where the browser permits.
- Phone and tablet shall have touch controls sized for safe use.
- Touch controls shall support a left-handed/mirrored layout.
- Pause/resume shall work from all play methods.
- Controls shall be remappable where practical; invalid conflicts shall receive clear errors.
- Switching active input shall update prompts without dropping held-state cleanup.

## 8. HUD, camera, and results

- The race HUD shall be limited to position, lap, timer, qualifying target, heat, and actionable feedback.
- Solo may omit position; Practice may omit target pressure.
- Critical information shall never depend on color alone.
- The race camera shall keep upcoming obstacles and landing zones visible and avoid preventable occlusion.
- Reduced-screen-shake settings shall affect crash and landing responses.
- Results shall offer immediate retry/restart and an understandable return path.

## 9. Track editor

### 9.1 Core tools

The editor shall provide:

- a 3D build camera;
- snap-grid and lane-aware placement;
- placement preview with valid/invalid feedback beyond color alone;
- at least 19 original terrain/obstacle modules;
- multiple ramp shapes/heights, bumps, jump chains, mud, cooling zones, barriers, curves/banked terrain where appropriate, and a super-jump equivalent;
- delete, duplicate, rename, thumbnail, test play, save, and local library;
- clear-all with confirmation;
- undo/redo preserving at least 50 actions;
- selectable lap counts from one through nine.

Test play shall consume the validated authored route directly: start/finish and every ordered checkpoint, selected lap count, module lane and route position, rotation, height, curve/bank surface geometry, and obstacle behavior must match the saved placement data. It shall not substitute fixed checkpoint ratios or a generic obstacle layout.

### 9.2 Validation

Saving for normal play shall require:

- a complete drivable route;
- valid start, finish, and ordered checkpoints;
- no impossible module overlap;
- valid collision bounds;
- a declared difficulty estimate.

Errors shall identify the affected module or route segment and suggest a correction where possible.

### 9.3 Persistence and interchange

- Editor data shall use a versioned local schema and migration path.
- JSON export shall contain data only, with a documented schema/version and bounded size.
- Import shall reject malformed, malicious, oversized, incompatible, non-finite, out-of-bounds, overlapping, or semantically invalid content with clear errors.
- Import shall never evaluate code or fetch arbitrary external assets.
- Three polished example tracks authored in the editor shall ship and pass the same validation as player tracks.

## 10. Persistence

IndexedDB shall store versioned local profiles, settings, progress, personal bests/splits, custom tracks, and replays if replays ship. Requirements:

- explicit database and record schema versions;
- sequential, tested migrations;
- atomic upgrade behavior and safe fallback;
- corruption detection, recovery messaging, and preservation/export where possible;
- bounded storage and graceful quota failure;
- no credential, account, or tracking dependency.

## 11. Accessibility and responsive UI

The settings/UI shall provide:

- reduced motion;
- reduced screen shake;
- high-contrast mode;
- UI scaling;
- captions/subtitles for gameplay-critical audio;
- master, music, and SFX volume controls;
- colorblind-safe, redundant indicators;
- no essential color-only communication.

High-contrast mode shall toggle real 3D lane-divider and track-edge guide geometry during an active race. Cooling gates shall remain recognizable without color through a visible snowflake-shaped 3D cue; barriers, mud, grass, and ramps retain their stripe, rut, tuft, and rail silhouettes.

Layouts shall be verified at 16:9 desktop, ultrawide, tablet, phone, and narrow-width fallback sizes. Focus order, visible focus, labels, semantic controls, keyboard traps, target sizes, clipping, safe areas, and text scaling shall be tested. Touch UI shall not obscure critical track reads.

## 12. Art and audio requirements

- The visual identity shall be bright, chunky, colorful, low-poly, coherent, and original.
- Track, lane paint, hazards, mud, grass, cooling zones, riders, UI, and scenery shall have a deliberate hierarchy.
- Each track shall use a limited, intentional palette.
- UI, icons, typography, animation, effects, vehicles, riders, sounds, writing, and layouts shall be original or commercially licensed.
- Temporary meshes, generic dashboard styling, excessive gradients, inconsistent stock icons, and default engine widgets shall not remain in RC1.
- Original or licensed engine, landing, crash, crowd, wind, UI, music, and terrain audio shall be inventoried.

## 13. Performance and compatibility

| Area | RC1 requirement |
|---|---|
| Desktop | Target 60 FPS at 1920×1080 on a representative current desktop browser |
| Mobile | Target 30 FPS on a representative mid-range mobile browser |
| Stability | No persistent hitching during jumps, crashes, restart, AI, loading, or editor test play |
| Initial gameplay assets | Target under 12 MB compressed where practical |
| Quality | Low, Medium, High, and Auto |
| Desktop browsers | Current Chrome, Safari, Firefox, and Edge |
| Mobile browsers | Current Chrome Android and Safari iOS where available |
| Production build | No TypeScript errors, console errors, missing assets, or broken required requests |

QA shall record FPS, frame time, memory, draw calls, compressed asset size, initial load, first-race load, restart, and editor test-play time. Unavailable real hardware shall be labeled `UNVERIFIED`, never inferred from emulation.

## 14. Reliability and security

- Loading, retry, offline, unsupported-browser, and asset-failure states shall be implemented and tested.
- Save corruption and migration failure shall recover safely without a crash loop.
- No credentials, API keys, private tokens, or secrets shall exist in source control or the client bundle.
- Dependency vulnerabilities shall be audited; known critical vulnerabilities block RC1.
- A 30-minute continuous session shall show no runaway memory growth, accumulating input lag, crash loop, or save corruption.
- Analytics, if ever added, shall be privacy-conscious, documented, easy to disable, and outside the default RC1 requirement.
- Future leaderboards must validate scores server-side and shall never trust browser-submitted scores.

## 15. QA and acceptance

- Vitest shall cover deterministic units and state transitions.
- Playwright shall cover real-browser flows from fresh load through a completed race and a saved/reloaded custom track.
- Axe checks and keyboard-only journeys shall cover menus and settings.
- Screenshot comparisons shall cover key screens and required responsive widths.
- Manual browser/device, soak, performance, gamepad, touch, and gameplay-fairness results shall be recorded in `QA_REPORT.md`.

No requirement becomes `PASS` merely because code exists. It requires a named test or recorded manual procedure, environment, date, result, and evidence. RC1 is permitted only when mandatory requirements pass, except honestly documented hardware-specific `UNVERIFIED` cases and genuine external blockers.
