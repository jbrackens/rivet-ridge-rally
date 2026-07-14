# RIVET RIDGE RALLY — Visual Fidelity Ledger

**Review date:** 2026-07-14

**Review state:** REOPENED — owner acceptance pending

**Review authority:** owner feedback rejected the previous coarse-fidelity acceptance; the implementation review below records the response, not approval

**Candidate:** `1.0.0-rc.2` working source; untagged and not qualified for release

**Historical evidence:** annotated `v1.0.0-rc.1` and its screenshots remain the record of the superseded candidate

The concepts define composition, hierarchy, environmental richness, rider readability, track depth, atmosphere, and control presence. They are not pixel-accurate production screenshots. That distinction is not a blanket waiver for a materially emptier or coarser result.

The 2026-07-12 ledger accepted the RC1 renderer as a performance-safe low-poly interpretation even though its geometry and scenery were materially coarser and less dense than the gameplay concepts. The owner subsequently rejected that conclusion: the game graphics did not look sufficiently like the concept art. That direct acceptance result supersedes the implementation-only `PASS`. The current working-source changes described here reopen the comparison; code presence and regenerated snapshots cannot turn it back into a pass without renewed owner review.

## Historical RC1 comparisons — superseded

| Surface | Concept | RC1 browser evidence | Historical result and current disposition |
|---|---|---|---|
| Title and campaign | `concepts/title-background-production.png`, `concepts/campaign-menu.png` | `e2e/core-flow.spec.ts-snapshots/title-screen-chromium-darwin.png` | **HISTORICAL RC1 PASS; CURRENT BASELINE REOPENED.** The source art and campaign hierarchy were accepted for RC1, but the new persistent Rider School replay action changes the live main-menu composition and therefore requires a fresh capture before the current baseline can be accepted. |
| Desktop race | `concepts/gameplay-desktop.png` | `e2e/visual-regression.spec.ts-snapshots/race-screen-chromium-darwin.png` | **REJECTED / REOPENED.** RC1 contained the required HUD fields, four-lane route, rider, hazards, fencing, stands, and sightline, but the previous ledger excused substantially coarser geometry and lower scenery density. The owner rejected that tradeoff as visually unlike the concept. |
| Mobile race | `concepts/gameplay-mobile.png` | `e2e/visual-regression.spec.ts-snapshots/race-mobile-mobile-chrome-darwin.png` | **REJECTED / REOPENED.** RC1 kept the route and labeled controls visible, but its sparse course treatment and compact flat controls did not meet the owner's concept-fidelity expectation. |
| Track builder | `concepts/track-builder.png` | `e2e/visual-regression.spec.ts-snapshots/editor-screen-chromium-darwin.png` | **HISTORICAL RC1 PASS; NOT RE-REVIEWED.** The builder structure was accepted for RC1. The current corrective visual scope is gameplay; this row is not promoted into current-candidate evidence. |
| High contrast and color redundancy | desktop race concept | `e2e/visual-regression.spec.ts-snapshots/race-high-contrast-chromium-darwin.png` | **HISTORICAL FUNCTIONAL PASS; CURRENT BASELINE PENDING.** RC1's real WebGL guides and redundant hazard silhouettes remain historical accessibility evidence. The changed course composition requires a new capture and review before current visual acceptance. |

The paths above identify the checked-in RC1 evidence at the time of its review. If current-candidate baselines replace files at those paths, retain the tagged RC1 versions as the immutable historical comparison rather than describing the new bytes as RC1 evidence.

## Current working-source response — acceptance pending

