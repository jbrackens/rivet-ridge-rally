/**
 * The scene a frozen visual candidate must actually be, in one place.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 * Two `openFrozenRace()` implementations decided what "the scene is ready"
 * means, and they disagreed by an order of magnitude:
 *
 * - `e2e/visual-regression.spec.ts` asserted **41** canvas attributes — the
 *   whole authored inventory, down to 198 route spectators and 184 shoulder
 *   rocks.
 * - `scripts/capture-baseline-candidates.mjs` waited on **four**:
 *   `data-visual-state`, `data-bike-asset`, `data-canyon-kit-asset` and
 *   `data-environment-asset`. Its own header said it "deliberately mirrors" the
 *   spec.
 *
 * The capture script produces the PNGs an owner reviews, and
 * `promote-visual-baseline.mjs` copies exactly those PNGs into the spec's
 * snapshot directory. So an owner could sign a frame taken from a scene the
 * gate would reject on its next run — a missing watchtower, a short banner run,
 * a half-built festival pocket — and the promotion chain, which hashes response
 * bodies and enforces a six-path add-only diff, compared everything about those
 * files except the state they were captured in.
 *
 * A fact with two spellings is a fact that will disagree. This is the one
 * spelling.
 *
 * ---------------------------------------------------------------------------
 * What is here
 * ---------------------------------------------------------------------------
 * Attribute/value pairs only. Navigation is deliberately NOT shared: the spec
 * drives the ordinary dev server through Playwright's `expect`, while the
 * capture script drives a strict frozen-candidate server that 404s a param-less
 * index and polls with `page.waitForFunction`. Those are genuinely different
 * jobs, and forcing one flow onto both would trade a real bug for a fragile
 * abstraction. What must agree is the *scene*, and that is what this exports.
 */

/** The canvas whose dataset carries the inventory. */
export const RACE_CANVAS_LABEL = "Live 3D race on Canyon Kickoff";

/**
 * Readiness gates. Separated from the inventory because these three are the
 * only ones that legitimately need a long timeout — they wait on decode and
 * upload of compressed assets rather than on scene construction.
 */
export const FROZEN_READINESS = Object.freeze([
  Object.freeze(["data-visual-state", "frozen"]),
  Object.freeze(["data-bike-asset", "ready"]),
  Object.freeze(["data-canyon-kit-asset", "ready"]),
  Object.freeze(["data-environment-asset", "ready"]),
]);

/**
 * Everything the authored Canyon scene must contain for a frame to be worth
 * signing. Every value here is a count or a style name the engine writes onto
 * the race canvas once construction settles.
 */
export const FROZEN_SCENE_INVENTORY = Object.freeze([
  Object.freeze(["data-canyon-kit-cooling-gate-style", "per-lane-open-arch"]),
  Object.freeze(["data-canyon-kit-cooling-gate-arch-count", "12"]),
  Object.freeze(["data-cooling-gate-venue-pocket-count", "4"]),
  Object.freeze(["data-cooling-gate-venue-style", "bilateral"]),
  Object.freeze(["data-cooling-gate-watchtower-count", "4"]),
  Object.freeze(["data-cooling-gate-watchtower-style", "staffed-elevated"]),
  Object.freeze(["data-cooling-gate-watchtower-spectator-count", "16"]),
  Object.freeze(["data-festival-pocket-style", "tiered-canyon"]),
  Object.freeze(["data-festival-pocket-tier-rows", "4"]),
  Object.freeze(["data-course-edge-safety-style", "continuous-canyon"]),
  Object.freeze(["data-course-edge-safety-batch-count", "1"]),
  Object.freeze(["data-start-grid-style", "numbered-four-lane"]),
  Object.freeze(["data-start-grid-stencil-count", "4"]),
  Object.freeze(["data-start-grid-batch-count", "2"]),
  Object.freeze(["data-dirt-texture-detail-style", "layered-rut-pebble-v3"]),
  Object.freeze(["data-dirt-texture-resolution", "512x512"]),
  Object.freeze(["data-dirt-height-texture-resolution", "512x512"]),
  Object.freeze(["data-canyon-route-banner-style", "route-following-textured-sponsor-v2"]),
  Object.freeze(["data-canyon-route-banner-count", "76"]),
  Object.freeze(["data-canyon-route-banner-pole-count", "76"]),
  Object.freeze(["data-canyon-route-banner-texture-variant-count", "4"]),
  Object.freeze(["data-canyon-route-crowd-style", "route-following-rail-bleachers-v2"]),
  Object.freeze(["data-canyon-route-crowd-group-count", "22"]),
  Object.freeze(["data-canyon-route-crowd-spectator-count", "198"]),
  Object.freeze(["data-canyon-route-crowd-tier-count", "44"]),
  Object.freeze(["data-canyon-cactus-style", "branched-saguaro"]),
  Object.freeze(["data-canyon-cactus-batch-count", "1"]),
  Object.freeze(["data-canyon-cactus-instance-count", "24"]),
  Object.freeze(["data-canyon-shoulder-dressing-style", "route-following-cut-bank"]),
  Object.freeze(["data-canyon-shoulder-ribbon-count", "2"]),
  Object.freeze(["data-canyon-shoulder-dressing-batch-count", "4"]),
  Object.freeze(["data-canyon-shoulder-shelf-count", "78"]),
  Object.freeze(["data-canyon-shoulder-rock-count", "184"]),
  Object.freeze(["data-canyon-shoulder-agave-count", "52"]),
]);

/**
 * The three counts the spec exposed as overridable.
 *
 * Every call site passes the defaults — the two that name them pass exactly
 * "26", "104" and "1320" — so they are constant in practice. They stay
 * parameterised rather than folded into the table above because a density
 * change is precisely the kind of edit that should have to name its new number
 * at the call site.
 */
export const FROZEN_DENSITY_DEFAULTS = Object.freeze({
  festivalPocketCount: "26",
  festivalPocketTierCount: "104",
  courseEdgeSafetyBlockCount: "1320",
});

/**
 * The complete scene contract: inventory plus the three density counts.
 *
 * @param {{festivalPocketCount?: string, festivalPocketTierCount?: string, courseEdgeSafetyBlockCount?: string}} [overrides]
 * @returns {ReadonlyArray<readonly [string, string]>}
 */
export function frozenSceneContract(overrides = {}) {
  const density = { ...FROZEN_DENSITY_DEFAULTS, ...overrides };
  return Object.freeze([
    ...FROZEN_SCENE_INVENTORY,
    Object.freeze(["data-festival-pocket-count", density.festivalPocketCount]),
    Object.freeze(["data-festival-pocket-tier-count", density.festivalPocketTierCount]),
    Object.freeze(["data-course-edge-safety-block-count", density.courseEdgeSafetyBlockCount]),
  ]);
}
