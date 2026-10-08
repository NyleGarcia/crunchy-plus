import type { AniEntry, NowPlaying } from './types';
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
  watched: 0,
  synced: false,
  busy: false,
  toasts: [] as Toast[],
});

let seq = 0;
export function toast(text: string, tone: Toast['tone'] = 'ok', action?: Toast['action'], ms = 6000) {
  const t: Toast = { id: ++seq, text, tone, action };
  ui.toasts.push(t);
  setTimeout(() => (ui.toasts = ui.toasts.filter((x) => x.id !== t.id)), ms);
}
