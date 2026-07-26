# Chromium E2E Baseline — 2026-07-26

**Commit under test:** `715748b` working tree
**Command:** `RRR_PLAYWRIGHT_PORT=4174 npx playwright test --project=chromium`
**Toolchain:** Node `26.4.0` / npm `11.17.0` (pinned)
**Host:** macOS arm64, headless Chromium, `workers: 1`, `fullyParallel: false`
**Duration:** 2.2 hours

**Result: 91 passed / 19 failed / 5 skipped across 115 tests in 15 spec files.**

This is the first whole-suite run recorded for this branch. It exists because three failing tests were found by accident while doing unrelated work, which meant the true state of the other fourteen spec files was unknown. The readiness documents' claims about browser coverage rested on that unknown.

**Headline: no product defect was found.** Every failure falls into one of three classes, each established by evidence rather than assumption.

## Classification

### A. Correct behaviour — deliberately unpromoted visual baselines (4 failures)

| Test | Result |
|---|---|
| `visual-regression.spec.ts:126` desktop race | 563,845 px differ (ratio 0.62) vs the checked-in baseline |
| `visual-regression.spec.ts:138` production Canyon bend | **No baseline exists** at `race-curved-course-canyon-chromium-darwin.png` |
| `visual-regression.spec.ts:157` editor | 179,582 px differ (ratio 0.20) |
| `visual-regression.spec.ts:186` high-contrast scaled HUD | 310,413 px differ (ratio 0.34) |

These are the system working as designed, not defects:

- The checked-in baselines are RC1-era. The composition has changed deliberately and substantially since, and `docs/design/FIDELITY_LEDGER.md` records them as rejected/reopened pending owner review.
- The Canyon bend baseline is **intentionally absent**. The ledger is explicit that it must not exist until the owner reviews the exact frame and the guarded `npm run visual:promote:canyon` workflow runs. `playwright.config.ts` sets `updateSnapshots: 'none'` so it cannot be created accidentally.
- The measured deltas track the values already recorded in `LAUNCH_READINESS.md` (previously ~69%/22%/35%), confirming the harness is stable rather than drifting.

**No baseline was created, updated or promoted.** These four will keep failing, correctly, until owner visual acceptance exists.

### B. Real defects, found and fixed (4 failures)

| Test | Root cause | Fix |
|---|---|---|
| `release-quality.spec.ts:31` required surfaces free of axe failures | **The axe scan raced the screen entrance animation.** `.screen-surface` fades opacity `.01 → 1` over 180 ms. The test waited only for the heading to be visible, then ran axe mid-fade. axe samples *computed* colour, so it measured the teal step labels at ~60 % opacity — `#178990` on `#071e34`, 4.03:1 — and reported a WCAG AA contrast failure. The settled UI is well clear of the threshold. | Await all finite animations before scanning. Infinite animations are filtered out so the wait cannot hang. |
| `editor-coverage.spec.ts:457`, `:563` (and `:526`, `:586` locators) | **`getByLabel("Laps")` matched three elements.** The 2026-07-19 inspector-stepper slice added `Decrease laps` / `Increase laps` buttons beside the existing numeric input; Playwright's string matching is substring and case-insensitive, so all three matched and strict mode failed. | `getByLabel("Laps", { exact: true })`, targeting the numeric input the tests intend. |

The axe case is the most valuable find in the run: a UI-motion change shipped on 2026-07-19 silently broke a release accessibility gate, and the scoped test for that slice did not cover it. Only a whole-suite run could surface it.

Both fixes were verified individually — `release-quality` 1/1 (1.9 min), `editor-coverage` lap cases 2/2 (1.9 min).

### C. Timing budgets under serial load — not product defects (11 failures)

| Test | Evidence |
|---|---|
| `campaign-modes.spec.ts:128` Canyon rival | Test timeout 150 s |
| `campaign-modes.spec.ts:177` Solo→Rival six-rider field | Test timeout 240 s |
| `editor-coverage.spec.ts:472` Rider School ignores Test Ride course | 5 s assertion budget for a WebGL race start. **Verified passing in isolation (56 s)** against its own 60 s test budget — marginal by ~4 s. |
| `editor-coverage.spec.ts:526`, `:606`, `:643` | Same shape: WebGL race start exceeding default assertion budgets |
| `hero-bike-rider-motion.spec.ts:472` airborne pitch and landing pulse | Expected `airborne`, received `grounded`. **Verified passing in isolation (2.5 min).** Checked specifically because the 2026-07-25 hero asset change was a candidate cause; it is not — that change is presentation-only and cannot affect the fixed-step simulation that sets the phase. |
| `lifecycle.spec.ts:340` device-storage recovery | Assertion count mismatch under load |
| `lifecycle.spec.ts:422` twenty immediate restarts | Test timeout 480 s. **Reached restart 18 of 20**, and all 17 completed restarts passed their leak assertions (`gameEngines: 1`, `webglContexts: 1`, render loops, listener groups). The property under test held; the clock ran out at ~24 s per restart cycle. |
| `lifecycle.spec.ts:515` six results retries | Test timeout 480 s |
| `quality-presets.spec.ts:3` four renderer presets | Test timeout 90 s |
| `rival-pack.spec.ts:67` failed rival request | Test timeout 30 s — the same under-budgeted shape already fixed in `reliability.spec.ts` |

