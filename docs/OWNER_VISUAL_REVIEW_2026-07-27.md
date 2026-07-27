# Owner Visual Review Package — 2026-07-27

**Gate:** 4 of `docs/RC2_REMAINING_GATES_CHECKLIST.md` (owner visual acceptance).
**Status:** **SUPERSEDED — DO NOT REVIEW YET. RECAPTURE REQUIRED FIRST.** Nothing here is
acceptance, and no baseline has been promoted.

> ## Hold — a venue defect was found in this package after it was assembled
>
> I validated these 11 frames myself before asking you to spend time on them, and found
> that **Foundry Flight does not read as a distinct venue** in this build. Its terraces
> render the same warm brown as Canyon and Coastline, so the venue reads as "Canyon plus
> one smokestack". The fidelity ledger's claim of a "dark industrial palette" was not
> supported by these captures. Full analysis: finding **R10** in
> `docs/design/FIDELITY_LEDGER.md`.
>
> **This is already fixed in source** (`palette.rock` warm brown → steel blue `0x4a5a70`,
> plus a cooler `dirtDark`), and working-tree diagnostic captures confirm Foundry now
> reads as a cold steel industrial site, with Canyon and Pine Run unchanged in the same
> runs and plainly distinct from it. All five venues now read as different places. That
> diagnostic is *not* certification: it was rendered from the working tree, not a frozen
> candidate.
>
> I also checked all five venues rather than only the one that looked wrong. Pine Run,
> Coastline Clash, Canyon Kickoff and Summit Showdown each read as their documented
> identity in this package; Foundry was the only venue-identity defect.
>
> **What this means for your review.** These frames are of candidate build `2d0376d`,
> which predates the fix, so reviewing them now would spend your time on a venue defect
> that no longer exists in source. The frames remain on disk unaltered as historical
> evidence — nothing has been deleted or overwritten.
>
> **Your decision — one of:**
>
> 1. **Re-freeze and recapture first (recommended).** The candidate is re-frozen at a
>    commit including the Foundry fix, all 11 frames are recaptured, and you review once
>    against a build that matches source. **This is owner-gated and I have not done it.**
> 2. **Review this package as informal feedback only**, treating Foundry's two frames as
>    known-defective and judging the other four venues. This cannot be Gate 4 acceptance —
>    see the scope limit below.
>
> ### Three constraints found by external review, 2026-07-27 — read before deciding
>
> An external skeptical review (GPT 5.6, read-only, checking the scripts rather than my
> summary) found three things I had wrong. All three are verified against the code.
>
> **1. Re-freezing is destructive, and I was wrong to say I could do it unilaterally.** I
> had told you re-freezing the *visual candidate* was mine to run because the artifact is
> regenerable. That was rationalisation. `npm run visual:candidate` calls
> `removeRootOutputs()`, which performs `rm(visualCandidateRoot, { recursive: true, force:
> true })` (`scripts/release-manifest.mjs:639`), so it **deletes the existing candidate
> distribution**. Those artifacts are git-ignored, and `promote-visual-baseline.mjs`
> validates only the fixed `current/` path, so keeping copies elsewhere does not preserve
> the candidate or its ability to be revalidated or promoted. My supporting citation was
> also the wrong proof: `docs/ROLLBACK_REPRODUCIBILITY_2026-07-27.md` covers tag commit
> `2b40695` built with `VITE_QA_MODE=0`, **not** the QA-mode candidate at `2d0376d`.
> Re-freezing therefore requires your authorisation plus a verified immutable archive of
> the current candidate first.
>
> **The archive prerequisite is now DONE (2026-07-27).** `npm run visual:candidate:archive`
> preserved all 34 candidate files (7,605,658 bytes) to
> `artifacts/candidate-evidence/visual/archive/visual-candidate-1.0.0-rc.2-cd06b258cd4f`,
> verified byte-exact, with a committed integrity record at
> `artifacts/history/visual-candidate-1.0.0-rc.2-cd06b258cd4f-archive.json` recording every
> file's SHA-256. Independently confirmed with `shasum -a 256` across both trees outside the
> script's own logic. The script refuses to overwrite an existing archive (verified: exit 1).
>
> **One caveat you should know:** `artifacts/candidate-evidence/` is git-ignored, so the
> archived *bytes* are on this machine only — just the integrity record is in version
> control. Off-machine durability is still an operator task and remains on the owner supply
> list. So the re-freeze is now gated on your authorisation and the identity/scope decisions
> below, not on the archive.
>
> **2. Gate 4 cannot formally accept Foundry — or any venue except Canyon — as built.** The
> approval tooling is Canyon-scoped: `promote-visual-baseline.mjs` has a single
> `TARGET_PATH` (`race-curved-course-canyon-chromium-darwin.png`) and its approval statement
> reads *"I reviewed the exact Canyon Practice 500 capture … and accept it as the checked-in
> visual regression baseline."* So reviewing 11 frames produces an acceptance record for
> **one Canyon frame**. Either the approval scope is expanded to enumerate all 11 frames and
> their hashes, or Gate 4's claim narrows honestly to Canyon. I had been describing Gate 4
> as satisfiable by you reviewing the package; that was not accurate.
>
> **3. Candidate identity must be decided before any recapture.** The candidate records
> commit `2d0376d` with `expectedVersionTagAtCommit: false`, yet still carries version
> `1.0.0-rc.2`, whose tag points elsewhere. The next immutable identity (likely `rc.3`)
> needs deciding *before* a replacement candidate is built, not after.
>
> Separately, the full Chromium sweep at `d3e4480` returned **104 passed / 7 failed**, and
> three of those failures are **not** the expected unpromoted baselines. Those are being
> diagnosed. Nothing should be frozen until they are classified.
>
> Everything below describes the superseded `2d0376d` package and is accurate for that
> build only.

