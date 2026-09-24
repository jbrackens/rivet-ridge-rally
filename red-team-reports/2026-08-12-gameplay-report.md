---
target: rivet-ridge-rally
date: 2026-08-12
scope: game quality, mechanics, performance, usability — distribution/feedback/legal explicitly descoped by the owner
findings:
  - {id: solo-targets-set-48pct-off-competent-pace, severity: CRITICAL, confidence: 10, status: NEW}
  - {id: ai-top-speed-capped-below-player, severity: MAJOR, confidence: 10, status: NEW}
  - {id: turbo-has-no-real-cost, severity: MAJOR, confidence: 9, status: NEW}
  - {id: replays-are-write-only-no-ghost, severity: MAJOR, confidence: 9, status: NEW}
  - {id: hud-text-below-deck-legibility-floor, severity: MAJOR, confidence: 8, status: NEW}
  - {id: campaign-clears-in-under-30-minutes, severity: MAJOR, confidence: 8, status: NEW}
  - {id: zero-physical-device-evidence, severity: MAJOR, confidence: 9, status: STILL OPEN}
  - {id: unsigned-owner-visual-gate-blocky-rivals, severity: MAJOR, confidence: 9, status: STILL OPEN}
  - {id: front-loaded-14-step-tutorial, severity: MINOR, confidence: 7, status: STILL OPEN}
closed:
  - evictable-local-saves-no-persist
descoped:
  - no-feedback-channel-or-telemetry
  - no-hosting-or-distribution-path
  - no-license-or-operator-identity
  - no-retention-loop-vs-market
---

# Red Team: Rivet Ridge Rally — game quality and mechanics for beta

## Verdict

Judged only on what a player who can already reach the game experiences, this is a competent, unusually well-built arcade racer with one defect that undermines the entire play experience: **nothing in it is hard.** I drove the shipped simulation headlessly using the repository's own representative-rider policy and finished Canyon Kickoff in **128.3 seconds against its 190-second qualification target** — 61.7 seconds, or 48%, of slack. That same margin holds across all five venues, and it means all seven Summit Showdown "mastery" tiers — the endgame, specified as "full-system mastery under pressure" — fall in a single first attempt, together, by roughly 70 seconds. The supporting systems can't rescue it: the Ace AI's top speed is hard-capped at 17.9 m/s against the player's 20 m/s turbo, so the hardest rival in the game is mechanically incapable of beating a competent player, and turbo carries no real cost — a max-turbo run held boost for 89% of the race and never once overheated. The game therefore has no difficulty ceiling, no rival pressure, and no resource tension, which leaves the "read the track, then commit" pillar with nothing to commit to. Set against the bar you named, Trackmania's gold medal sits at author-time × 1.06; Rivet Ridge Rally's only visible tier sits at roughly × 1.48, which is Trackmania's *bronze*. Every one of these is a numbers change in `tracks.ts` and `aiRules.ts`, not an architecture change — but shipping the current numbers to testers means their feedback will describe a game that was never actually asking anything of them.

## Since last review

The 2026-08-12 register, re-checked. Three findings are descoped at your instruction (feedback channel, hosting, license) and one is descoped as commercial rather than mechanical (retention loop); they are neither closed nor re-argued here.

- **`evictable-local-saves-no-persist` — CLOSED.** Re-ran the original check: `navigator.storage.persist()` is now requested after the first confirmed profile write (`src/app/store.ts`), and the Support screen renders the durability disclosure — verified live in-browser, `data-storage-durability="best-effort"` with the seven-day WebKit rule named in the copy. 26 new regression tests cover it.
- **`front-loaded-14-step-tutorial` — PARTIALLY CLOSED, downgraded to MINOR.** The skip-parity half is closed and measured: the action is a 419 px full-width button at full contrast with zero card overflow at 1280×720, against a 56 px faint link previously below the scroll fold. First-boot routing is unchanged by explicit decision, so the front-loading itself stays open — but with a visible peer-sized exit, its severity no longer reads as MAJOR.
- **`unsigned-owner-visual-gate-blocky-rivals` — STILL OPEN.** Re-ran the original check on your machine today: `e2e/visual-regression.spec.ts-snapshots/` is still absent and no canonical approval record exists (only the draft-preparation script). The rc.3 package has now been waiting since 9 August.
- **`zero-physical-device-evidence` — STILL OPEN.** Nothing in `LAUNCH_READINESS.md`'s unverified-environments table has changed.

