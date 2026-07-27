# Owner Visual Review Package — 2026-07-27

**Gate:** 4 of `docs/RC2_REMAINING_GATES_CHECKLIST.md` (owner visual acceptance).
**Status:** **PACKAGE READY — AWAITING OWNER REVIEW.** Nothing here is acceptance, and no baseline has been promoted.

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