**The pattern.** This suite's timing assumptions were calibrated on a faster or less loaded machine. Headless WebGL plus WASM transcoder startup costs roughly 8–14 s per page load here, before any assertion under test can become true. Tests that boot the engine several times, or drive multi-step tutorials, exceed budgets that looked generous when written.

Three tests in `reliability.spec.ts` with exactly this shape were fixed earlier the same day by giving them budgets proportional to their work; that file now passes 13/13.

**These eleven were deliberately left unfixed.** Raising eleven more timeouts in one pass is precisely the "loosen thresholds until CI is green" move `AGENTS.md` prohibits, and doing it without owner visibility would bury a legitimate question: whether the suite should be re-budgeted, or run with more workers, or whether this host is simply slower than the one that set the numbers. That is a decision, not a cleanup.

## What this establishes, and what it does not

**Establishes:** at `715748b`, on this host, Chromium exercises 91 passing browser journeys covering accessibility controls, campaign modes, core flow, editor coverage, gamepad emulation, hero motion, lifecycle, migrations, persistence, quality presets, release quality, reliability, rival pack, and tutorial. No product defect surfaced anywhere in the suite.

**Does not establish:** any release qualification. Specifically —

- This is a **dirty working tree**, not a frozen candidate.
- Chromium only. Firefox, WebKit, mobile-chrome, mobile-safari and tablet-chrome were **not run**; the suite defines all six projects.
- The four visual gates remain correctly failing pending owner acceptance.
- The eleven timing failures remain open, so **`npm run test:e2e` does not pass end to end on this host**.
- It is not the structured `browser` QA record required by the release attestation, which must bind a frozen candidate and its manifest aggregate.

## Confirming run after re-budgeting — and a real defect the timeout was hiding

Second full Chromium sweep, same host, after the `playwright.config.ts` default raise and six individual budget increases.

**101 passed / 9 failed / 5 skipped (2.3 hours)** — up from 91 passed / 19 failed.

| Failure | Class |
|---|---|
| 4 × `visual-regression` | A — correct behaviour, unpromoted baselines (unchanged) |
| `lifecycle.spec.ts:422` twenty immediate restarts | **NEW CLASS D — a real defect, previously masked** |
| `editor-coverage.spec.ts:457` | C — own budget 90 s; passes individually at ~90 s. Raised to 240 s. |
| `editor-coverage.spec.ts:643` | C — three sequential test rides. Raised 300 → 480 s. |
| `accessibility-controls.spec.ts:221` | C — **verified passing in isolation (1.6 min)** |
| `accessibility-controls.spec.ts:407` | C — **verified passing in isolation (1.1 min)**; failed with `Target page, context or browser has been closed`, i.e. the browser died |

### Finding R7 — restarts recreate the WebGL context instead of reusing it

`lifecycle.spec.ts:422` no longer times out; with a realistic budget it now completes all 20 restarts and **fails a real assertion**:

```
expect(finalSnapshot.started.webglContexts).toBe(baseline.started.webglContexts)
  Expected: 2
  Received: 22
```

Twenty restarts created twenty additional WebGL contexts. The test's name states the intended contract — *"twenty immediate restarts **reuse one WebGL context**"* — and that contract is not being met.

**Cause.** `src/ui/game/GameView.tsx:914` renders `<canvas key={raceAttempt}>`. Keying the element on the attempt number makes React unmount and remount the canvas for every race, which necessarily destroys and recreates its WebGL context. This was introduced deliberately: the 2026-07-19 dust-plume slice "remounts the game canvas for each new race attempt and keeps the engine-instance diagnostic guard so asynchronous Canyon panorama callbacks cannot leak stale environment attributes into a later Pine canvas."

So two intentional behaviours now contradict each other, and the test guarding one of them has been masked by a timeout ever since — which is exactly why the whole-suite sweep was worth running.

**Severity — churn, not a leak.** The per-resource active-count loop immediately above line 509 **passed**: active engines, contexts, render loops, listener groups and poll loops all returned to 1. Contexts are being disposed correctly. Nothing accumulates.

