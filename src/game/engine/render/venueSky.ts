import * as THREE from "three";

/**
 * Procedural venue sky for image-based lighting.
 *
 * `createPbrEnvironment()` used to PMREM Three's `RoomEnvironment` — a box room
 * with area lights — and hand that to five *outdoor* venues as their IBL. Every
 * metal, the visor, the plastics reflected a studio ceiling. GRAPHICS_EVOLUTION_
 * PLAN.md §4 Phase 1 item 4 calls this the largest single IBL error in the
 * renderer, and it is why the per-material `envMapIntensity` tuning (1.72 metals,
 * 1.55 visor, 0.5 rubber) never quite meant anything: the thing being reflected
 * was wrong.
 *
 * This module builds, per venue, a tiny sky-dome scene from the venue's own
 * `WorldVisualProfile` colours — the same zenith/horizon/haze derivation that
 * `createSkyGradientTexture` paints as the visible backdrop, so what the metals
 * reflect matches what the player sees behind the course — plus a ground bounce
 * from the hemisphere-ground colour and a sun disc at the direct sun's
 * direction. PMREM'ing it costs one init-time render and zero per-frame work,
 * exactly like the room did. Nothing here ships bytes: the dome is a unit sphere
 * and a ~40-line fragment shader.
 *
 * The colour maths is kept in `deriveVenueSkyPalette` as a pure function so it
 * is unit-testable without a WebGL context; the GPU part is confined to
 * `createVenueEnvironment`.
 */

/** The subset of `WorldVisualProfile` the sky is built from. */
export interface VenueSkyColours {
  background: number;
  fog: number;
  hemisphereGround: number;
  sun: number;
}

export interface VenueSkyPalette {
  zenith: THREE.Color;
  highSky: THREE.Color;
  horizon: THREE.Color;
  lowerHaze: THREE.Color;
  ground: THREE.Color;
  sun: THREE.Color;
}

/**
 * The direct sun's placement, shared with `createWorld()` so the sun disc the
 * metals reflect sits exactly where the shadows say the sun is. Kept as a plain
 * tuple so the light setup can spread it into `position.set(...)` unchanged.
 */
export const VENUE_SUN_POSITION: readonly [number, number, number] = [-30, 42, 22];

// Dome energy is NORMALISED per venue, not fixed. RoomEnvironment was a constant,
// neutral, bright fill regardless of venue; a dome painted from the venue's own
// palette inherits that venue's brightness, so a dim venue starves its lighting
// (measured: Foundry 44.3 → 36.0 luma, track edges crushing to black, and a
// fixed 1.7× gain moved it only to 36.8 because Foundry's dome is ~3× dimmer
// than Canyon's). Scaling each dome to a common mean linear luminance keeps the
// venue's hue while making the IBL fill tier-consistent, which is what the
// per-venue exposure retune (Phase 1 item 1) expects to be tuning against.
// The target sits a little under the room's effective energy so the moody grade
// keeps some of its shadow depth. Capture-tuned, like the tone curve.
const TARGET_DOME_LUMINANCE = 0.75;
// Sunlit-ground bounce, relative to the sky gain, applied below the horizon.
// The palette's `ground` is the venue's HemisphereLight ground colour — tuned
// as a dim *light* — and a box room is bright from underneath too, filling
// every vertical track-edge face and underside. This keeps those from going
// black without touching the painted sky above the horizon.
const GROUND_BOUNCE_RATIO = 1.6;
const MIN_DOME_GAIN = 1;
const MAX_DOME_GAIN = 12;

/**
 * Derive the dome colours from a venue profile. Mirrors the HSL offsets and lerps
 * in `createSkyGradientTexture` on purpose: the IBL and the painted backdrop must
 * agree, or the bike reflects a sky the player cannot see.
 */
export function deriveVenueSkyPalette(colours: VenueSkyColours): VenueSkyPalette {
  const sky = new THREE.Color(colours.background);
  const fog = new THREE.Color(colours.fog);
  return {
    zenith: sky.clone().offsetHSL(-0.015, 0.06, -0.12),
    highSky: sky.clone().offsetHSL(0, 0.035, 0.06),
    horizon: fog.clone().lerp(sky, 0.55),
    lowerHaze: fog.clone().lerp(sky, 0.68),
    ground: new THREE.Color(colours.hemisphereGround),
    sun: new THREE.Color(colours.sun).lerp(new THREE.Color(0xffffff), 0.34),
  };
}

function linearLuminance(colour: THREE.Color): number {
  // THREE.Color holds linear working-space values (ColorManagement on), which is
  // what the dome shader emits, so this is the luminance PMREM integrates.
  return 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b;
}

/**
 * Approximate mean linear luminance of the dome the palette paints: the sky
 * hemisphere (zenith / highSky / horizon bands) and the ground hemisphere
 * (lowerHaze / ground) weighted by their solid angle, half each. Coarse on
 * purpose — it only has to rank venues consistently so the gain can equalise
 * them; the exact radiance shape is the shader's job.
 */
export function domeMeanLuminance(palette: VenueSkyPalette): number {
  const sky = (
    linearLuminance(palette.zenith) * 0.45
    + linearLuminance(palette.highSky) * 0.35
    + linearLuminance(palette.horizon) * 0.2
  );
  const ground = linearLuminance(palette.lowerHaze) * 0.4 + linearLuminance(palette.ground) * 0.6;
  return sky * 0.5 + ground * 0.5;
}

