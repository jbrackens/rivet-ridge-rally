import { describe, expect, it } from "vitest";

import { EMISSIVE_SIGNAL_TONE_MAPPED, WORLD_SURFACE_TONE_MAPPED } from "../toneBypass";
// Vite's `?raw` rather than `node:fs`: `tsconfig.app.json` types `src` as
// browser-only (`types: ["vite/client"]`) on purpose, and a test is not a reason
// to pull Node's globals into the app's type surface.
import engineSource from "../../GameEngine.ts?raw";

/**
 * `toneMapped` decides whether a material passes through the authored curve or
 * writes straight to the framebuffer. Seventeen materials opted out with no
 * recorded reason, which under the `cine-night` default made them render ~1.3x
 * bright, fully saturated and uncooled against a graded scene.
 *
 * The fix is a policy, and a policy is only worth having if it cannot be
 * bypassed silently — so this suite reads the engine source and fails on a bare
 * `toneMapped: true|false`. That is deliberately a source-text assertion: the
 * defect being prevented is an *authoring* mistake, and there is no runtime
 * surface that would catch it (a material with the wrong flag renders fine, just
 * wrong). A new material must name which class it belongs to.
 */
describe("tone-bypass policy", () => {
  it("routes every engine material through a named policy constant", () => {
    const bare = engineSource
      .split("\n")
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => /toneMapped:\s*(true|false)/.test(line));
    expect(
      bare,
      "Use WORLD_SURFACE_TONE_MAPPED (lit by the world) or "
      + "EMISSIVE_SIGNAL_TONE_MAPPED (represents light itself) from render/toneBypass.ts, "
      + "so the choice is recorded rather than accidental.",
    ).toEqual([]);
  });

  it("keeps both classes in use, so neither is quietly abandoned", () => {
    expect(engineSource).toContain("WORLD_SURFACE_TONE_MAPPED");
    expect(engineSource).toContain("EMISSIVE_SIGNAL_TONE_MAPPED");
  });

  it("grades physical surfaces and exempts only emissive signals", () => {
    expect(WORLD_SURFACE_TONE_MAPPED).toBe(true);
    expect(EMISSIVE_SIGNAL_TONE_MAPPED).toBe(false);
  });

  it("keeps the emissive exemption rare — it is for signals, not brightness", () => {
    const emissive = engineSource.match(/EMISSIVE_SIGNAL_TONE_MAPPED/g) ?? [];
    const world = engineSource.match(/WORLD_SURFACE_TONE_MAPPED/g) ?? [];
    // Import lines count once each; the rest are call sites.
    expect(emissive.length).toBeLessThan(world.length);
    expect(emissive.length).toBeLessThanOrEqual(8);
  });
});
