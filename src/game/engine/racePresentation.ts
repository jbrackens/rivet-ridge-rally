const NARROW_RACE_PRESENTATION_WIDTH = 680;
const RIDER_CRASH_ROLL = -1.05;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function usesPortraitRacePresentation(width: number, height: number): boolean {
  return height > width || width < NARROW_RACE_PRESENTATION_WIDTH;
}

export function resolveRiderSpeedTuck(
  speed: number,
  crashed: boolean,
  reducedMotion: boolean,
): number {
  if (crashed || reducedMotion) return 0;
  return -0.055 * clamp(speed / 22, 0, 1);
}

export function resolveRiderSteeringRoll(
  targetLanePosition: number,
  lanePosition: number,
  crashed: boolean,
  reducedMotion: boolean,
): number {
  if (crashed) return RIDER_CRASH_ROLL;
  if (reducedMotion) return 0;
  return clamp((targetLanePosition - lanePosition) * -0.12, -0.17, 0.17);
}
