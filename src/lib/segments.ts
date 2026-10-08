/**
 * One Crunchyroll season ↔ several AniList entries (and the reverse).
 *
 * A Segment maps a run of CR episode positions onto an AniList entry:
 *   CR positions [crFrom, crFrom + count - 1]  →  AniList episodes [aniOffset + 1, aniOffset + count]
 *
 *  - CR "Season 1" (24 eps) = AniList Part 1 (12) + Part 2 (12):
 *      [{A, crFrom: 1, count: 12, aniOffset: 0}, {B, crFrom: 13, count: 12, aniOffset: 0}]
 *  - CR "Season 2" (12 eps) continues one 24-ep AniList entry:
 *      [{X, crFrom: 1, count: 12, aniOffset: 12}]
 */
export interface Segment {
  mediaId: number;
  /** First CR position (1-based) covered by this entry. */
  crFrom: number;
  /** CR positions covered; null = open-ended (last segment, airing). */
  count: number | null;
  /** AniList episode number just before crFrom (0 unless a CR season continues an entry). */
  aniOffset: number;
}

/**
 * AniList progress per entry for "watched up to CR position p". Only entries that p has reached
 * are returned, so watching Part 1 never creates a Part 2 entry.
 */
export function progressBySegment(segs: Segment[], p: number): { mediaId: number; progress: number }[] {
  return segs
    .filter((s) => p >= s.crFrom)
    .map((s) => {
      const within = p - s.crFrom + 1;
      return { mediaId: s.mediaId, progress: s.aniOffset + (s.count == null ? within : Math.min(within, s.count)) };
    });
}

/** The segment that contains CR position p (for showing "the" entry in the player). */
export function segmentAt(segs: Segment[], p: number): Segment | undefined {
  return [...segs].reverse().find((s) => p >= s.crFrom) ?? segs[0];
}

/**
 * Build split segments for a CR season of `crEpisodes` from consecutive AniList entries
 * (first match + its sequels, in order). Returns null when the episode counts don't line up
 * (sum must reach the CR count within 1, every entry but the last needs a known count).
 */
export function splitSegments(crEpisodes: number, parts: { id: number; episodes: number | null }[]): Segment[] | null {
  if (parts.length < 2) return null;
  const segs: Segment[] = [];
  let from = 1;
  for (const [i, part] of parts.entries()) {
    const last = i === parts.length - 1;
    if (!last && !part.episodes) return null;
    segs.push({ mediaId: part.id, crFrom: from, count: last ? part.episodes : part.episodes, aniOffset: 0 });
    from += part.episodes ?? 0;
  }
  const known = parts.reduce((n, p) => n + (p.episodes ?? 0), 0);
  const lastOpen = parts[parts.length - 1]!.episodes == null;
  // Fits when the parts add up to the CR season (±1 for a recap/special), or the last part is still airing.
  const fits = Math.abs(known - crEpisodes) <= 1 || (lastOpen && known < crEpisodes);
  return fits ? segs : null;
}

/** Simple 1:1 mapping, optionally offset (CR season continues an AniList entry). */
export const single = (mediaId: number, aniOffset = 0): Segment[] => [{ mediaId, crFrom: 1, count: null, aniOffset }];
