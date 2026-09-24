import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  VENUE_SUN_POSITION,
  deriveVenueSkyPalette,
  domeMeanLuminance,
  venueSkyGain,
  venueSunDirection,
} from "../venueSky";

// Two venues at the ends of the brightness range, from WORLD_VISUAL_PROFILES.
const COASTLINE = {
  background: 0x55cbe4,
  fog: 0xdce9d6,
  hemisphereGround: 0x54715e,
  sun: 0xffe5b5,
};
const FOUNDRY = {
  background: 0x6e9fac,
  fog: 0xb6a093,
  hemisphereGround: 0x402d2a,
  sun: 0xffbb78,
};


/**
 * The palette is the contract between the painted backdrop and the IBL: both
 * derive from the same venue colours with the same offsets, so the bike
 * reflects the sky the player actually sees. These pin the shape of that
 * derivation without needing a WebGL context.
 */
const CANYON = {
  background: 0x5cbce7,
  fog: 0xe7c8a5,
  hemisphereGround: 0x6c3525,
  sun: 0xffd6a0,
};

function lightness(colour: THREE.Color): number {
  const hsl = { h: 0, s: 0, l: 0 };
  colour.getHSL(hsl);
  return hsl.l;
}

describe("deriveVenueSkyPalette", () => {
  it("darkens the zenith and lifts the high sky relative to the base sky", () => {
    const palette = deriveVenueSkyPalette(CANYON);
    const base = new THREE.Color(CANYON.background);
    expect(lightness(palette.zenith)).toBeLessThan(lightness(base));
    expect(lightness(palette.highSky)).toBeGreaterThan(lightness(base));
  });

  it("places the horizon between the fog colour and the sky colour", () => {
    const palette = deriveVenueSkyPalette(CANYON);
    const fog = new THREE.Color(CANYON.fog);
    const sky = new THREE.Color(CANYON.background);
    for (const channel of ["r", "g", "b"] as const) {
      const low = Math.min(fog[channel], sky[channel]);
      const high = Math.max(fog[channel], sky[channel]);
      expect(palette.horizon[channel]).toBeGreaterThanOrEqual(low - 1e-6);
      expect(palette.horizon[channel]).toBeLessThanOrEqual(high + 1e-6);
    }
  });

  it("uses the hemisphere ground colour verbatim for the ground bounce", () => {
    const palette = deriveVenueSkyPalette(CANYON);
    expect(palette.ground.getHex()).toBe(CANYON.hemisphereGround);
  });

  it("lifts the sun toward white so the disc reads hot, not tinted mud", () => {
    const palette = deriveVenueSkyPalette(CANYON);
    expect(lightness(palette.sun)).toBeGreaterThan(lightness(new THREE.Color(CANYON.sun)));
  });

  it("does not mutate the inputs across calls (fresh colours each time)", () => {
    const first = deriveVenueSkyPalette(CANYON);
    first.zenith.setHex(0x000000);
    const second = deriveVenueSkyPalette(CANYON);
    expect(second.zenith.getHex()).not.toBe(0x000000);
  });
});

describe("venueSunDirection", () => {
  it("is the unit vector of the shared sun position", () => {
    const direction = venueSunDirection();
    expect(direction.length()).toBeCloseTo(1, 6);
    const expected = new THREE.Vector3(...VENUE_SUN_POSITION).normalize();
    expect(direction.distanceTo(expected)).toBeLessThan(1e-9);
  });

  it("points upward, matching a daytime sun", () => {
    expect(venueSunDirection().y).toBeGreaterThan(0);
  });
});

/**
 * The dome's energy is normalised per venue so a dim palette does not starve
 * its lighting (the box room it replaces was a constant fill). These pin the
 * ranking and the normalisation, which is what the captures depend on.
 */
describe("venueSkyGain", () => {
  it("ranks a dim venue's dome below a bright one's before normalisation", () => {
    expect(domeMeanLuminance(deriveVenueSkyPalette(FOUNDRY)))
      .toBeLessThan(domeMeanLuminance(deriveVenueSkyPalette(COASTLINE)));
  });

  it("gives the dim venue the larger gain", () => {
    expect(venueSkyGain(deriveVenueSkyPalette(FOUNDRY)))
      .toBeGreaterThan(venueSkyGain(deriveVenueSkyPalette(COASTLINE)));
  });

  it("never dims a venue below its own energy and stays within the cap", () => {
    for (const venue of [COASTLINE, FOUNDRY, CANYON]) {
      const gain = venueSkyGain(deriveVenueSkyPalette(venue));
      expect(gain).toBeGreaterThanOrEqual(1);
      expect(gain).toBeLessThanOrEqual(12);
    }
  });

  it("brings every unclamped venue to the same mean luminance", () => {
    const normalised = [COASTLINE, FOUNDRY, CANYON].map((venue) => {
      const palette = deriveVenueSkyPalette(venue);
      return domeMeanLuminance(palette) * venueSkyGain(palette);
    });
    const first = normalised[0];
    if (first === undefined) throw new Error("expected at least one venue");
    for (const value of normalised.slice(1)) expect(value).toBeCloseTo(first, 6);
  });
});
