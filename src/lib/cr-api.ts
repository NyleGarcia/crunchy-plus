import type { CREpisode, CRSeason, CRVersion } from './types';

/**
 * Crunchyroll internal API. Runs in the crunchyroll.com content script, authenticated with the
 * bearer token the MAIN-world hook captured from the page's own requests.
 * Endpoints mirror what the web app calls; keep them all here so CR changes are a one-file fix.
 */
const BASE = 'https://www.crunchyroll.com';

let token: string | null = null;
/** The last token CR rejected with 401; cleared when the hook delivers a different one. */
let expiredToken: string | null = null;
const waiters: ((t: string) => void)[] = [];

/** CR rejected the session token and no fresh one arrived. Callers must not cache results on this error. */
export class CRSessionError extends Error {
  constructor() {
    super('Crunchyroll session expired — reload the Crunchyroll tab and retry.');
  }
}

export function setToken(t: string) {
  if (t === expiredToken) return; // the hook re-reporting a token CR already rejected
  if (t !== token) accountId = null; // a new token can mean a profile switch
  token = t;
  expiredToken = null;
  waiters.splice(0).forEach((w) => w(t));
}

function waitToken(timeoutMs: number, onTimeout: () => Error): Promise<string> {
  if (token) return Promise.resolve(token);
  return new Promise((resolve, reject) => {
    const w = (t: string) => {
      clearTimeout(timer);
      resolve(t);
    };
    const timer = setTimeout(() => {
      const i = waiters.indexOf(w);
      if (i >= 0) waiters.splice(i, 1);
      reject(onTimeout());
    }, timeoutMs);
    waiters.push(w);
  });
}

function getToken(timeoutMs = 15000): Promise<string> {
  // Once CR has rejected the session, fail fast instead of stalling every call for the full timeout.
  if (!token && expiredToken) return Promise.reject(new CRSessionError());
  return waitToken(timeoutMs, () => new Error('No Crunchyroll session token yet — are you logged in?'));
}

export class CRError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`Crunchyroll ${status} on ${path}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }
}

type Params = Record<string, string | number | undefined>;

async function cr<T>(path: string, params: Params = {}, init?: { method: string; body?: unknown }): Promise<T> {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  if (!('locale' in params) && !url.searchParams.has('locale')) url.searchParams.set('locale', 'en-US');
  for (let attempt = 0; attempt < 2; attempt++) {
    const used = await getToken();
    const res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${used}`,
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: 'include',
    });
    if (res.status === 401) {
      // Expired. We can't refresh it ourselves; the hook posts a new token only when the page itself
      // refreshes (its own authed request or /auth/v1/token). Give that a short chance, then fail fast.
      if (token === used) {
        token = null;
        expiredToken = used;
      }
      if (attempt === 0) {
        const fresh = await waitToken(3000, () => new CRSessionError()).catch(() => null);
        if (fresh && fresh !== used) continue;
      }
      throw new CRSessionError();
    }
    if (!res.ok) throw new CRError(res.status, url.pathname, await res.text().catch(() => ''));
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }
  throw new CRSessionError();
}

let accountId: Promise<string> | null = null;
let observedPath: string | null = null;

/** Id the page uses in its own per-user URLs — authoritative for the active profile. */
export function setObservedPath(id: string) {
  if (id !== observedPath) accountId = null;
  observedPath = id;
}

function jwtClaim(t: string | null, claim: string): string | undefined {
  try {
    const part = t?.split('.')[1];
    if (!part) return undefined;
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))[claim];
  } catch {
    return undefined;
  }
}

/**
 * The id for per-user URLs (history, watchlist, Crunchylists). On multi-profile accounts this must be
 * the *active profile*, not the account id — otherwise you read another profile's data.
 * Order: what the page itself uses → profile_id in the session token → account id.
 */
export function account(): Promise<string> {
  accountId ??= (async () => {
    if (observedPath) return observedPath;
    const fromJwt = jwtClaim(await getToken(), 'profile_id');
    if (fromJwt) return fromJwt;
    return (await cr<{ account_id: string }>('/accounts/v1/me')).account_id;
  })();
  accountId.catch(() => (accountId = null));
  return accountId;
}

export interface ProfileInfo {
  id: string;
  name: string | null;
  source: 'page' | 'token' | 'account';
  profiles: number;
}

/** Which profile the extension will read/write, for the user to confirm. */
export async function activeProfile(): Promise<ProfileInfo> {
  const id = await account();
  const source = id === observedPath ? 'page' : id === jwtClaim(token, 'profile_id') ? 'token' : 'account';
  try {
    const r = await cr<{ profiles?: { profile_id: string; profile_name: string; is_selected?: boolean }[] }>(
      '/accounts/v1/me/multiprofile',
    );
    const list = r.profiles ?? [];
    const p = list.find((x) => x.profile_id === id) ?? list.find((x) => x.is_selected);
    return { id, name: p?.profile_name ?? null, source, profiles: list.length };
  } catch {
    return { id, name: null, source, profiles: 0 };
  }
}

