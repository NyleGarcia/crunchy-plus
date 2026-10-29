import type { CREpisode, CREpisodeMeta, CRVersion } from './types';

/**
 * Incremental scan cache. Watch history only grows at the top (newest first), so a rescan fetches
 * pages until it meets an entry it already holds and merges the rest. Season episode lists are
 * stable once a season has finished airing, so they're kept per season and only refetched for
 * seasons that received new plays since they were cached.
 */

/** One watch-history entry, trimmed to what the scraper reads. */
export interface CachedPlay {
  /** Episode id (CR keeps one history entry per episode: its latest play). */
  id: string;
  /** ISO date_played. */
  at: string;
  done: boolean;
  playhead: number;
  ep: CREpisode;
}

export interface CachedSeason {
  at: number;
  episodes: CREpisode[];
}

export interface ScanCache {
  profileId: string;
  /** Newest first, one per episode id. */
  history: CachedPlay[];
  /** Original-audio season id -> its main episodes in order. */
  seasons: Record<string, CachedSeason>;
  /** Watchlist series-panel id -> first episode of its first original season (null = none found). */
  seriesFirstEp: Record<string, CREpisode | null>;
}

export const emptyCache = (profileId: string): ScanCache => ({ profileId, history: [], seasons: {}, seriesFirstEp: {} });

const META_KEYS: (keyof CREpisodeMeta)[] = [
  'series_id', 'series_title', 'series_slug_title', 'season_id', 'season_title', 'season_slug_title',
  'season_number', 'episode_number', 'sequence_number', 'duration_ms', 'audio_locale',
];

/** Keep only the metadata the scraper and matcher read (history panels carry ~2 KB each otherwise). */
export function trimEpisode(ep: CREpisode): CREpisode {
  const m = ep.episode_metadata;
  if (!m) return { id: ep.id, title: ep.title };
  const meta = {} as CREpisodeMeta;
  for (const k of META_KEYS) if (m[k] !== undefined) (meta as any)[k] = m[k];
  const orig = m.versions?.find((v) => v.original);
  if (orig) meta.versions = [{ guid: orig.guid, audio_locale: orig.audio_locale, original: true, season_guid: orig.season_guid } satisfies CRVersion];
  return { id: ep.id, title: ep.title, episode_metadata: meta };
}

export interface PlayLike {
  date_played: string;
  fully_watched: boolean;
  playhead: number;
  panel: CREpisode;
}

export const toPlay = (h: PlayLike): CachedPlay => ({
  id: h.panel.id,
  at: h.date_played,
  done: h.fully_watched,
  playhead: h.playhead,
  ep: trimEpisode(h.panel),
});

/**
 * Stop condition for a rescan: a fetched play at or before the newest cached play is already known (a replay moves
 * an episode's entry to the top with a new date), so nothing past that page is new. Undefined on an empty cache.
 */
export function seenBefore(cached: CachedPlay[]): ((h: PlayLike) => boolean) | undefined {
  const newest = cached.reduce((t, c) => Math.max(t, Date.parse(c.at) || 0), 0);
  return newest ? (h) => (Date.parse(h.date_played) || 0) <= newest : undefined;
}

/**
 * Merge freshly fetched plays (newest first, possibly overlapping the cache) into the cached list.
 * A fetched entry replaces the cached one for the same episode (a rewatch moves it to the top).
 * Returns the merged list and the ids of episodes whose entry is new or changed.
 */
export function mergeHistory(cached: CachedPlay[], fetched: PlayLike[]): { history: CachedPlay[]; changed: Set<string> } {
  const byId = new Map(cached.map((c) => [c.id, c]));
  const changed = new Set<string>();
  for (const h of fetched) {
    if (!h.panel?.id) continue;
    const prev = byId.get(h.panel.id);
    if (prev && prev.at === h.date_played && prev.playhead === h.playhead && prev.done === h.fully_watched) continue;
    byId.set(h.panel.id, toPlay(h));
    changed.add(h.panel.id);
  }
  const history = [...byId.values()].sort((a, b) => b.at.localeCompare(a.at));
  return { history, changed };
}
