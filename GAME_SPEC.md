# RIVET RIDGE RALLY — Game Specification

**Status:** Normative requirements for the post-`1.0.0-rc.1` candidate; implementation and executed evidence are tracked in `QA_REPORT.md`

**Current milestone:** Post-RC1 corrective revision; input, tutorial, and visual acceptance are being requalified

**Current release decision:** NOT READY

**Latest-change validation:** Scoped working-tree automation/browser/asset/smoke/performance diagnostics pass their named gates; visual, frozen-candidate, owner/legal, and release acceptance remain `UNVERIFIED`

This document defines the behavior required for RC1. “Must” and “shall” statements are acceptance requirements, not claims about the current workspace. Evidence and current results belong in `QA_REPORT.md`.

## 1. Product boundaries

RIVET RIDGE RALLY shall be an original, commercially launchable 3D browser motocross game. It shall run without an account, payment, advertising, public chat, public track discovery, public UGC services, or third-party tracking by default.

The shipping renderer shall use direct Three.js scene/gameplay code and `WebGLRenderer`. React may render menus, HUD, settings, results, and editor panels, but shall not own simulation, AI, rendering, or high-frequency input loops.

## 2. Race lifecycle

The application shall implement an explicit flow equivalent to:

`boot → load profile → title → mode/track selection → loading → countdown → racing ↔ paused → finished → results → retry/restart/menu`

Failure branches shall cover unsupported browsers, offline state where needed, asset failure, recoverable save corruption, and retry. A race restart shall reset simulation deterministically without requiring a page reload or unnecessary menu traversal.

For every non-tutorial race, the loading state shall hold the fixed-step simulation and race clock at zero until the essential hero bike-and-rider presentation either loads atomically or selects its safe built-in fallback. Hero-asset readiness shall have a five-second deadline: a request that rejects, fails hierarchy/bounds validation, or remains unsettled at that point shall be canceled through its isolated loader, shall leave the complete already-present procedural bike and rider visible, and shall terminate its texture-worker resources; any result that still settles late shall be discarded without changing the active race. A valid detached hero scene shall resolve all required bike, wheel, rider, pose-pivot, and anchor nodes before both authored presentation groups are installed and both procedural groups are hidden in one handoff; a partial bike-only or rider-only state is prohibited. Canyon Kickoff and Rider School shall additionally settle both the authored Canyon modular GLB or its complete procedural-scenery fallback and the original festival-canyon far-background or its procedural-sky fallback, each through an independent five-second bounded loader. A failed, unsupported, canceled, invalid, or late Canyon model/background request shall never block play beyond its deadline, remove the procedural fallback, replace an active scene after readiness, or affect simulation. A visible `3 → 2 → 1 → GO` gate shall follow. The `GO` label shall be presented by the browser before the engine enters its racing phase; rider input and gameplay time shall begin on that immediate handoff, never before the player can see `GO` and never after an unexplained visual delay. Hiding the page during loading/countdown shall leave the race paused when the gate completes rather than starting unseen. Tutorial mode retains its explicit player-operated Lesson 1 start instead of stacking a second countdown over Rider School, and its engine shall remain paused until that action.

Before the countdown is shown, the engine shall publish an authoritative initial HUD snapshot. Target time, field size, lap count, and other pre-start values shall come from the selected race simulation rather than UI placeholders.

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

Canyon Kickoff shall frame each of its two unique cooling-gate showcase locations with a left/right pair of live, staffed elevated watchtowers beyond the course fence; Rider School shall use one bilateral pair around its single training cooling gate. Low, Medium, and High shall place two, three, and four spectators on each raised deck respectively, with mirrored teal/coral canopy identity. The complete cooling-gate silhouette, all four lane reads where applicable, redundant snowflake cues, and forward landing sightline shall remain unobscured. This treatment shall be presentation-only, shall not add a second cooling affordance, and shall not be inherited by editor-authored Test Ride courses that reuse Canyon's palette or identifier.

## 4. Modes and progression

### 4.1 Solo Challenge

- Shall contain no direct AI interference.
- Shall display current lap, current time, lap splits, final time, personal best, best time, and a continuously visible third-place qualification target.
- Beating the track's third-place target shall unlock its Rival Main Race.
- A faster Solo result shall atomically replace the standing personal-best final time, lap times, and checkpoint splits. Equal or slower results shall preserve the standing arrays. Solo results shall keep the current run visible and, where a standing personal best exists, show its corresponding lap/split time and a signed delta.
- Production qualification targets shall be feasible at the full two-lap course length without requiring continuous Turbo. The RC source calibration is `190 / 208 / 224 / 239 / 259` seconds for Canyon, Pine, Coastline, Foundry, and Summit; its stricter par references are `181 / 198 / 214 / 228 / 247` seconds. A future reduction requires a recorded deterministic full-course, no-crash reference run under the same heat, obstacle, checkpoint, and lap rules.

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
- Summit mastery shall use one shared target source for HUD and progression. The seven RC calibration targets are `257 / 255 / 253 / 251 / 249 / 248 / 247` seconds while starting heat rises from 35% through 65%; every target shall remain at or above the production clean standard-Ride reference until exact-tier deterministic qualification proves a replacement.

## 5. Simulation and handling

### 5.1 Timing

