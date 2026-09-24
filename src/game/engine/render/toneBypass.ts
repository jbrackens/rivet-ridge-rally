/**
 * Tone-mapping policy for materials that opt out of the authored curve.
 *
 * Three renders a material with `toneMapped: false` straight to the framebuffer,
 * skipping the tone-mapping stage entirely. Seventeen materials in the engine did
 * that, and none of them recorded *why* — GRAPHICS_EVOLUTION_PLAN.md §4 Phase 1
 * item 2 calls this out: "Decide that deliberately rather than by accident."
 *
 * It became a real defect when `cine-night` shipped as the default grade
 * (§10). The authored curve desaturates to 0.42, adds contrast, casts cool and
 * dims to 0.76, so a bypassing surface now renders roughly 1.3x too bright, at
 * full saturation, with no cool cast — while every pixel around it is graded.
 * Clouds read as white blobs, sponsor banners and dust as stickers pasted onto a
 * moody scene. That "pasted on" quality is precisely the amateur signal the
 * grading work exists to remove.
 *
 * There are exactly two defensible classes, so this module names both. Every
 * `toneMapped` in the engine must use one of these constants — `toneBypass.test.ts`
 * fails the build on a bare `toneMapped: true|false`, which is what stops the next
 * material from making this choice silently.
 */

/**
 * Physical surfaces: anything that exists in the world and is lit by it —
 * dust, the contact shadow, clouds, track paint, signage, banner fabric.
 * These must pass through the authored curve so they sit in the same colour
 * response as the geometry around them. This is the default for new materials;
 * if you are unsure, it is this one.
 */
export const WORLD_SURFACE_TONE_MAPPED = true;

/**
 * Emissive gameplay signals: surfaces that represent *light itself* rather than
 * a lit object — the cooling-gate glow, its additive halos, and the cooling
 * snowflake icon. These are functional cues whose job is to read at a constant
 * intensity regardless of how dark the venue or the grade is, so they
 * deliberately bypass the curve. Keep this list small: it is an exception for
 * signals, not a brightness shortcut for art.
 */
export const EMISSIVE_SIGNAL_TONE_MAPPED = false;
