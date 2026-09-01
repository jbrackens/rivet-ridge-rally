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
 * A `?tone=` URL parameter selects among the base modes and the authored grade
 * variants, so the same frozen frame can be captured under each and compared —
 * the look variant loop the owner approved (GRAPHICS_EVOLUTION_PLAN.md §3.2).
 * The shipped default is `cine-night` — the moody/cinematic night grade the
 * owner picked from that loop; the `custom` family remains selectable via
 * `?tone=` as the previous bright look. Each variant is a LUT expressed as
 * code: auditable, and carrying no image bytes.
 */

/** The authored grade variants, each composed over Khronos PBR Neutral. */
export type ToneVariant =
  | "custom"
  | "custom-warm"
  | "custom-cool"
  | "custom-vivid"
  | "custom-soft"
  | "custom-punch"
  | "cine-night"
  | "cine-dusk"
  | "cine-blade";

export type ToneMode = ToneVariant | "neutral" | "agx" | "aces" | "none";

// The shipped default is the moody/cinematic night grade the owner selected from
// the look variant loop (GRAPHICS_EVOLUTION_PLAN.md §9). `custom` and its family
// remain available via `?tone=` as the previous bright look.
const DEFAULT_TONE_MODE: ToneMode = "cine-night";

const BASE_MAPPING: Readonly<Record<"neutral" | "agx" | "aces" | "none", THREE.ToneMapping>> = {
  neutral: THREE.NeutralToneMapping,
  agx: THREE.AgXToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  none: THREE.NoToneMapping,
};

/**
 * Each variant is the grade applied *after* Khronos PBR Neutral, in the
 * renderer's tone-mapping stage (exposure-scaled linear in, display-linear out,
 * before the sRGB transfer). The constants are the tuning surface.
 *
 * - `custom` — balanced: gentle S-contrast, +10% saturation, mild warm/cool split.
 * - `custom-warm` — sunnier: stronger warm highlights, a touch more lift.
 * - `custom-cool` — crisper: cool cast, slightly higher contrast.
 * - `custom-vivid` — punchier colour: +18% saturation.
 * - `custom-soft` — gentle/filmic: lower contrast, less saturation.
 * - `custom-punch` — dramatic: stronger S-curve and saturation together.
 *
 * The `cine-*` family is the moodier/cinematic direction — real desaturation,
 * deeper shadows, film-style split-toning, and a dim — authored per film
 * reference and vetted by a legibility panel across all five venues:
 * - `cine-night` — the shipped default. A John Wick night: desaturated, deep
 *   shadows, teal/magenta split, exposure eased to 0.76 so already-dark venues
 *   (Foundry, Pine) stay readable while the moody night identity holds.
 * - `cine-dusk` — Sicario twilight: warm sun / cold sky split, low-key, the
 *   most "film still" of the set.
 * - `cine-blade` — Blade Runner 2049: teal shadows, amber-haze highlights, dim.
 */