- Gameplay simulation shall advance at a fixed 60 Hz (`1/60` second steps).
- Input shall be sampled independently of React rendering.
- Rendering may interpolate between the latest completed simulation states.
- Large frame gaps shall be clamped and the number of catch-up steps bounded to prevent a spiral of death.
- Every due fixed step shall independently sample the player's current course environment, advance player and AI rules once, process track/bike/tutorial events, and resolve AI-pair then player/AI contact before another catch-up step. Partial accumulator time shall run none of those rules, and one catch-up callback shall produce the same authoritative world interactions as the equivalent sequence of `1/60` callbacks.
- Pause shall stop gameplay time without corrupting timers, input state, or interpolation. A held keyboard key that emits repeated `keydown` events shall not toggle pause repeatedly; one physical press shall cause at most one pause/resume transition.

### 5.2 Lanes

- Every race surface shall present four marked, readable lanes.
- Lane changes shall be quick, intentional, bounded, and meaningful for passing, mud avoidance, jump setup, barriers, and cooling zones.
- Lane occupancy and transitions shall be represented in simulation state, not inferred from React or visual position alone.

### 5.3 Throttle, turbo, and heat

- Standard Ride shall accelerate the bike while approaching a fixed 62% safe heat ceiling from either side outside cooling zones; it shall not drive heat above that ceiling.
- Turbo shall create a measurable speed advantage and continuously add heat.
- Turbo shall be able to carry heat beyond the Standard Ride ceiling into the warning and overheat ranges.
- Continuous Turbo shall remain usable for at least 11 seconds from cold and at least 4 seconds from the 62% Standard Ride ceiling before lockout; this window is a gameplay requirement, not merely a HUD presentation target.
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
- A grounded controlled wheelie shall clear a striped barrier without crashing while retaining exactly 60% of entry speed; striking the same barrier with the front wheel down shall still cause an obstacle crash. Player and AI riders shall share this outcome.
- In ordinary race modes, keeping pull-back held while the bike remains in a wheelie for 1.4 seconds shall become unstable and cause a readable, recoverable crash; releasing pull-back or lowering the front wheel shall reset that continuous-hold window.
- A clean two-wheel landing shall preserve momentum.
- A bad landing shall cause either a readable crash or substantial speed loss according to a documented landing envelope.

### 5.5 Surfaces and obstacles

The launch content shall include dirt, grass/track-edge slowdown, mud slowdown, small bumps, ramps, jump chains, large jumps, barriers, cooling zones, and a high-risk super-jump equivalent. Curves or banked terrain shall be used where appropriate. Surface and obstacle effects shall be deterministic enough for reproducible QA.

### 5.6 Crashes and recovery

- Crashes shall communicate cause through animation, camera response, sound, caption/visual feedback, and results telemetry.
- The authoritative bike state shall retain the first crash cause for the active crash until recovery begins. Landing, obstacle, rider-contact, and overheld-wheelie crashes shall count exactly once; a stale landing marker shall not suppress a later crash.
- Hold-to-recover shall be the default input.
- While crashed, the visible recovery prompt shall name the active input method's recovery control and expose bounded recovery completion through a labeled `progressbar` with numeric and text alternatives.
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
- AI riders shall resolve rear-impact contact against one another deterministically after every fixed AI step, including the bounded post-player-finish simulation used for official classification. Every unique pair shall use one symmetric forgiveness distance: only grounded riders in the same lane qualify, and the faster rear rider shall crash. Array order shall not change that outcome; crashed, recovering, or finished riders shall not create repeat pair collisions, and classification-only contact shall not emit late captions or audio.
- Forgiveness windows shall prevent visually ambiguous grazing contact from producing severe outcomes.
- Contact response shall remain understandable through pose, effect, sound, camera, and results data.

### 6.3 Difficulty

Easy, Standard, and Expert shall vary decision quality, consistency, route planning, obstacle anticipation, and recovery skill. Speed-only scaling is insufficient. Any rubber-banding shall be optional, subtle, disclosed in settings, and constrained by visible game rules.

## 7. Tutorial and input

### 7.1 Tutorial

The first-play tutorial shall be interactive and use its dedicated 1,200-unit, one-lap production Canyon training course in both normal and QA builds. Opening Rider School shall ignore any retained campaign race or editor Test Ride payload; the displayed course and engine configuration shall both resolve the canonical Canyon training route, never a stale custom track. It shall not depend on a QA-only compressed race. Before movement begins, an input-adaptive rider-school panel shall summarize Ride, Turbo, lane, pitch, recovery, and pause controls while the simulation and race clock remain paused. That fresh intro and the training pause dialog shall both expose Settings without counting as a tutorial skip. Opening Settings shall keep the same tutorial engine and canvas mounted, keep any started lesson paused, apply control changes to the live session, and return focus and progress to the originating intro or pause surface when closed. The course shall then safely sequence a cooling gate, wheelie bump, launch ramp and landing, an avoidable named lane-choice barrier, mud, grass/off-track terrain, and a final unavoidable training barrier for a real crash-and-recovery exercise, with enough remaining route that crossing the finish cannot bypass the contact drills.