| Area | Post-RC1 change present in the working source | Evidence required for acceptance | Current result |
|---|---|---|---|
| First-frame camera and composition | The camera now starts at its calculated gameplay target instead of visibly easing from an unrelated origin. Desktop and portrait framing increase rider/lane alignment and route look-ahead. | First-frame plus settled-frame desktop and portrait captures; verify rider silhouette, four lanes, near hazards, and landing sightline against the concepts. | **PENDING OWNER ACCEPTANCE** |
| Venue atmosphere | Canyon, Pine, Coastline, Foundry, and Summit now use separate background, fog, light, exposure, and density profiles. | Matching start and midcourse captures for all five tracks, reviewed for intentional palette, depth, atmosphere, and cross-track distinction. | **PENDING OWNER ACCEPTANCE** |
| Course grounding and depth | Terraced shoulders/walls/caps and visible lane ridges now give the course vertical edges and reinforce its four-lane construction. Coastline retains an intentionally open water side. | Desktop, portrait, and high-contrast review at racing speed; verify depth without hiding obstacles or weakening non-color guides. | **PENDING OWNER ACCEPTANCE** |
| Scenery and safety treatment | Theme scenery density is increased and safety barriers form connected runs instead of isolated blocks. | Five-track captures and live play review for concept-like richness, coherent rhythm, draw-distance behavior, and no preventable camera occlusion. | **PENDING OWNER ACCEPTANCE** |
| Mobile controls | Lane/pitch and Ride/Turbo controls are larger and use stronger contrast, depth, spacing, and shadows. | Portrait capture plus physical-device reach, label, safe-area, track-visibility, and mirrored-layout review. Emulation alone does not prove comfort. | **PENDING OWNER ACCEPTANCE** |

These changes address specific gaps visible in the rejected RC1 comparison. They are not themselves proof that the concepts have been met, and this ledger does not pre-approve their exact tuning.

## Controlled RC2 visual evidence — acceptance pending

Two independent controlled runs exercised the revised visual-regression harness against the same RC2 working source. The harness now freezes a live race at a named QA state without entering the paused UI or applying its dimming filter, forces the `High` quality preset, waits for `document.fonts.ready` and the compressed bike's `ready` state, and keeps desktop race, editor, portrait race, and high-contrast coverage in separate tests. These controls remove the prior wall-clock, Auto-quality, asynchronous-asset, pause-filter, and test-short-circuit ambiguities.

The first race run is retained under `artifacts/visual-review/rc2-controlled/`; its independent repeat is under `artifacts/visual-review/rc2-controlled-repeat/`. Each failed race directory contains the Playwright `actual`, obsolete `expected`, and `diff` PNGs, its error context, and a video. Both race `.last-run.json` files record the same three failures. The independently repeated editor passes are recorded under `artifacts/visual-review/rc2-editor-controlled/` and `artifacts/visual-review/rc2-editor-controlled-repeat/`.

| Surface | Controlled RC2 result against untouched RC1 baseline | Repeatability | Repository evidence |
|---|---|---|---|
| Desktop race | **FAIL against obsolete baseline:** 558,095 pixels differ, ratio `0.61`, above the `0.02` allowance. This delta represents the deliberately changed camera, atmosphere, terrain depth, scenery, safety treatment, rider, and HUD copy rather than acceptance of the old composition. | The two actual PNGs are byte-identical: SHA-256 `c4299018e2b41f26f43914fa3f98c63b87f5195d578c4bd7ec8d53438a0aa269`. | `artifacts/visual-review/rc2-controlled/visual-regression-desktop--78d62-pted-production-composition-chromium/` and `artifacts/visual-review/rc2-controlled-repeat/visual-regression-desktop--78d62-pted-production-composition-chromium/` |
| High-contrast race | **FAIL against obsolete baseline:** 353,688 pixels differ, ratio `0.39`, above the `0.02` allowance. The controlled actual retains the strengthened HUD vignette, lane/edge guides, cooling snowflakes, and non-color hazard silhouettes, but still requires explicit review as part of the changed composition. | The two actual PNGs are byte-identical: SHA-256 `fb5996fa720a3c81b614fc04980a96c1c2e1605c0da87b21ff1152adcc670b42`. | `artifacts/visual-review/rc2-controlled/visual-regression-high-con-77f96--retains-readable-hierarchy-chromium/` and `artifacts/visual-review/rc2-controlled-repeat/visual-regression-high-con-77f96--retains-readable-hierarchy-chromium/` |
| Portrait race | **FAIL against obsolete baseline:** 121,374 pixels differ, ratio `0.36`, above the `0.02` allowance. The changed camera, venue density, rider framing, visible Heat label, and larger touch controls intentionally invalidate the superseded compact composition. | The two actual PNGs are byte-identical: SHA-256 `a5a6173bd4e2874800cd2eb59c4427ed260f49792c96a7080775cc09bd91e3bd`. | `artifacts/visual-review/rc2-controlled/visual-regression-portrait-2e235--accepted-touch-composition-mobile-chrome/` and `artifacts/visual-review/rc2-controlled-repeat/visual-regression-portrait-2e235--accepted-touch-composition-mobile-chrome/` |
| Track builder | **PASS:** the separate editor test matched `e2e/visual-regression.spec.ts-snapshots/editor-screen-chromium-darwin.png` in both controlled runs. Playwright produced no failure attachment for the passing surface. | Two independent passes; separating the editor test ensures a race failure no longer prevents this evidence from executing. | `artifacts/visual-review/rc2-editor-controlled/.last-run.json`, `artifacts/visual-review/rc2-editor-controlled-repeat/.last-run.json`, and the checked-in editor baseline above |