const VARIANT_GLSL: Readonly<Record<ToneVariant, string>> = {
  "custom": `
    color = ( color - 0.42 ) * 1.06 + 0.42;
    float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
    color = mix( vec3( luma ), color, 1.10 );
    float hi = smoothstep( 0.25, 0.9, luma );
    color *= mix( vec3( 0.985, 1.0, 1.03 ), vec3( 1.03, 1.0, 0.965 ), hi );`,
  "custom-warm": `
    color = ( color - 0.44 ) * 1.05 + 0.45;
    float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
    color = mix( vec3( luma ), color, 1.09 );
    float hi = smoothstep( 0.2, 0.92, luma );
    color *= mix( vec3( 0.99, 0.995, 1.0 ), vec3( 1.06, 1.005, 0.94 ), hi );`,
  "custom-cool": `
    color = ( color - 0.4 ) * 1.09 + 0.4;
    float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
    color = mix( vec3( luma ), color, 1.10 );
    float hi = smoothstep( 0.25, 0.9, luma );
    color *= mix( vec3( 0.965, 1.0, 1.05 ), vec3( 1.0, 1.005, 1.01 ), hi );`,
  "custom-vivid": `
    color = ( color - 0.42 ) * 1.07 + 0.42;
    float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
    color = mix( vec3( luma ), color, 1.18 );
    float hi = smoothstep( 0.25, 0.9, luma );
    color *= mix( vec3( 0.985, 1.0, 1.03 ), vec3( 1.03, 1.0, 0.965 ), hi );`,
  "custom-soft": `
    color = ( color - 0.44 ) * 1.02 + 0.45;
    float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
    color = mix( vec3( luma ), color, 1.04 );
    float hi = smoothstep( 0.2, 0.95, luma );
    color *= mix( vec3( 0.995, 1.0, 1.01 ), vec3( 1.015, 1.0, 0.99 ), hi );`,
  "custom-punch": `
    color = ( color - 0.42 ) * 1.12 + 0.42;
    float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
    color = mix( vec3( luma ), color, 1.16 );
    float hi = smoothstep( 0.22, 0.9, luma );
    color *= mix( vec3( 0.975, 1.0, 1.04 ), vec3( 1.04, 1.0, 0.955 ), hi );`,
  "cine-night": `
    float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
    color = mix( vec3( luma ), color, 0.42 );
    color = ( color - 0.36 ) * 1.46 + 0.33;
    float nightSplit = smoothstep( 0.0, 0.9, luma );
    vec3 nightShadow = vec3( 1.04, 0.38, 1.22 );
    vec3 nightHighlight = vec3( 0.38, 1.00, 1.34 );
    color *= mix( nightShadow, nightHighlight, nightSplit );
    color *= vec3( 0.88, 0.98, 1.16 );
    color *= 0.76;`,
  "cine-dusk": `
    float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
    color = mix( vec3( luma ), color, 0.45 );
    color = ( color - 0.32 ) * 1.50 + 0.32;
    float dusk = smoothstep( 0.0, 0.90, luma );
    vec3 duskTint = mix( vec3( 0.52, 0.74, 1.28 ), vec3( 1.34, 1.00, 0.52 ), dusk );
    color *= duskTint;
    color *= 0.66;`,
  "cine-blade": `
    float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
    color = mix( vec3( luma ), color, 0.40 );
    color = ( color - 0.34 ) * 1.42 + 0.34;
    float blade = smoothstep( 0.0, 0.9, luma );
    color *= mix( vec3( 0.42, 0.78, 0.98 ), vec3( 1.42, 0.82, 0.34 ), blade );
    float haze = smoothstep( 0.42, 1.0, luma );
    color += vec3( 0.14, 0.08, 0.02 ) * haze;
    color *= 0.78;`,
};

function customGlsl(variant: ToneVariant): string {
  return `
vec3 CustomToneMapping( vec3 color ) {
  color = NeutralToneMapping( color );
${VARIANT_GLSL[variant]}
  return clamp( color, 0.0, 1.0 );
}`;
}

const PLACEHOLDER = "vec3 CustomToneMapping( vec3 color ) { return color; }";

let installedVariant: ToneVariant | null = null;

/**
 * Install a grade variant into Three's shared shader chunk.
 *
 * Three compiles every material against the shared `tonemapping_pars_fragment`
 * chunk, so replacing the no-op `CustomToneMapping` placeholder once teaches
 * every shader the authored curve. Installing is one-shot per page: the first
 * call replaces the placeholder, later calls are ignored (the placeholder is
 * gone). In production only the default `custom` is ever installed; the variant
 * argument exists for the capture loop, where each page loads a single variant.
 */
export function installAuthoredToneCurve(variant: ToneVariant = "custom"): void {
  if (installedVariant !== null) return;
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  if (!chunk.includes(PLACEHOLDER)) {
    // The Three build changed the placeholder shape; fail soft rather than
    // corrupt the chunk. The renderer still works with a stock base mode.
    installedVariant = variant;
    return;
  }
  THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(
    PLACEHOLDER,
    customGlsl(variant).trim(),
  );
  installedVariant = variant;
}

function isToneVariant(value: string): value is ToneVariant {
  return value in VARIANT_GLSL;
}

/**
 * Which tone mode this run should use, from an optional `?tone=` override.
 *
 * Defaults to the shipped grade. An unrecognised value falls back to the default
 * rather than throwing, because this is a capture affordance, not a validated
 * input path.
 */
export function resolveToneMode(search: string): ToneMode {
  let requested: string | null;
  try {
    requested = new URLSearchParams(search).get("tone");
  } catch {
    requested = null;
  }
  if (!requested) return DEFAULT_TONE_MODE;
  if (isToneVariant(requested)) return requested;
  if (requested in BASE_MAPPING) return requested as ToneMode;
  return DEFAULT_TONE_MODE;
}

/**
 * Apply a tone mode to the renderer, installing the authored grade if the mode
 * is one of the custom variants. Leaves `toneMappingExposure` untouched — that
 * stays per-venue.
 */
export function applyToneMapping(renderer: THREE.WebGLRenderer, mode: ToneMode): void {
  if (isToneVariant(mode)) {
    installAuthoredToneCurve(mode);
    renderer.toneMapping = THREE.CustomToneMapping;
    return;
  }
  renderer.toneMapping = BASE_MAPPING[mode];
}
