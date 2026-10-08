/**
 * AniList-style progress from the set of episode positions watched in a season.
 * Furthest position N where you'd watched nearly everything up to it: at most max(1, 20% of N) missing.
 * Tolerates a missing history entry or two, but a skip-ahead (watched 1–3 then 13) stays at 3.
 */
export function progressFrom(positions: number[]): number {
  const sorted = [...new Set(positions.filter((p) => p > 0))].sort((a, b) => a - b);
  let progress = 0;
  sorted.forEach((p, i) => {
    const watchedUpTo = i + 1;
    if (watchedUpTo >= p - Math.max(1, Math.floor(p * 0.2))) progress = p;
  });
  return progress;
}
