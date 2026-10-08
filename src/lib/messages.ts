import type { AniEntry, AniListItem, AniMedia, ListStatus, NowPlaying } from './types';
import type { JevVerdict } from './jev';
import type { Segment } from './segments';
import type { MatchInput } from './matcher';
import type { ImportLogItem } from './settings';

export interface Ranked {
  media: AniMedia;
  score: number;
}

export interface MatchResult {
  key: string;
  /** null = no confident match; user must pick. 0 = user disabled sync for this season. */
  mediaId: number | null;
  media: AniMedia | null;
  candidates: Ranked[];
  /** Score of the chosen match (≥ AUTO_ACCEPT = auto). null = saved/manual pick, not scored this time. */
  score: number | null;
  /** How the current match was decided. */
  source: 'auto' | 'saved' | 'jev' | 'none';
  /** Jev's verdict when it was consulted (unsure rows / "Ask Jev"). */
  jev?: JevVerdict | null;
  /** Set when this CR season maps onto several AniList entries or continues one (offset). */
  segments?: { seg: Segment; media: AniMedia | null }[];
}

/** Season rows produced by the CR scraper, consumed by the import page. */
export interface ScrapedSeason {
  key: string;
  input: MatchInput;
  progress: number;
  /** Distinct episodes watched, and the furthest one (for display/sanity). */
  watchedCount: number;
  furthest: number;
  lastPlayed: string | null;
  inWatchlist: boolean;
}

export interface Scrape {
  historyCount: number;
  watchlistCount: number;
  seasons: ScrapedSeason[];
}

export interface UpNextItem {
  aniId: number;
  title: string;
  cover: string | null;
  status: ListStatus;
  progress: number;
  total: number | null;
  seriesId: string | null;
  nextEpisode: { id: string; title: string; number: number | null; url: string } | null;
  /** Episodes on Crunchyroll past your AniList progress. */
  available: number | null;
  airing: { episode: number; airingAt: number } | null;
  updatedAt: number;
  /** Last played on Crunchyroll (ms), from recent watch history; null if not in it. */
  lastWatched: number | null;
  /** AniList popularity (users with it on their list). */
  popularity: number | null;
  error?: string;
}

export type UpNextSort = 'recent' | 'popular';

/**
 * Ready-to-watch first, then by the chosen order. "recent" = last played on Crunchyroll; shows with
 * no recent CR history come after all that have it (AniList update times are unreliable — an
 * import touches hundreds at once — so they only order that remainder). "popular" = AniList popularity.
 */
export function sortUpNext(items: UpNextItem[], mode: UpNextSort): UpNextItem[] {
  return [...items].sort(
    (a, b) =>
      Number(!!b.nextEpisode) - Number(!!a.nextEpisode) ||
      (mode === 'popular' ? (b.popularity ?? 0) - (a.popularity ?? 0) : 0) ||
      Number(b.lastWatched != null) - Number(a.lastWatched != null) ||
      (b.lastWatched ?? 0) - (a.lastWatched ?? 0) ||
      b.updatedAt - a.updatedAt,
  );
}

export interface ShowRef {
  aniId: number;
  /** AniList title. */
  title: string;
  seriesId: string;
  /** CR series title when a title search picked it (null = mapped by link/cache, title unknown). */
  crTitle?: string | null;
}

export interface ListPlan {
  status: ListStatus;
  title: string;
  listId: string | null;
  add: ShowRef[];
  remove: { entryId: string; title: string }[];
  /** Shows that didn't fit under the list's item cap. */
  overflow: number;
}

export interface ExportPlan {
  watchlistAdd: ShowRef[];
  lists: ListPlan[];
  unmapped: { aniId: number; title: string }[];
  warnings: string[];
}

export interface ExportResult {
  done: number;
  failed: { what: string; error: string }[];
}

/** Operations run inside a Crunchyroll tab (it holds the CR session). */
export interface CrOps {
  profile: { args: void; result: import('./cr-api').ProfileInfo };
  scrape: { args: void; result: Scrape };
  upnext: { args: void; result: UpNextItem[] };
  exportPlan: { args: void; result: ExportPlan };
  exportApply: { args: ExportPlan; result: ExportResult };
}
export type CrOp = keyof CrOps;