export async function episode(id: string): Promise<CREpisode> {
  const r = await cr<{ data: CREpisode[] }>(`/content/v2/cms/objects/${id}`);
  const ep = r.data[0];
  if (!ep) throw new Error(`Crunchyroll: episode ${id} not found`);
  return ep;
}

/** Query shapes for the seasons endpoint; some return an empty list without an audio preference. */
const SEASON_VARIANTS: Params[] = [
  {},
  { preferred_audio_language: 'ja-JP' },
  { preferred_audio_language: 'ja-JP', locale: undefined },
  { force_locale: '' },
];
let seasonShape: Params | null = null;

export async function seasons(seriesId: string): Promise<CRSeason[]> {
  const path = `/content/v2/cms/series/${seriesId}/seasons`;
  const tries = seasonShape ? [seasonShape, ...SEASON_VARIANTS.filter((v) => v !== seasonShape)] : SEASON_VARIANTS;
  for (const v of tries) {
    const data = (await cr<{ data?: CRSeason[] }>(path, v)).data;
    if (Array.isArray(data) && data.length) {
      if (seasonShape !== v) console.info('[Crunchy+] seasons query shape:', v);
      seasonShape = v;
      return data;
    }
  }
  return [];
}

export async function seasonEpisodes(seasonId: string): Promise<CREpisode[]> {
  const r = await cr<{ data: (CREpisode & CREpisode['episode_metadata'])[] }>(
    `/content/v2/cms/seasons/${seasonId}/episodes`,
  );
  // This endpoint returns flattened episodes; normalize to {episode_metadata}.
  return r.data.map((e) => ('episode_metadata' in e && e.episode_metadata ? e : { id: e.id, title: e.title, episode_metadata: e as any }));
}

export interface HistoryItem {
  date_played: string;
  fully_watched: boolean;
  playhead: number;
  panel: CREpisode;
}

type Page<T> = { data: T[]; total?: number; next_page?: string | null; meta?: { next_page?: string | null } };

/** Query shapes CR's history endpoint has accepted over time; first one that answers wins. */
const HISTORY_VARIANTS: Params[] = [
  { page_size: 100, page: 1 },
  { page_size: 50, page: 1 },
  { page_size: 100, page: 1, locale: undefined },
  { page_size: 16 },
  {},
];

/** The history query shape that last worked (skips the trial-and-error next time). */
let historyShape: Params | null = null;

/** Watch history, newest first. `max` stops early (e.g. recent activity only). */
export async function watchHistory(onPage?: (n: number) => void, max = Infinity): Promise<HistoryItem[]> {
  const path = `/content/v2/${await account()}/watch-history`;
  let first: Page<HistoryItem> | null = null;
  let shape: Params = {};
  let lastErr: unknown;
  for (const v of historyShape ? [historyShape, ...HISTORY_VARIANTS.filter((x) => x !== historyShape)] : HISTORY_VARIANTS) {
    try {
      first = await cr<Page<HistoryItem>>(path, v);
      shape = v;
      historyShape = v;
      break;
    } catch (e) {
      lastErr = e;
      if (!(e instanceof CRError) || e.status !== 400) throw e;
    }
  }
  if (!first) throw lastErr;
  console.info('[Crunchy+] watch-history params:', shape, 'first page:', first.data.length, 'total:', first.total);

  const out = [...first.data];
  onPage?.(out.length);
  let r = first;
  for (let i = 0; i < 500 && out.length < max; i++) {
    const next = r.next_page ?? r.meta?.next_page;
    const size = Number(shape.page_size) || first.data.length;
    try {
      if (next) r = await cr<Page<HistoryItem>>(next, { locale: undefined });
      else if (shape.page && r.data.length >= size && (first.total == null || out.length < first.total))
        r = await cr<Page<HistoryItem>>(path, { ...shape, page: Number(shape.page) + i + 1 });
      else break;
    } catch (e) {
      if (e instanceof CRError && e.status === 400) break; // paged past the end
      throw e;
    }
    if (!r.data.length) break;
    out.push(...r.data);
    onPage?.(out.length);
  }
  return out;
}

export interface WatchlistItem {
  fully_watched: boolean;
  never_watched: boolean;
  panel: CREpisode & { series_metadata?: unknown };
}

export async function watchlist(): Promise<WatchlistItem[]> {
  const id = await account();
  const out: WatchlistItem[] = [];
  for (let start = 0; start < 5000; start += 100) {
    const r = await cr<{ data: WatchlistItem[]; total?: number }>(`/content/v2/discover/${id}/watchlist`, { n: 100, start });
    const page = Array.isArray(r.data) ? r.data : [];
    // Guard against an endpoint that ignores `start` and repeats page 1.
    const seen = new Set(out.map((w) => w.panel?.id));
    const fresh = page.filter((w) => !seen.has(w.panel?.id));
    out.push(...fresh);
    if (page.length < 100 || !fresh.length || (r.total != null && out.length >= r.total)) break;
  }
  console.info('[Crunchy+] watchlist', { id, observedPath, count: out.length,
    sample: out.slice(0, 8).map((w) => w.panel?.episode_metadata?.series_title ?? w.panel?.title) });
  return out;
}