## What to look at

**Captures:** `artifacts/visual-review/rc2-owner-review-2d0376d-20260727T023725Z/`
**Manifest:** `artifacts/visual-review/rc2-owner-review-2d0376d-20260727T023725Z/manifest.json` — 229,198 bytes, SHA-256 `d38740bef0ea7a3ac1136f07a4c28db80a8eeaba4fc05705b81576cdf3f5bc0a`, schema 3, `five-track-controlled-visual-review`, status **PASS**, 11/11 frames.

Compare each frame against the approved concept art in `docs/design/concepts/` — principally `gameplay-desktop.png` for composition and density, and `hero-bike-rider-production-reference.png` for the bike and rider.

| Frame | Bytes |
|---|---:|
| `start/canyon-kickoff-practice-1280x720.png` | 899,262 |
| `start/pine-run-practice-1280x720.png` | 790,605 |
| `start/coastline-clash-practice-1280x720.png` | 779,973 |
| `start/foundry-flight-practice-1280x720.png` | 799,063 |
| `start/summit-showdown-practice-1280x720.png` | 783,733 |
| `midcourse/canyon-kickoff-rival-1280x720.png` | 891,828 |
| `midcourse/pine-run-rival-1280x720.png` | 794,883 |
| `midcourse/coastline-clash-rival-1280x720.png` | 665,098 |
| `midcourse/foundry-flight-rival-1280x720.png` | 823,506 |
| `midcourse/summit-showdown-rival-1280x720.png` | 637,001 |
| **`curved-baseline-candidate/canyon-kickoff-practice-1280x720.png`** | **867,328** |

The last frame is the one that matters most: it is the **only** capture eligible to become a checked-in regression baseline, and the promotion tool accepts nothing else.

## Binding

- **Source commit:** `2d0376d2080320cb8047492bf628ff04e3d6e0b7`, clean tree before and after capture.
- **Visual QA candidate:** 33 files / 7,593,929 bytes, aggregate SHA-256 `cd06b258cd4f0a4dc74bc7a823384ffd9a695c4d9dd5e1fd294cb78976f4c5a2`.
- **Conditions:** dedicated `127.0.0.1:4380` loopback, Chromium, 1280×720 at device scale 1, **High** quality, production course scale, browser audio muted.
- Every frame required the authored hero, Canyon kit and panorama to report ready before it was taken. Passive snapshots only — no state injection, no relocation, no freeze.

## What has changed since the last review captures

Since the July 19 captures the readiness documents describe, the hero asset has had one accepted improvement and two rejected experiments:

- **Shipped:** the rounded-silhouette pass — smooth-by-angle shading plus denser rider forms. Rounder shoulders, arms, helmet and pelvis at +2,040 triangles, and the hero file got **39% smaller** (517,664 → 317,936 bytes).
- **Rejected on evidence:** a baked occlusion map (imperceptible at this camera — glTF occlusion only dims ambient light and this hero is direct-lit) and a procedural relief map (actively worse — arbitrary UVs put machined ribbing on the forks and quilting across the number plate). Both reverted; see `docs/design/HERO_TEXTURE_ATLAS_PLAN.md` §5b and §5c.

**My own assessment, so you are not reviewing blind:** the environment reads as a coherent, readable arcade course and the silhouettes are better than July. The gap to the reference art is now **material depth** — ten flat solid-colour surfaces with no texture maps — and three separate attempts established that closing it needs authored art from a person or a high-poly sculpt, not procedural generation. Judge whether the current look is acceptable for RC2 on its own terms; it will not get materially closer to the reference without art resourcing.

## How to accept, if you accept

A non-accepting draft is prepared at `canyon-owner-approval.draft.json` (session scratchpad, deliberately outside the repository). It is pre-filled with the candidate and screenshot hashes and is **rejected by the promotion tool until you author the decision yourself**.

Required edits, made by you:

1. `decision` → `ACCEPT`
2. `approvedAt` → the current UTC timestamp
3. `reviewer.name` → your real name

Do not alter any candidate or screenshot hash field. Then run `npm run visual:promote:canyon`, which re-inventories the candidate, independently revalidates all 11 frames and each served response set, enforces a 24-hour window between capture and approval, and creates exactly two files: the checked-in baseline and its committed approval record.

`authentication: "external-manual-trust-boundary"` is deliberate and load-bearing. Hashes, timestamps and file placement prove internal consistency only — **they cannot authenticate you**. Genuine authorship and genuine review remain outside the tooling, which is why no automated step can substitute for you looking at the frames.

## Scope limits

Captures live under `artifacts/visual-review/`, which is git-ignored; the durable evidence is the hashes recorded here. This package covers desktop 1280×720 five-track start and midcourse plus the Canyon 500 m baseline candidate. **Not covered:** portrait, high contrast, Builder and Test Ride, hero motion states, rival readability at racing distance, and any physical device. Those remain open under gates 4, 7 and 8.
