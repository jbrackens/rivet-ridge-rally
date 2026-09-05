import * as THREE from "three";

import { VENUE_SUN_POSITION } from "./venueSky";

/**
 * Exponential-squared height fog with sun inscatter.
 *
 * The engine shipped linear `THREE.Fog` and nothing else. Fog is the thing
 * reviewers read as "hand-painted" in the reference set (GRAPHICS_EVOLUTION_
 * PLAN.md §2): it separates depth planes, unifies the palette and masks the
 * draw-distance cut. A straight swap to `FogExp2` was tried and rejected (§9)
 * as imperceptible — and the first passes of this module measured the same.
 * The reason turned out to be the near plane, not the curve: the venues set
 * `fogNear` at 66–105 m because *linear* fog ramps harshly and would crush the
 * mid-track, but the chase camera sits 8.85 m behind the bike looking down a
 * curving course, so almost no geometry in frame is that far away — the distant
 * mesas are the screen-space backdrop, which fog never touches. Every fog
 * model agreed on ≈0 for everything visible. exp²'s soft ramp is what lets the
 * haze start much closer without the crush, so this module scales the near
 * plane in and changes the shape beyond it:
 *
 * 1. **Distance** — exp² from a fraction of `fogNear`, still reaching full fog
 *    at `fogFar`, so the per-venue proportions hold.
 * 2. **Height** — a world-Y density term: haze pools at track level and
 *    clears with height, so valleys hold atmosphere while ridgelines and tall
 *    kit stay crisp. This is what makes fog read as weather, not a depth cue.
 * 3. **Sun inscatter** — the haze tints warm toward the sun by
 *    `pow(dot(viewDir, sunDir), k)`, using the sun vector shared with the
 *    DirectionalLight and the IBL sky dome.
 *
 * Strength is a **preset**, selected by `?fog=light|medium|heavy` the way
 * `?tone=` selects a grade — the §3.2 variant loop: the same frozen frame is
 * captured under each and the owner picks. `?fog=linear` keeps Three's stock
 * fog for the before/after. The shipped default is `medium` until the owner
 * picks.
 *
 * Mechanism, same as `toneCurve.ts`: Three compiles every fog-enabled material
 * against the shared `fog_*` shader chunks, so replacing them once teaches
 * every `MeshStandardMaterial` in the scene the new fog — no extra pass, no
 * extra draw call, ~10 ALU per opaque fragment and zero bandwidth, which is the
 * correct side of the tile-GPU trade. `scene.fog` stays a plain `THREE.Fog`, so
 * Three still defines `USE_FOG` and feeds the per-venue `fogColor` /
 * `fogNear` / `fogFar` uniforms; only the maths changed.
 *
 * Deliberate limitation: the inscatter tint is a warm push on the venue's own
 * fog colour rather than the venue's exact sun colour, because Three's fog
 * uniform path carries no extra values and the plan wants one chunk edit, not
 * a per-material hook. Revisit if capture says the venues want distinct tints.
 */

export interface FogPreset {
  /** Where haze starts, as a fraction of the venue's `fogNear`. */
  nearScale: number;
  /** exp² scale over the range; higher = denser mid-range. */
  distanceScale: number;
  /** Density at track level relative to the linear endpoint (>1 pools haze). */
  groundDensity: number;
  /** Density floor for high fragments, so tall kit still recedes with distance. */
  heightFloor: number;
  /** How fast density falls with world height above the base (per metre). */
  heightFalloff: number;
  /** Inscatter lobe tightness; low = a wide, soft sun halo. */
  sunPower: number;
  /** Warm push on the fog colour inside the sun lobe. */
  sunWarm: readonly [number, number, number];
}

export type FogPresetName = "light" | "medium" | "heavy";
export type FogModel = FogPresetName | "linear";

/**
 * The variant menu. Each is a complete, self-consistent atmosphere; they differ
 * mainly in how close the haze starts and how hard it pools at track level.
 * Capture-tuned. The first pass (near 1.0, ground 1.0, scale 3, sun 8) was
 * measured identical to stock at mid-course for the near-plane reason above.
 */
export const FOG_PRESETS: Readonly<Record<FogPresetName, FogPreset>> = {
  light: {
    nearScale: 0.3,
    distanceScale: 4.5,
    groundDensity: 1.5,
    heightFloor: 0.25,
    heightFalloff: 0.06,
    sunPower: 3.0,
    sunWarm: [1.35, 1.1, 0.82],
  },
  medium: {
    nearScale: 0.18,
    distanceScale: 5.0,
    groundDensity: 2.2,
    heightFloor: 0.25,
    heightFalloff: 0.06,
    sunPower: 3.0,
    sunWarm: [1.35, 1.1, 0.82],
  },
  heavy: {
    nearScale: 0.1,
    distanceScale: 5.5,
    groundDensity: 3.0,
    heightFloor: 0.22,
    heightFalloff: 0.05,
    sunPower: 2.5,
    sunWarm: [1.4, 1.12, 0.8],
  },
};

const DEFAULT_FOG_MODEL: FogModel = "medium";

/** World Y (m) at and below which the height term is at full density. */
const FOG_BASE_HEIGHT = 0.0;

function glslFloat(value: number): string {
  const text = String(value);
  return text.includes(".") || text.includes("e") ? text : `${text}.0`;
}

function glslVec3(values: readonly [number, number, number]): string {
  return `vec3( ${values.map(glslFloat).join(", ")} )`;
}

const sunDirection = new THREE.Vector3(...VENUE_SUN_POSITION).normalize();

// The four stock chunks (three@0.185.1) are matched by a distinctive line each
// so a Three upgrade that reshapes them fails soft to stock fog rather than
// corrupting the chunk. They are independent of one another.
const STOCK = {
  parsVertex: "varying float vFogDepth;",
  vertex: "vFogDepth = - mvPosition.z;",
  parsFragment: "uniform vec3 fogColor;",
  fragment: "float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );",
} as const;

const PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG

	varying float vFogDepth;
	varying vec3 vRrrFogWorldPosition;

#endif
`;

// `transformed` and `modelMatrix` exist at this include point in every built-in
// vertex shader; instancing and batching are applied the same way Three's own
// project_vertex applies them, so the 79 InstancedMesh sites fog correctly.
const VERTEX = /* glsl */ `
#ifdef USE_FOG

	vFogDepth = - mvPosition.z;
	{
		vec4 rrrFogWorld = vec4( transformed, 1.0 );
		#ifdef USE_BATCHING
			rrrFogWorld = batchingMatrix * rrrFogWorld;
		#endif
		#ifdef USE_INSTANCING
			rrrFogWorld = instanceMatrix * rrrFogWorld;
		#endif
		rrrFogWorld = modelMatrix * rrrFogWorld;
		vRrrFogWorldPosition = rrrFogWorld.xyz;
	}

#endif
`;

const PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG

	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vRrrFogWorldPosition;

	#ifdef FOG_EXP2

		uniform float fogDensity;

	#else

		uniform float fogNear;
		uniform float fogFar;

	#endif

#endif
`;

/** The fragment chunk for a preset. Exported for tests; the install bakes it. */
export function fogFragmentChunk(preset: FogPreset): string {
  return /* glsl */ `
#ifdef USE_FOG

	#ifdef FOG_EXP2

		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );

	#else

		// Haze starts at a fraction of the venue's fogNear (see FogPreset.nearScale);
		// nothing nearer than that is fogged at all, and fogFar is still full fog.
		float rrrFogNear = fogNear * ${glslFloat(preset.nearScale)};
		float rrrFogRange = max( fogFar - rrrFogNear, 1.0 );
		float rrrFogDistance = max( vFogDepth - rrrFogNear, 0.0 ) / rrrFogRange;
		// Height term: full density at and below the base, falling off above it,
		// floored so tall kit still recedes with distance.
		float rrrFogHeight = exp( - max( vRrrFogWorldPosition.y - ${glslFloat(FOG_BASE_HEIGHT)}, 0.0 ) * ${glslFloat(preset.heightFalloff)} );
		float rrrFogDensity = mix( ${glslFloat(preset.heightFloor)}, ${glslFloat(preset.groundDensity)}, rrrFogHeight );
		float fogFactor = 1.0 - exp( - rrrFogDistance * rrrFogDistance * ${glslFloat(preset.distanceScale)} * rrrFogDensity );

	#endif

	// Sun inscatter: the haze warms toward the sun along the view direction.
	vec3 rrrFogView = normalize( vRrrFogWorldPosition - cameraPosition );
	float rrrFogSun = pow( max( dot( rrrFogView, ${glslVec3([sunDirection.x, sunDirection.y, sunDirection.z])} ), 0.0 ), ${glslFloat(preset.sunPower)} );
	vec3 rrrFogColor = mix( fogColor, fogColor * ${glslVec3(preset.sunWarm)}, rrrFogSun );

	gl_FragColor.rgb = mix( gl_FragColor.rgb, rrrFogColor, fogFactor );

#endif
`;
}

let installed: FogPresetName | null = null;

/** Which preset is installed in Three's shared chunks, if any. */
export function installedFogPreset(): FogPresetName | null {
  return installed;
}

function isFogPresetName(value: string): value is FogPresetName {
  return value in FOG_PRESETS;
}

/**
 * Which fog model this run should use, from an optional `?fog=` override —
 * the same capture affordance as `?tone=`. `linear` keeps Three's stock fog;
 * a preset name selects that strength. Not a validated input; anything
 * unrecognised falls back to the shipped default rather than throwing.
 */
export function resolveFogModel(search: string): FogModel {
  let requested: string | null;
  try {
    requested = new URLSearchParams(search).get("fog");
  } catch {
    requested = null;
  }
  if (!requested) return DEFAULT_FOG_MODEL;
  if (requested === "linear") return "linear";
  return isFogPresetName(requested) ? requested : DEFAULT_FOG_MODEL;
}

/**
 * Install a fog preset into Three's shared shader chunks. One-shot per page,
 * like the tone curve: the first call replaces the stock chunks, later calls
 * are ignored (the stock shape is gone). If any of the four stock chunks does
 * not have the expected shape (a Three upgrade), nothing is replaced and stock
 * linear fog remains — the renderer keeps working, just without the
 * atmosphere. Returns the preset now in effect, or null for stock fog.
 */
export function installHeightFog(preset: FogPresetName = DEFAULT_FOG_MODEL as FogPresetName): FogPresetName | null {
  if (installed !== null) return installed;
  const chunks = THREE.ShaderChunk;
  const stockShapeIntact = chunks.fog_pars_vertex.includes(STOCK.parsVertex)
    && chunks.fog_vertex.includes(STOCK.vertex)
    && chunks.fog_pars_fragment.includes(STOCK.parsFragment)
    && chunks.fog_fragment.includes(STOCK.fragment);
  if (!stockShapeIntact) return null;
  chunks.fog_pars_vertex = PARS_VERTEX;
  chunks.fog_vertex = VERTEX;
  chunks.fog_pars_fragment = PARS_FRAGMENT;
  chunks.fog_fragment = fogFragmentChunk(FOG_PRESETS[preset]);
  installed = preset;
  return preset;
}

/** Test-only: the preset-independent chunk bodies. */
export const HEIGHT_FOG_CHUNKS = Object.freeze({
  parsVertex: PARS_VERTEX,
  vertex: VERTEX,
  parsFragment: PARS_FRAGMENT,
});
