# Candidate Decision — Evidence for Gate Row 14

**Prepared:** 2026-07-27
**Question:** should RC2 be re-frozen on current source, or should the existing `v1.0.0-rc.2` tag remain the candidate?

I previously recorded this as low-priority — "it doesn't matter right now". **That was wrong.** Testing the tagged candidate directly shows the choice is forced: `v1.0.0-rc.2` can never reach a completable attestation, so re-freezing is the only path forward.

## Method

Fresh `git clone --depth 1 --branch v1.0.0-rc.2` from `origin`, `npm ci` from its own lockfile, `VITE_QA_MODE=0 npm run build`, then the exact command the attestation verifier mandates for the missing `accessibility` QA record:

```
npx playwright test e2e/core-flow.spec.ts e2e/accessibility-controls.spec.ts
```

Pinned toolchain (Node `26.4.0` / npm `11.17.0`), isolated port, throwaway directory since deleted.

## Result: the tagged candidate cannot produce a passing `accessibility` record

**13 passed / 10 failed / 2 skipped (24.8 min).** Two independent causes, neither fixable without changing the tag:

### 1. Timing budgets

`rc.2`'s `playwright.config.ts` sets only a `webServer` timeout. Its tests therefore run on Playwright's **defaults — 30 s per test and 5 s per assertion** — which the 2026-07-26 baseline established are far too tight for this project on this host, where headless WebGL plus WASM transcoder startup alone costs 8–14 s per page load. Observed failures include `Test timeout of 60000ms exceeded` and `Test timeout of 180000ms exceeded`.

Current source fixes this at the config level (`timeout: 120_000`, `expect: { timeout: 15_000 }`) with the measured startup cost recorded as justification.

### 2. The title-screen visual test is unguarded at `rc.2`

At the tag, `core-flow.spec.ts:252` runs the title-screen baseline comparison with no opt-in guard, so it fails against an unpromoted baseline. Current source adds:

```
test.skip(process.env.RRR_APPROVED_VISUAL_BASELINES !== "1",
  "Visual baselines require explicit owner-approved promotion.");
```

which correctly parks that gate behind owner approval. **At `rc.2` the `accessibility` record is contaminated by a visual baseline** — which is precisely the coupling the guard was added to remove.

## Why this forecloses the tag

The attestation verifier requires **ten** candidate-bound QA records. For `v1.0.0-rc.2`:

| Record | Mandated command | Status at the tag |
|---|---|---|
| 7 existing records | — | **PASS**, already archived |
| `accessibility` | `core-flow` + `accessibility-controls` | **FAIL** — timing budgets and an unguarded visual test |
| `visual` | `visual-regression.spec.ts` | **FAIL** — baselines correctly unpromoted |
| `browser` | `npm run test:e2e` | **FAIL** — includes visual-regression |

`visual` and `browser` are blocked behind owner acceptance for *either* candidate, so they are not a differentiator. **`accessibility` is**: it passes on current source and cannot pass at the tag.

Sweep 4 measured current source at **107 passed / 4 failed** across 116 Chromium tests, where the only four failures are the unpromoted baselines. Both `core-flow.spec.ts` and `accessibility-controls.spec.ts` passed completely, so the `accessibility` record is achievable immediately on current source.

## Recommendation

**Re-freeze RC2 on current source.** The evidence, not a preference:

1. The tagged candidate **cannot** complete its QA record set. It is a dead end for attestation regardless of any other decision.
2. Current source passes everything except the four owner-blocked baselines.
3. Current source also carries two real defect fixes the tag does not: the silently broken release accessibility gate (axe scanning mid-fade), and the WebGL context rebuilt on every restart — the latter reproduced in Chromium **and WebKit**, so it affected real Safari users.
4. Rollback is unaffected. `v1.0.0-rc.2` remains reproducible byte-for-byte (33/33 files verified) and stays available as the rollback target, which is arguably its better role. See `docs/ROLLBACK_REPRODUCIBILITY_2026-07-27.md`.

**Sequencing matters.** Re-tag only *after* owner visual acceptance, because promoting the baselines changes checked-in files, and the new candidate should contain them. The order is: review the package in `docs/OWNER_VISUAL_REVIEW_2026-07-27.md` → accept or request changes → promote baselines via the guarded workflow → re-tag → regenerate the manifest, smoke, performance, soak and all ten QA records against the new tag.

## What this does not claim

Nothing here is an owner decision, and no tag was created, moved or deleted. `v1.0.0-rc.2` and `v1.0.0-rc.1` are untouched on `origin`. This records what the tagged candidate can and cannot do, measured rather than assumed, so the row 14 decision rests on evidence.
