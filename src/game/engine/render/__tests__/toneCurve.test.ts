import { describe, expect, it } from "vitest";

import { resolveToneMode } from "../toneCurve";

/**
 * The `?tone=` override drives the look variant loop. It is a capture
 * affordance, not a validated input, so an unknown or malformed value must fall
 * back to the shipped default rather than throw.
 */
describe("resolveToneMode", () => {
  it("defaults to the shipped cinematic night grade with no override", () => {
    expect(resolveToneMode("")).toBe("cine-night");
    expect(resolveToneMode("?other=1")).toBe("cine-night");
  });

  it("honours each grade variant", () => {
    for (const mode of [
      "custom", "custom-warm", "custom-cool", "custom-vivid", "custom-soft", "custom-punch",
      "cine-night", "cine-dusk", "cine-blade",
    ]) {
      expect(resolveToneMode(`?tone=${mode}`)).toBe(mode);
    }
  });

  it("honours each base tone mode", () => {
    for (const mode of ["neutral", "agx", "aces", "none"]) {
      expect(resolveToneMode(`?tone=${mode}`)).toBe(mode);
    }
  });

  it("falls back to the default for an unrecognised or malformed value", () => {
    expect(resolveToneMode("?tone=sepia")).toBe("cine-night");
    expect(resolveToneMode("?tone=custom-neon")).toBe("cine-night");
    expect(resolveToneMode("?tone=")).toBe("cine-night");
  });
});
