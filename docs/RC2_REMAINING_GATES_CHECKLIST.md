# RC2 Remaining Gates Checklist

Prepared: 2026-07-25
Project: Rivet Ridge Rally
Branch: `agent/rc2-launch-hardening`
Current readiness: **NOT READY**

This checklist is the operational starting point for Claude Fable or any follow-on agent. It maps the remaining release gates to the source documents, expected actions, and completion evidence. Verify every row against `LAUNCH_READINESS.md`, `QA_REPORT.md`, and `docs/OPERATIONS.md` before marking anything complete.

## Ground rules

- Treat historical, scoped, dirty-working-tree, or diagnostic evidence as valid only for the exact scope and byte identity recorded beside it.
- Do not claim `READY`, `RC READY`, or launch readiness until `LAUNCH_READINESS.md` and `QA_REPORT.md` support the claim.
- Do not migrate engines unless the owner explicitly accepts the rewrite cost.
- Do not copy Mario Kart, Nintendo characters, items, UI, course layouts, vehicle silhouettes, music, sounds, iconography, branding, or trade dress.
- The 2026-07-25 creative pivot changes the visual target away from Roblox-style/blocky toy assets and toward an original, polished mascot-kart-racer level of finish.

## Remaining gates

| Gate | Current status | Source docs | Action required | Expected artifact/output | Product bytes changed? | Owner/manual/legal required? | Completion criteria |
|---|---|---|---|---|---|---|---|
| 1. Reconcile current state | Open | `LAUNCH_READINESS.md`, `QA_REPORT.md`, `git status`, PR #1 | Read current docs, compare to current branch/tag/evidence, list contradictions or stale statements. | Updated checklist notes or doc corrections. | No, unless docs only. | No. | Current repo state, PR state, release tag state, and docs agree. |
| 2. Creative pivot accepted into docs | In progress | `GAME_BIBLE.md`, `GAME_SPEC.md`, `docs/design/GRAPHICS_TOOLCHAIN.md`, `docs/design/FIDELITY_LEDGER.md`, `docs/HANDOFF_TO_CLAUDE_FABLE.md` | Ensure all style/design docs state the new target: original polished mascot-kart-racer finish, not Roblox-style block assets, with Nintendo/Mario Kart IP guardrails. | Committed doc updates. | No product bytes if docs only. | Owner provided direction; legal review still required later. | No core style guide contradicts the pivot. |
| 3. Remaining structured QA records | Open: 7/10 complete; missing `browser`, `accessibility`, `visual` | `LAUNCH_READINESS.md`, `QA_REPORT.md`, release-attestation scripts/docs | Generate or complete the three missing candidate-bound structured QA records and their command logs. | `artifacts/release-attestations/.../qa/browser.json`, `accessibility.json`, `visual.json`, plus logs, or exact current schema equivalents. | Evidence/docs only unless failures require fixes. | Visual record may require owner acceptance. Accessibility may require manual screen-reader/device review. | Schema verifier accepts all ten required QA records for the candidate. |
| 4. Owner visual acceptance package | Open / not accepted | `docs/design/FIDELITY_LEDGER.md`, `docs/OPERATIONS.md`, `QA_REPORT.md` | Prepare latest candidate captures for side-by-side owner review under the new polished mascot-racer target. Include desktop, portrait, high contrast, five track start/midcourse, Builder/Test Ride, hero/rider motion, and rival readability where required. | Owner-review packet/manifest with hashes and screenshots; acceptance draft updated but not self-approved. | Evidence/docs only unless visuals need fixes. | Yes. Owner must review and accept or request changes. | Owner-authored acceptance exists and is hash-bound to the exact reviewed captures. |
| 5. Visual baseline promotion | Open | `docs/OPERATIONS.md`, visual promotion scripts, visual-regression snapshots | After owner acceptance only, promote accepted baselines using the guarded workflow. Do not replace baselines before acceptance. | Committed promoted baseline records/snapshots/manifests. | Possibly yes, if snapshots are tracked product-adjacent test files; no runtime product byte change expected. | Yes; depends on visual acceptance. | Controlled visual regression passes against promoted accepted baselines. |
| 6. Physical-device manual review | Open | `LAUNCH_READINESS.md`, `QA_REPORT.md`, `GAME_SPEC.md` | Run or record unavailable physical-device/manual checks: mobile/tablet touch comfort, physical gamepad, installed Safari/Firefox/Edge where available, brightness/motion comfort, fairness review, assistive technology. | Manual QA entries with device/browser/version/date/result, or explicit owner-blocked entries. | No unless issues require fixes. | Yes, because hardware/manual review is required. | All manual/physical rows are PASS or explicitly owner-blocked with specific missing devices/inputs. |
| 7. Manual accessibility review | Open | `GAME_SPEC.md`, `QA_REPORT.md`, `LAUNCH_READINESS.md` | Complete screen-reader and keyboard/manual accessibility review beyond automated axe/Playwright. Include high contrast, reduced motion, captions/status, focus order, live regions, touch semantics, and editor dialogs. | Manual accessibility record and, if required, structured `accessibility` QA evidence. | No unless fixes required. | Yes. | Manual accessibility findings are resolved or explicitly accepted/deferred by owner. |
| 8. Gameplay fairness/balance review | Open / scoped evidence exists | `GAME_SPEC.md`, `QA_REPORT.md`, campaign/AI specs | Validate Solo targets, Rival difficulty, Summit mastery, heat tuning, wheelie/barrier behavior, collision fairness, crash/recovery clarity, and physical-input feel. | Manual fairness review plus supporting test logs. | Maybe, if tuning changes are required. | Yes for subjective fairness; automation can support. | Owner/QA accepts targets and mechanics as fair for RC2 or records specific follow-up fixes. |
| 9. Rollback proof and data safety | Open | `docs/OPERATIONS.md`, `LAUNCH_READINESS.md`, release/rollback docs | Prove predecessor rollback archive can be located, byte/hash verified, staged, and compared with pre/post served inventories. Include data-safety expectations. | Rollback rehearsal record, archive locator, byte count/SHA-256, pre/post inventories. | Evidence/docs only. | Possibly owner/ops approval. | Rollback readiness is independently verifiable from committed evidence. |
| 10. Public support / privacy / hosting / legal approvals | Open / owner-dependent | `LAUNCH_READINESS.md`, `README.md`, legal/support docs | Fill owner/operator support contact, data-controller/privacy commitments, product license choice, hosting/TLS/cache policy, trademark/trade-dress/legal review status. | Updated public/support/legal docs and approval records. | Docs/config only unless hosting assets change. | Yes. | Owner/legal approvals are recorded, or exact external blockers remain. |
| 11. Schema-v3 release attestation | Open / incomplete | `docs/RELEASE_ATTESTATION.md`, `LAUNCH_READINESS.md`, release-attestation scripts | Complete all required structured QA records, approval records, predecessor archive, rollback rehearsal, data-safety record, final attestation JSON, and attestation tag. | Final schema-v3 attestation JSON and annotated `attestation/v1.0.0-rc.2` tag if/when valid. | Evidence/tag only if product bytes unchanged. | Yes for approval records. | Schema-v3 verifier passes from a clean tag. |
| 12. Final readiness docs | Open | `LAUNCH_READINESS.md`, `QA_REPORT.md` | Update final docs honestly after the above gates. | `LAUNCH_READINESS.md` and `QA_REPORT.md` with exact evidence links/hashes. | Docs only. | Yes for commercial readiness sign-off. | `NOT READY` changes only if all required gates are closed or only true external blockers remain. |

## Recommended first commands

Run from `/Users/john/Sandbox/Rivet Ridge Rally`.

```sh
git status -sb
git log --oneline -12
rg -n "NOT READY|UNVERIFIED|NOT ACCEPTED|ATTESTATION INCOMPLETE|browser|accessibility|visual|rollback|owner|legal" LAUNCH_READINESS.md QA_REPORT.md docs
```

Then read:

```sh
sed -n '1,220p' LAUNCH_READINESS.md
sed -n '1,260p' QA_REPORT.md
sed -n '1,360p' docs/OPERATIONS.md
sed -n '1,220p' docs/RELEASE_ATTESTATION.md
```

## First execution recommendation for Claude Fable

Start with gates 1 and 2. Confirm this checklist matches the current source and that the creative pivot has reached every style guide or design reference that governs visual acceptance. Then close the missing structured QA records and owner visual-review package before attempting baseline promotion or final attestation.