The tutorial shall retain cumulative mechanic demonstrations for recap and diagnostics, but lesson clearance shall use a separate active-lesson gate. Evidence observed before a lesson becomes active shall not pre-clear that lesson; multi-signal lessons shall accept only their stated order. When the active requirement completes, the engine shall freeze simulation atomically through the 550 ms presentation handoff without clearing held Ride or Turbo input, then activate a fresh evidence scope for the next lesson. Course-specific lessons shall use explicit event evidence from the named training obstacle or surface transition rather than a generic earlier wheelie, grass touch, crash, or recovery. Its visible progress treatment shall identify the active lesson and completed lessons with symbols or text in addition to color. In order, the player shall complete these 12 guided lessons:

1. Hold Ride to reach usable forward speed while locating run/position, lap/time, and target information in the HUD. Turbo-only acceleration shall not satisfy this lesson.
2. Release Ride and Turbo to demonstrate safe coasting and speed loss; there is no separate brake action.
3. Make a committed lane change, with one lane move per press.
4. Use Turbo to gain speed and reach the critical heat warning without treating the red zone as safe. Reaching that warning shall be latched as cumulative lesson evidence so the player can release Turbo immediately; the lesson shall not require remaining hot or overheating during its presentation delay.
5. Release Turbo and pass through the cyan, snowflake-marked cooling gate. The RC gate spans 241–259 m: after the required Ride/coast/lane lead-in and deterministic cold Turbo run reach the 78% warning, with a dirt handoff before the 300 m training bump.
6. Raise the front wheel and clear the training bump with a controlled wheelie.
7. Shape the launch by commanding nose-up and nose-down airborne pitch, then release pitch so the bike returns toward level.
8. Complete a clean, nearly level two-wheel landing.
9. Read the named striped lane-choice barrier and either move to an open lane for full speed or clear it with a controlled, speed-sapping wheelie; avoiding an unrelated earlier hazard shall not satisfy this lesson.
10. Experience the deterministic speed loss from glossy, rutted mud.
11. Experience grass/off-track slowdown, then return to the marked dirt lanes.
12. Lower the front wheel, strike the final training barrier, enter the real crash state, and hold the active Recover control until the bike returns to grounded riding.

Every incomplete riding lesson shall expose a visible **Retry this lesson** action. A focused retry shall preserve the active lesson index, earlier completed markers, and cumulative recap evidence, while returning the one-lap simulation, race time, checkpoints, bike, heat, handled obstacles, recovery and presentation transients, replay capture, and the active lesson's evidence scope to a fresh attempt. It shall clear latched keyboard and touch commands, shall make the named one-shot obstacle available again, and shall never grant lesson credit. The action shall be unavailable during the completed-lesson handoff and after the riding lessons; full training restart remains a separate checklist-resetting action.

After the 12 riding lessons, the player shall correctly complete both Rival contact drills: the rider who strikes from behind crashes, whether that rider is the player or a pursuing rival.

Tutorial copy and the final recap of Ride, Turbo, lanes, pitch, recovery, and pause shall adapt immediately to keyboard, gamepad, or touch input. Keyboard prompts shall use the player's current remapped bindings rather than hard-coded labels, and recovery copy shall render the `Hold` instruction exactly once. Tutorial pause shall freeze simulation and input, and the pause surface shall offer resume, Settings, and full training restart. Any return to the festival from that surface shall be explicitly labeled as skipping training and shall use the same persisted skip action; an unlabeled bypass is prohibited.

Tutorial mode shall use the same fixed-step handling rules as normal racing except that its continuously held wheelie window shall be 6 seconds rather than the ordinary 1.4 seconds. The longer finite window shall allow a first-time player to demonstrate the mechanic without making excessive wheelies permanently safe.

The complete sequence, including all 12 guided lessons and both contact drills, shall reach the training-cleared state in under three minutes during recorded QA without skipping any lesson.

Crossing the course finish shall never earn or persist tutorial completion. The one-lap attempt makes the first finish crossing decisive: if it is crossed before the checklist is clear, the route and checklist shall restart with an explicit explanation; after all lessons and drills are clear, the final action shall remain available. Earned completion shall occur only from that final post-drill action after all 12 lessons and both contact drills; the explicitly labeled skip path remains a separate player choice. Tutorial completion or skipping shall persist, while replay shall remain available from a clearly labeled Rider School action on the main menu.

### 7.2 Input methods