No file under `e2e/visual-regression.spec.ts-snapshots/` was replaced. The `expected` images copied into the failure directories are the obsolete RC1 baselines and remain comparison history, not an approved RC2 target. New race baselines may be accepted only after explicit owner review; byte-identical captures prove determinism, not concept fidelity.

The controlled RC2 composition is materially closer to the gameplay concepts in brightness, canyon/festival density, course-edge depth, rider framing, four-lane hierarchy, cooling-gate prominence, and mobile control presence. It remains visibly flatter and straighter, with substantially less surface, vegetation, rider, crowd, and prop detail than the illustrative concepts. That remaining difference is not waived by the deterministic result and keeps visual acceptance open.

## Five-track identity review

The ten existing captures under `artifacts/visual-review/` are historical RC1 evidence. The `midcourse/` images used the shortened QA route only to bring theme props and obstacle silhouettes into one review frame; they were never scale or performance evidence. Because every venue's atmosphere, course edges, barriers, or density can now differ, all five identities require fresh start/midcourse captures and owner review.

| Track | Current acceptance focus | Result |
|---|---|---|
| Canyon Kickoff | Warm red-rock festival depth, terraced canyon edges, readable cooling rhythm, and the concept's open long sightline | **PENDING OWNER ACCEPTANCE** |
| Pine Run | Cooler forest atmosphere, meaningfully denser pines/timber, readable mud/barrier rhythm, and retained lane clarity | **PENDING OWNER ACCEPTANCE** |
| Coastline Clash | Bright coastal light, visible open-water horizon, grounded landward edge, and readable heat/jump routes | **PENDING OWNER ACCEPTANCE** |
| Foundry Flight | Compact industrial atmosphere, furnace warmth, connected safety treatment, and clear precision-jump reads through denser scenery | **PENDING OWNER ACCEPTANCE** |
| Summit Showdown | Dusk mountain depth, pale rock/snow silhouettes, high-risk obstacle readability, and a finale distinct from Canyon and Pine | **PENDING OWNER ACCEPTANCE** |

## Acceptance criteria and constraints

Renewed concept-fidelity acceptance requires:

1. Side-by-side review of the desktop and portrait gameplay concepts against first-frame and settled live captures at the intended aspect ratios.
2. Fresh high-contrast evidence and ten five-track start/midcourse captures, with the old RC1 evidence retained through its immutable tag.
3. Recorded review of camera composition, environmental density, terrain/course depth, atmosphere, rider silhouette, HUD hierarchy, hazard readability, and mobile control hierarchy.
4. Confirmation that greater richness preserves critical lane and landing reads, non-color cues, responsive layouts, quality presets, bundle limits, and recorded desktop/mobile performance.
5. Explicit owner acceptance of the resulting compositions before new screenshots become regression baselines.

The following remain technical/product constraints, not visual-fidelity waivers:

- Production rendering remains direct Three.js/WebGL with original, bright, chunky low-poly forms; the goal is concept-aligned richness and composition, not photorealism or a pasted concept backdrop.
- Custom-course curves and banks change rendered geometry, placement transforms, collision footprints, and route height, while the authoritative rider centerline remains longitudinal as recorded in `ARCHITECTURE.md`.
- Physical-device brightness, display calibration, touch ergonomics, and motion comfort remain hardware-specific evidence gaps tracked in `QA_REPORT.md`.

## Current conclusion

Concept fidelity is **REOPENED** and **PENDING OWNER ACCEPTANCE**. The controlled RC2 harness now produces byte-identical desktop, high-contrast, and portrait actuals, and the editor baseline passes independently, but all three changed race surfaces correctly fail against the untouched obsolete baselines. The prior statement that no visual P0/P1 existed was an RC1 implementation review and is no longer a valid current-candidate conclusion. Determinism does not prove that the revised visual target has been met, and no launch-readiness claim is made here.
