import { bg } from './messages';
import { quickPatch, type QuickAction } from './quick';
import { toast, ui } from './state.svelte';
import { STATUS_LABEL, type AniEntry, type AniMedia } from './types';

/**
 * What quick actions (hotkeys, quick bar) act on: the playing episode's matched AniList entry, else on a series page
 * the show's most actionable entry. Reads `ui`, so it is reactive inside `$derived`.
 */
export function quickTarget(): { media: AniMedia; entry: AniEntry | null } | null {
  if (ui.np) return ui.match?.mediaId && ui.match.media ? { media: ui.match.media, entry: ui.entry } : null;
  return ui.series?.media ? { media: ui.series.media, entry: ui.series.entry } : null;
}

const titleOf = (m: AniMedia) => m.title.english ?? m.title.romaji ?? `#${m.id}`;

/** Apply a quick action (hotkey or quick bar) to the current target's AniList entry. */
export async function applyQuick(action: QuickAction) {
  const t = quickTarget();
  if (!ui.loggedIn || !t) {
    // Series page, show not on your list: the W / P hotkeys add it (like the bar's "+ Watching" / "+ Planning").
    if (ui.loggedIn && ui.series && !ui.np && 'status' in action && (action.status === 'CURRENT' || action.status === 'PLANNING'))
      return addSeries(action.status);
    toast(ui.np ? 'No AniList entry for this season yet — pick one in the Crunchy+ panel.' : 'Open an episode or a series page first.', 'warn');
    return;
  }
  if (ui.busy) return; // a save (or the auto-sync) is in flight: a second click would act on a stale entry
  const patch = quickPatch(t.entry, t.media.episodes ?? null, action);
  if (!patch) return toast('AniList: already up to date');
  ui.busy = true;
  try {
    const entry = await bg({ type: 'anilist:save', mediaId: t.media.id, patch });
    if (ui.np) ui.entry = entry;
    else if (ui.series) ui.series.entry = entry;
    toast(`AniList: ${titleOf(t.media)} → ${STATUS_LABEL[entry.status]} · ep ${entry.progress}${t.media.episodes ? `/${t.media.episodes}` : ''}`);
  } catch (e) {
    toast((e as Error).message, 'err');
  } finally {
    ui.busy = false;
  }
}

/** Series page, show not on your list: add its first season (exact title match, like the cards' "+ Plan"). */
export async function addSeries(status: 'PLANNING' | 'CURRENT') {
  const s = ui.series;
  if (!s || ui.busy) return;
  // Series pages carry the show title in their only h1; the tab title ("Watch X - Crunchyroll") is the fallback.
  const title =
    document.querySelector('h1')?.textContent?.trim() || document.title.replace(/^Watch\s+/i, '').replace(/\s+-\s+Crunchyroll.*$/i, '').trim();
  if (!title) return toast('Could not read this show’s title', 'err');
  ui.busy = true;
  try {
    const r = await bg({ type: 'anilist:plan', seriesId: s.id, title, status });
    if (ui.series?.id === s.id) Object.assign(ui.series, { media: r.media, entry: r.entry });
    toast(r.existed ? `${titleOf(r.media)} is already on your list (${STATUS_LABEL[r.entry.status]})` : `${titleOf(r.media)} → ${STATUS_LABEL[r.entry.status]}`);
  } catch (e) {
    toast((e as Error).message, 'err');
  } finally {
    ui.busy = false;
  }
}
