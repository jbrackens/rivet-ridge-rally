import { describe, expect, it } from "vitest";

import { formatKeyCode } from "../keyLabels";

describe("formatKeyCode", () => {
  it("renders arrow, modifier, letter, digit, and fallback codes readably", () => {
    expect(formatKeyCode("ArrowLeft")).toBe("← Left");
    expect(formatKeyCode("ArrowRight")).toBe("→ Right");
    expect(formatKeyCode("ShiftLeft")).toBe("Left Shift");
    expect(formatKeyCode("KeyQ")).toBe("Q");
    expect(formatKeyCode("Digit7")).toBe("7");
    expect(formatKeyCode("Numpad3")).toBe("Numpad 3");
    expect(formatKeyCode("BracketLeft")).toBe("Bracket Left");
  });
});
