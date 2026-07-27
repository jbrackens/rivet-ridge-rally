# Owner Supply List — What Only You Can Provide

**Prepared:** 2026-07-27
**Purpose:** every remaining release blocker that cannot be closed by engineering work, stated precisely enough to act on. Gates 4, 7, 8, 9, 11 and 14 of `docs/RC2_REMAINING_GATES_CHECKLIST.md`.

This exists because "owner-dependent" is not actionable. Each item below names the exact artifact, where it goes, and what it unblocks.

## 1. Visual acceptance — unblocks the most

**Status:** package ready and waiting. **Blocks gates 5, 6, 12 and 13.**

Review the eleven captures listed in `docs/OWNER_VISUAL_REVIEW_2026-07-27.md`, then either request changes or accept by editing the prepared non-accepting draft: set `decision` to `ACCEPT`, `approvedAt` to the current UTC timestamp, and `reviewer.name` to your real name. Do not alter any hash field. Then run `npm run visual:promote:canyon`.

**Why this is first:** the `visual` and `browser` QA records run the visual-regression suite, so they cannot pass until the baselines are promoted. Those two records gate the attestation, which gates final readiness. This single decision is the head of the critical path.

## 2. Product licence — a missing file

**Status:** **there is no `LICENSE` file at the repository root.** Verified absent.

The support page already discloses this honestly ("the top-level product license remain owner decisions and must be published before release"), so the game is not making a false claim — but the file has to exist before launch. Only you can choose it.

## 3. Published contact channels — two, currently absent

The shipped Support & Privacy screen states plainly that neither exists:

- **Public support contact** — "not published. There is currently no authorized inbox for support, safety, privacy, or accessibility requests."
- **Accessibility reporting contact** — "not published."

Both need a verified address or URL you control. The copy is already written to accommodate them.

## 4. Operator and privacy commitments — five decisions

The privacy card currently says the following "have not been selected or published":

1. **Commercial operator / data-controller identity**
2. **Hosting provider**
3. **Request-log policy** (what the host records)
4. **Retention period**
5. **Deletion-response commitment**

The game itself collects nothing — no account, ads, payments, analytics SDKs or behavioural tracking, and saves stay on device. These five are about the *host*, not the game.

## 5. Three formal approval records

The attestation verifier requires three, each with exactly these fields: `approvedAt`, `approvedBy`, `evidence`, `manifestAggregateSha256`, `productCommit`, `productTag`, `role`, `scope`, `status` — and `status` must be `APPROVED`.

| Role | Required scope string |
|---|---|
| `qa` | `release-qualification` |
| `accessibility` | `release-accessibility` |
| `legal` | `release-rights-privacy-and-trade-dress` |

Each must bind the product tag, commit and manifest aggregate of whichever candidate is frozen. **They cannot be pre-generated**, because they assert a human decision; producing them mechanically would be forging the thing they exist to record.

## 6. Legal review — trademark, trade dress, generated-output provenance

Needs you or counsel:

- Trademark and trade-dress clearance for the name, look and UI.
- Copyright review of all shipped assets. `ASSET_LICENSES.md` is a complete source/licence/hash inventory to review against.
- **Generated-image provenance** — the concept and title art was produced with an image generator. The governing account terms and prompt/session or receipt evidence need archiving, and confirmation that commercial use is permitted under those terms.
- Confirmation that the original-IP boundary holds: no Nintendo, Mario Kart or Roblox resemblance. Three visual passes were kept deliberately original, and the rejected texture experiments were reverted, so nothing derivative shipped — but that is my assessment, not a legal opinion.

## 7. Physical devices and human review

No amount of automated work substitutes. Specifically absent on this machine:

| Environment | What it needs |
|---|---|
| Physical Android Chrome | real touch, audio, storage, GPU, thermal and battery session |
| Physical iPhone/iPad Safari | same |
| Physical gamepad | controller model, prompts, stuck-input cleanup, vibration |
| Installed Safari, Firefox, Edge | Playwright's bundled engines are not the same applications |
| Screen reader (VoiceOver / NVDA) | gate 8 — automated axe now covers 11 surfaces with zero violations, which is not the same as usable |
| Subjective fairness | gate 9 — whether Rookie/Rider/Ace difficulty and the heat and barrier tuning actually feel fair |

## 8. Hosting and operations

- Deployment target, DNS and TLS.
- Verified security response headers.
- **A durable artifact archive.** `v1.0.0-rc.2` rebuilds byte-for-byte (33/33 files verified), but rebuild-on-demand depends on GitHub, npm and the pinned toolchain all being available *during an incident*, which is exactly when that is least safe to assume.
- **Named release, support, rollback and incident owners.**

## 9. The candidate decision

**Status:** the choice is forced by evidence — see `docs/CANDIDATE_DECISION_EVIDENCE_2026-07-27.md`.

`v1.0.0-rc.2` cannot complete its QA record set: its `accessibility` check fails 10 of 23 on this host, because the tag never raised Playwright's default budgets and its title-screen visual test runs unguarded. Current source passes everything except the owner-blocked baselines.

**Recommended: re-freeze on current source, after visual acceptance** so the promoted baselines are inside the new candidate. `v1.0.0-rc.2` stays available as the rollback target, which is a better role for it.

## Ordering

Items 2, 3, 4, 6, 7 and 8 are independent and can proceed in any order. Item 1 gates the largest downstream set, and item 9 should follow item 1.

Nothing on this list is something I can do, and nothing here has been guessed at — each is a real gap verified against the repository or the verifier's own requirements.
