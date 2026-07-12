export function formatTime(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return "--:--.--";
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const hundredths = Math.floor((milliseconds % 1_000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}
