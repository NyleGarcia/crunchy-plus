import type { CRVersion, Mode } from './types';

/** Original-audio locales for the kinds of shows Crunchyroll carries. */
const ORIGINAL_LOCALES = new Set(['ja-JP', 'zh-CN', 'zh-TW', 'ko-KR']);
const DUB_TITLE = /\((?:[\p{L}\s-]+\s)?dub(?:bed)?\)/iu;

type Obj = Record<string, any>;

/** Pull the audio info off an episode, season, or panel-wrapped item. Returns null for things we don't judge (series, movies listings…). */
export function audioInfo(item: Obj): { id: string; locale?: string; versions?: CRVersion[]; title?: string } | null {
  if (!item || typeof item !== 'object') return null;
  const inner: Obj = item.panel && typeof item.panel === 'object' ? item.panel : item;
  const meta: Obj | undefined = inner.episode_metadata ?? inner.movie_metadata;
  if (meta) {
    return { id: inner.id, locale: meta.audio_locale, versions: meta.versions ?? undefined, title: inner.title };
  }
  // Season objects carry audio fields at top level.
  if ('season_number' in inner && ('audio_locale' in inner || 'versions' in inner)) {
    return { id: inner.id, locale: inner.audio_locale, versions: inner.versions ?? undefined, title: inner.title };
  }
  return null;
}

export function isOriginal(info: NonNullable<ReturnType<typeof audioInfo>>): boolean {
  const own = info.versions?.find((v) => v.guid === info.id);
  // Only trust an explicit flag; some CR payloads omit `original` → fall back to the audio locale.
  if (own && typeof own.original === 'boolean') return own.original;
  if (info.locale) return ORIGINAL_LOCALES.has(info.locale);
  return !(info.title && DUB_TITLE.test(info.title));
}

/** Should this list item be shown under the given mode? Items we can't classify always stay. */
export function keepItem(item: Obj, mode: Mode, dubLocale: string): boolean {
  if (mode === 'all') return true;
  const info = audioInfo(item);
  if (!info) return true;
  const original = isOriginal(info);
  if (mode === 'sub') return original;
  // dub mode: show the preferred dub; fall back to original only when no such dub exists.
  if (original) return !info.versions?.some((v) => v.audio_locale === dubLocale);
  return info.locale === dubLocale;
}

/**
 * Recursively filter every array of objects in a Crunchyroll JSON payload.
 * Depth-limited: CR payloads nest lists at most a few levels (home feed → carousels → items).
 */
export function filterPayload<T>(payload: T, mode: Mode, dubLocale: string, depth = 0): T {
  if (mode === 'all' || depth > 5 || !payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) {
    return payload
      .filter((x) => keepItem(x, mode, dubLocale))
      .map((x) => filterPayload(x, mode, dubLocale, depth + 1)) as T;
  }
  const out: Obj = {};
  for (const [k, v] of Object.entries(payload as Obj)) {
    out[k] = v && typeof v === 'object' ? filterPayload(v, mode, dubLocale, depth + 1) : v;
  }
  if (Array.isArray(out.data) && typeof out.total === 'number') out.total = out.data.length;
  return out as T;
}

/** For the player: the episode id to redirect to so the mode's audio plays, or null to stay. */
export function preferredVersion(
  episodeId: string,
  versions: CRVersion[] | null | undefined,
  mode: Mode,
  dubLocale: string,
): string | null {
  if (mode === 'all' || !versions?.length) return null;
  const target =
    mode === 'sub' ? versions.find((v) => v.original) : versions.find((v) => v.audio_locale === dubLocale);
  return target && target.guid !== episodeId ? target.guid : null;
}

/** URLs whose list payloads we filter. Single-object fetches (cms/objects, playback) are never touched. */
export function isFilterableUrl(url: string): boolean {
  try {
    const u = new URL(url, 'https://www.crunchyroll.com');
    if (!/(^|\.)crunchyroll\.com$/.test(u.hostname)) return false;
    const p = u.pathname;
    if (!p.startsWith('/content/v2/')) return false;
    if (/\/cms\/objects\/|\/playheads|\/watch-history|\/watchlist\/[^/]+$|\/up_next\//.test(p)) return false;
    return true;
  } catch {
    return false;
  }
}
