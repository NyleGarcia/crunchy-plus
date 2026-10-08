import { storage } from '#imports';
import type { ScrapedSeason, UpNextItem } from './messages';
import type { Segment } from './segments';
import type { ListStatus, Mode, SeasonInfo } from './types';

/** One-click presets for common rows people hide. */
export const ROW_PRESETS = ['Crunchyroll Manga', 'Recent English Dubs', 'New to Anime? Start Here!'];

export type DeclutterKey = 'banners' | 'manga' | 'news' | 'games' | 'store' | 'music';
export const DECLUTTER_LABEL: Record<DeclutterKey, string> = {
  banners: 'Promo banners between rows',
  manga: 'Manga rows & menu',
  news: 'News rows & menu',
  games: 'Games menu',
  store: 'Store menu',
  music: 'Music video rows',
};

export interface Settings {
  mode: Mode;
  /** Dub language used by dub mode (and the one non-original locale sub mode tolerates: none). */
  dubLocale: string;
  autoSync: boolean;
  /** Fraction of the episode watched before AniList progress is bumped. */
  syncThreshold: number;
  theme: boolean;
  anilistClientId: string;
  /** AniList status badges on Crunchyroll cards. */
  badges: boolean;
  /** Home-page clutter switches (each adds a `cp-hide-*` class on <html>; CSS does the rest). */
  declutter: Record<DeclutterKey, boolean>;
  /** Home rows hidden by title (case-insensitive substring of the row heading). */
  hiddenRows: string[];
  /** Shrink the home hero carousel to ~half height. */
  compactHero: boolean;
  /** "Up next from AniList" row at the top of the home feed. */
  upNextRow: boolean;
  /** Up next ordering: last watched on CR, or AniList popularity. */
  upNextSort: 'recent' | 'popular';
  /** Hide cards for shows completed on AniList unless a new original-audio episode came out since. */
  hideCompleted: boolean;
  /** AniList statuses whose shows get added to the CR Watchlist. */
  exportWatchlist: ListStatus[];
  /** AniList statuses mirrored as "AniList · <status>" Crunchylists. */
  exportLists: ListStatus[];
  /** Remove shows from the mirrored Crunchylists once they leave that AniList status. */
  mirrorLists: boolean;
  /** Re-run the AniList → Crunchyroll export automatically on a CR visit. */
  autoExport: boolean;
  autoExportHours: number;
  /** Auto mode: apply additions (never removals) without a click, only when the active profile is confirmed. */
  autoApplyAdds: boolean;
  /** Ask Jev (TypeSafe) to pick among unsure AniList matches. Needs a key (local only). */
  jevEnabled: boolean;
  /** Jev probability needed to accept its pick without asking. */
  jevAccept: number;
}

export const DEFAULTS: Settings = {
  mode: 'sub',
  dubLocale: 'en-US',
  autoSync: true,
  syncThreshold: 0.8,
  theme: true,
  anilistClientId: '',
  badges: true,
  declutter: { banners: true, manga: true, news: true, games: true, store: true, music: false },
  compactHero: false,
  hiddenRows: [],
  upNextRow: true,
  hideCompleted: false,
  upNextSort: 'recent',
  exportWatchlist: ['PLANNING', 'CURRENT'],
  exportLists: ['CURRENT', 'PLANNING', 'PAUSED'],
  mirrorLists: true,
  autoExport: false,
  autoExportHours: 6,
  autoApplyAdds: false,
  jevEnabled: true,
  jevAccept: 0.9,
};

export const settingsItem = storage.defineItem<Settings>('sync:settings', { fallback: DEFAULTS });
/** TypeSafe API key — local storage only (never synced), read only by the background. */
export const typesafeKeyItem = storage.defineItem<string | null>('local:typesafeKey', { fallback: null });
export const tokenItem = storage.defineItem<string | null>('local:anilistToken', { fallback: null });
/** AniList media id -> CR series id. Legacy '' entries (old permanent misses) are ignored and re-searched. */
export const crSeriesItem = storage.defineItem<Record<number, string>>('local:crSeries', { fallback: {} });
/** Per AniList media id: CR series title the search picked (for previews) or when a clean search found nothing. */
export const crSeriesMetaItem = storage.defineItem<Record<number, { title?: string; missAt?: number }>>('local:crSeriesMeta', {
  fallback: {},
});
export interface ImportLogItem {
  mediaId: number;
  title: string;
  /** Entry state before the import touched it; null = the import created it. */
  before: { status: ListStatus; progress: number } | null;
}
/** Exact record of recent import applies (newest first, max 5) for precise undo. */
export const importLogItem = storage.defineItem<{ at: number; items: ImportLogItem[] }[]>('local:importLog', { fallback: [] });
export interface ScanSnapshot {
  at: number;
  profileId: string | null;
  seasons: ScrapedSeason[];
  /** Per season key: the matched AniList ids (parts) and their planned updates at scan time. */
  results: Record<string, { mediaId: number | null; parts: { mediaId: number; plan: { status: ListStatus; progress: number } | null }[] }>;
}
/** Last import scan, for replaying/diffing after code or setting changes. */
export const lastScanItem = storage.defineItem<ScanSnapshot | null>('local:lastScan', { fallback: null });
/** seriesId -> original-audio seasons with released episode counts, checked at `at` (ms). */
export const crSeasonsItem = storage.defineItem<Record<string, { at: number; seasons: SeasonInfo[] }>>('local:crSeasons.v4', { fallback: {} }); // v4: tolerant original-audio check
/** Cached Up next list for the home-page row (rebuilt after 15 min). */
export const upNextCacheItem = storage.defineItem<{ at: number; items: UpNextItem[] } | null>('local:upNextCache.v4', { fallback: null }); // v4: lastWatched from working history query
export const lastExportItem = storage.defineItem<number>('local:lastExport', { fallback: 0 });
/** Last time a CR visit computed an export preview for the "changes ready" reminder (never applies anything). */
/** Cross-tab claim for the periodic export check: {at, by}. */
export const exportClaimItem = storage.defineItem<{ at: number; by: string } | null>('local:exportClaim', { fallback: null });
export const lastExportCheckItem = storage.defineItem<number>('local:lastExportCheck', { fallback: 0 });
/** seasonKey -> AniList media id (0 = user said "not on AniList / don't sync"). */
/** seasonKey -> how CR episodes map onto several AniList entries (split parts / continuing entry). */
export const segmentsItem = storage.defineItem<Record<string, Segment[]>>('local:segments', { fallback: {} });
// v2: v1 held auto-matches from the old, over-confident scorer (e.g. MHA S1 → FINAL SEASON).
export const matchesItem = storage.defineItem<Record<string, number>>('local:matches.v2', { fallback: {} });

export async function getSettings(): Promise<Settings> {
  const s = await settingsItem.getValue();
  // Merge nested defaults so new declutter keys appear for existing users.
  return { ...DEFAULTS, ...s, declutter: { ...DEFAULTS.declutter, ...(s?.declutter ?? {}) } };
}

export async function patchSettings(patch: Partial<Settings>) {
  await settingsItem.setValue({ ...(await getSettings()), ...patch });
}