- Keyboard play and keyboard-only menu navigation shall be complete.
- The default keyboard lane controls shall be `ArrowLeft` and `ArrowRight`; `A` and `D` shall not change lanes in a fresh profile. `ArrowUp` and `ArrowDown` remain the default pitch controls.
- Non-repeated lane-key presses and releases that occur between fixed-step input samples shall be queued in order and produce exactly one lane-change command per press on subsequent eligible samples. Repeated same-direction taps shall include a neutral sample between pulses so the shared lane-change latch can reset without turning a held key into repeated lane moves. Suspension, focus loss, disconnect, modifier cancellation, or a binding change shall discard any unsampled lane taps.
- `A` and `D` may still be selected through explicit remapping. A sequential settings migration shall change only the exact historical default pair `laneLeft = KeyA` and `laneRight = KeyD` to the arrow-key pair; any other stored pair shall be preserved as a player customization. If another valid legacy action already uses either arrow key, that action shall move to the corresponding vacated `KeyA` or `KeyD` binding so the migration preserves a unique full mapping and does not reset unrelated settings.
- Gamepads shall support appropriate prompts and optional vibration where the browser permits. A discrete Start press shall select gamepad prompts through the common input manager before it toggles pause; disconnecting the active pad shall return prompts to Keyboard until another real device command occurs.
- If the browser assigns the active controller to a slot other than zero, input, pause, and optional vibration shall use the first connected controller rather than assuming slot zero.
- Active-device arbitration shall be based on the same mapped command thresholds used to produce gameplay input. Sub-deadzone stick drift, partially resting triggers below their mapped action thresholds, and unmapped analog values shall not claim the gamepad or suppress held keyboard/touch commands.
- A held touch command shall take precedence over simultaneously active keyboard or gamepad commands. Keyboard or gamepad input may resume immediately after all touch commands are released.
- Phone and tablet shall have touch controls sized for safe use.
- Portrait touch controls shall use original lane-chevron, bike/pitch, Ride-bike, and Turbo-turbine pictograms. The pictograms shall be decorative inside buttons with stable accessible names; Ride and Turbo shall retain visible text. Mirroring shall change side placement without changing control meaning or hit area.
- Touch gameplay controls shall remain semantic native buttons for pointer, keyboard, and assistive-technology activation. Held controls shall expose `aria-pressed`; the two pitch toggles shall be mutually exclusive, and releasing a stale pitch direction shall not clear the direction that is currently active.
- Touch controls shall support a left-handed/mirrored layout.
- Pause/resume shall work from all play methods, with one transition per discrete press rather than per repeated key event.
- Controls shall be remappable where practical. Each remap button shall expose its logical action and current binding in its accessible name. Duplicate bindings and keys reserved for focus navigation, browser commands, or system commands shall receive clear errors; every accepted mapped gameplay key shall suppress its browser default outside interactive UI targets.
- Switching active input shall update prompts without dropping held-state cleanup.

## 8. HUD, camera, and results

- The race HUD shall be limited to position, lap, timer, qualifying target, heat, and actionable feedback.
- Solo may omit position; Practice may omit target pressure.
- Critical information shall never depend on color alone.
- The race camera shall keep upcoming obstacles and landing zones visible and avoid preventable occlusion.
- The camera shall initialize at its gameplay target on the first rendered frame rather than visibly easing from an unrelated origin. In campaign and tutorial races it shall sample the same renderer-only course presentation as the road, riders, and hazards. Desktop and portrait compositions shall retain a readable rider silhouette, marked lanes, near hazards, and useful route look-ahead; camera sampling shall never become gameplay authority.
- Reduced-screen-shake settings shall affect crash and landing responses.
- A simulation finish shall synchronously commit exactly one attempt-scoped result, progression update, and replay handoff before any cosmetic finish-presentation delay. An incomplete replay shall produce a separate typed diagnostic, shall not be persisted, and shall not cancel or mutate the completed result or progression update. Retrying or navigating away during that delay shall preserve the committed result without allowing a stale attempt to reopen results or overwrite a newer race.
- Results shall offer immediate retry/restart and an understandable return path. Custom-course pause and results surfaces shall return directly to the retained Track Builder session.
- “Podium” language shall be reserved for a competitive multi-rider Rival or Mastery field. Solo target misses, Practice, Custom, and single-rider results shall use neutral completion language.

## 9. Track editor

### 9.1 Core tools

The editor shall provide:

- a 3D build camera;
- snap-grid and lane-aware placement;
- a complete keyboard-only placement path that uses the selected module, route-view position, and explicit lane without requiring pointer interaction with the 3D canvas;
- placement preview with valid/invalid feedback beyond color alone;
- selection and editing of existing placements after creation or reopening;
- inspector steppers for common placement adjustments, including selected-module lane, rotation, height, and one-through-nine lap count, while retaining exact form controls for precise entry and accessibility;
- route navigation and focus across the complete accepted 0–20,000 m placement range, with a bounded visible and raycastable local continuation whenever focus moves beyond the authored Start–Finish surface;
- a **Fit route** overview that includes the authored surface, route scenery, and all placed module geometry at allowed heights, independent of the local-route zoom state;
- checkpoint-only Route turn and Route rise controls whose edits participate in the same 50-action history as placement edits;
- at least 19 original terrain/obstacle modules;
- multiple ramp shapes/heights, bumps, jump chains, mud, cooling zones, barriers, curves/banked terrain where appropriate, and a super-jump equivalent;
- delete, duplicate, rename, thumbnail, test play, save, and local library;
- clear-all with confirmation;
- undo/redo preserving at least 50 actions;
- selectable lap counts from one through nine.

