export function firstConnectedGamepad(): Gamepad | null {
  const pads = navigator.getGamepads?.();
  if (!pads) return null;
  for (const pad of pads) {
    if (pad?.connected) return pad;
  }
  return null;
}
