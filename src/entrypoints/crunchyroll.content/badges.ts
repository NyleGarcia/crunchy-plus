/**
 * AniList status pills on Crunchyroll cards, and "hide completed".
 *
 * Pill: "Watching 5 of 8 out (12)" — your AniList progress of the original-audio episodes out on CR
 * for that season, with AniList's season total in brackets (omitted while unknown/airing). An orange pill appears only for unwatched content:
 * "3 to watch" (aired past your progress) or, on completed shows, "New season".
 *
 * Mapping is offline (AniList links, import matches, export cache) — browsing never triggers
 * searches. The one network call is `seriesSeasons` per series on screen (cached 6 h, 2 at a time).
 *
 * Card shapes (logged-in CR, 2026-10; class names carry a 5-char hash suffix):
 *  - series:  [class*="browse-card--"]   → poster [class*="browse-card__poster-wrapper--"]
 *  - episode: [class*="playable-card--"] → thumb  [class*="playable-card__thumbnail-wrapper--"],
 *             series via a[data-t="series-title"]
 *  - carousel slot: [data-t="carousel-card-wrapper"]; continue-watching slot: .collection-item (unhashed)
 */
import { bg } from '@/lib/messages';
import { getSettings } from '@/lib/settings';
import { STATUS_LABEL, type AniListItem, type ListStatus, type SeasonInfo } from '@/lib/types';
import { crSeriesItem } from '@/lib/settings';
import { baseTitle, knownSeries, lastSeasonsError, seasonNumberOf, seasonOf, seriesSeasons } from './reverse';

const PRIORITY: ListStatus[] = ['CURRENT', 'REPEATING', 'PAUSED', 'PLANNING', 'COMPLETED', 'DROPPED'];
const COLOR: Record<ListStatus, string> = {
  CURRENT: '#3ddc97',
  REPEATING: '#3ddc97',
  PLANNING: '#7aa2ff',
  COMPLETED: '#c792ea',
  PAUSED: '#ffb454',
  DROPPED: '#ff5470',
};
/** Progress state once CR's episode count is known (watching-type statuses). */
const PROGRESS_COLOR = {
  behind: '#3ddc97', // episodes out you haven't watched
  airing: '#4fd1c5', // caught up, waiting for the next episode
  finished: '#ffd166', // caught up and the season is over — likely ready to mark Completed
};
const BADGE = 'data-crunchyplus-badge';
const HIDDEN = 'data-crunchyplus-hidden';
const DONE = 'data-crunchyplus-seen';

interface SeriesState {
  /** Most actionable entry; among equals, the latest season. Drives the pill. */
  best: AniListItem;
  entries: AniListItem[];
  /** Every AniList entry mapped to this CR series is COMPLETED. */
  allCompleted: boolean;
}

/** What CR has beyond your AniList progress, for the best entry's season. */
interface Fresh {
  /** Debug: CR seasons and which one the best entry matched. */
  debug: string;
  out: number | null;
  /** Original episodes out past your progress in that season. */
  newEps: number;
  /** A later original CR season than any of your entries. */
  newSeason: boolean;
}

let index = new Map<string, SeriesState>();
/** Fallback mapping: base title (season markers stripped) → AniList entries with that title. */
let byTitle = new Map<string, AniListItem[]>();
/** Title-matched mappings to persist (AniList id → CR series id), flushed in batches. */
let learned: Record<number, string> = {};
let flushTimer = 0;
/** Hide-completed decisions for the console summary (seriesId → outcome). */
const decisions = new Map<string, { title: string; outcome: 'hidden' | 'shown'; why: string }>();
let reportTimer = 0;
function record(id: string, title: string, outcome: 'hidden' | 'shown', why: string) {
  decisions.set(id, { title, outcome, why });
  clearTimeout(reportTimer);
  reportTimer = window.setTimeout(() => {
    const all = [...decisions.values()];
    const shown = all.filter((d) => d.outcome === 'shown');
    // Plain text (not an Object) so it survives copy/paste.
    console.info(
      `[Crunchy+] hide completed: ${all.length - shown.length} hidden, ${shown.length} shown` +
        shown.map((d) => `\n  • ${d.title} — ${d.why}`).join(''),
    );
  }, 1500);
}
let observer: MutationObserver | null = null;
let hideCompleted = false;
let showBadges = true;
const freshCache = new Map<string, Promise<Fresh | null>>();
let inFlight = 0;
const queue: (() => void)[] = [];

const later = (a: AniListItem, b: AniListItem) =>
  seasonNumberOf(a) - seasonNumberOf(b) || (a.completedAt?.year ?? 0) - (b.completedAt?.year ?? 0) || a.updatedAt - b.updatedAt;