## Scope and method

In scope: mechanics, balance, game feel, content depth, HUD/usability, and performance. Out of scope at your instruction: hosting, feedback plumbing, telemetry, licensing, operator identity.

The strongest evidence here is reproduced locally rather than cited. I imported the shipped fixed-step simulation (`RaceSimulation`), the shipped AI rules (`aiRules.ts`), and the shipped track data into a Node harness modelled directly on the repository's own `trackTargetFeasibility.test.ts`, then drove four strategies over full production-length races. Because the simulation is deterministic and decoupled from rendering, these times are exact and unaffected by this container's software WebGL. What software rendering *does* block is any claim about frame rate or feel — so this review makes none, and performance stays open.

**Measured, four strategies × five venues (2 laps, production lengths):**

| Venue | Target | Hold W only | Lanes, no turbo | Repo's representative rider | Max turbo |
|---|---:|---:|---:|---:|---:|
| Canyon Kickoff | 190.0 s | 185.3 s | 180.7 s | **128.3 s** | 127.0 s |
| Pine Run | 208.0 s | crashed @756 m | 198.3 s | **141.3 s** | 139.5 s |
| Coastline Clash | 224.0 s | crashed @346 m | 214.2 s | **151.5 s** | 150.4 s |
| Foundry Flight | 239.0 s | crashed @211 m | 227.8 s | **161.6 s** | 160.1 s |
| Summit Showdown | 259.0 s | crashed @1386 m | 250.4 s | **177.3 s** | 175.8 s |

