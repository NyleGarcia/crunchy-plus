import * as cr from '@/lib/cr-api';
import { progressFrom } from '@/lib/progress';
import { progress, type Scrape, type ScrapedSeason } from '@/lib/messages';
import { emptyCache, isKnown, knownKeys, mergeHistory, trimEpisode, type CachedPlay, type ScanCache } from '@/lib/scan-cache';
import { scanCacheItem } from '@/lib/settings';
import { seasonKey, type CREpisode } from '@/lib/types';

const WATCHED = 0.8;

interface Group {
  seriesId: string;
  seasonId: string; // original-audio season
  sample: CREpisode;
  watched: CREpisode[];
  lastPlayed: string | null;
  inWatchlist: boolean;
  /** Got a new or changed play this scan (its episode list may have grown — refetch it). */
  fresh: boolean;
}

/**
 * Scrape CR watch history + watchlist into one row per original-audio season.
 * Incremental: history pages are read newest-first until one holds an entry the cache already has;
 * season episode lists are reused unless the season got new plays. `full` ignores the cache.
 */
export async function scrape(opts?: { full?: boolean }): Promise<Scrape> {
  progress(0, 'Checking profile…');
  const profileId = await cr.account();
  const prev = opts?.full ? null : await scanCacheItem.getValue();
  const cache: ScanCache = prev && prev.profileId === profileId ? prev : emptyCache(profileId);
  const keys = knownKeys(cache.history);
  const known = keys.size ? (h: cr.HistoryItem) => isKnown(keys, h) : undefined;

  progress(0, known ? 'Reading new watch history…' : 'Reading watch history…');
  const fetched = await cr.watchHistory((n) => progress(n, `Reading ${known ? 'new ' : ''}watch history… ${n}`), Infinity, known);
  const { history, changed } = mergeHistory(cache.history, fetched);
  console.info('[Crunchy+] history', { profile: profileId, count: history.length, fetched: fetched.length, changed: changed.size,
    sample: history.slice(0, 8).map((h) => h.ep.episode_metadata?.series_title) });
  progress(history.length, 'Reading watchlist…');
  const watchlist = await cr.watchlist();

  const groups = new Map<string, Group>();
  const group = (ep: CREpisode) => {
    const m = ep.episode_metadata!;
    const seasonId = m.versions?.find((v) => v.original)?.season_guid ?? m.season_id;
    const key = seasonKey(m.series_id, seasonId);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { seriesId: m.series_id, seasonId, sample: ep, watched: [], lastPlayed: null, inWatchlist: false, fresh: false }));
    return g;
  };

  for (const h of history) {
    const m = h.ep.episode_metadata;
    if (!m) continue;
    const g = group(h.ep);
    const dur = (m.duration_ms ?? 0) / 1000;
    if (h.done || (dur > 0 && h.playhead >= dur * WATCHED)) g.watched.push(h.ep);
    if (!g.lastPlayed || h.at > g.lastPlayed) g.lastPlayed = h.at;
    if (changed.has(h.id)) g.fresh = true;
  }

  const seriesFirstEp: ScanCache['seriesFirstEp'] = {};
  for (const w of watchlist) {
    if (w.panel?.episode_metadata) {
      group(w.panel).inWatchlist = true;
      continue;
    }
    // Series-type panel: attach to its first original-audio season (cached: it never changes).
    const seriesId = w.panel?.id;
    if (!seriesId) continue;
    let ep = cache.seriesFirstEp[seriesId];
    if (ep === undefined) {
      ep = null;
      try {
        const first = (await cr.seasons(seriesId)).find((s) => s.versions?.find((v) => v.guid === s.id)?.original ?? true);
        const [e] = first ? await cr.seasonEpisodes(first.id) : [];
        if (e?.episode_metadata) ep = trimEpisode(e);
      } catch {}
    }
    seriesFirstEp[seriesId] = ep;
    if (ep?.episode_metadata) group(ep).inWatchlist = true;
  }

  // Resolve each season's episode order so progress = AniList-style position.
  const all = [...groups.values()];
  const seasons: ScanCache['seasons'] = {};
  const rows: ScrapedSeason[] = [];
  let i = 0;
  let fetchedSeasons = 0;
  const worker = async () => {
    for (let g = all[i++]; g; g = all[i++]) {
      progress(rows.length, `Resolving seasons… ${rows.length}/${all.length}`);
      let eps: CREpisode[] = [];
      const hit = cache.seasons[g.seasonId];
      if (hit && !g.fresh) {
        eps = hit.episodes;
        seasons[g.seasonId] = hit;
      } else {
        try {
          eps = (await cr.originalSeason(g.seasonId)).episodes.map(trimEpisode);
          fetchedSeasons++;
          seasons[g.seasonId] = { at: Date.now(), episodes: eps };
        } catch {
          if (hit) {
            eps = hit.episodes;
            seasons[g.seasonId] = hit;
          }
        }
      }
      const pos = g.watched.map((ep) => (eps.length ? cr.positionIn(eps, ep) : Number(ep.episode_metadata!.episode_number) || 0));
      const m = (eps[0] ?? g.sample).episode_metadata!;
      rows.push({
        key: seasonKey(g.seriesId, g.seasonId),
        input: {
          seriesId: g.seriesId,
          seriesTitle: m.series_title,
          seasonTitle: m.season_title,
          seasonNumber: m.season_number,
          seasonEpisodes: eps.length || null,
        },
        progress: progressFrom(pos),
        watchedCount: new Set(pos.filter((p) => p > 0)).size,
        furthest: pos.length ? Math.max(...pos) : 0,
        lastPlayed: g.lastPlayed,
        inWatchlist: g.inWatchlist,
      });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  console.info('[Crunchy+] seasons resolved', { total: all.length, fetched: fetchedSeasons, cached: all.length - fetchedSeasons });
  rows.sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''));

  try {
    await scanCacheItem.setValue({ profileId, history, seasons, seriesFirstEp });
  } catch (e) {
    console.warn('[Crunchy+] scan cache not saved', e);
  }
  progress(rows.length, 'Done');
  return { historyCount: history.length, historyNew: changed.size, watchlistCount: watchlist.length, seasons: rows };
}
