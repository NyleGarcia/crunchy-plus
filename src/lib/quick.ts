import type { AniEntry, ListStatus } from './types';

/** A quick list action from a Crunchyroll hotkey or the widget: set a status, or step progress by one. */
export type QuickAction = { status: ListStatus } | { step: 1 | -1 };

/**
 * Alt+Shift hotkeys on Crunchyroll (by physical key, so layouts and macOS Option don't change them):
 * W Watching · P Planning · C Completed · ↑ / = +1 episode · ↓ / - −1 episode. Typing in a field never triggers one.
 */
export function hotkeyAction(e: Pick<KeyboardEvent, 'code' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>): QuickAction | null {
  if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return null;
  switch (e.code) {
    case 'KeyW':
      return { status: 'CURRENT' };
    case 'KeyP':
      return { status: 'PLANNING' };
    case 'KeyC':
      return { status: 'COMPLETED' };
    case 'ArrowUp':
    case 'Equal':
      return { step: 1 };
    case 'ArrowDown':
    case 'Minus':
      return { step: -1 };
    default:
      return null;
  }
}

export const HOTKEY_HELP = 'Episode & series pages: Alt+Shift+W Watching · P Planning · C Completed · ↑ +1 ep · ↓ −1 ep';

/**
 * The entry update a quick action means, or null when nothing changes. A manual +1 is watching: Planning (or no
 * entry) becomes Watching and reaching AniList's episode count completes it; −1 out of Completed goes back to
 * Watching. Completed sets progress to the full count when it is known.
 */
export function quickPatch(
  entry: Pick<AniEntry, 'status' | 'progress'> | null,
  total: number | null,
  action: QuickAction,
): { status: ListStatus; progress: number } | null {
  const cur = entry?.progress ?? 0;
  let status: ListStatus;
  let progress: number;
  if ('status' in action) {
    status = action.status;
    progress = status === 'COMPLETED' && total ? total : cur;
  } else {
    progress = Math.max(0, total ? Math.min(total, cur + action.step) : cur + action.step);
    const was = entry?.status;
    if (total && progress >= total) status = 'COMPLETED';
    else if (!was || was === 'PLANNING' || was === 'COMPLETED' || (action.step > 0 && (was === 'PAUSED' || was === 'DROPPED'))) status = 'CURRENT';
    else status = was;
  }
  return entry && entry.status === status && entry.progress === progress ? null : { status, progress };
}

/** "2d 4h", "3h 12m", "12m 05s", or "now" for a time `at` (ms) relative to `now`. */
export function countdown(at: number, now = Date.now()): string {
  const s = Math.floor((at - now) / 1000);
  if (s <= 0) return 'now';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}
