import { describe, expect, it } from "vitest";

import { formatKeyCode, getKeyBindingRejectionReason } from "../keyLabels";

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

describe("getKeyBindingRejectionReason", () => {
  it("accepts gameplay keys whose browser behavior can be suppressed", () => {
    for (const code of ["Escape", "ArrowLeft", "PageDown", "ShiftLeft", "Space", "KeyQ"]) {
      expect(getKeyBindingRejectionReason(code)).toBeNull();
    }
  });

  it("rejects unidentified, focus-navigation, browser, and system keys clearly", () => {
    expect(getKeyBindingRejectionReason("Unidentified")).toBe("That key could not be identified. Choose another key.");
    for (const code of ["Tab", "Enter", "NumpadEnter", "MetaLeft", "F1", "BrowserBack", "MediaPlayPause"]) {
      expect(getKeyBindingRejectionReason(code)).toMatch(/reserved for menu, browser, or system controls/);
    }
  });
});
