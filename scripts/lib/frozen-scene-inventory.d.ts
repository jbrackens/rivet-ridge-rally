/**
 * Hand-written types for `frozen-scene-inventory.mjs`, so the TypeScript
 * visual-regression spec can import the same table the `.mjs` capture script
 * uses. The module has no build step and is loaded directly by Node, which is
 * why the declaration is written rather than generated.
 */

export type FrozenAttribute = readonly [attribute: string, value: string];

export const RACE_CANVAS_LABEL: string;

export const FROZEN_READINESS: readonly FrozenAttribute[];

export const FROZEN_SCENE_INVENTORY: readonly FrozenAttribute[];

export const FROZEN_DENSITY_DEFAULTS: Readonly<{
  festivalPocketCount: string;
  festivalPocketTierCount: string;
  courseEdgeSafetyBlockCount: string;
}>;

export function frozenSceneContract(overrides?: {
  festivalPocketCount?: string;
  festivalPocketTierCount?: string;
  courseEdgeSafetyBlockCount?: string;
}): readonly FrozenAttribute[];