export async function startBadges() {
  const s = await getSettings();
  hideCompleted = s.hideCompleted;
  showBadges = s.badges;
  const entries = await bg({ type: 'anilist:listFull' });
  const series = await knownSeries(entries);
  const grouped = new Map<string, AniListItem[]>();
  for (const e of entries) {
    const id = series.get(e.mediaId);
    if (id) grouped.set(id, [...(grouped.get(id) ?? []), e]);
  }
  index = new Map([...grouped].map(([id, list]) => [id, stateOf(list)]));
  byTitle = new Map();
  for (const e of entries) {
    for (const t of new Set([e.media.title.english, e.media.title.romaji].filter((x): x is string => !!x).map(baseTitle))) {
      if (t) byTitle.set(t, [...(byTitle.get(t) ?? []), e]);
    }
  }
  freshCache.clear();
  reset();
  paint();
  if (!observer) {
    let timer = 0;
    observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(paint, 250);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

export function stopBadges() {
  observer?.disconnect();
  observer = null;
  reset();
}

function stateOf(list: AniListItem[]): SeriesState {
  let best = list[0]!;
  for (const e of list.slice(1)) {
    const pe = PRIORITY.indexOf(e.status);
    const pb = PRIORITY.indexOf(best.status);
    if (pe < pb || (pe === pb && later(e, best) > 0)) best = e;
  }
  return { best, entries: list, allCompleted: list.every((e) => e.status === 'COMPLETED') };
}

/**
 * Offline fallback for cards with no known mapping: exact match of the card's title against your
 * AniList titles after stripping season/part markers. Learned matches are saved for Up next/export.
 */
function stateByTitle(card: HTMLElement, id: string): SeriesState | undefined {
  const title = card.querySelector(
    '[class*="browse-card__title--"], [class*="playable-card__show-title--"], a[data-t="series-title"]',
  )?.textContent;
  const key = title ? baseTitle(title) : '';
  const list = key ? byTitle.get(key) : undefined;
  if (!list?.length) return undefined;
  const state = stateOf(list);
  index.set(id, state);
  for (const e of list) learned[e.mediaId] ??= id;
  clearTimeout(flushTimer);
  flushTimer = window.setTimeout(async () => {
    const add = learned;
    learned = {};
    const cur = await crSeriesItem.getValue();
    // Never overwrite a mapping that came from a link, import, or search.
    const fresh = Object.fromEntries(Object.entries(add).filter(([k]) => !cur[Number(k)]));
    if (Object.keys(fresh).length) await crSeriesItem.setValue({ ...cur, ...fresh });
  }, 2000);
  return state;
}

function reset() {
  document.querySelectorAll(`[${BADGE}]`).forEach((el) => el.remove());
  document.querySelectorAll(`[${HIDDEN}]`).forEach((el) => el.removeAttribute(HIDDEN));
  document.querySelectorAll(`[${DONE}]`).forEach((el) => el.removeAttribute(DONE));
}

const seriesIdOf = (card: Element) =>
  card
    .querySelector<HTMLAnchorElement>('a[href*="/series/"]')
    ?.getAttribute('href')
    ?.match(/\/series\/([A-Z0-9]+)/i)?.[1];

function paint() {
  if (!index.size && !byTitle.size) return;
  // On a series page every episode card belongs to the show you opened; CR already marks them
  // "Watched", and show-level AniList state would mislabel individual episodes.
  const onSeriesPage = /\/series\//.test(location.pathname);
  const cards = document.querySelectorAll<HTMLElement>(
    `[class*="browse-card--"]:not([${DONE}]), [class*="playable-card--"]:not([${DONE}])`,
  );
  for (const card of cards) {
    if (card.closest('header, nav, [data-t="header-default"]')) continue;
    card.setAttribute(DONE, '');
    const isEpisode = /playable-card--/.test(card.className);
    if (isEpisode && onSeriesPage) continue;
    const id = seriesIdOf(card);
    const state = id ? (index.get(id) ?? stateByTitle(card, id)) : undefined;
    if (!id || !state) continue;
    const art = card.querySelector<HTMLElement>(
      '[class*="browse-card__poster-wrapper--"], [class*="playable-card__thumbnail-wrapper--"]',
    );
    if (!art) continue;
    if (getComputedStyle(art).position === 'static') art.style.position = 'relative';
    const pill = showBadges ? statusPill(state.best) : null;
    if (pill) art.append(pill);

    const hide = hideCompleted && state.allCompleted;
    const slot = card.closest<HTMLElement>('[data-t="carousel-card-wrapper"], .collection-item, [class*="collection-item--"]') ?? card;
    if (hide) slot.setAttribute(HIDDEN, 'completed');
    if (!pill && !hide) continue;

    const name = state.best.media.title.english ?? state.best.media.title.romaji ?? id;
    freshness(id, state).then((f) => {
      // Unknown (check failed) → never keep something hidden we couldn't verify.
      if (hide) {
        const why = !f
          ? `Crunchyroll check failed: ${lastSeasonsError || 'unknown'}`
          : f.newSeason
            ? `new season on CR [${f.debug}]`
            : f.newEps > 0
              ? `${f.newEps} episodes past your progress [${f.debug}]`
              : '';
        if (why) slot.removeAttribute(HIDDEN);
        record(id, name, why ? 'shown' : 'hidden', why);
      }
      if (!f || !pill) return;
      if (f.out != null && state.best.status !== 'COMPLETED' && state.best.status !== 'PLANNING') {
        const b = state.best;
        const total = b.media.episodes;
        pill.textContent = `${STATUS_LABEL[b.status]} ${b.progress} of ${f.out} out (${total ?? '?'})`;
        const airing = b.media.status === 'RELEASING' || b.media.status === 'NOT_YET_RELEASED' || !total || f.out < total;
        const phase = f.newEps > 0 ? 'behind' : airing ? 'airing' : 'finished';
        // Paused/Dropped keep their own colour; the progress colours describe active watching.
        if (b.status === 'CURRENT' || b.status === 'REPEATING') pill.style.background = PROGRESS_COLOR[phase];
        const next = b.media.nextAiringEpisode;
        const hint =
          phase === 'behind'
            ? `${f.newEps} out you haven't watched`
            : phase === 'airing'
              ? `caught up${next ? ` · ep ${next.episode} airs ${relTime(next.airingAt * 1000)}` : ' · waiting for the next episode'}`
              : 'caught up · season finished airing — mark it Completed?';
        pill.title = `AniList: ${b.progress} watched · Crunchyroll: ${f.out} out · ${total ? `${total} in the season` : 'season length unknown'}\n${hint}`;
      }
      // Episode cards are single episodes: show-level "to watch" pills would mislabel them.
      if (isEpisode || state.best.status === 'PLANNING') return;
      if (state.best.status === 'COMPLETED' && f.newSeason) art.append(extraPill('New season'));
      else if (f.newEps > 0) art.append(extraPill(`${f.newEps} to watch`));
    });
  }
}

function freshness(id: string, state: SeriesState): Promise<Fresh | null> {
  let p = freshCache.get(id);
  if (!p) {
    p = limited(async () => {
      const seasons = await seriesSeasons(id);
      if (!seasons?.length) {
        if (seasons) console.warn('[Crunchy+] no seasons with episodes for', id);
        return null;
      }
      const mine: SeasonInfo[] = [];
      for (const e of state.entries) {
        const s = await seasonOf(e, id, seasons);
        if (s) mine.push(s);
      }
      const bestSeason = await seasonOf(state.best, id, seasons);
      const out = bestSeason?.out ?? null;
      const top = Math.max(0, ...mine.map((s) => s.number));
      const fmt = (s: SeasonInfo) => `S${s.number}${s.main === false ? '(extra)' : ''} "${s.title ?? s.id}" ${s.out} out`;
      return {
        debug: `AniList ${state.best.progress}/${state.best.media.episodes ?? '?'} ↔ ${bestSeason ? fmt(bestSeason) : 'no season'}; yours: ${mine.map((s) => 'S' + s.number).join(',') || '-'}; CR: ${seasons.map(fmt).join(' | ')}`,
        out,
        newEps: out != null ? Math.max(0, out - state.best.progress) : 0,
        // Only a later *main* season counts — OVAs/specials/movies listed as seasons don't.
        newSeason: seasons.some((s) => (s.main ?? true) && s.number > top && s.out > 0),
      };
    });
    freshCache.set(id, p);
  }
  return p;
}

function limited<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      inFlight++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          inFlight--;
          queue.shift()?.();
        });
    };
    if (inFlight < 2) run();
    else queue.push(run);
  });
}

