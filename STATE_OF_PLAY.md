# Rivet Ridge Rally — State of Play

**Written 2026-09-06, before the project went on hold.** Read this first. Several release
documents in this repo were last updated in late July and describe a version and a set of
blockers that have both moved on — where they disagree with this page, check their dates.

---

## In one paragraph

The game is in good technical shape and was actively being worked on until 2026-09-05.
It is **not ready to release**, and the reason has changed since the release docs were
written: the thing standing between you and an accepted visual baseline is now an
**engine bug**, not your sign-off. There is also one open CRITICAL gameplay-tuning defect.
Nothing is uncommitted and nothing is at risk — every change is pushed.

## Where the code is

| | |
|---|---|
| **Working branch** | `agent/rc2-launch-hardening` — all current work |
| **`main`** | 2026-07-15, 142 commits behind |
| **Pull request** | [#1](https://github.com/jbrackens/rivet-ridge-rally/pull/1) — open, still marked **draft** |
| **Candidate version** | **1.0.0-rc.3** (`package.json`). Docs that say rc.2 are out of date. |
| **Working tree** | Clean, pushed, in sync |

## The two things actually blocking release

### 1. A render flicker under CPU load — this is the real blocker

Recorded in `docs/design/GRAPHICS_EVOLUTION_PLAN.md` §10, found 2026-09-02. The visual
capture process gzip-hashes several megabytes per frame on the CPU while the browser is
rendering. That self-inflicted load makes roughly **20–30% of loads** render in an
anomalous lighting state, so captured frames aren't trustworthy.

It was investigated properly and is **not** a colour-grade problem — the night tone
mapping is correctly compiled even in a bad frame, and the older bright default shows the
same variance. It is a separate engine-robustness issue with a fast local repro.

**Why this matters most:** the release documents say the project is waiting on *your*
visual approval. That is no longer true. Until the flicker is fixed, a capture can't be
trusted, so approving frames would approve noise. The graphics plan states this directly:
the flicker, "not the owner sign-off," is what blocks a clean baseline capture.

### 2. An open CRITICAL gameplay-tuning defect

From 2026-08-12, still **untouched** per `QA_REPORT.md`:
- Canyon finishes **48% inside** its target time (`solo-targets-set-48pct-off-competent-pace`)
- The hardest AI (Ace) has its top speed **capped below the player's turbo speed**
  (`ai-top-speed-capped-below-player`)

Together these mean the difficulty curve doesn't hold up. `LAUNCH_READINESS.md` claims
"zero product defects outstanding" — that claim predates this finding and is wrong.

## What is genuinely done

- **Rendering overhaul, 2026-08-30 → 09-05** — authored display grade, cine-night default,
  per-venue sky lighting (replacing the old studio-box environment), height fog, GPU
  timing, exposure retune.
- **UI/UX polish plan** — all four waves complete (`docs/UI_UX_POLISH_PLAN.md`).
- **Performance** — production Lighthouse run on 2026-07-20 scored performance 98,
  accessibility 100, best practices 100, SEO 91 (TBT 40 ms, LCP 1.1 s). Note this is a
  *July* measurement taken before the render overhaul; re-measure before quoting it.
- **Release machinery** — content-addressed attestation chain, release manifests,
  production smoke, 30-minute soak, rollback reproducibility. Unusually thorough.
- **Test suites** — 303 unit tests, 21 end-to-end spec files, 158 release-script checks.

## What is stale in the release docs

Each of these now carries a status banner explaining the problem:

| Document | Problem |
|---|---|
| `LAUNCH_READINESS.md` | Names rc.2 (now rc.3); claims zero defects (see above); quotes pixel-diffs for baselines deleted 2026-07-28 and never re-promoted |
| `README.md` | Said the candidate was rc.2 while `docs/OPERATIONS.md` — updated in the same commit — said rc.2 was retired |
| `docs/OWNER_VISUAL_REVIEW_2026-08-09.md` | Says "ready for owner review", but the whole look was replaced 09-01 → 09-05. Needs recapture. |
| `docs/OWNER_SUPPLY_LIST_2026-07-27.md` | Instructs you to review a package that is itself marked superseded |
| `docs/RC2_REMAINING_GATES_CHECKLIST.md` | Says the visual vertical slice is "not started" — it shipped |
| `docs/HANDOFF_TO_CLAUDE_FABLE.md` | Its art target was replaced by the 2026-08-30 owner brief |
| `AGENTS.md` | Its "read these first" list omits `docs/design/` — where the current art direction *and* the real blocker live |

## If you have one hour when you come back

1. Read this page and `docs/design/GRAPHICS_EVOLUTION_PLAN.md` §10.
2. Fix the capture-time flicker — it gates every visual gate downstream. There is a fast
   local repro recorded with it.
3. Then re-capture visual baselines. Only then is owner review worth your time.
4. Separately, retune the Canyon target and the Ace top-speed cap.

Do **not** start by reviewing the existing screenshot packages. They show a look that no
longer ships.

## Reference — easy to get wrong

- **Toolchain drift is real.** The project pins Node 26.4.0 and npm 11.17.0, but a plain
  shell here resolves Node 22 / npm 10. Release scripts enforce the pin and will fail
  otherwise — use `npx -y npm@11.17.0 run <script>` for release commands.
- **TypeScript is deliberately double-installed.** `typescript` is an alias for
  `@typescript/typescript6` (an API shim the linter needs, because TypeScript 7.0 ships no
  programmatic API); the real TypeScript 7.0.2 lives under `typescript-7`, which is what
  `npm run typecheck` invokes. Collapse this back to a single dependency once
  typescript-eslint supports TS 7.
- **Lighthouse must be run against a production build** (`npm run build`), not a
  `VITE_QA_MODE=1` build — the QA instrumentation makes the score look far worse than it is.
- **Release evidence is cryptographically bound** to the tagged candidate under the pinned
  toolchain. Producing it on the wrong Node version creates invalid evidence.
