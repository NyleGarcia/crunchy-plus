/**
 * AniList → Crunchyroll: map AniList entries to CR series, build "up next", and plan/apply the
 * watchlist + Crunchylist export. Runs in the crunchyroll.com content script (holds the CR session).
 */
import * as cr from '@/lib/cr-api';
import { audioInfo, isOriginal } from '@/lib/dub';
import { normalize, similarity } from '@/lib/matcher';
import {
  sortUpNext,
  bg,
  progress,
  type ExportPlan,
  type ExportResult,
  type ListPlan,
  type ShowRef,
  type UpNextItem,
} from '@/lib/messages';
import { crSeasonsItem, crSeriesItem, crSeriesMetaItem, getSettings, matchesItem } from '@/lib/settings';
import { STATUS_LABEL, type AniListItem, type CRSeason, type ListStatus, type SeasonInfo } from '@/lib/types';

const LIST_PREFIX = 'AniList · ';
const SEARCH_ACCEPT = 0.82;

export const titleOf = (e: AniListItem) => e.media.title.english ?? e.media.title.romaji ?? `#${e.mediaId}`;

/** Strip season/part markers so "Foo Season 2" matches the CR series "Foo". */
export function baseTitle(t: string): string {
  return normalize(t)
    .replace(/\b(season|part|cour)\s*\d+\b/g, '')
    .replace(/\b\d+(st|nd|rd|th)\s+season\b/g, '')
    .replace(/\b(final season|the final chapters?)\b/g, '')
    .replace(/\s+(ii|iii|iv|v|vi)$/g, '')
    .replace(/\s+\d+$/g, '')
    .trim();
}

export function seasonNumberOf(e: AniListItem): number {
  for (const t of [e.media.title.english, e.media.title.romaji, ...(e.media.synonyms ?? [])]) {
    const m = t && normalize(t).match(/\b(?:season|part)\s*(\d+)\b|\b(\d+)(?:st|nd|rd|th)\s+season\b/);
    if (m) return Number(m[1] ?? m[2]);
  }
  return 1;
}

const linkId = (e: AniListItem) =>
  e.media.externalLinks
    ?.filter((l) => l.site === 'Crunchyroll' && l.url)
    .map((l) => l.url!.match(/crunchyroll\.com\/(?:[a-z-]+\/)?series\/([A-Z0-9]+)/i)?.[1])
    .find(Boolean);

async function invertedMatches() {
  const byAni = new Map<number, { seriesId: string; seasonId: string }>();
  for (const [key, id] of Object.entries(await matchesItem.getValue())) {
    const [seriesId, seasonId] = key.split('|');
    if (id && seriesId && seasonId) byAni.set(id, { seriesId, seasonId });
  }
  return byAni;
}

/** Cheap, offline mapping (links + caches only). Used by badges. */
export async function knownSeries(entries: AniListItem[]): Promise<Map<number, string>> {
  const cache = await crSeriesItem.getValue();
  const inv = await invertedMatches();
  const out = new Map<number, string>();
  for (const e of entries) {
    const id = cache[e.mediaId] || linkId(e) || inv.get(e.mediaId)?.seriesId;
    if (id) out.set(e.mediaId, id);
  }
  return out;
}

const MISS_TTL_MS = 30 * 86400e3;
/** Runner-up must trail the best hit by this much, as in the import matcher. */
const SEARCH_MARGIN = 0.05;

export interface SeriesHitLite {
  id: string;
  title: string;
}

/**
 * Pick the CR series for an AniList entry from search hits, or null if unsure.
 * A unique exact (normalized) title match wins outright; otherwise the best score must clear
 * SEARCH_ACCEPT and beat every other series by SEARCH_MARGIN — ties (e.g. "Steins;Gate" vs
 * "Steins;Gate 0", same baseTitle) stay unmapped instead of guessing.
 */