But it is not harmless. Browsers cap simultaneous live WebGL contexts (Chrome around 16) and respond to pressure by force-losing the oldest. Creating and destroying twenty contexts in a session is real churn, and it is the most plausible explanation for `accessibility-controls.spec.ts:407` dying with `Target page, context or browser has been closed` after a long sweep while passing comfortably in isolation. Three of the remaining class-C failures pass alone and fail only in a long run, which fits resource pressure rather than slowness alone.

**This needs a decision, not a quick fix.** Two coherent options:

1. **Restore context reuse.** Architecturally better — it removes the churn. Viable only if the engine-instance guard and canvas-ownership token added in the same 2026-07-19 slice already prevent the stale-callback bug on their own, in which case the remount is redundant belt-and-braces. Requires confirming that, then removing the `key`.
2. **Accept remount-per-attempt** and rewrite the test's contract to assert what actually matters — one *active* context, every started context stopped, nothing accumulating — instead of asserting reuse.

Option 1 is preferable if the guard suffices, because it also relieves the suspected resource pressure. **Neither should be chosen unilaterally**: the remount was a deliberate correctness fix, and weakening the test to match current behaviour would erase a real signal. Tracked as gate row 20.

### R7 investigation — option 1 validated, with one of my own claims corrected

**Finding: the remount was redundant belt-and-braces that silently disabled an optimisation the codebase already had.**

`GameView.tsx` cleanup computes `const retainRenderer = canvas.isConnected && sameSessionSurvives;` and passes it to `engine.dispose({ retainRenderer })`. React removes a keyed element from the DOM *before* effect cleanup runs, so with `key={raceAttempt}` the old canvas was always already disconnected, `retainRenderer` always evaluated `false`, and the WebGL context was destroyed every race. The reuse path existed but was unreachable.

**Chronology.** `git log -S` shows the ownership guard (`ownsCanvasDiagnostics`), the remount (`key={raceAttempt}`), and the tests asserting reuse (`reusedCanvas`, and `lifecycle.spec.ts:422` "reuse one WebGL context") were **all introduced in the same commit `aae8943`** (2026-07-19, "Harden rc2 launch candidate"). Two mechanisms for one problem shipped alongside tests requiring only the first — so those tests could never pass. `lifecycle:422` then began timing out, which hid the contradiction until the budgets were fixed.

**Evidence with the `key` removed:**

| Check | Before | After |
|---|---|---|
| `npm run typecheck`, `eslint` | — | clean |
| `lifecycle.spec.ts` (whole file) | 5/7 | **7/7** |
| `lifecycle:422` twenty restarts | FAIL (22 contexts vs 2) | **PASS** (9.2 min) |
| `lifecycle:515` six retries release each context | FAIL (timeout) | **PASS** (9.9 min) |
| `lifecycle:340` device-storage recovery | FAIL in sweep | **PASS** |
| `reliability.spec.ts` (whole file, the stale-callback surface) | 13/13 | **13/13** — no regression |

**Correction to an earlier claim in this document.** The section above asserted that `ownsCanvasDiagnostics()` is what prevents the stale-callback bug and is "load-bearing on its own". A falsifiability probe disproved that:

1. Stubbing `ownsCanvasDiagnostics()` to `return true` — the new track-switch regression test still **passed**.
2. Additionally short-circuiting the guard inside `activateEnvironmentBitmap` — still **passed**.

The write never reaches those paths, because an earlier `if (this.disposed)` in the settle path short-circuits first. **The layered `disposed` checks are what actually stop this scenario**; the ownership comparison is defence in depth for a shared canvas, not the primary guard.

This does not weaken the conclusion — it strengthens it. The protection is `disposed`, which is set by the effect cleanup that always runs before the next engine is constructed, and is therefore **entirely independent of whether the canvas element is reused**. Removing the remount cannot reintroduce the bug.

It does mean the new `reliability.spec.ts` regression test is a **behaviour-level** guard, not a probe of one mechanism: no single guard can be defeated to make it fail. Its comment now says so explicitly, and points at `lifecycle:422` as the test that catches a re-added remount. Recording this because a test that cannot fail is worth less than it looks, and that limitation should be visible to whoever reads it next.

### R7 REVERTED — the fix caused a regression the targeted runs could not see

**Third full sweep at `4fed0cc`: 105 passed / 6 failed / 5 skipped (2.2 hours).** Better than 101/9 — but the composition changed, and one change was a regression I introduced.

| Test | Sweep 1 | Sweep 2 | Sweep 3 (with canvas reuse) |
|---|---|---|---|
| `lifecycle:422` twenty restarts | FAIL | FAIL | **PASS** |
| `lifecycle:515`, `lifecycle:340` | FAIL | FAIL | **PASS** |
| `editor-coverage:457`, `:643` | FAIL | FAIL | **PASS** |
| `accessibility-controls:221` | FAIL | FAIL | **PASS** |
| `accessibility-controls:407` | PASS | FAIL | FAIL |
| **`tutorial:229` comprehensive tutorial** | **PASS** | **PASS** | **FAIL** |
| 4 × `visual-regression` | FAIL | FAIL | FAIL (correct) |