/**
 * Per-venue gain that brings the dome's mean luminance to the common target.
 * Never below 1 (a venue brighter than the target keeps its own energy) and
 * capped so a pathological near-black palette cannot blow the PMREM out.
 */
export function venueSkyGain(palette: VenueSkyPalette): number {
  const mean = domeMeanLuminance(palette);
  if (!(mean > 0)) return MAX_DOME_GAIN;
  return Math.min(MAX_DOME_GAIN, Math.max(MIN_DOME_GAIN, TARGET_DOME_LUMINANCE / mean));
}

/** Unit vector toward the sun, from the shared position tuple. */
export function venueSunDirection(): THREE.Vector3 {
  return new THREE.Vector3(...VENUE_SUN_POSITION).normalize();
}

// Radiance scale on the sun disc and its glow. The dome colours are display-ish
// values in [0,1]; the sun needs to be genuinely brighter than the sky for the
// metals to pick up a highlight, and PMREM's roughness ladder smears the disc
// into a soft specular lobe on the plastics. Tuned by capture, not by theory.
const SUN_DISC_RADIANCE = 6.0;
const SUN_GLOW_RADIANCE = 1.4;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize( position );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

// Bands are driven by the direction's Y (up). Sky above the horizon runs
// horizon → highSky → zenith; below it, lowerHaze darkens into the ground
// bounce. The sun is a hard disc plus a wide pow() glow along the sun direction.
const SKY_FRAGMENT = /* glsl */ `
varying vec3 vDirection;
uniform vec3 uZenith;
uniform vec3 uHighSky;
uniform vec3 uHorizon;
uniform vec3 uLowerHaze;
uniform vec3 uGround;
uniform vec3 uSun;
uniform vec3 uSunDirection;
uniform float uSunDisc;
uniform float uSunGlow;
uniform float uSkyGain;
uniform float uGroundGain;
void main() {
  vec3 dir = normalize( vDirection );
  float up = dir.y;
  vec3 colour;
  if ( up >= 0.0 ) {
    float lower = smoothstep( 0.0, 0.14, up );
    float upper = smoothstep( 0.14, 0.62, up );
    colour = mix( uHorizon, uHighSky, lower );
    colour = mix( colour, uZenith, upper );
    colour *= uSkyGain;
  } else {
    float down = smoothstep( 0.0, 0.35, -up );
    colour = mix( uLowerHaze, uGround, down );
    // Sunlit-ground bounce: fills vertical faces and undersides the way the
    // old box room did from beneath. Blend in with depth so the horizon band
    // stays continuous with the sky gain above it.
    colour *= mix( uSkyGain, uGroundGain, down );
  }
  float sunDot = max( dot( dir, uSunDirection ), 0.0 );
  float disc = smoothstep( 0.9985, 0.9996, sunDot );
  float glow = pow( sunDot, 24.0 );
  colour += uSun * ( disc * uSunDisc + glow * uSunGlow );
  gl_FragColor = vec4( colour, 1.0 );
}`;

/**
 * Build the sky-dome scene. Caller owns disposal (see `createVenueEnvironment`).
 * The sphere is inward-facing and sized to sit comfortably inside PMREM's
 * cube camera's near/far range; its absolute radius is otherwise irrelevant.
 */
export function buildVenueSkyScene(colours: VenueSkyColours, sunDirection: THREE.Vector3): THREE.Scene {
  const palette = deriveVenueSkyPalette(colours);
  const gain = venueSkyGain(palette);
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uZenith: { value: palette.zenith },
      uHighSky: { value: palette.highSky },
      uHorizon: { value: palette.horizon },
      uLowerHaze: { value: palette.lowerHaze },
      uGround: { value: palette.ground },
      uSun: { value: palette.sun },
      uSunDirection: { value: sunDirection.clone().normalize() },
      uSunDisc: { value: SUN_DISC_RADIANCE },
      uSunGlow: { value: SUN_GLOW_RADIANCE },
      uSkyGain: { value: gain },
      uGroundGain: { value: gain * GROUND_BOUNCE_RATIO },
    },
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), material);
  dome.frustumCulled = false;
  scene.add(dome);
  return scene;
}

function disposeSkyScene(scene: THREE.Scene): void {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  });
}

/**
 * PMREM the venue sky into an environment render target the scene can use as
 * its IBL. Same signature shape the room path had (sigma / near / far / size) so
 * `createPbrEnvironment` keeps its quality ladder and its error handling; the
 * sky scene is disposed here regardless of outcome. Throws on renderer failure
 * exactly as the room path did, so the caller's direct-light fallback still
 * engages.
 */
export function createVenueEnvironment(
  renderer: THREE.WebGLRenderer,
  colours: VenueSkyColours,
  size: number,
): THREE.WebGLRenderTarget {
  const sky = buildVenueSkyScene(colours, venueSunDirection());
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  try {
    return pmremGenerator.fromScene(sky, 0.04, 0.1, 100, { size });
  } finally {
    pmremGenerator.dispose();
    disposeSkyScene(sky);
  }
}