export interface UndoRow {
  mediaId: number;
  title: string;
  cover: string | null;
  /** Current list entry (what the import left). null = already gone. */
  current: { entryId: number; status: ListStatus; progress: number } | null;
  /** Best guess of the state before the import; null = the import created this entry. */
  before: { status: ListStatus; progress?: number } | null;
  /** Activity posts created in the window (deletable). */
  activityIds: number[];
  action: 'delete' | 'restore' | 'keep';
  /** Why the preselected action is conservative, e.g. "no earlier state known". */
  note?: string;
}

export type BgRequest =
  | { type: 'anilist:status' }
  | { type: 'anilist:login' }
  | { type: 'anilist:logout' }
  | { type: 'anilist:setToken'; token: string }
  | { type: 'anilist:search'; q: string }
  | { type: 'anilist:list' }
  | { type: 'anilist:save'; mediaId: number; patch: { status?: ListStatus; progress?: number } }
  | { type: 'match:resolve'; key: string; input: MatchInput; force?: boolean }
  | { type: 'match:resolveMany'; items: { key: string; input: MatchInput }[]; force?: boolean }
  | { type: 'anilist:saveMany'; items: { mediaId: number; status?: ListStatus; progress?: number }[] }
  | { type: 'match:set'; key: string; mediaId: number }
  | { type: 'match:setSegments'; key: string; segments: Segment[] | null }
  | { type: 'match:split'; key: string; input: MatchInput; mediaId: number }
  | { type: 'jev:choose'; input: MatchInput; candidates: AniMedia[] }
  | { type: 'jev:status' }
  | { type: 'sync:episode'; np: NowPlaying }
  | { type: 'anilist:listFull'; fresh?: boolean }
  | { type: 'undo:scan'; since: number }
  | { type: 'undo:fromLog'; log: { at: number; items: ImportLogItem[] } }
  | { type: 'undo:apply'; rows: UndoRow[]; deleteActivities: boolean }
  | { type: 'cr:op'; op: CrOp; args?: unknown }
  | { type: 'hub:open'; tab: 'upnext' | 'import' | 'export'; review?: boolean };

export type CsRequest = { type: 'cr:op'; op: CrOp; args?: unknown } | { type: 'cr:progress'; done: number; label: string };

export interface BgResponses {
  'anilist:status': { user: { id: number; name: string; avatar: { medium: string } } | null; redirectUrl: string };
  'anilist:login': { ok: true };
  'anilist:logout': { ok: true };
  'anilist:setToken': { ok: true };
  'anilist:search': AniMedia[];
  'anilist:list': [number, AniEntry][];
  'anilist:save': AniEntry;
  'match:resolve': MatchResult;
  'match:resolveMany': MatchResult[];
  'anilist:saveMany': (AniEntry | { error: string })[];
  'match:set': MatchResult;
  'match:setSegments': MatchResult;
  'match:split': MatchResult;
  'jev:choose': JevVerdict;
  'jev:status': { hasKey: boolean; enabled: boolean };
  'sync:episode': { match: MatchResult; entry: AniEntry | null; changed: boolean; reason?: string };
  'anilist:listFull': AniListItem[];
  'undo:scan': UndoRow[];
  'undo:fromLog': UndoRow[];
  'undo:apply': { deleted: number; restored: number; activitiesDeleted: number; failed: string[] };
  'cr:op': unknown;
  'hub:open': { ok: true };
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

export async function bg<K extends BgRequest['type']>(
  msg: Extract<BgRequest, { type: K }>,
): Promise<BgResponses[K]> {
  const r = (await browser.runtime.sendMessage(msg)) as Envelope<BgResponses[K]> | undefined;
  if (!r) throw new Error('Background did not respond');
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

export function respond<T>(p: Promise<T>): Promise<Envelope<T>> {
  return p.then(
    (data) => ({ ok: true as const, data }),
    (e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }),
  );
}

/** Run a Crunchyroll-side operation via the background (which finds/opens a CR tab). */
export async function crOp<K extends CrOp>(op: K, args?: CrOps[K]['args']): Promise<CrOps[K]['result']> {
  return (await bg({ type: 'cr:op', op, args })) as CrOps[K]['result'];
}

export function progress(done: number, label: string) {
  browser.runtime.sendMessage({ type: 'cr:progress', done, label }).catch(() => {});
}