export function pickSeries(hits: SeriesHitLite[], titles: string[]): SeriesHitLite | null {
  const want = titles.map(normalize).filter(Boolean);
  const byId = new Map<string, { hit: SeriesHitLite; score: number; exact: boolean }>();
  for (const hit of hits) {
    if (!hit?.id || !hit.title) continue;
    const exact = want.includes(normalize(hit.title));
    const score = Math.max(...titles.map((t) => Math.max(similarity(baseTitle(hit.title), baseTitle(t)), similarity(hit.title, t))));
    const prev = byId.get(hit.id);
    byId.set(hit.id, { hit: prev?.hit ?? hit, score: Math.max(score, prev?.score ?? 0), exact: exact || !!prev?.exact });
  }
  const all = [...byId.values()];
  const exacts = all.filter((c) => c.exact);
  if (exacts.length === 1) return exacts[0]!.hit;
  if (exacts.length > 1) return null;
  all.sort((a, b) => b.score - a.score);
  const [top, second] = all;
  if (!top || top.score < SEARCH_ACCEPT) return null;
  if (second && second.score > top.score - SEARCH_MARGIN) return null;
  return top.hit;
}

/** Map entries to CR series ids, searching Crunchyroll for the ones links/caches don't cover. */
export async function mapSeries(entries: AniListItem[]): Promise<Map<number, string | null>> {
  const meta = await crSeriesMetaItem.getValue();
  const known = await knownSeries(entries);
  const out = new Map<number, string | null>();
  const todo: AniListItem[] = [];
  const now = Date.now();
  for (const e of entries) {
    const missAt = meta[e.mediaId]?.missAt;
    if (known.has(e.mediaId)) out.set(e.mediaId, known.get(e.mediaId)!);
    else if (missAt && now - missAt < MISS_TTL_MS) out.set(e.mediaId, null);
    else todo.push(e); // never searched, legacy '' miss, or miss older than the TTL (CR may have added it)
  }
  const learned: Record<number, string> = {};
  const learnedMeta: Record<number, { title?: string; missAt?: number }> = {};
  let i = 0;
  let done = 0;
  let sessionErr: unknown = null;
  const worker = async () => {
    for (let e = todo[i++]; e && !sessionErr; e = todo[i++]) {
      progress(done, `Finding shows on Crunchyroll… ${done}/${todo.length}`);
      const titles = [e.media.title.english, e.media.title.romaji].filter((t): t is string => !!t);
      const hits: SeriesHitLite[] = [];
      let failed = false;
      for (const t of titles) {
        try {
          const r = await cr.searchSeries(baseTitle(t) || t);
          if (Array.isArray(r)) hits.push(...r);
        } catch (err) {
          failed = true; // transient (429, network, expired session): don't learn anything from this entry
          if (err instanceof cr.CRSessionError) sessionErr = err;
        }
        const exact = hits.filter((h) => titles.some((x) => normalize(x) === normalize(h.title ?? '')));
        if (exact.length === 1) break;
      }
      const pick = pickSeries(hits, titles);
      out.set(e.mediaId, pick?.id ?? null);
      if (pick) {
        learned[e.mediaId] = pick.id;
        learnedMeta[e.mediaId] = { title: pick.title };
      } else if (!failed && titles.length) {
        learnedMeta[e.mediaId] = { missAt: now }; // every search answered, no safe pick: re-check after MISS_TTL_MS
      }
      done++;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (Object.keys(learned).length) await crSeriesItem.setValue({ ...(await crSeriesItem.getValue()), ...learned });
  if (Object.keys(learnedMeta).length) await crSeriesMetaItem.setValue({ ...(await crSeriesMetaItem.getValue()), ...learnedMeta });
  if (sessionErr) throw sessionErr;
  return out;
}

const originalSeasons = (seasons: CRSeason[]) =>
  seasons.filter((s) => {
    const info = audioInfo(s);
    return info ? isOriginal(info) : true;
  });

/** The original-audio CR season an AniList entry corresponds to. */
async function seasonFor(seriesId: string, e: AniListItem, inv: Awaited<ReturnType<typeof invertedMatches>>) {
  const exact = inv.get(e.mediaId);
  if (exact?.seriesId === seriesId) return exact.seasonId;
  const seasons = originalSeasons(await cr.seasons(seriesId)).sort((a, b) => a.season_number - b.season_number);
  if (seasons.length <= 1) return seasons[0]?.id ?? null;
  const n = seasonNumberOf(e);
  const byNumber = seasons.find((s) => s.season_number === n);
  if (byNumber) return byNumber.id;
  const titles = [e.media.title.english, e.media.title.romaji].filter((t): t is string => !!t);
  return seasons
    .map((s) => ({ s, score: Math.max(...titles.map((t) => similarity(s.title, t))) }))
    .sort((a, b) => b.score - a.score)[0]!.s.id;
}

export async function upNext(): Promise<UpNextItem[]> {
  progress(0, 'Loading AniList…');
  const all = await bg({ type: 'anilist:listFull' });
  const watching = all.filter((e) => e.status === 'CURRENT' || e.status === 'REPEATING');
  const series = await mapSeries(watching);
  const inv = await invertedMatches();
  const played = await cr.recentlyPlayed().catch(() => new Map<string, number>());
  const out: UpNextItem[] = [];
  let i = 0;
  const worker = async () => {
    for (let e = watching[i++]; e; e = watching[i++]) {
      progress(out.length, `Checking episodes… ${out.length}/${watching.length}`);
      const seriesId = series.get(e.mediaId) ?? null;
      const item: UpNextItem = {
        aniId: e.mediaId,
        title: titleOf(e),
        // Large poster (~460px): the row shows covers at ~190px wide, so medium (~100px) looks blurry.
        cover: e.media.coverImage.extraLarge ?? e.media.coverImage.large ?? e.media.coverImage.medium,
        status: e.status,
        progress: e.progress,
        total: e.media.episodes,
        seriesId,
        nextEpisode: null,
        available: null,
        airing: e.media.nextAiringEpisode,
        updatedAt: e.updatedAt,
        lastWatched: (seriesId && played.get(seriesId)) || null,
        popularity: e.media.popularity ?? null,
      };
      if (seriesId) {
        try {
          const seasonId = await seasonFor(seriesId, e, inv);
          if (seasonId) {
            const { episodes } = await cr.originalSeason(seasonId);
            item.available = Math.max(0, episodes.length - e.progress);
            const next = episodes[e.progress];
            if (next)
              item.nextEpisode = {
                id: next.id,
                title: next.title,
                number: next.episode_metadata?.episode_number ?? null,
                url: `https://www.crunchyroll.com/watch/${next.id}`,
              };
          }
        } catch (err) {
          item.error = (err as Error).message;
        }
      }
      out.push(item);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  // Ready-to-watch first, then most recently touched on AniList.
  return sortUpNext(out, 'recent');
}

/** Read-only preview. `fresh` refetches the AniList list (skip it for the periodic reminder). */
export async function exportPlan(opts: { fresh?: boolean } = {}): Promise<ExportPlan> {
  const s = await getSettings();
  progress(0, 'Loading AniList…');
  const all = await bg({ type: 'anilist:listFull', fresh: opts.fresh ?? true });
  const wanted = new Set<ListStatus>([...s.exportWatchlist, ...s.exportLists]);
  const relevant = (Array.isArray(all) ? all : []).filter((e) => wanted.has(e.status));
  const series = await mapSeries(relevant);
  const meta = await crSeriesMetaItem.getValue();
  const ref = (e: AniListItem): ShowRef | null => {
    const id = series.get(e.mediaId);
    // crTitle = the CR series a title search picked, so the preview shows what will actually be added.
    return id ? { aniId: e.mediaId, title: titleOf(e), seriesId: id, crTitle: meta[e.mediaId]?.title ?? null } : null;
  };
  const warnings: string[] = [];

  // Watchlist: add-only (it's the user's own list; never remove from it).
  progress(0, 'Reading your Crunchyroll watchlist…');
  const onWatchlist = s.exportWatchlist.length ? await cr.watchlistSeriesIds() : new Set<string>();
  const watchlistAdd = dedupe(
    relevant.filter((e) => s.exportWatchlist.includes(e.status)).map(ref).filter((r): r is ShowRef => !!r),
  ).filter((r) => !onWatchlist.has(r.seriesId));

  // Crunchylists: one extension-owned list per status.
  progress(0, 'Reading your Crunchylists…');
  const { lists: existing, maxLists, used } = s.exportLists.length ? await cr.crunchylists() : { lists: [], maxLists: 0, used: 0 };
  let slots = maxLists - used;
  const lists: ListPlan[] = [];
  for (const status of s.exportLists) {
    const title = LIST_PREFIX + STATUS_LABEL[status];
    const list = existing.find((l) => l.title === title) ?? null;
    if (!list && slots <= 0) {
      warnings.push(`No room for a new Crunchylist “${title}” (Crunchyroll allows ${maxLists}).`);
      continue;
    }
    if (!list) slots--;
    const { items, max } = list ? await cr.crunchylistItems(list.list_id) : { items: [], max: 100 };
    const want = dedupe(
      relevant
        .filter((e) => e.status === status)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(ref)
        .filter((r): r is ShowRef => !!r),
    );
    const wantIds = new Set(want.map((w) => w.seriesId));
    const have = new Set(items.map((it) => it.panel?.id));
    const remove = s.mirrorLists
      ? items.filter((it) => !wantIds.has(it.panel?.id)).map((it) => ({ entryId: it.id, title: it.panel?.title ?? it.id }))
      : [];
    const room = max - (items.length - remove.length);
    const missing = want.filter((w) => !have.has(w.seriesId));
    lists.push({ status, title, listId: list?.list_id ?? null, add: missing.slice(0, Math.max(0, room)), remove, overflow: Math.max(0, missing.length - room) });
    if (missing.length > room) warnings.push(`“${title}” is capped at ${max} shows — ${missing.length - room} most stale left out.`);
  }

  const unmapped = relevant.filter((e) => !series.get(e.mediaId)).map((e) => ({ aniId: e.mediaId, title: titleOf(e) }));
  return { watchlistAdd, lists, unmapped, warnings };
}

function dedupe(refs: ShowRef[]): ShowRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => !seen.has(r.seriesId) && seen.add(r.seriesId));
}

export async function exportApply(plan: ExportPlan): Promise<ExportResult> {
  const result: ExportResult = { done: 0, failed: [] };
  const total = plan.watchlistAdd.length + plan.lists.reduce((n, l) => n + l.add.length + l.remove.length, 0);
  let sessionLost = false;
  const step = async (what: string, fn: () => Promise<unknown>) => {
    progress(result.done, `Updating Crunchyroll… ${result.done + result.failed.length}/${total}`);
    if (sessionLost) return;
    try {
      await fn();
      result.done++;
    } catch (e) {
      result.failed.push({ what, error: (e as Error).message });
      if (e instanceof cr.CRSessionError) sessionLost = true; // stop: every later write would fail the same way
    }
  };
  for (const r of plan.watchlistAdd) await step(`Watchlist + ${r.title}`, () => cr.watchlistAdd(r.seriesId));
  for (const l of plan.lists) {
    if (sessionLost) break;
    let listId = l.listId;
    if (!listId && l.add.length) {
      try {
        listId = await cr.crunchylistCreate(l.title);
      } catch (e) {
        result.failed.push({ what: `Create ${l.title}`, error: (e as Error).message });
        if (e instanceof cr.CRSessionError) break;
        continue;
      }
    }
    if (!listId) continue;
    for (const r of l.remove) await step(`${l.title} − ${r.title}`, () => cr.crunchylistRemove(listId!, r.entryId));
    for (const r of l.add) await step(`${l.title} + ${r.title}`, () => cr.crunchylistAdd(listId!, r.seriesId));
  }
  return result;
}

const SEASONS_TTL = 6 * 3600e3;
let loggedSeasonShape = false;
/** Last failure reason from `seriesSeasons` (for the hide-completed console summary). */
export let lastSeasonsError = '';

/**
 * Original-audio seasons of a CR series with how many episodes are out (dub versions and
 * specials never count). One CR request per season; cached 6 h. null = couldn't check.
 */
export async function seriesSeasons(seriesId: string): Promise<SeasonInfo[] | null> {
  const hit = (await crSeasonsItem.getValue())[seriesId];
  if (hit && Date.now() - hit.at < SEASONS_TTL) return hit.seasons;
  try {
    const raw = await cr.seasons(seriesId);
    let seasons = originalSeasons(raw);
    if (!seasons.length && raw.length) {
      // The original-audio filter removed everything — CR described audio differently. Don't fail closed.
      // Log the shape once (plain text) so a CR format change is diagnosable without stack spam.
      if (!loggedSeasonShape) {
        loggedSeasonShape = true;
        const s0 = raw[0]!;
        const own = s0.versions?.find((v) => v.guid === s0.id);
        console.info(
          '[Crunchy+] season audio fields:',
          JSON.stringify({
            title: s0.title,
            audio_locale: s0.audio_locale,
            audio_locales: (s0 as unknown as { audio_locales?: string[] }).audio_locales,
            versions: s0.versions?.length ?? null,
            ownVersion: own ?? null,
            firstVersion: s0.versions?.[0] ?? null,
          }),
        );
      }
      seasons = raw;
    }
    if (!raw.length) {
      lastSeasonsError = 'Crunchyroll returned no seasons';
      return null;
    }
    seasons = [...seasons].sort((a, b) => a.season_number - b.season_number);
    const out: SeasonInfo[] = [];
    for (const s of seasons) {
      const now = Date.now();
      const eps = (await cr.seasonEpisodes(s.id)).filter((ep) => {
        const m = ep.episode_metadata;
        const info = audioInfo(ep);
        if (m?.episode_number == null || (info && !isOriginal(info))) return false;
        const t = Date.parse(m.premium_available_date ?? m.episode_air_date ?? '');
        return !(t > now); // unknown date counts as out (it's listed)
      });
      out.push({
        id: s.id,
        number: s.season_number,
        out: new Set(eps.map((e) => e.episode_metadata!.episode_number)).size,
        title: s.title,
        main: isMainSeason(s),
      });
    }
    await crSeasonsItem.setValue({ ...(await crSeasonsItem.getValue()), [seriesId]: { at: Date.now(), seasons: out } });
    return out;
  } catch (e) {
    lastSeasonsError = e instanceof Error ? e.message : String(e);
    console.warn('[Crunchy+] season check failed for', seriesId, '—', lastSeasonsError);
    return null;
  }
}

/** CR lists OVAs, specials, movies and recaps as "seasons" too — often with high numbers. */
const EXTRA_SEASON = /\b(ova|oad|ona special|specials?|movies?|film|recap|picture drama|shorts?|mini|extra|bonus)\b/i;
export function isMainSeason(s: { title: string; season_display_number?: string }): boolean {
  if (EXTRA_SEASON.test(s.title)) return false;
  // Many series leave the display number empty for non-numbered extras.
  return s.season_display_number !== '' ;
}

/** Which CR season an AniList entry is: exact import match → season number in its title (main seasons) → last main season. */
export async function seasonOf(e: AniListItem, seriesId: string, seasons: SeasonInfo[]): Promise<SeasonInfo | undefined> {
  const exact = (await invertedMatches()).get(e.mediaId);
  if (exact?.seriesId === seriesId) {
    const s = seasons.find((x) => x.id === exact.seasonId);
    if (s) return s;
  }
  // AniList OVA/special entries map to CR extras; everything else to main seasons.
  const extra = !['TV', 'TV_SHORT', 'ONA'].includes(e.media.format ?? 'TV');
  const pool = seasons.filter((x) => (x.main ?? true) !== extra);
  const list = pool.length ? pool : seasons;
  const n = seasonNumberOf(e);
  return list.find((x) => x.number === n) ?? (n === 1 ? list[0] : list[list.length - 1]);
}
