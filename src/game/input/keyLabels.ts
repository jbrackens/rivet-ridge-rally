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

export function formatKeyCode(code: string): string {
  const named = NAMED_KEY_LABELS[code];
  if (named) return named;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Numpad ${code.slice(6)}`;
  return code.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}
