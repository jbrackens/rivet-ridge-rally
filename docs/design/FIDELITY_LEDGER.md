# RIVET RIDGE RALLY — Visual Fidelity Ledger

**Review date:** 2026-07-12

**Reviewer:** primary implementation agent

**Candidate:** `1.0.0-rc.1`

This ledger compares the accepted concept images with current browser-rendered evidence. Concepts define composition, hierarchy, readability, and art direction; they are not pixel-accurate production screenshots. The production renderer intentionally uses code-native, chunky low-poly geometry rather than trying to reproduce the concepts' offline-render detail.

## Accepted comparisons

| Surface | Concept | Browser evidence | Result and observed difference |
|---|---|---|---|
| Title and campaign | `concepts/title-background-production.png`, `concepts/campaign-menu.png` | `e2e/core-flow.spec.ts-snapshots/title-screen-chromium-darwin.png` | **PASS.** The shipped source art is retained, while the live UI supplies the approved logo, three primary actions, rider progress, five-track path, lock states, and keyboard guidance. The live treatment is flatter and more compact than the illustrative concept but preserves its hierarchy. |
| Desktop race | `concepts/gameplay-desktop.png` | `e2e/visual-regression.spec.ts-snapshots/race-screen-chromium-darwin.png` | **PASS.** Position/mode, lap/time, target, heat, instruction cue, readable four-lane dirt, rider silhouette, hazards, festival fencing, crowd stands, banners, and long landing sightline are present. Geometry is deliberately coarser and scenery less dense than the concept's offline render; this is the selected performance-safe low-poly production style. |
| Mobile race | `concepts/gameplay-mobile.png` | `e2e/visual-regression.spec.ts-snapshots/race-mobile-mobile-chrome-darwin.png` | **PASS.** The portrait camera keeps the route visible and separates pause, lap/time, target, heat, lane/pitch rocker, Ride, and Turbo into reachable labeled controls. The production controls use compact textured rectangles instead of illustrative icon slabs so they remain legible at narrow widths. |
| Track builder | `concepts/track-builder.png` | `e2e/visual-regression.spec.ts-snapshots/editor-screen-chromium-darwin.png` | **PASS.** The live builder retains the concept's top actions, category rail, module miniatures, 3D camera, snap grid, placement panel, race settings, validation, and history/status footer. The default three-module route is intentionally sparser than the concept showcase. Authored curves and banks render as transformed surfaces over the editor's longitudinal route model. |
| High contrast and color redundancy | desktop race concept | `e2e/visual-regression.spec.ts-snapshots/race-high-contrast-chromium-darwin.png` | **PASS.** High contrast adds real WebGL lane/edge strips. Cooling gates carry white geometric snowflakes; barriers, mud, grass, and ramps retain stripe, rut, tuft, and rail silhouettes. The state is not communicated by color alone. |

## Five-track identity review

The browser captures in `artifacts/visual-review/` inspect the production start composition. The `midcourse/` captures use the shortened QA route only to bring theme props and obstacle silhouettes into one review frame; they are not scale or performance evidence.

| Track | Readable identity in browser | Result |
|---|---|---|
| Canyon Kickoff | warm red-rock mesas, canyon arch, festival flags, cooling rhythm | **PASS** |
| Pine Run | grey alpine rock, denser pines, timber/log props, bump-and-barrier rhythm | **PASS** |
| Coastline Clash | bright sand/cliff palette, visible water horizon, long jump and mud rhythm | **PASS** |
| Foundry Flight | clay industrial palette, sheds and smokestacks, smoke puffs, dense ramp/barrier rhythm | **PASS** |
| Summit Showdown | pale mountain rock, snow-capped trees/peaks, high-risk ramp and barrier density | **PASS** |

## Accepted limitations

- The illustrative concepts contain materially more mesh and texture detail than the real-time code-native renderer. The shipped treatment remains internally consistent, original, readable, and within the intended bright toy-diorama direction; this is not tracked as a release defect.
- Custom-course curves and banks change rendered geometry, placement transforms, collision footprints, and route height, but the authoritative rider centerline remains longitudinal rather than following a freeform 2D spline. That matches the editor data model and is recorded in `ARCHITECTURE.md`.
- Physical-device brightness, touch ergonomics, display calibration, and motion comfort remain hardware-specific `UNVERIFIED` items in `QA_REPORT.md`.

No P0/P1 visual defect was found in this review. Screenshot tests remain the regression authority for the accepted compositions above.
