import type { AniEntry, AniMedia, NowPlaying } from './types';
import type { MatchResult } from './messages';
import { DEFAULTS, type Settings } from './settings';

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'warn' | 'err';
  action?: { label: string; run: () => void };
}

/** Reactive state the in-page widget renders. Mutated by the content script. */
export const ui = $state({
  settings: { ...DEFAULTS } as Settings,
  loggedIn: false,
  np: null as NowPlaying | null,
  match: null as MatchResult | null,
  entry: null as AniEntry | null,
  /** Series page (no episode playing): the show's most actionable AniList entry, or none (`media` null). */
  series: null as { id: string; media: AniMedia | null; entry: AniEntry | null } | null,
  watched: 0,
  synced: false,
  busy: false,
  toasts: [] as Toast[],
});

let seq = 0;
export function toast(text: string, tone: Toast['tone'] = 'ok', action?: Toast['action'], ms = 6000) {
  // The same message already on screen (a retrying failure) isn't stacked again.
  if (ui.toasts.some((x) => x.text === text)) return;
  const t: Toast = { id: ++seq, text, tone, action };
  ui.toasts.push(t);
  setTimeout(() => {
    ui.toasts = ui.toasts.filter((x) => x.id !== t.id);
  }, ms);
}