Test play shall consume the validated authored route directly: start/finish and every ordered checkpoint, selected lap count, module lane and route position, rotation, height, checkpoint-authored turn/rise, curve/bank surface geometry, and obstacle behavior must match the saved placement data. Start and finish are zero-offset/zero-rise seam anchors; checkpoint anchors interpolate with the version-1 deterministic quintic smootherstep centerline. Builder and Test Ride shall use that same sampler for dirt, shoulders, lane/high-contrast guides, modules, gates, riders, camera focus, shadows/effects, and route-relative presentation. Module rotation is local to the sampled route frame. The renderer-only mapping shall preserve scalar arc metres and shall never alter fixed-step progress, lanes, contacts, AI, timing, checkpoints, laps, or replay data. It shall not substitute fixed checkpoint ratios or a generic obstacle layout. Tabletop, Double Jump, Jump Chain, Trail Bump, Bump Row, Offset Barriers, and Sky Kicker shall retain visibly distinct runtime silhouettes. Multi-part modules shall resolve their ordered contact sections from the same saved parent transform for both player and AI; their dirt gaps and staggered lane openings shall not collapse into one oversized rectangular contact, and a quarter-turned rhythm module shall use one sideways footprint rather than inventing sequential along-route impacts. A valid in-memory draft shall remain test-playable when IndexedDB saving fails; the failed save shall preserve the disclosed session/export warning, shall not claim persistence, and shall not prevent the validated snapshot from launching. Test Ride shall retain a separate tab-scoped copy of the exact draft and its thumbnail, undo/redo stacks, active module category, selected module, and valid selected placement. Returning from custom pause or results shall restore that session without requiring a database record or accepting race-side mutation.

### 9.2 Validation

Saving for normal play shall require:

- a complete drivable route;
- valid start, finish, and ordered checkpoints;
- no impossible module overlap;
- valid collision bounds, including every rotated resolved parent footprint strictly between Start and Finish;
- authored-centerline anchors bounded to ±16 m lateral and 0–12 m rise, with no more than 12° rendered yaw after combined turn/grade, 9.5° grade, or a lateral/vertical transition tighter than a 24 m radius;
- a declared difficulty estimate.

Errors shall identify the affected module or route segment and suggest a correction where possible.
An invalid pointer or keyboard candidate shall remain a preview/error only and shall never be committed to the draft.

### 9.3 Persistence and interchange

- Editor data shall use a versioned local schema and migration path. Schema v2 adds checkpoint-only route anchors. V1 tracks that meet current semantics migrate in place by changing only `schemaVersion`; omitted anchors preserve the exact straight/flat mapping. A track accepted by the former center-only Start/Finish rule but rejected by current full-parent-footprint containment shall remain readable and editable without quarantine, normalize to v2 in memory, and require repair before save, export, or Test Ride.
- JSON export shall contain data only, with a documented schema/version and bounded size.
- Import shall reject malformed, malicious, oversized, incompatible, non-finite, out-of-bounds, overlapping, or semantically invalid content with clear errors.
- Import shall apply bounded byte, nesting, item-count, and string-length preflight before parsing and shall reject unknown interchange fields rather than silently stripping them.
- Import shall never evaluate code or fetch arbitrary external assets.
- Three polished example tracks authored in the editor shall ship, include safe nonzero turn/rise anchors, and pass the same validation as player tracks.

## 10. Persistence

IndexedDB shall store versioned local profiles, settings, progress, personal bests/splits, custom tracks, and replays if replays ship. Requirements:

- explicit database and record schema versions;
- sequential, tested migrations;
- atomic upgrade behavior and safe fallback;
- corruption detection, recovery messaging, and preservation/export where possible;
- a blocked database open shall leave Boot after a bounded wait, disclose session mode, and remain retryable after the other connection closes;
- complete record validation shall reject future profile schema versions without overwriting them; an invalid current-version record shall be replaced only after its recovery copy succeeds;
- invalid custom tracks shall be removed from the active library only in the same transaction that preserves them in quarantine, and the editor shall disclose and export a portable tagged recovery package that preserves cycles and non-JSON structured-clone value types;
- recovery/quarantine export shall enforce depth, node, string, binary, and output-byte budgets during traversal, reserve Blob/File output before reading bytes, preserve supported cycles without recursion escape, and reject unmeasurable aggregate records rather than estimating them optimistically;
- profile recovery shall re-read settings and progress together inside one write transaction, reject either future schema before mutation, quarantine current invalid records, write only the missing/invalid side, and preserve a valid or concurrently updated companion record;
- normal settings writes shall serialize within a tab and transactionally apply only locally changed leaves—including disjoint key-remap actions—to the latest stored record; a combined key collision shall resolve deterministically without persisting an invalid duplicate map. Normal progression writes shall serialize and merge tutorial/unlock/qualification, best-time-with-matching-splits, best-position, and mastery gains monotonically so a stale tab cannot replace unrelated newer progress;
- each profile queue shall adopt the actual merged database return and rebase any later local mutation rather than treating the submitted snapshot as persisted truth. Device-saving retry shall hold a write barrier, preserve explicit reset revision/order, rebase settings/progress mutations made while recovery is awaiting storage, drain reconciliation writes, and refuse to claim persistent mode after any newer failure;
- resetting progress shall remain an explicit replacement intent through a failed-write retry; unchanged stale progress shall not resurrect achievements cleared by another tab, while any accepted post-reset best/position/mastery gain shall restore the prerequisites that make that gain internally consistent;
- a custom-track recovery scan shall re-read and validate the current same-ID record inside the quarantine/delete transaction so a stale scan cannot delete a newer valid cross-tab save;
- normal custom-track saves shall compare the exact persisted base inside the write transaction and preserve a divergent local edit under a new conflict-copy identity; deletion shall require an irreversible-loss confirmation, use an explicit readable control with a 44 CSS-pixel target, and refuse when the stored record differs from the displayed base. Save, Test Ride, and destructive library mutations shall hold an editor-wide interaction guard until their exact snapshot resolves; identity-changing Open, import, and conflict-copy transitions shall not retain undo history bound to another document/base;
- replay insertion and deterministic per-track pruning shall commit or roll back together;
- newly recorded replays shall use a self-identifying versioned codec, preserve monotonic fixed-step timing and centimetre-scale forward progress across the maximum 20,000-unit nine-lap custom race, and reject truncated, non-monotonic, or unsupported sample data before persistence or playback;
- if the initial profile read fails, automatic session changes shall not overwrite an unread existing profile; a device-saving retry shall first reopen, validate, and reconcile stored settings/progress, preserving every valid stored record before writing fallbacks for missing or corrupt records;
- editor creation, duplication, validation, persistence, import, and Test Ride shall enforce one shared ceiling of 500 modules;
- Test Ride shall reconcile its exact persisted base before launch, use a generated conflict-copy identity when another tab changed the original, and still start from the validated in-memory snapshot after a bounded save failure; a failed save shall retain and disclose both the exact attempted snapshot and exact base until retry or same-track save/export explicitly supersedes it;
- device-saving recovery from paused-race Settings shall not reconstruct, restart, or otherwise replace the live race attempt; reconciled progression shall be consumed when a later attempt is explicitly constructed;
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