const PILL = {
  position: 'absolute',
  left: '8px',
  zIndex: '5',
  padding: '3px 8px',
  borderRadius: '999px',
  font: '600 11px/1.3 system-ui, sans-serif',
  letterSpacing: '0.02em',
  color: '#0b0c10',
  boxShadow: '0 4px 14px -6px rgb(0 0 0 / 0.8)',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
} satisfies Partial<CSSStyleDeclaration>;

/** "Watching 5/12" (bottom-left: CR uses top-left for Sub/Dub tags, top-right for the watchlist mark). */
function statusPill(e: AniListItem): HTMLElement {
  const el = document.createElement('span');
  el.setAttribute(BADGE, '');
  const total = e.media.episodes;
  el.textContent =
    e.status === 'PLANNING'
      ? STATUS_LABEL.PLANNING
      : e.status === 'COMPLETED'
        ? `${STATUS_LABEL.COMPLETED} ${total ?? e.progress}/${total ?? e.progress}`
        : `${STATUS_LABEL[e.status]} ${e.progress}/${total ?? '?'}`;
  el.title = 'AniList: your progress / total episodes';
  Object.assign(el.style, PILL, { bottom: '8px', background: COLOR[e.status] });
  return el;
}

function extraPill(text: string): HTMLElement {
  const el = document.createElement('span');
  el.setAttribute(BADGE, '');
  el.textContent = text;
  el.title = 'Original-audio episodes on Crunchyroll you have not watched (dubs never count)';
  Object.assign(el.style, PILL, { bottom: '32px', background: '#ff7a1a' });
  return el;
}

function relTime(ms: number) {
  const h = Math.round((ms - Date.now()) / 3600e3);
  if (h <= 0) return 'soon';
  return h < 48 ? `in ${h}h` : `in ${Math.round(h / 24)}d`;
}
