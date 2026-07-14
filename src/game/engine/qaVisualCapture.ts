/**
 * Parses the optional, QA-only frozen-race distance used by visual review.
 * Invalid and lap-boundary values are ignored so capture URLs cannot place a
 * rider outside the first production lap.
 */
export function parseQaVisualDistance(
  search: string,
  courseLength: number,
): number | undefined {
  if (!Number.isFinite(courseLength) || courseLength <= 0) return undefined;

  const rawDistance = new URLSearchParams(search).get("qa-visual-distance");
  if (rawDistance === null || rawDistance.trim() === "") return undefined;

  const distance = Number(rawDistance);
  if (!Number.isFinite(distance) || distance < 0 || distance >= courseLength) {
    return undefined;
  }
  return distance;
}
