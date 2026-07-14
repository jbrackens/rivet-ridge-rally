import { describe, expect, it } from "vitest";

import { parseQaVisualDistance } from "../qaVisualCapture";

describe("QA visual capture distance", () => {
  it("accepts finite positions inside the first production lap", () => {
    expect(parseQaVisualDistance("?qa-visual-distance=0", 1_260)).toBe(0);
    expect(parseQaVisualDistance("?qa-visual-distance=650.5", 1_260)).toBe(650.5);
    expect(parseQaVisualDistance("?other=value&qa-visual-distance=900", 1_720)).toBe(900);
  });

  it.each([
    "",
    "?qa-visual-distance=",
    "?qa-visual-distance=not-a-number",
    "?qa-visual-distance=Infinity",
    "?qa-visual-distance=-1",
    "?qa-visual-distance=1260",
    "?qa-visual-distance=1400",
  ])("ignores absent or invalid state: %s", (search) => {
    expect(parseQaVisualDistance(search, 1_260)).toBeUndefined();
  });

  it("ignores invalid course bounds", () => {
    expect(parseQaVisualDistance("?qa-visual-distance=1", 0)).toBeUndefined();
    expect(parseQaVisualDistance("?qa-visual-distance=1", Number.NaN)).toBeUndefined();
  });
});