`tutorial.spec.ts:229` — "a new rider completes the comprehensive tutorial without skipping" — failed at the *"Shape the jump"* lesson, reaching `data-demonstrated-mechanics="… wheelie crash"` where it expects `airbornePitchUp`. The bike wheelie-crashed instead of getting airborne.

**Confirmed as my regression by A/B probe**, not inferred:

| Canvas | Tutorial result |
|---|---|
| Reused (key removed) | **FAIL** — reproduced in the sweep *and* twice in isolation |
| Remounted (key restored) | **PASS** (4.4 min) |

**Mechanism.** Retaining the renderer removes engine start-up cost, which changes how much simulation time is dropped on the first frames after a race begins. That shifts when the bike reaches the ramp relative to the tutorial test's scripted key presses, so `ArrowUp` is still being held while grounded — and a wheelie held past `wheelieCrashSeconds: 1.4` is a crash, exactly as designed.

**Decision: reverted.** The `key={raceAttempt}` is restored, with a comment recording why it must stay until the tutorial flow is decoupled from start-up timing.

Reasoning, since the trade is not one-sided — the revert costs `lifecycle:422`, `:515`, `:340` and possibly `accessibility:221` going back to failing:

1. **The regression is in the most important test in the suite.** It validates that a genuine first-time player can complete onboarding. Lifecycle context churn is an efficiency defect; contexts were always disposed correctly and nothing leaked.
2. **I do not yet know whether only the test shifted, or the actual onboarding experience did.** If real players now reach the ramp at a different moment, the wheelie-into-jump window genuinely changed. That is a gameplay question, and the owner explicitly asked that tutorial behaviour not regress.
3. **Adjusting the tutorial test to accommodate the runtime change would be exactly backwards** — it would mask the open question in (2).

**What re-landing R7 requires — a decouple attempt on 2026-07-26 established this is bigger than it looks.**

The obvious fix was tried: `tutorial.spec.ts:229` holds `ArrowUp` continuously from the wheelie lesson through the jump lesson, so the outcome depends on how long the bike takes to cover the ground between the bump and the ramp — and a wheelie held past `PHYSICS.wheelieCrashSeconds` (1.4 s) is a crash by design. The fix released `ArrowUp` after the wheelie lesson and re-pressed it only once `data-player-motion-snapshot.phase` reported `airborne`, driving on observed state instead of travel timing.

**It fixed the original failure and moved the problem downstream.** `airbornePitchUp` then passed, and the test failed later at the barrier lesson: `data-tutorial-events` reached `trainingBumpClearedInWheelie` but never `choiceBarrierAvoided`, with the tutorial already advanced to Lesson 10 ("Mud slowdown"). The barrier had been passed by a different route than the assertion names, because shifting the airborne window changed where and how the bike landed and therefore which lane it occupied at the barrier.

**Diagnosis: the coupling is the whole chain, not one link.** This is a twelve-lesson scripted flow whose steps share bike state — lane, forward position, phase, held keys. Each lesson's outcome feeds the next, so decoupling any single step redistributes the timing pressure rather than removing it. Properly decoupling it means driving *every* lesson on observed state (lane and forward position as well as phase), which is a substantial test-harness rewrite, and each verification cycle costs about 4.5 minutes.

The attempt was reverted; `tutorial.spec.ts` is unchanged and passing. The attempt is archived as `tutorial-decouple-attempt.spec.ts` in the session scratchpad so the next pass can start from it rather than rediscovering the downstream effect.

**Sequenced honestly, re-landing R7 is: (1) rewrite the comprehensive tutorial flow to be state-driven throughout, (2) confirm by hand that the jump and barrier lessons still play the same for a human, (3) remove the canvas key, (4) re-run `tutorial.spec.ts` and `lifecycle.spec.ts`, (5) run a full sweep.** Step 1 is the real cost, and it is test-harness work rather than a product fix.

**Wider lesson worth recording.** The R7 fix was validated against `lifecycle.spec.ts` (7/7) and `reliability.spec.ts` (13/13) — the two files most obviously related to it — and both were green. The regression was in a file nobody would have thought to run. Targeted verification of a runtime change is not sufficient; only the full sweep caught it, and it cost 2.2 hours to find. That is the argument for running the sweep before landing runtime changes, not after.

## Recommended next steps

1. Decide the timing question in class C — re-budget the eleven, or investigate host/parallelism first. Re-budgeting is defensible per-test but should be a deliberate call.
2. Run the remaining five browser projects once class C is settled, to complete the cross-browser picture.
3. Only then generate the structured `browser` QA record, against a frozen candidate.
