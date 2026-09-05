# Owner Visual Review Package — 2026-08-09 (rc.3)

**Gate:** 4 of `docs/RC2_REMAINING_GATES_CHECKLIST.md` (owner visual acceptance).
**Status:** **READY FOR OWNER REVIEW.** Nothing here is acceptance; no baseline has been
promoted. This package supersedes `docs/OWNER_VISUAL_REVIEW_2026-07-27.md` (retained as
history), whose build predated the Foundry Flight venue fix (finding R10).

## What this package is

One frozen, verified bundle at commit `16951c9461e0369e9612f07dee2a52bd58a21ad9`
(version `1.0.0-rc.3`, deliberately untagged — promotion requires it):

- **Captures:** `artifacts/visual-review/rc3-owner-review-16951c9-20260809T190911Z/`
- **Manifest:** `manifest.json` in that directory — 232,266 bytes, SHA-256
  `2b64b091a847ed47e69babfe59e82a72aec47ddb228612b59e48262ad67b9c82`, schema 3,
  status **PASS**, all 12 checks passed, captured 2026-08-09T19:20Z.
- **Visual QA candidate:** 33 files, aggregate SHA-256
  `9062d9d049fa1e593ac2a0f56ba9b0440667772077f805117458b79319e3ab06`, rebuilt and served
  from a dedicated loopback with every response byte manifest-bound.

Under owner-approved gate-4 scope (2026-07-30), your single review covers **both**:

1. the **11 venue review frames** (five venues at start and midcourse, plus the Canyon
   curved-course frame), and
2. the **5 visual-regression baseline candidates** that guarded promotion will check in as
   the permanent test baselines.

## Mechanical verification already done (none of it is acceptance)

- Capture ran end to end against the frozen candidate: 11/11 frames PASS, 5/5 baseline
  candidates PASS, zero browser console errors, failed requests, or HTTP errors.
- **The five candidates were installed as baselines and the unmodified
  `e2e/visual-regression.spec.ts` was run against them: 5 passed, 0 failed** (chromium +
  mobile-chrome), then the copies were removed. So the bytes you are asked to accept are
  proven to pass the permanent regression gate before you spend any time on them.
- The portrait candidate is 412×839 **CSS pixels** (Pixel 7 profile) — the R14
  device-pixel trap is guarded against at capture, promotion, and verification.
- The first end-to-end run failed (`HTTP 404`, strict candidate-server URL contract) and is
  preserved unaltered at `artifacts/visual-review/rc3-owner-review-4d00c97-20260809T185501Z/`
  with the fix recorded in commit `37f937c`.

## The 11 review frames

| Frame | Bytes | SHA-256 (first 16) |
|---|---:|---|
| `start/canyon-kickoff-practice-1280x720.png` | 899,262 | `004a6418fa4aba95` |
| `start/pine-run-practice-1280x720.png` | 790,605 | `e276f334c94dc13e` |
| `start/coastline-clash-practice-1280x720.png` | 779,973 | `4555b88d908b00d2` |
| `start/foundry-flight-practice-1280x720.png` | 805,141 | `3e931d609b6fec7a` |
| `start/summit-showdown-practice-1280x720.png` | 783,733 | `d904de757d3c1231` |
| `midcourse/canyon-kickoff-rival-1280x720.png` | 891,828 | `f634b1d50da1e273` |
| `midcourse/pine-run-rival-1280x720.png` | 794,883 | `46c535393340d793` |
| `midcourse/coastline-clash-rival-1280x720.png` | 665,098 | `b29c717dac93e530` |
| `midcourse/foundry-flight-rival-1280x720.png` | 828,514 | `066d8344afaca5cb` |
| `midcourse/summit-showdown-rival-1280x720.png` | 637,001 | `16f0efe9afeccbbe` |
| `curved-baseline-candidate/canyon-kickoff-practice-1280x720.png` | 867,328 | `1c20d591cfc4a3aa` |

