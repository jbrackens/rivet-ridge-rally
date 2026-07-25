# RC2 Remaining Gates Checklist

Prepared: 2026-07-25
Reconciled: 2026-07-25 at `bb10ce4448bc3b4036ba832382c57b7086747400`
Project: Rivet Ridge Rally
Branch: `agent/rc2-launch-hardening`
Current readiness: **NOT READY**

This checklist is the operational starting point for Claude Fable or any follow-on agent. It maps the remaining release gates to the source documents, expected actions, and completion evidence. Verify every row against `LAUNCH_READINESS.md`, `QA_REPORT.md`, and `docs/OPERATIONS.md` before marking anything complete.

## Reconciliation outcome (2026-07-25)

Gate 1 executed. Full evidence: **`docs/RC2_RECONCILIATION_2026-07-25.md`**. Three findings change the shape of the remaining work and are tracked as new rows 14–16 below.

- **R1 — the tagged candidate is superseded.** Eighteen product-byte files changed between the annotated `v1.0.0-rc.2` tag (`2b40695`) and `bb10ce4`, including `GameEngine.ts`, `InputManager.ts`, `styles.css`, `TrackEditorScreen.tsx`, `index.html`, `package.json`/lockfile, four shipped icon PNGs, and three asset manifests. All release-bound evidence for `2b40695` — format-2 manifest, production/offline smoke, headed performance, 30-minute soak, and the 7 structured QA records — is therefore **HISTORICAL** with respect to current source. Gates 5 and 12 are blocked behind an owner decision on which commit is the candidate.
- **R2 — local toolchain drift.** The default `PATH` now resolves Node `v22.23.1` / npm `10.9.8`; the pin is `26.4.0` / `11.17.0` (still installed at `/opt/homebrew/bin`). Under the drifted toolchain the release-manifest guard correctly fails closed. All gate evidence must explicitly select the pinned toolchain.
- **R3 — the dependency-audit gate now FAILS.** `npm audit --audit-level=high` reports 24 vulnerabilities (18 moderate, 6 high) at `bb10ce4`. All affected packages are devDependencies (`lighthouse`/`@sentry/node`/`@opentelemetry/*` via the MCP dev packages; `sharp` via `@gltf-transform/functions`). None reaches the shipped browser runtime. The `sharp` fix is breaking.

Verified at `bb10ce4` on the pinned toolchain with a clean tree: `assets:verify`, `typecheck`, `lint`, `npm test` (456 checks — 303 Vitest, 45 release-manifest, 71 release-attestation, 37 production-smoke/service-worker/release-scope), `audit:release-scope` (131 files / 14,916,760 bytes / aggregate `ceff8bedb6b88393786ddfafac55b8cb395642b37ba014dc9c103ecada0fe3b7` / zero findings), and `VITE_QA_MODE=0 npm run build`. A live non-QA preview confirmed runtime marker `bb10ce4` / `dirty=false` / `shell-v35` with every authored asset ready and zero console errors — the first live evidence bound to this commit.

Gameplay behaviour the owner asked to preserve was re-verified against `bb10ce4` and is intact: arrow-key lane steering, arrow-key pitch, 12 gated lessons plus 2 contact drills, the forgiving 8→4 heat/second warning band, and front-wheel barrier clearance at `pitch >= 0.18` with a speed penalty instead of a crash. One ambiguity is open — throttle is `W`, not an arrow key (row 16).

## Ground rules

- Treat historical, scoped, dirty-working-tree, or diagnostic evidence as valid only for the exact scope and byte identity recorded beside it.
- Do not claim `READY`, `RC READY`, or launch readiness until `LAUNCH_READINESS.md` and `QA_REPORT.md` support the claim.
- Do not migrate engines unless the owner explicitly accepts the rewrite cost.
- Do not copy Mario Kart, Nintendo characters, items, UI, course layouts, vehicle silhouettes, music, sounds, iconography, branding, or trade dress.
- The 2026-07-25 creative pivot changes the visual target away from Roblox-style/blocky toy assets and toward an original, polished mascot-kart-racer level of finish.
- Prove the revised art direction with one representative vertical slice before attempting a game-wide visual overhaul.
- Do not promote visual baselines before the owner accepts hash-bound review captures.