Race presentation shall use its portrait composition whenever `height > width` or `width < 680` CSS pixels, so a narrow landscape window receives the protected framing as well as a physically portrait viewport.

Layouts shall be verified at 16:9 desktop, ultrawide, tablet, phone, and narrow-width fallback sizes. From 320 through 780 CSS pixels wide with UI scale at 140%, the position, timing, target, pause, steering, throttle, and heat surfaces shall remain inside the viewport and mutually separated in both normal and mirrored layouts, while every touch target remains at least 44×44 CSS pixels. On a 320×568 short-phone viewport at 140% scale, the tutorial card shall retain a visible action area, keep all 12 progress markers readable without horizontal overflow, and support vertical touch scrolling to lesson actions without disabling page or control semantics. A pause dialog opened during the transient visible `GO` handoff shall paint above the noninteractive start gate. Focus order, visible focus, labels, semantic controls, keyboard traps, target sizes, clipping, safe areas, and text scaling shall be tested. Touch UI shall not obscure critical track reads.

At phone widths, Track Builder shall retain Save, Test Ride, Export, Import, the placed-module selector, keyboard placement controls, lap/difficulty/clear actions, actionable validation detail, and its live status notice; none may be removed solely to fit the narrow layout. The Support/Privacy/Accessibility surface shall receive the same axe, keyboard, and required-viewport coverage as the primary menus.

On narrow tutorial layouts, gameplay-critical caption feedback shall remain inside the tutorial card's scrolling status region rather than being painted behind it. The Skip training action shall retain a minimum 44×44 CSS-pixel target, and visually hidden native setting toggles shall expose a visible focus indicator on their rendered track.

## 12. Art and audio requirements