**Measured heat economy:** turbo from cold to lockout 15.3 s (the bible's floor is 11 s); standard ride settles at exactly the 62 ceiling in 7.8 s; turbo from that ceiling to lockout 7.5 s (floor is 4 s); passive cooling from 90 heat to 10 takes **5.7 s**; turbo speed advantage 1.43×.

## Scorecard

| Area | Verdict | One-line issue |
|---|---|---|
| Difficulty & target calibration | CRITICAL | Qualification targets sit ~48% off a competent pace; all seven mastery tiers clear in one run |
| AI & rival pressure | MAJOR | Ace tops out at 17.9 m/s vs the player's 20 m/s — the ceiling is below the player at every tier |
| Heat / turbo economy | MAJOR | 89% of a race on boost with zero overheats; the signature risk mechanic carries no risk |
| Replay & mastery loop | MAJOR | A full versioned replay system is recorded, validated, pruned — and never playable |
| HUD legibility | MAJOR | Smallest default text ~6.5 px cap height at 1280×800, under Valve's 9 px floor |
| Content volume | MAJOR | ~13 minutes of Solo racing to clear the campaign at competent pace |
| Performance | OPEN — UNVERIFIED | Cannot be judged here (software WebGL) and remains unmeasured on real devices |
| Visual acceptance | MAJOR (carried) | Owner gate unsigned since 9 Aug; pre-pivot rival assets still ship in every Rival race |
| Onboarding | MINOR (carried) | First boot still enters the 12-lesson school; exit is now a visible peer button |
| Lane-reading pressure | CLEAR | Hold-W-only crashes on 4 of 5 venues — the track genuinely demands lane reads |
| Retry friction | CLEAR | Instant restart from both pause and results; matches the Trials benchmark |
| Gamepad prompts | CLEAR | Xbox-standard names ("A / RT", "Start") satisfy Valve's glyph-naming rule |
| Input breadth & accessibility | CLEAR | Keyboard + remapping + gamepad + touch + mirrored layout; reduced motion, contrast, captions |
| Runtime stability | CLEAR | Zero console and page errors across every journey driven this session |

## Findings

### [CRITICAL · confidence 10/10] Every qualification target is set roughly 48% slower than a competent run, and the entire seven-tier mastery ladder falls in a single attempt

- **id:** solo-targets-set-48pct-off-competent-pace
- **Evidence in the target:** Measured above, reproduced locally against shipped code and data. Canyon 128.3 s vs a 190 s target (−61.7 s); Summit 177.3 s vs 259 s (−81.7 s). The seven Summit mastery targets are `257/255/253/251/249/248/247` s (`tracks.ts`, `getMasteryTargetMs`) — a 177.3 s run clears **all seven simultaneously**, by 70–80 s. The mastery modifier that is supposed to add pressure raises starting heat to 65%, but measured passive cooling drains 90 heat to 10 in 5.7 s, so the handicap evaporates before the first obstacle. The repo's own test asserts only `finishMs <= soloTargetMs` — it proves targets are *reachable* and never that they are *demanding*, which is exactly how the gap survived. `parTimeMs` (181 s for Canyon — a genuinely tight number) exists in the data model but appears nowhere in `src/ui` or `src/app`: the demanding tier is computed and then hidden.
- **External evidence:** [Trackmania wiki — map editor](https://wiki.trackmania.io/en/content-creation/map-editor): "Gold = ceil(Author Time × 1.06), Silver = ceil(Author Time × 1.2), Bronze = ceil(Author Time × 1.5)." RRR's single visible tier is ≈ author × 1.48 — bronze. [Karri Kiviluoma, Lead Designer, RedLynx, on Trials](https://www.gamedeveloper.com/design/q-a-welcome-to-the-future---designing-i-trials-fusion-i-): "There's very little on or off, true or false, in Trials. It's always about the small nuances." [Fisher & Kulshreshth, IntechOpen](https://www.intechopen.com/chapters/1228576): "If a task is too easy for the player's current skill level, it results in apathy or boredom."
- **Why it matters:** This is the finding that decides whether beta feedback is worth anything. A tester holds turbo, wins by a minute, unlocks everything including the endgame ladder in one sitting, and reports "it was fine" — which tells you nothing, because the game never asked a question. Worse, the reward structure inverts: the mastery ladder is meant to be the thing experts chase for weeks, and it is consumed accidentally on the way past. Every downstream judgement testers give you about pacing, tension, and track design will be made in a difficulty vacuum.
- **Fix:** Set targets from measured competent runs, not from a hold-W reference. Take the representative-rider times as the author baseline (128/141/151/161/177 s) and apply a medal ladder in the Trackmania shape: bronze ≈ ×1.35 (finish and unlock), silver ≈ ×1.15, gold ≈ ×1.06, author = the baseline itself. Unlock the next venue on bronze so progression stays generous; hang the mastery ladder off gold and author so there is somewhere to go. Surface the already-computed `parTimeMs` as one of those tiers instead of hiding it. Then extend the repo's feasibility test with the assertion it currently lacks — an upper bound, so a target that is too *loose* fails CI just as loudly as one that is impossible.

### [MAJOR · confidence 10/10] The hardest AI in the game cannot mechanically outrun a competent player at any difficulty

- **id:** ai-top-speed-capped-below-player
- **Evidence in the target:** `aiRules.ts` sets `baseSpeed` to 12.6 / 14.6 / 16.4 m/s for rookie / rider / ace. `getAiDriveControl` grants turbo only while `decision.speed < baseTarget + 1.5`, so an AI rider's ceiling is `baseSpeed × consistency + 1.5` — at most **17.9 m/s for Ace**, and `getAiConsistency` only ever reduces that (`1 - penalty`). The player's turbo speed is **20 m/s** (`BIKE_PERFORMANCE_LIMITS`), sustainable for 89% of a race (measured). Rookie's ceiling (~14.1 m/s) barely exceeds the player's *no-turbo* speed of 14 m/s.
- **External evidence:** [Descenders Steam negative reviews](https://steamcommunity.com/app/681280/negativereviews/?browsefilter=toprated) — players punish absent challenge and sameness directly: "every run is very samey." [Trials Rising positive reviews](https://steamcommunity.com/app/641080/positivereviews/?l=english&p=1&browsefilter=trendyear) show what the genre is praised for instead: "you are expected to fail, fail and fail again, struggling on obstacles tirelessly."
- **Why it matters:** Rival Main Race is the mode meant to supply pressure that Solo's clock does not, and it structurally cannot. A player who has learned turbo simply drives away from the field on lap one, at Ace, forever. This also quietly voids the "pressure without hidden cheating" pillar from the other side: the rules are fair, but the ceiling is set so low that fairness never gets tested. Combined with the target finding, there is no mode in the product where a competent player can lose.
- **Fix:** Raise Ace's ceiling above the player's sustainable pace — `baseSpeed` near 19–20 m/s with the `+1.5` turbo band intact — and let Ace exploit the same cooling-gate routing the player does, so it is fast because it plans well rather than because it was handed speed. Keep Rookie below the player's standard speed as the accessible tier and put Rider near 17. Then verify with the harness pattern already in the repo: a per-difficulty test asserting the AI's finish time brackets the player baseline, so "the AI is beatable" and "the AI is a threat" both become CI-enforced.

### [MAJOR · confidence 9/10] Turbo — the signature risk/reward mechanic — carries no real cost, so the core moment-to-moment decision is always "hold it"

- **id:** turbo-has-no-real-cost
- **Evidence in the target:** Measured: the max-turbo strategy held boost for **113 of 127 seconds (89%)** on Canyon and finished with **zero overheats**, peaking at 96 heat; the repo's own representative rider held it 101 of 128 s (79%). Turbo runs 15.3 s from cold before lockout against the bible's stated 11 s floor, and 7.5 s from the 62 ceiling against its 4 s floor — the implementation is ~1.5× more forgiving than its own specified minimum. Passive cooling returns 90 heat to 10 in **5.7 s** with no cooling gate involved, so gates are decorative rather than tactical. `GAME_BIBLE.md` requires the opposite: "Turbo before ramps and hazards must offer a tactical advantage rather than a cosmetic speed effect."
- **External evidence:** [Steve Swink, "Game Feel: The Secret Ingredient"](https://www.gamedeveloper.com/design/game-feel-the-secret-ingredient) defines the dimension this collapses — Context: "How constraints give spatial meaning to motion." Remove the constraint and the motion stops meaning anything. [Fisher & Kulshreshth](https://www.intechopen.com/chapters/1228576): "Flow emerges in the narrow channel between these extremes, where players are stretched just enough to stay immersed and motivated."
- **Why it matters:** Heat is the mechanic that is supposed to make lane choice, cooling-gate routing, and turbo timing into a live decision — the thing that separates this from an endless runner. As tuned, the optimal policy is a constant, and a constant is not a decision. Rider School spends lessons 4 and 5 teaching a resource-management system that the shipped tuning makes irrelevant fifteen seconds later, which is worse than not teaching it.
- **Fix:** Make sustained turbo genuinely unaffordable: raise `turboHeatPerSecond` (currently 8, identical to *standard* ride's heat rate) so cold-to-lockout lands near the 11 s floor rather than 15.3 s, and cut `passiveCoolingPerSecond` (14) hard so recovery costs meaningful track rather than 5.7 s. That single change gives cooling gates their intended pull and makes the 62 ceiling a real operating decision. Re-run the harness afterwards: the target is that max-turbo *overheats* and loses to a routed run, which is the outcome that proves the mechanic pays.

### [MAJOR · confidence 9/10] A complete replay system is recorded, validated and pruned — and no player can ever watch or race against one

- **id:** replays-are-write-only-no-ghost
- **Evidence in the target:** `saveReplay` is called on every finish (`GameView.tsx:667`). In `database.ts` the only other uses of the `replays` table are `put`, a `toArray()` used solely to compute pruning, and `bulkDelete`. There is no load-for-playback path, and `src/ui` and `src/app` contain no reference to watching, playback, ghosts, or spectating. The engineering behind it is substantial and specified in `GAME_SPEC.md` §10: a "self-identifying versioned codec" that preserves "monotonic fixed-step timing and centimetre-scale forward progress across the maximum 20,000-unit nine-lap custom race."
- **External evidence:** Leaderboards or ladders are verified on 4 of the 8 competitor pages opened this session — [Descenders](https://store.steampowered.com/app/681280/Descenders/) ("Steam Leaderboards"), [Lonely Mountains: Downhill](https://store.steampowered.com/app/711540/Lonely_Mountains_Downhill/) ("prove your speed-running talents on the leaderboards"), [Trackmania](https://store.steampowered.com/app/2225070/Trackmania/) ("Climb global and regional leaderboards, collect medals and trophies"), and [TrackMania Nations Forever](https://store.steampowered.com/app/11020/TrackMania_Nations_Forever/) ("Official ladders for solo and multiplayer"). Counter-evidence, stated plainly: no page I opened explicitly names *ghosts*, so ghosts are not proven table stakes from this sample.
- **Why it matters:** A local ghost is the one competitive structure that needs no server, no account, and no policy change — and it is the direct answer to the difficulty finding. Racing your own best run converts a loose clock into a self-tightening target that scales with the player forever. The codec, the storage, the pruning, and the validation are already built and tested; only the playback and the compare-against-ghost rendering are missing. Every hour spent on that replay system currently returns nothing to the player.
- **Fix:** Ship a personal ghost: load the stored best replay for the selected track and render it as a translucent rider, plus a live split delta against it in the HUD. Extend it to a "best of the last N" picker if it lands well. This is the cheapest available depth in the product and it composes directly with the medal ladder from the first finding — beat your ghost, then beat silver, then gold.

### [MAJOR · confidence 8/10] The smallest default HUD and menu text falls under Valve's legibility floor at Deck resolution

- **id:** hud-text-below-deck-legibility-floor
- **Evidence in the target:** Measured in-browser at exactly 1280×800 with default UI scale (1.0), reading computed styles of every visible text node. Smallest per screen: title screen **9.2 px** font-size ("Lane choice, heat, and clean landings", "Finish third to unlock"); track/mode select **9.3 px** ("Solo best · No run"); race HUD **9.6 px** ("Saved best", "No time"); Rider School intro control map **10.7 px**. The display face is Barlow Condensed — a condensed family, so glyph width compounds the problem — and cap height runs ≈ 0.7 × font-size, putting these at roughly **6.5–6.7 px of actual character height**.
- **External evidence:** [Steamworks — Steam Deck compatibility criteria](https://partner.steamgames.com/doc/steamdeck/compat): "the smallest on-screen font character should never fall below 9 pixels in height at 1280x800", and text must be "easily readable at a distance of 12 inches/30 cm". [Valve — Steam Deck Verified](https://www.steamdeck.com/en/verified): a verified title "should support the default resolution of Steam Deck (1280x800 or 1280x720), have good default settings, and text should be legible." [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/basic/) lists "Use an easily readable default font size" as a *basic* requirement.
- **Why it matters:** Valve's criterion is written about character height, and by that reading the smallest text is roughly 28% under the floor; even on the most generous possible reading — treating font-size as character height — 9.2 px clears 9 px by a fifth of a pixel. Neither reading is comfortable for a launch-quality bar. The affected strings are not decoration: "Solo best · No run" and "Saved best / No time" are the personal-best feedback that the entire time-trial loop depends on, and they are the smallest text in the product. Counter-evidence worth weighing: the game ships a UI scale setting reaching 140%, which resolves this for any player who finds it — but Deck Verified explicitly judges shipped defaults, and most players never open settings.
- **Fix:** Raise the floor so no default text renders below ~12 px font-size (~8.4 px cap) and ideally 13 px for the personal-best and target strings, then re-run this measurement as a gate — the repo already asserts HUD geometry in `accessibility-controls.spec.ts`, so a "no visible text below N px at 1280×800" assertion fits the existing pattern exactly. Consider promoting UI scale to the first-run flow, since it is the mitigation that already exists.

### [MAJOR · confidence 8/10] The full campaign is consumed in under half an hour of competent play

- **id:** campaign-clears-in-under-30-minutes
- **Evidence in the target:** Summing the measured competent runs, clearing all five Solo challenges takes **758 seconds — 12.6 minutes** of actual racing. Rival races reuse the same five courses at the same lengths, so a complete campaign clear is roughly 25 minutes of racing across ten runs on five tracks, after which the seven-tier Summit ladder is already beaten (finding 1). Standard races are two laps of a single course, so each venue is seen twice per run.
- **External evidence:** Verified content volumes from pages opened this session: [Trials Rising](https://store.steampowered.com/app/641080/Trials_Rising/) — "With over 125 new tracks"; [TrackMania Nations Forever](https://store.steampowered.com/app/11020/TrackMania_Nations_Forever/) — "65 brand new, progressively challenging tracks", free; [Moto X3M](https://poki.com/en/g/moto-x3m) — "Across 50 different levels", 4.3 stars from 5,282,415 votes; [Mad Skills Motocross 3](https://play.google.com/store/apps/details?id=com.turborilla.bike.racing.madskillsmotocross3) — "hundreds of expertly designed tracks, with new offroad tracks added every week." Player sentiment on thin racing content, verbatim: "you'll be lucky to get 5 hours out of this game… Overall, this game lacks content" ([Hotshot Racing Steam reviews](https://steamcommunity.com/app/609920/negativereviews/?browsefilter=toprated)).
- **Why it matters:** Five tracks is defensible for a beta; five tracks that are *fully exhausted in 25 minutes* is a different problem, because the loose targets remove the replay pressure that would normally stretch that content across many sessions. Trials ships 125 tracks *and* leans on failure-driven repetition; RRR ships five and currently asks for none. The track editor is the genuine mitigation here — it is real, it is good, and 4 of the 8 competitors I verified ship one — but a local-only editor with no sharing produces content only for the player willing to build it.
- **Fix:** Do not build more tracks first. Tighten the targets (finding 1) and ship the ghost (finding 4); together they convert the same five courses from 25 minutes of consumption into a repeatable time-attack loop, which is precisely the model TrackMania Nations Forever and Trials monetised. Then judge content volume again from beta behaviour rather than from track count. If tracks are still wanted, the three editor-authored example tracks the bible already requires are the cheapest additions.

### [MAJOR · confidence 9/10 · STILL OPEN] The game has still never run on a physical phone, tablet, gamepad, or real Safari

- **id:** zero-physical-device-evidence
- **Evidence in the target:** Unchanged since the last review. `LAUNCH_READINESS.md`'s unverified-environments table still lists every row as UNVERIFIED, including physical Android Chrome, physical iPhone/iPad Safari ("Playwright WebKit is not equivalent"), physical gamepad, and installed Firefox/Edge. All recorded performance evidence remains one Apple M1 Max with *emulated* mobile. This session could not close it either: software WebGL here makes any frame-rate claim meaningless, which is why performance appears nowhere else in this report.
- **External evidence:** [Steamworks Deck criteria](https://partner.steamgames.com/doc/steamdeck/compat): "the game must ship with a default configuration on Deck that results in a playable framerate." [CrazyGames technical requirements](https://docs.crazygames.com/requirements/technical/): games are disabled if they do not "work smoothly on a 4GB RAM device". [Claypool et al., WPI](https://web.cs.wpi.edu/~claypool/papers/fr/fulltext.pdf): "There are performance benefits for user play up through 60 fps."
- **Why it matters:** Performance is the one dimension of your stated scope that no amount of code reading can settle, and it is the dimension most likely to differ between an M1 Max and a mid-range Android. Browser-game performance is famously bimodal across machines — verbatim from a player on a comparable 3D browser title: "I opened it on my Intel Mac with 64 gigs RAM and it slowed down like hell, entire machine ground to halt" ([Hacker News](https://news.ycombinator.com/item?id=39934881)).
- **Fix:** Unchanged and still an hour: run the full journey on your own iPhone and one mid-range Android, with the performance HUD visible, and write the numbers into `QA_REPORT.md`. Until that exists, "ready on quality" is a claim about desktop only, and should be stated that way to testers.

### [MAJOR · confidence 9/10 · STILL OPEN] The rc.3 visual gate is still unsigned, and every Rival race still ships the rejected rider style

- **id:** unsigned-owner-visual-gate-blocky-rivals
- **Evidence in the target:** Re-verified on your machine today: `e2e/visual-regression.spec.ts-snapshots/` remains absent and no canonical approval record exists — only `scripts/prepare-visual-approval-draft.mjs`. The visual-regression suite therefore still guards nothing. The rc.3 midcourse captures show five cube-bodied, box-headed rival riders flanking the detailed hero in every Rival race, against a bible that forbids "Roblox-adjacent block avatars, cube-first bodies… flat untextured blockiness as a final style." The package's own text concedes the hero "remains flat solid-colour" and that its strengthened contract is "**not** met by this package."
- **External evidence:** None required — repository artifacts, opened this session.
- **Why it matters:** In your stated scope this is squarely a quality question: the rival riders are on screen for the entire duration of the mode meant to showcase the game, and they are the least finished assets in it. Testers will report on them, and you will be receiving feedback on a visual state you never approved.
- **Fix:** Unchanged — spend thirty minutes on the 11 frames and either sign or reject, then decide the rival-pack pass separately. If they ship as-is for beta, say so deliberately and put "how do the rival riders read?" in the tester questions.

### [MINOR · confidence 7/10 · STILL OPEN] First boot still enters the 12-lesson school before the player has raced

- **id:** front-loaded-14-step-tutorial
- **Evidence in the target:** A fresh profile still boots directly into Rider School ("FIRST RIDE · 12 LESSONS + 2 CONTACT DRILLS"). What changed this session is the exit: it is now a 419 px full-width peer button at full-strength contrast with a note that Rider School stays on the main menu, and the card no longer overflows its scroll fold on desktop or Pixel 7 portrait.
- **External evidence:** [Andersen et al., CHI 2012](https://grail.cs.washington.edu/projects/game-abtesting/chi2012/chi2012.pdf), 45,000 players: tutorials "did not significantly improve player engagement in the two simpler games." [CrazyGames quality guidelines](https://docs.crazygames.com/requirements/quality/): "it is crucial that users get to gameplay quickly" and "Focus on the core functionality so users can start playing, avoid explaining every single feature."
- **Why it matters:** Reduced to MINOR because the escape hatch is now real and visible, which was the actual harm. The residual cost is that a first-time tester's opening impression is still a lesson rather than a race — but they can now opt out in one obvious click.
- **Fix:** Optional and unchanged: put Rider School on the title screen as a recommended card rather than auto-entering it, and teach heat and cooling with two just-in-time prompts during the first Practice race. Worth doing only if beta testers actually report the school as friction.

## Untested hypotheses

Not findings — each needs evidence this session could not produce.

1. **Frame rate and feel on real hardware.** Software WebGL here; the repo's only numbers are one M1 Max. Test: finding 7's device hour.
2. **Whether the handling has enough "weight" to satisfy genre players.** I read the physics constants and drove the simulation, but feel is not measurable from constants — and it is the single most-cited complaint in this genre, verbatim from a Descenders player: "sliding through the map, zero weight." Test: two experienced racing-game players on real hardware, asked specifically about weight and landing impact.
3. **Whether landings and crashes read clearly at speed.** `GAME_SPEC` requires readable landing quality; I verified the rules exist but not their legibility in motion. Test: watch someone play and count misread landings.
4. **Audio sufficiency.** All audio is procedural Web Audio with no music tracks. Research was equivocal — [Zhang & Fu](https://www.longdom.org/open-access/the-influence-of-background-music-of-video-games-on-immersion-12114.html) found background music raised immersion mainly for "low gamers" — so I am not calling it a finding. Test: ask testers directly whether it sounds finished.

## What survived

Under measurement, several things held up that I expected to break. **The tracks genuinely demand lane reading** — a hold-W-only run crashes on four of five venues (Pine at 756 m, Coastline at 346 m, Foundry at 211 m, Summit at 1386 m), so the obstacle placement is doing real work even though the clock is not. **Retry friction is right**: instant restart from both the pause overlay ("RESTART NOW") and the results screen ("Retry now"), matching the benchmark the genre is praised for — Trials' "instant restarts at a press of a button." **Gamepad prompts already satisfy Valve's naming rule**, using "A / RT", "B / LT", "D-pad or left stick", "Start" rather than generic labels; I went looking for a violation here and did not find one. **Input breadth and accessibility exceed the bar** set by [Poki's guidelines](https://sdk.poki.com/poki-quality-guidelines) ("offering flexible input options can make the difference between someone being able to play or being completely excluded"): keyboard with full remapping, gamepad, touch, mirrored touch, reduced motion, reduced shake, high contrast, colourblind-safe redundancy, captions, and UI scaling. **Runtime stability was flawless** — zero console errors and zero page errors across every journey driven this session, including the fixes committed today. And the simulation being deterministic and render-decoupled is what made this entire review measurable; that architectural choice is why the numbers above are exact rather than estimated.

## Sources

Opened and read this session. Repository artifacts, measurements, and my harness output are cited inline.

- [Steamworks — Steam Deck compatibility criteria](https://partner.steamgames.com/doc/steamdeck/compat) — 9 px character-height floor, controller, glyph, and framerate criteria
- [Valve — Steam Deck Verified](https://www.steamdeck.com/en/verified) — default settings and text legibility
- [Steamworks — Review process](https://partner.steamgames.com/doc/store/review_process) — build must launch and match store claims
- [Steamworks — Releasing](https://partner.steamgames.com/doc/store/releasing) — build completeness before review
- [Game Accessibility Guidelines — Basic](https://gameaccessibilityguidelines.com/basic/) — readable default font size, remappable controls, difficulty choice
- [web.dev — Rendering performance](https://web.dev/articles/rendering-performance) — the 16.66 ms frame budget
- [Claypool et al., WPI — Frame rate and player performance](https://web.cs.wpi.edu/~claypool/papers/fr/fulltext.pdf) — benefits up through 60 fps
- [CrazyGames — Technical requirements](https://docs.crazygames.com/requirements/technical/) — 4 GB device bar, input requirements
- [CrazyGames — Quality guidelines](https://docs.crazygames.com/requirements/quality/) — time to gameplay, responsiveness
- [Poki — Quality guidelines](https://sdk.poki.com/poki-quality-guidelines) — flexible input, rejection criteria
- [Trackmania wiki — map editor](https://wiki.trackmania.io/en/content-creation/map-editor) — author/gold/silver/bronze medal formula
- [Game Developer — Q&A, designing Trials Fusion](https://www.gamedeveloper.com/design/q-a-welcome-to-the-future---designing-i-trials-fusion-i-) — nuance-driven difficulty, internal track bar
- [Steve Swink — Game Feel: The Secret Ingredient](https://www.gamedeveloper.com/design/game-feel-the-secret-ingredient) — input, response, context, polish
- [Fisher & Kulshreshth — Dynamic Difficulty Adjustment in Games](https://www.intechopen.com/chapters/1228576) — flow channel, boredom vs anxiety
- [Andersen et al., CHI 2012](https://grail.cs.washington.edu/projects/game-abtesting/chi2012/chi2012.pdf) — tutorials and game complexity
- [Trials Rising — Steam store](https://store.steampowered.com/app/641080/Trials_Rising/) — 125+ tracks, editor, $19.99
- [Trials Rising — positive reviews](https://steamcommunity.com/app/641080/positivereviews/?l=english&p=1&browsefilter=trendyear) — praise for precision and failure loop
- [Trials Rising — negative reviews](https://steamcommunity.com/app/641080/negativereviews/?browsefilter=toprated) — grind and inconsistent platinum times
- [Descenders — Steam store](https://store.steampowered.com/app/681280/Descenders/) — leaderboards, procedural runs, $24.99
- [Descenders — negative reviews](https://steamcommunity.com/app/681280/negativereviews/?browsefilter=toprated) — "zero weight", sameness, restart requests
- [Lonely Mountains: Downhill — Steam store](https://store.steampowered.com/app/711540/Lonely_Mountains_Downhill/) — leaderboards, $19.99
- [Lonely Mountains: Downhill — negative reviews](https://steamcommunity.com/app/711540/negativereviews/?browsefilter=toprated) — crash punishment, camera, memorisation
- [Trackmania — Steam store](https://store.steampowered.com/app/2225070/Trackmania/) — free, editor, leaderboards, medals
- [TrackMania Nations Forever — Steam store](https://store.steampowered.com/app/11020/TrackMania_Nations_Forever/) — 65 tracks, editor, ladders, free
- [Mad Skills Motocross 3 — Google Play](https://play.google.com/store/apps/details?id=com.turborilla.bike.racing.madskillsmotocross3) — hundreds of tracks, weekly cadence, editor, 50M+ downloads
- [Moto X3M — Poki](https://poki.com/en/g/moto-x3m) — 50 levels, 5.28M votes
- [Smash Karts — Poki](https://poki.com/en/g/smash-karts) — modes, XP progression, 1.5M votes
- [Hotshot Racing — negative reviews](https://steamcommunity.com/app/609920/negativereviews/?browsefilter=toprated) — content volume and handling complaints
- [The Crew 2 — Steam discussion](https://steamcommunity.com/app/646910/discussions/0/2595630410181792546) — "on rails" arcade handling sentiment
- [TheSixthAxis — Trials Rising review](https://www.thesixthaxis.com/2019/02/25/trials-rising-review/) — instant restarts
- [Hacker News — slowroads.io](https://news.ycombinator.com/item?id=33305234) and [second thread](https://news.ycombinator.com/item?id=39934881) — browser 3D handling and performance sentiment
- [Zhang & Fu — Background music and immersion](https://www.longdom.org/open-access/the-influence-of-background-music-of-video-games-on-immersion-12114.html) — music raises immersion mainly for low gamers
- [Designing Sound — Procedural audio now](https://designingsound.org/2010/09/24/audio-implementation-greats-8-procedural-audio-now/) — procedural audio limits in commercial games
- [Game Developer — GameMaker platformer jumping tips](https://www.gamedeveloper.com/design/gamemaker-platformer-jumping-tips) — coyote time and input buffering
- Dead ends logged by the research sweeps: reddit.com (403 for all queries), gameaccessibilityguidelines.com per-guideline pages (429), partner.steamgames.com/doc/store/application/testing_build (served docs home), eprints.qut.edu.au thesis (robots.txt), onlinelibrary.wiley.com DDA paper (403), trackmania.wiki medals (403)