## Remaining gates

| Gate | Current status | Source docs | Action required | Expected artifact/output | Product bytes changed? | Owner/manual/legal required? | Completion criteria |
|---|---|---|---|---|---|---|---|
| 1. Reconcile current state | **DONE 2026-07-25** | `LAUNCH_READINESS.md`, `QA_REPORT.md`, `git status`, PR #1 | Read current docs, compare to current branch/tag/evidence, list contradictions or stale statements. | `docs/RC2_RECONCILIATION_2026-07-25.md` | No — docs only. | No. | **Met.** Repo, branch, remote, and PR match the handoff; three divergences from the docs are recorded as R1–R3 and tracked as rows 14–16. |
| 2. Creative pivot accepted into docs | **DONE 2026-07-25** | `GAME_BIBLE.md`, `GAME_SPEC.md`, `docs/design/GRAPHICS_TOOLCHAIN.md`, `docs/design/FIDELITY_LEDGER.md`, `docs/HANDOFF_TO_CLAUDE_FABLE.md` | Ensure all style/design docs state the new target: original polished mascot-kart-racer finish, not Roblox-style block assets, with Nintendo/Mario Kart IP guardrails. | Committed doc updates. | No product bytes — docs only. | Owner provided direction; legal review still required later (row 11). | **Met.** A full coverage audit is in the reconciliation record §9. `CANYON_VERTICAL_SLICE.md` actively contradicted the pivot ("chunky … toy-like") and now carries a superseding note; `HERO_BIKE_RIDER_VERTICAL_SLICE.md` and `RIVAL_PACK_VERTICAL_SLICE.md` gained pivot sections. Remaining "blocky"/"chunky" occurrences elsewhere are gap findings or intentional HUD styling language, not style targets. |
| 3. Representative visual vertical slice | **Planned; implementation not started** | `GAME_BIBLE.md`, `GAME_SPEC.md`, `docs/design/FIDELITY_LEDGER.md`, `docs/design/MASCOT_DIRECTION_VERTICAL_SLICE_PLAN.md` | Implement the smallest slice that proves the revised direction: hero bike/rider first, one Canyon section, terrain/materials, the existing barrier interaction, retained festival dressing, lighting, motion/VFX feedback, unchanged HUD, and measured performance. | Scoped implementation, before/after captures, asset/bundle measurements, and a review manifest tied to the exact commit. | Yes. | Owner input required to accept the direction after the slice is prepared. | Slice demonstrates an original cohesive direction, preserves gameplay readability, meets the budgets in the plan §4, and is ready for owner review. **Plan is written and reviewable; implementation is deliberately gated on row 14 (candidate decision).** |
| 4. Owner visual acceptance package | Open / not accepted | `docs/design/FIDELITY_LEDGER.md`, `docs/OPERATIONS.md`, `QA_REPORT.md` | Prepare the vertical slice and latest qualifying candidate captures for side-by-side owner review under the new polished mascot-racer target. Include desktop, portrait, high contrast, track start/midcourse, Builder/Test Ride, hero/rider motion, and rival readability where required. | Owner-review packet/manifest with hashes and screenshots; acceptance draft updated but not self-approved. | Evidence/docs only unless visuals need fixes. | Yes. Owner must review and accept or request changes. | Owner-authored acceptance exists and is hash-bound to the exact reviewed captures. |
| 5. Remaining structured QA records | Open, **and now blocked by row 14**: 7/10 records exist but all bind the superseded `2b40695` manifest aggregate; `browser`, `accessibility`, `visual` have never existed | `LAUNCH_READINESS.md`, `QA_REPORT.md`, release-attestation scripts/docs | Settle the candidate (row 14) first. Then generate all required candidate-bound structured QA records and their command logs against the chosen frozen candidate. | `artifacts/release-attestations/.../qa/browser.json`, `accessibility.json`, `visual.json`, plus logs, or exact current schema equivalents. | Evidence/docs only unless failures require fixes. | Visual record requires owner acceptance. Accessibility requires manual screen-reader/device review. | Schema verifier accepts all ten required QA records for the candidate. Records generated against `bb10ce4` today would bind a manifest aggregate that does not exist. |
| 6. Visual baseline promotion | Open | `docs/OPERATIONS.md`, visual promotion scripts, visual-regression snapshots | After owner acceptance only, promote accepted baselines using the guarded workflow. Do not replace baselines before acceptance. | Committed promoted baseline records/snapshots/manifests. | Possibly yes, if snapshots are tracked product-adjacent test files; no runtime product byte change expected. | Yes; depends on visual acceptance. | Controlled visual regression passes against promoted accepted baselines. |
| 7. Physical-device manual review | Open | `LAUNCH_READINESS.md`, `QA_REPORT.md`, `GAME_SPEC.md` | Run or record unavailable physical-device/manual checks: mobile/tablet touch comfort, physical gamepad, installed Safari/Firefox/Edge where available, brightness/motion comfort, fairness review, assistive technology. | Manual QA entries with device/browser/version/date/result, or explicit owner-blocked entries. | No unless issues require fixes. | Yes, because hardware/manual review is required. | All manual/physical rows are PASS or explicitly owner-blocked with specific missing devices/inputs. |
| 8. Manual accessibility review | Open | `GAME_SPEC.md`, `QA_REPORT.md`, `LAUNCH_READINESS.md` | Complete screen-reader and keyboard/manual accessibility review beyond automated axe/Playwright. Include high contrast, reduced motion, captions/status, focus order, live regions, touch semantics, and editor dialogs. | Manual accessibility record and, if required, structured `accessibility` QA evidence. | No unless fixes required. | Yes. | Manual accessibility findings are resolved or explicitly accepted/deferred by owner. |
| 9. Gameplay fairness/balance review | Open / scoped evidence exists | `GAME_SPEC.md`, `QA_REPORT.md`, campaign/AI specs | Validate Solo targets, Rival difficulty, Summit mastery, heat tuning, wheelie/barrier behavior, collision fairness, crash/recovery clarity, and physical-input feel. | Manual fairness review plus supporting test logs. | Maybe, if tuning changes are required. | Yes for subjective fairness; automation can support. | Owner/QA accepts targets and mechanics as fair for RC2 or records specific follow-up fixes. |
| 10. Rollback proof and data safety | Open | `docs/OPERATIONS.md`, `LAUNCH_READINESS.md`, release/rollback docs | Prove predecessor rollback archive can be located, byte/hash verified, staged, and compared with pre/post served inventories. Include data-safety expectations. | Rollback rehearsal record, archive locator, byte count/SHA-256, pre/post inventories. | Evidence/docs only. | Possibly owner/ops approval. | Rollback readiness is independently verifiable from committed evidence. |
| 11. Public support / privacy / hosting / legal approvals | Open / owner-dependent | `LAUNCH_READINESS.md`, `README.md`, legal/support docs | Fill owner/operator support contact, data-controller/privacy commitments, product license choice, hosting/TLS/cache policy, trademark/trade-dress/legal review status. | Updated public/support/legal docs and approval records. | Docs/config only unless hosting assets change. | Yes. | Owner/legal approvals are recorded, or exact external blockers remain. |
| 12. Schema-v3 release attestation | Open / incomplete | `docs/RELEASE_ATTESTATION.md`, `LAUNCH_READINESS.md`, release-attestation scripts | Complete all required structured QA records, approval records, predecessor archive, rollback rehearsal, data-safety record, final attestation JSON, and attestation tag. | Final schema-v3 attestation JSON and annotated `attestation/v1.0.0-rc.2` tag if/when valid. | Evidence/tag only if product bytes unchanged. | Yes for approval records. | Schema-v3 verifier passes from a clean tag. |
| 13. Final readiness docs | Open | `LAUNCH_READINESS.md`, `QA_REPORT.md` | Update final docs honestly after the above gates. | `LAUNCH_READINESS.md` and `QA_REPORT.md` with exact evidence links/hashes. | Docs only. | Yes for commercial readiness sign-off. | `NOT READY` changes only if all required gates are closed or only true external blockers remain. |
| 14. Candidate re-freeze decision (finding R1) | **OWNER BLOCKED — new 2026-07-25** | `docs/RC2_RECONCILIATION_2026-07-25.md` §2, `LAUNCH_READINESS.md`, `QA_REPORT.md` | Owner decides: (a) re-tag a new candidate from current source and regenerate the manifest/smoke/performance/soak/QA evidence set, or (b) freeze at `2b40695` and explicitly defer the 18 post-tag product-byte changes. Do not move or recreate the existing tag either way. | Recorded owner decision, then a new annotated tag and regenerated format-2 manifest if (a). | Depends on the decision. | **Yes — owner.** | A single frozen candidate exists whose bytes match the release evidence bound to it. **Rows 5, 6, 10, and 12 cannot close before this one.** |
| 15. Dependency-audit regression (finding R3) | **FAILED — new 2026-07-25** | `docs/RC2_RECONCILIATION_2026-07-25.md` §5 | Decide remediation: `npm audit fix` clears the non-breaking `brace-expansion`/`minimatch` advisories; `sharp`/libvips needs `--force`, which downgrades `@gltf-transform/functions` to `3.4.2` — a breaking change to the asset optimizer requiring a full `assets:build`/`assets:verify` re-run and re-hash. Alternatively drop or replace the Lighthouse/DevTools MCP dev packages that pull in most of the tree. | Updated lockfile plus a re-run gate batch, or a recorded, justified accepted-risk decision. | Lockfile only; no shipped-runtime bytes. | Owner decision on accepting dev-only risk vs. a breaking pipeline downgrade. | `npm run audit` exits 0, or the residual dev-only risk is explicitly accepted and recorded. **Not remediated in the reconciliation commit** — a lockfile change would invalidate the evidence recorded at `bb10ce4` and is entangled with row 14. |
| 16. Throttle-key intent (open question O1) | **OWNER BLOCKED — new 2026-07-25** | `docs/RC2_RECONCILIATION_2026-07-25.md` §7 | Confirm intent. Today lanes are `←`/`→` and pitch is `↑`/`↓`, while forward throttle is `W` and there is no reverse. Binding throttle to `↑` would collide with pitch-up, which the tutorial teaches as a separate airborne mechanic. | Owner confirmation, or a specified remapping and a new home for pitch. | Yes, if a remap is requested. | **Yes — owner.** | Controls, tutorial copy, settings labels, and behaviour agree with the owner's stated intent. They agree with each other today. |
| 17. Publish the predecessor tag | **OWNER BLOCKED — new 2026-07-25** | `docs/RC2_RECONCILIATION_2026-07-25.md` §1 | `v1.0.0-rc.1` exists locally only; `origin` carries just `v1.0.0-rc.2`. Push the predecessor tag so its source is retrievable. | `v1.0.0-rc.1` present on `origin`. | No. | **Yes — owner**, since pushing a tag is an outward-facing action. | Row 10 (rollback proof) cannot complete while the predecessor source cannot be retrieved from the remote. |

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

~~Start with gates 1 and 2.~~ **Gates 1 and 2 are complete as of 2026-07-25.**

Next recommended order:

1. **Obtain the row 14 candidate decision from the owner.** It gates rows 5, 6, 10, and 12, and it determines whether the vertical slice should be built before or after a re-freeze.
2. Obtain the row 16 throttle-key confirmation — cheap to ask, and it affects tutorial copy if the answer is a remap.
3. Implement gate 3 to `docs/design/MASCOT_DIRECTION_VERTICAL_SLICE_PLAN.md`, hero-first, measuring against the budgets in its §4. Report negative results rather than tuning them away.
4. Prepare the gate 4 owner-review package with before/after pairs and the measured budget table.
5. Only after owner acceptance, promote baselines via `npm run visual:promote:canyon` (row 6).
6. Resolve row 15 and row 17 alongside, since both are cheap and independent of the art work.

Do not attempt baseline promotion or final attestation before the prerequisite approvals and evidence exist. Use the pinned toolchain (`PATH="/opt/homebrew/bin:$PATH"`, Node `26.4.0` / npm `11.17.0`) for every gate command; evidence produced under the drifted `v22.23.1` toolchain does not qualify.
