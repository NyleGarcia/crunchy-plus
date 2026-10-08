/**
 * Hide home-feed rows by their heading text, plus a "Hide row" button on each heading.
 * Rows are re-numbered on every visit (`personalized-collection-N`), so the title is the stable key.
 *
 * Row structure (logged-in home, 2026-10):
 *   [data-t^="personalized-collection-"] > .container > [class*="feed-header--"] > h2[class*="feed-header__title--"]
 *   Rows without that data-t (history, editorial) are the nearest child of `.dynamic-feed-wrapper`.
 */
import { getSettings, patchSettings } from '@/lib/settings';
import { toast } from '@/lib/state.svelte';

const HIDDEN = 'data-crunchyplus-hidden';
const BTN = 'data-crunchyplus-row-btn';
let patterns: string[] = [];
let observer: MutationObserver | null = null;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export async function startRows() {
  patterns = (await getSettings()).hiddenRows.map(norm).filter(Boolean);
  // Settings are applied at document_start; wait for <body> before scanning/observing.
  if (!document.body) await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
  // Re-evaluate every row (patterns may have shrunk).
  document.querySelectorAll(`[${HIDDEN}="row"]`).forEach((el) => el.removeAttribute(HIDDEN));
  scan();
  if (!observer) {
    let t = 0;
    observer = new MutationObserver(() => {
      clearTimeout(t);
      t = window.setTimeout(scan, 200);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

function rowOf(title: HTMLElement): HTMLElement | null {
  const byHook = title.closest<HTMLElement>('[data-t^="personalized-collection-"]');
  if (byHook) return byHook;
  // Walk up to the direct child of the feed wrapper.
  let el: HTMLElement | null = title;
  while (el?.parentElement && !el.parentElement.classList.contains('dynamic-feed-wrapper')) el = el.parentElement;
  return el?.parentElement ? el : null;
}

function scan() {
  for (const title of document.querySelectorAll<HTMLElement>('.dynamic-feed-wrapper [class*="feed-header__title--"]')) {
    const row = rowOf(title);
    if (!row) continue;
    const text = norm(title.textContent ?? '');
    if (!text) continue;
    if (patterns.some((p) => text.includes(p))) row.setAttribute(HIDDEN, 'row');
    else if (row.getAttribute(HIDDEN) === 'row') row.removeAttribute(HIDDEN);
    addButton(title, title.textContent!.trim());
  }
}

function addButton(title: HTMLElement, label: string) {
  const header = title.parentElement;
  if (!header || header.querySelector(`[${BTN}]`)) return;
  const btn = document.createElement('button');
  btn.setAttribute(BTN, '');
  btn.type = 'button';
  btn.textContent = 'Hide row';
  btn.title = `Hide “${label}” on the home page (undo in the Crunchy+ popup)`;
  Object.assign(btn.style, {
    marginLeft: '12px',
    padding: '3px 10px',
    border: '1px solid rgb(255 255 255 / 0.18)',
    borderRadius: '999px',
    background: 'transparent',
    color: '#a0a0a0',
    font: '600 12px/1.4 system-ui, sans-serif',
    cursor: 'pointer',
    opacity: '0',
    transition: 'opacity 150ms ease',
    verticalAlign: 'middle',
  } satisfies Partial<CSSStyleDeclaration>);
  // Only visible while hovering the header (or focused via keyboard).
  const show = () => (btn.style.opacity = '1');
  const hide = () => document.activeElement !== btn && (btn.style.opacity = '0');
  header.addEventListener('mouseenter', show);
  header.addEventListener('mouseleave', hide);
  btn.addEventListener('focus', show);
  btn.addEventListener('blur', hide);
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const s = await getSettings();
    if (s.hiddenRows.some((r) => norm(r) === norm(label))) return;
    await patchSettings({ hiddenRows: [...s.hiddenRows, label] });
    toast(`Hid “${label}”`, 'ok', {
      label: 'Undo',
      run: async () => {
        const cur = await getSettings();
        await patchSettings({ hiddenRows: cur.hiddenRows.filter((r) => norm(r) !== norm(label)) });
      },
    });
  });
  if (getComputedStyle(header).display.includes('flex')) btn.style.marginLeft = '12px';
  title.after(btn);
}
