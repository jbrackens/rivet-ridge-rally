import * as THREE from "three";

/**
 * The display grade — the single highest-impact, zero-byte, zero-asset render
 * change available.
 *
 * The renderer shipped stock `ACESFilmicToneMapping`. The ACES film RRT was
 * built as a baseline for film production workflows, not direct screen output:
 * it desaturates highlights and crushes shadows, which on a bright, candy-
 * coloured stylized racer reads as the single largest "looks amateur" signal
 * (see GRAPHICS_EVOLUTION_PLAN.md §2). This module replaces it with an authored
 * curve — Khronos PBR Neutral as the base, which is designed for direct screen
 * output and preserves albedo/saturation, plus a light author grade so the
 * teal/coral identity reads punchy at the 8.85 m chase distance.
 *
 * Nothing here changes geometry, assets, or bytes. It is a shader-level change
 * applied by the renderer to every material automatically, so it needs no
 * post-processing pipeline.
 *
 * A `?tone=` URL parameter selects among the base modes so the same frozen
 * frame can be captured under each and compared — the look variant loop the
 * owner approved (GRAPHICS_EVOLUTION_PLAN.md §3.2). The shipped default is the
 * authored `custom` curve; the owner picks the final one from the captures.
 */

export type ToneMode = "custom" | "neutral" | "agx" | "aces" | "none";

const DEFAULT_TONE_MODE: ToneMode = "custom";

const TONE_MAPPING: Readonly<Record<ToneMode, THREE.ToneMapping>> = {
  custom: THREE.CustomToneMapping,
  neutral: THREE.NeutralToneMapping,
  agx: THREE.AgXToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  none: THREE.NoToneMapping,
};

/**
 * The authored grade, composed over Khronos PBR Neutral.
 *
 * Runs in the renderer's tone-mapping stage: it receives exposure-scaled linear
 * colour and returns display-linear colour before the sRGB transfer. The
 * constants are the tuning surface — a LUT expressed as code so it stays
 * auditable and carries no image bytes.
 */
const AUTHORED_CUSTOM_TONE_MAPPING = /* glsl */ `
vec3 CustomToneMapping( vec3 color ) {
  // Base: Khronos PBR Neutral — built for direct screen output, preserves the
  // saturation and albedo the ACES film RRT would desaturate and crush.
  color = NeutralToneMapping( color );

  // Gentle S-contrast around a lifted pivot, so shadows shape without crushing.
  color = ( color - 0.42 ) * 1.06 + 0.42;

  // Saturation lift so teal/coral read punchy at chase distance.
  float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  color = mix( vec3( luma ), color, 1.10 );

  // Mild warm-highlight / cool-shadow split for a sunny, premium read.
  float hi = smoothstep( 0.25, 0.9, luma );
  color *= mix( vec3( 0.985, 1.0, 1.03 ), vec3( 1.03, 1.0, 0.965 ), hi );

  return clamp( color, 0.0, 1.0 );
}
`;

const PLACEHOLDER = "vec3 CustomToneMapping( vec3 color ) { return color; }";

let installed = false;

/**
 * Install the authored `CustomToneMapping` into Three's shared shader chunk.
 *
 * Idempotent, and a global one-time edit: Three compiles every material against
 * the shared `tonemapping_pars_fragment` chunk, so replacing the no-op
 * placeholder once teaches every shader the authored curve. Calling twice would
 * try to replace a string that is no longer present, which the guard prevents.
 */
export function installAuthoredToneCurve(): void {
  if (installed) return;
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  if (!chunk.includes(PLACEHOLDER)) {
    // The Three build changed the placeholder shape; fail soft rather than
    // corrupt the chunk. The renderer still works with a stock base mode.
    installed = true;
    return;
  }
  THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(
    PLACEHOLDER,
    AUTHORED_CUSTOM_TONE_MAPPING.trim(),
  );
  installed = true;
}

/**
 * Which tone mode this run should use, from an optional `?tone=` override.
 *
 * Defaults to the authored curve. An unrecognised value falls back to the
 * default rather than throwing, because this is a capture affordance, not a
 * validated input path.
 */
export function resolveToneMode(search: string): ToneMode {
  let requested: string | null;
  try {
    requested = new URLSearchParams(search).get("tone");
  } catch {
    requested = null;
  }
  if (requested && requested in TONE_MAPPING) return requested as ToneMode;
  return DEFAULT_TONE_MODE;
}

/**
 * Apply a tone mode to the renderer, installing the authored curve if the mode
 * needs it. Leaves `toneMappingExposure` untouched — that stays per-venue.
 */
export function applyToneMapping(renderer: THREE.WebGLRenderer, mode: ToneMode): void {
  if (mode === "custom") installAuthoredToneCurve();
  renderer.toneMapping = TONE_MAPPING[mode];
}
