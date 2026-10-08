import * as cr from '@/lib/cr-api';
import { progressFrom } from '@/lib/progress';
import { progress, type Scrape, type ScrapedSeason } from '@/lib/messages';
import { seasonKey, type CREpisode } from '@/lib/types';

const WATCHED = 0.8;


interface Group {
  seriesId: string;
  seasonId: string; // original-audio season
  sample: CREpisode;
  watched: CREpisode[];
  lastPlayed: string | null;
  inWatchlist: boolean;
}

/** Scrape CR watch history + watchlist into one row per original-audio season. */
export async function scrape(): Promise<Scrape> {
  progress(0, 'Reading watch history…');
  const history = await cr.watchHistory((n) => progress(n, `Reading watch history… ${n}`));
  console.info('[Crunchy+] history', { profile: await cr.account(), count: history.length,
    sample: history.slice(0, 8).map((h) => h.panel?.episode_metadata?.series_title) });
  progress(history.length, 'Reading watchlist…');
  const watchlist = await cr.watchlist();

  const groups = new Map<string, Group>();
  const group = (ep: CREpisode) => {
    const m = ep.episode_metadata!;
    const seasonId = m.versions?.find((v) => v.original)?.season_guid ?? m.season_id;
    const key = seasonKey(m.series_id, seasonId);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { seriesId: m.series_id, seasonId, sample: ep, watched: [], lastPlayed: null, inWatchlist: false }));
    return g;
  };

  for (const h of history) {
    const m = h.panel?.episode_metadata;
    if (!m) continue;
    const g = group(h.panel);
    const dur = (m.duration_ms ?? 0) / 1000;
    if (h.fully_watched || (dur > 0 && h.playhead >= dur * WATCHED)) g.watched.push(h.panel);
    if (!g.lastPlayed || h.date_played > g.lastPlayed) g.lastPlayed = h.date_played;
  }

  for (const w of watchlist) {
    if (w.panel?.episode_metadata) {
      group(w.panel).inWatchlist = true;
      continue;
    }
    // Series-type panel: attach to its first original-audio season.
    const seriesId = w.panel?.id;
    if (!seriesId) continue;
    try {
      const first = (await cr.seasons(seriesId)).find((s) => s.versions?.find((v) => v.guid === s.id)?.original ?? true);
      if (!first) continue;
      const [ep] = await cr.seasonEpisodes(first.id);
      if (ep?.episode_metadata) group(ep).inWatchlist = true;
    } catch {}
  }

  // Resolve each season's episode order so progress = AniList-style position.
  const all = [...groups.values()];
  const rows: ScrapedSeason[] = [];
  let i = 0;
  const worker = async () => {
    for (let g = all[i++]; g; g = all[i++]) {
      progress(rows.length, `Resolving seasons… ${rows.length}/${all.length}`);
      let eps: CREpisode[] = [];
      try {
        eps = (await cr.originalSeason(g.seasonId)).episodes;
      } catch {}
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
  rows.sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''));
  progress(rows.length, 'Done');
  return { historyCount: history.length, watchlistCount: watchlist.length, seasons: rows };
}