**Foundry Flight now renders its corrected identity** — cool steel-blue terraces against
the warm dirt line (finding R10, both fix steps). Check it reads as a distinct venue to
you, and that lane/rut readability holds: the `dirtDark` component of the running-surface
texture changed with the fix, and readability is **unverified until you judge it**.

## The 5 baseline promotion candidates (`baseline-candidates/`)

| Id | State | Viewport | Bytes | SHA-256 (first 16) |
|---|---|---|---:|---|
| `desktop-race` | frozen Canyon race, desktop | 1280×720 | 899,262 | `004a6418fa4aba95` |
| `curved-canyon` | Canyon bend at distance 500 | 1280×720 | 867,328 | `1c20d591cfc4a3aa` |
| `editor` | Track Builder | 1280×720 | 266,901 | `bf8377a062dd` |
| `portrait-race` | Pixel 7 portrait race + touch controls | 412×839 | 418,583 | `b68dad7abd18` |
| `high-contrast` | high contrast + UI scale 1.2 HUD | 1280×720 | 740,675 | `442663bf302d` |

Accepting these makes them the permanent pass/fail reference for the visual-regression
suite until a future owner-approved re-promotion.

## How to review

1. Open each frame in the capture directory and compare against the approved concept art
   in `docs/design/concepts/` — principally `gameplay-desktop.png` for composition and
   density, `hero-bike-rider-production-reference.png` for the bike and rider.
2. Judge: venue distinctness (especially Foundry), lane/rut readability at speed, HUD
   legibility (especially the high-contrast candidate), and anything that reads as wrong.
3. If anything fails your eye, **stop — do not sign.** Tell me what, and the fix loops
   back through a fresh freeze and capture.

## If you accept — the signing procedure

Your draft (pre-filled with every hash, intentionally rejected by the promotion tool until
you author the decision) is at:

`/private/tmp/claude-501/-Users-john-Sandbox-Rivet-Ridge-Rally/6c6727a6-2acc-4f97-95c6-7442f8b3d7e6/scratchpad/rrr-rc3-owner-approval-draft-16951c9.json`

(This lives outside the repository by design so a draft is never mistaken for committed
evidence. If it is lost, one command regenerates it from the committed manifest.)

Edit exactly three fields, nothing else:

1. `decision`: `"PENDING_OWNER_REVIEW"` → `"ACCEPT"`
2. `approvedAt`: the current UTC timestamp when you sign, e.g. `"2026-08-10T14:00:00.000Z"`
3. `reviewer.name`: your real name

Do **not** change any `candidate`, `screenshot`, `reviewedFrames` or `baselines` hash
field — the promotion tool rejects any mismatch against the committed manifest.

**The 24-hour window:** promotion enforces `approvedAt` freshness of 24 hours. Sign when
you have told me (or are ready to run promotion yourself), not before — a signature older
than 24 h is rejected and you would have to re-sign.

Promotion (I can run it once your signed file exists; HEAD must be the capture commit and
the tree clean):

```sh
npm run visual:promote:canyon -- \
  --approval /path/to/your/signed-approval.json \
  --capture-manifest artifacts/visual-review/rc3-owner-review-16951c9-20260809T190911Z/manifest.json
```

It writes exactly six new files — the five baselines plus the canonical approval record —
verifies each byte-for-byte, and aborts if anything else in the tree would change.

## What acceptance does NOT cover (stated so the record stays honest)

- Hero motion states, crash/recovery silhouettes, and material fidelity against the
  reference sheet (the hero remains flat solid-colour; the strengthened contract in
  `HERO_BIKE_RIDER_VERTICAL_SLICE.md` is **not** met by this package and this acceptance
  does not claim it).
- Physical devices, screen readers, general accessibility, fairness review.
- Builder/Test Ride content beyond the single editor frame; rival readability beyond the
  five midcourse frames; motion (all frames are frozen stills).
- Any commercial-readiness claim. Release status remains **NOT READY**.