- The visual identity shall be bright, chunky, colorful, low-poly, coherent, and original.
- Track, lane paint, hazards, mud, grass, cooling zones, riders, UI, and scenery shall have a deliberate hierarchy.
- Each track shall use a limited, intentional palette.
- The gameplay concepts in `docs/design/concepts/` are acceptance references for camera composition, hierarchy, environmental richness, rider readability, track depth, and HUD/control presence. They are not pixel-accurate screenshots, but materially coarser or emptier output shall not be accepted solely because it is internally consistent or faster.
- Race rendering shall establish its intended composition on the first frame, use per-track lighting, exposure, and fog profiles, and reinforce the toy-diorama course with terraced edges, visible lane ridges, safety treatment appropriate to each venue, and deliberate scenery density.
- Handcrafted campaign and Rider School starts shall use a presentation-only, code-native four-lane grid with visible lane numbers `1` through `4` and a start-line treatment. Editor-authored Test Rides shall omit this generic numbered grid so their saved Start Grid module remains the only authored start geometry.
- Canyon Kickoff and Rider School shall use continuous cream/coral/teal modular safety walls along both course edges with the timber fence visibly behind them. Quality tiers may use longer or shorter connected modules, but shall preserve dirt-edge, lane, hazard, landing, and fence clearance. The wall shall be render-only and non-colliding, shall not imply an authoritative boundary the simulation does not enforce, and shall be omitted from editor-authored Test Ride courses rather than cutting across saved curve or bank geometry. Other handcrafted tracks may retain shorter festival-zone runs.
- Handcrafted Canyon Kickoff and Rider School festival pockets shall present spectators on outward-rising timber grandstand rows beneath their canopies rather than on one flat plane. Low, Medium, and High shall use two, three, and four rows respectively while preserving the legacy flat-pocket density and placement rules for other tracks and editor-authored Test Rides. At the bilateral cooling-gate showcases only, the existing deck, canopy, and four post instances shall form elevated staffed watchtowers, with two/three/four existing spectators moved onto each deck by quality tier. Route pockets shall remain separated from those showcases so opaque canopies do not intersect or weaken gate symmetry. The tiers and watchtowers remain instanced, render-only, outside the safety wall, and absent from collision, cooling, AI, timing, and replay state.
- Canyon Kickoff and Rider School shall place the inventoried original festival-canyon matte behind the procedural Three.js course as a responsive center-cropped far-background layer, not stretch it across aspect ratios or treat it as a 360° environment. Low and Medium quality may decode bounded lower resolutions; the selected resolution is fixed for that engine attempt and a later quality change applies on the next race. The matte shall remain presentation-only, shall not replace readable 3D course/hazard/scenery depth, and shall fall back to the generated sky without changing gameplay.
- The focal player bike shall remain readable from the follow camera through a rear-facing `22`, knobby wheel silhouette, visible hubs/brake hardware, layered bodywork, and exposed exhaust treatment. Its wheel assemblies shall spin as complete units, focal rider/bike geometry shall participate in enabled-quality shadows, and bounded lane-change lean plus speed-responsive rider pose shall communicate steering and momentum without changing simulation state or ignoring reduced-motion settings.
- Every Rival and Mastery entrant shall use one of the five authored variants in the shared `/assets/rivals/rival-pack.glb` runtime pack, with a coherent primary/accent palette and a distinct two-digit jersey and rear-plate number. The current pack is 193,884 bytes and 19,588 triangles across 26 nodes, reusing 12 shared geometries/render primitives, five materials, and one embedded PNG; the fixed five-rider field shall remain the allocation ceiling.
- Player fallback and rival presentation riders shall use a bounded six-pivot presentation rig for torso, head, arms, and legs. Existing render snapshots may drive modest speed, airborne pitch/height, lane-lean, and static crash poses, but these transforms shall never feed simulation. Reduced Motion shall suppress the nonessential tuck, bob, cadence, jump, and lean articulation while retaining the essential crash silhouette.
- Dirt albedo and physical relief shall use separate color-space-correct inputs. Lane paint shall remain in the color layer rather than becoming false raised geometry; deterministic shallow ruts and clods plus campaign-only sculpted grass lane berms may enrich the presentation but shall not change authoritative surface, collision, steering, or AI rules. Generic campaign berms shall not cut through editor-authored curve/bank geometry.
- High-contrast campaign guides shall clear the presentation berms. On authored courses, base and replacement guides shall follow the saved centerline plus each piece's local height, banking, curve, rotation, and lap transform. Base guides shall be removed only for the exact route intervals where a visible authored overlay replaces them; valid rotated and negative-height pieces shall retain any needed fallback stripe. Authored overlays shall be batched or instanced rather than adding one draw call per stripe.
- Campaign and tutorial races shall use one shared three-dimensional presentation mapping for the road and its shoulders/lane guides, player and AI riders, camera, shadows/effects, hazards and lap gates, safety treatment, and route-adjacent scenery. Hazard footprints, their approach/readability margins, and lap transitions shall remain on protected flat, straight, yaw-aligned corridors. C2-smooth lateral bends and bounded positive rolling grades may occur only between those corridors, shall return to zero before the next protected corridor and every lap seam, and shall preserve scalar presentation arc length. Summit shall carry the strongest elevation silhouette while every venue retains forward sightline and landing readability. The campaign mapping shall add no authoritative bank or terrain contact.
- This course shaping is renderer-only. It shall never change authoritative scalar progress, lane or surface rules, obstacle contact, checkpoint/lap logic, AI decisions, timing, replay data, or input meaning. Player and AI presentation may consume the route's pitch/up frame, but both remain governed by the same fixed-step simulation. Authored custom-track test play shall consume its validated schema-v2 checkpoint centerline while retaining saved placement, local rotation, height, curve/bank geometry, collision, gate, and lap semantics; migrated v1 tracks remain exact identity routes. A separate moving distant-course ribbon shall not be layered over the shared route.
- Portrait touch controls shall retain safe reach and labels while presenting stronger scale, contrast, depth, separation, and original rally pictograms comparable to the concepts' control hierarchy.
- UI, icons, typography, animation, effects, vehicles, riders, sounds, writing, and layouts shall be original or commercially licensed.
- Display/HUD typography shall use the inventoried bundled condensed face consistently across DOM chrome and CanvasTexture signs rather than depending on optional operating-system fonts. The complete redistributed font license shall ship in the distribution notices, and the service worker shall precache the font bytes.
- Temporary meshes, generic dashboard styling, excessive gradients, inconsistent stock icons, and default engine widgets shall not remain in a release candidate.
- Original or licensed engine, landing, crash, crowd, wind, UI, music, and terrain audio shall be inventoried.

## 13. Performance and compatibility

