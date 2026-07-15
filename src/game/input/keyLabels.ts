const NAMED_KEY_LABELS: Readonly<Record<string, string>> = {
  ArrowDown: "↓ Down",
  ArrowLeft: "← Left",
  ArrowRight: "→ Right",
  ArrowUp: "↑ Up",
  Backspace: "Backspace",
  Enter: "Enter",
  Escape: "Esc",
  ShiftLeft: "Left Shift",
  ShiftRight: "Right Shift",
  Space: "Space",
  Tab: "Tab",
};

const RESERVED_GAMEPLAY_KEY_CODES = new Set([
  "CapsLock",
  "ContextMenu",
  "Enter",
  "MetaLeft",
  "MetaRight",
  "NumLock",
  "NumpadEnter",
  "OSLeft",
  "OSRight",
  "Pause",
  "Power",
  "PrintScreen",
  "ScrollLock",
  "Sleep",
  "Tab",
  "WakeUp",
]);
const FUNCTION_KEY_CODE = /^F(?:[1-9]|1\d|2[0-4])$/;
const SYSTEM_KEY_CODE = /^(?:AudioVolume|Browser|Launch|Media)/;

export function formatKeyCode(code: string): string {
  const named = NAMED_KEY_LABELS[code];
  if (named) return named;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Numpad ${code.slice(6)}`;
  return code.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

export function getKeyBindingRejectionReason(code: string): string | null {
  if (!code || code === "Unidentified") {
    return "That key could not be identified. Choose another key.";
  }
  if (
    RESERVED_GAMEPLAY_KEY_CODES.has(code)
    || FUNCTION_KEY_CODE.test(code)
    || SYSTEM_KEY_CODE.test(code)
  ) {
    return `${formatKeyCode(code)} is reserved for menu, browser, or system controls. Choose another key.`;
  }
  return null;
}
