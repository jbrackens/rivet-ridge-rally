import { describe, expect, it } from "vitest";

import { resolveFestivalPocketPlacements } from "../GameEngine";

describe("festival pocket placement", () => {
  it("preserves the full High Canyon crowd plan outside every cooling showcase", () => {
    const layout = resolveFestivalPocketPlacements({
      handcraftedCanyon: true,
      quality: "high",
      totalLength: 1_260 * 2 + 120,
      trackOrder: 1,
      coolingGateDistances: [138, 895],
    });

    expect(layout.routePockets).toHaveLength(22);
    expect(layout.coolingGatePockets).toHaveLength(4);
    expect(layout.pocketPlacements).toHaveLength(26);
    expect(layout.pocketPlacements.length * 4).toBe(104);

    for (const routePocket of layout.routePockets) {
      for (const gatePocket of layout.coolingGatePockets) {
        expect(Math.hypot(
          routePocket.x - gatePocket.x,
          routePocket.z - gatePocket.z,
        )).toBeGreaterThanOrEqual(5.6);
      }
    }
  });
});