| Area | Release-candidate requirement |
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
- The application shall claim cached-race offline readiness only after the current page receives a successful cache acknowledgement from its exact current-generation service-worker controller. A later `controllerchange` shall immediately invalidate that page's readiness claim, restore conservative offline copy, and begin one guarded preparation attempt; readiness may return only after the new current controller acknowledges the exact expected generation. Upgrade transitions may retain one immediately previous app-owned cache, but current-generation matches shall take priority and a failed or stale acknowledgement shall produce conservative offline copy rather than a false readiness promise.
- The current service-worker generation shall be `rivet-ridge-rally-shell-v35`. Installation shall fetch `index.html` once with reload semantics, cache clones of those exact bytes under both `/` and `/index.html`, and fetch core—including both bundled font subsets, `/assets/3d/hero-bike-rider.glb`, `/assets/rivals/rival-pack.glb`, and the Canyon modular GLB—plus HTML-discovered build assets before committing the current cache; any failed, non-static-final, cross-origin-final, `no-store`, or `Vary: *` response shall delete the partial v35 cache. Ordinary CDN `Vary` headers may be matched without variance only after both the request and final response pass the credential-free, query-free static allowlist. Runtime warming shall accept at most 128 root/index/manifest-or-`/assets/` URLs per request, cap the complete current cache at 192 entries across repeated warming and generic misses, validate each final response with the same cacheability boundary, and retain an already cached usable response if a refresh fails. Other same-origin paths shall bypass service-worker runtime caching. Rejected, cross-origin-final, or 5xx navigation shall fall back to the last complete current-or-transition app shell; a genuine same-origin 4xx shall remain visible. A controller change or later reconnect shall request preparation, and an event received during an active preparation shall schedule one guarded rerun rather than being lost.
- Save corruption and migration failure shall recover safely without a crash loop.
- No credentials, API keys, private tokens, or secrets shall exist in source control or the client bundle.
- Dependency vulnerabilities shall be audited; known applicable high or critical vulnerabilities block a release candidate.
- A 30-minute continuous session shall show no runaway memory growth, accumulating input lag, crash loop, or save corruption.
- Analytics, if ever added, shall be privacy-conscious, documented, easy to disable, and outside the default RC1 requirement.
- Future leaderboards must validate scores server-side and shall never trust browser-submitted scores.

## 15. QA and acceptance

- Vitest shall cover deterministic units and state transitions.
- Playwright shall cover real-browser flows from fresh load through a completed race and a saved/reloaded custom track.
- Production smoke shall accept only a valid format-2 release manifest and a credential-free dedicated-origin root URL. The manifest shall bind every file's raw byte count/SHA-256 and deterministic gzip level-9 byte count/SHA-256 plus both totals, and its toolchain shall include a schema-checked, path-private attestation of the complete pinned npm package tree. Smoke shall fetch every recorded file without cache reuse, recompute and compare the complete raw/gzip inventory plus aggregate digest, then fetch `/` separately and require those bytes to equal the manifest's `index.html` without leaving the origin. Browser navigation shall remain on that origin, and the evidence shall bind the normalized root/entrypoint plus manifest source, toolchain, and build identity before exercising the release.
- Production smoke shall stage each run in a unique directory, emit schema-5 evidence that binds installed Google Chrome/channel/version/viewport, runtime title/version/commit, exact service-worker cache identity, complete pre/post raw-and-gzip served inventories, and each captured screenshot's safe relative path, byte count, and SHA-256 plus one path-sorted screenshot aggregate; catch setup/browser failures into an explicit failure record when the artifact root is writable; and atomically promote the completed bundle beneath the full manifest SHA-256 (or a separate unbound failure namespace). It shall never overwrite the retained schema-1 historical smoke files.
- Release-manifest generation shall prepend the active Node executable directory to the isolated child environment; verify the resolved child Node version, file identity, and SHA-256 before and after install/build; and record the Node executable hash. It shall resolve the absolute npm launcher to the nearest physical `npm` package, require pinned metadata and canonical `bin/npm-cli.js`, reject special or unsafe symbolic-link entries, and deterministically hash the complete package tree without recording its absolute path. It shall revalidate source, annotated tag, package/lock/Node inputs, npm launcher and whole package tree, and the Node executable after sidecar creation and temporary-worktree cleanup before reporting success.
- Axe checks and keyboard-only journeys shall cover menus and settings.
- Screenshot comparisons shall cover key screens and required responsive widths.
- Visual regression screenshots shall be accepted only after side-by-side review against the corresponding concepts. Desktop race, portrait race, high contrast, and all five track start/midcourse compositions require renewed owner acceptance after the post-RC1 rendering changes; matching a superseded RC1 baseline is not concept-fidelity evidence.
- Fresh Canyon desktop and portrait captures shall explicitly verify the festival-canyon matte's crop, horizon, 3D-course separation, fallback path, readability, and visual relationship to the approved gameplay concepts before it can become an accepted baseline.
- Fresh Canyon and Rider School cooling-gate captures shall explicitly verify that the raised teal/coral decks read as staffed watchtowers, deck occupants meet the platform, posts/canopies clear correctly, all four lanes and snowflake cues remain readable, and no authored Test Ride inherits the treatment.
- Manual browser/device, soak, performance, gamepad, touch, and gameplay-fairness results shall be recorded in `QA_REPORT.md`.

No requirement becomes `PASS` merely because code exists. It requires a named test or recorded manual procedure, environment, date, result, and evidence. Qualification has resumed for named working-tree scopes: headed hero action integration passes 5/5, the enriched 15-state public-controls manifest passes with authored Canyon-kit/panorama readiness and muted browser audio, targeted reliability and earlier scoped production/performance diagnostics pass, and the complete command suite passes. Those results do not qualify the whole product: hero visual fidelity remains **NOT ACCEPTED**, the captured rear-view landing/crash/recovery states remain visually weak, and the broader gameplay, responsive, accessibility, typography, graphics, rival-asset, shell-v35, frozen-candidate, owner/legal, and release gates remain incomplete or `UNVERIFIED`. A new release candidate is permitted only when mandatory requirements pass, except honestly documented hardware-specific `UNVERIFIED` cases and genuine external blockers.