/**
 * The original-audio counterpart of a (possibly dubbed) season, plus its main episodes in order.
 * Specials (no episode_number) are excluded so the index matches AniList progress.
 */
export async function originalSeason(seasonId: string, versions?: CRVersion[] | null) {
  const origSeasonId = versions?.find((v) => v.original)?.season_guid ?? seasonId;
  const eps = (await seasonEpisodes(origSeasonId)).filter((e) => e.episode_metadata?.episode_number != null);
  eps.sort((a, b) => (a.episode_metadata!.sequence_number ?? 0) - (b.episode_metadata!.sequence_number ?? 0));
  return { seasonId: origSeasonId, episodes: eps };
}

/** 1-based AniList-style progress of an episode inside its original season. */
export function positionIn(episodes: CREpisode[], ep: CREpisode): number {
  const m = ep.episode_metadata!;
  const byNumber = episodes.findIndex((e) => e.episode_metadata?.episode_number === m.episode_number);
  if (byNumber >= 0) return byNumber + 1;
  const bySeq = episodes.findIndex((e) => (e.episode_metadata?.sequence_number ?? -1) >= (m.sequence_number ?? Infinity));
  return bySeq >= 0 ? bySeq + 1 : Math.max(1, Number(m.episode_number) || 1);
}

// ---- Catalog search ----

export interface CRSeriesHit {
  id: string;
  title: string;
  slug_title?: string;
  type?: string;
  series_metadata?: { season_count?: number; episode_count?: number };
}

export async function searchSeries(q: string, n = 6): Promise<CRSeriesHit[]> {
  const r = await cr<{ data: { type: string; items: CRSeriesHit[] }[] }>('/content/v2/discover/search', {
    q,
    type: 'series',
    n,
    limit: n,
  });
  return r.data?.find((b) => b.type === 'series')?.items ?? r.data?.flatMap((b) => b.items ?? []) ?? [];
}

// ---- Watchlist writes ----

export async function watchlistAdd(contentId: string) {
  await cr(`/content/v2/${await account()}/watchlist`, {}, { method: 'POST', body: { content_id: contentId } });
}

/** Series ids currently on the watchlist (panels are next-up episodes or series objects). */
export async function watchlistSeriesIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const w of await watchlist()) {
    const id = w.panel?.episode_metadata?.series_id ?? (w.panel?.type === 'series' ? w.panel.id : undefined);
    if (id) ids.add(id);
  }
  return ids;
}

// ---- Crunchylists (custom-lists) ----

export interface CrunchylistPreview {
  list_id: string;
  title: string;
  total: number;
  is_public?: boolean;
}

export interface CrunchylistEntry {
  id: string; // entry id (used for removal)
  list_id: string;
  panel: { id: string; title: string; type?: string };
}

export async function crunchylists() {
  const r = await cr<{ data: CrunchylistPreview[]; meta?: { total_private?: number; max_private?: number } }>(
    `/content/v2/${await account()}/custom-lists`,
  );
  return { lists: r.data ?? [], maxLists: r.meta?.max_private ?? 10, used: r.meta?.total_private ?? r.data?.length ?? 0 };
}

export async function crunchylistItems(listId: string) {
  const r = await cr<{ data: CrunchylistEntry[]; meta?: { max?: number; total?: number } }>(
    `/content/v2/${await account()}/custom-lists/${listId}`,
  );
  return { items: r.data ?? [], max: r.meta?.max ?? 100 };
}

export async function crunchylistCreate(title: string): Promise<string> {
  const r = await cr<{ data?: { list_id: string }[]; list_id?: string }>(
    `/content/v2/${await account()}/custom-lists`,
    {},
    { method: 'POST', body: { title } },
  );
  const id = r.data?.[0]?.list_id ?? r.list_id;
  if (!id) throw new Error(`Crunchyroll did not return an id for new list “${title}”`);
  return id;
}

export async function crunchylistAdd(listId: string, contentId: string) {
  await cr(`/content/v2/${await account()}/custom-lists/${listId}`, {}, { method: 'POST', body: { content_id: contentId } });
}

export async function crunchylistRemove(listId: string, entryId: string) {
  await cr(`/content/v2/${await account()}/custom-lists/${listId}/${entryId}`, {}, { method: 'DELETE' });
}

/** Last-played time (ms) per series from recent watch history (same query shape as the full scan). */
export async function recentlyPlayed(max = 400): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const h of await watchHistory(undefined, max)) {
    const id = h.panel?.episode_metadata?.series_id;
    const t = Date.parse(h.date_played);
    if (id && t > (out.get(id) ?? 0)) out.set(id, t);
  }
  return out;
}
