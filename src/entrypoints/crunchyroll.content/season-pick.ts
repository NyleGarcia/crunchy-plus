/**
 * Series pages open on season 1 (or the season you last watched). This switches CR's season menu to
 * the newest regular season once per visit. Found by text, not CR class names: the trigger reads
 * "Season 1" / "S1: …", the options "Season 3 · 4 Episodes". Extras (OVA, movie, specials) and dubs
 * never win.
 */
const LABEL = /^\s*(?:season\s*(\d+)|s(\d+)\b)/i;
const OPTION = /episodes?\s*$/i;
const EXTRA = /\b(ova|oad|specials?|movies?|film|recap|extra|bonus)\b/i;
const DUB = /\bdub\b|\(.*(?:english|deutsch|español|français|italiano|português|русский|العربية|हिंदी).*\)/i;

const seasonNo = (text: string) => {
  const m = text.match(LABEL);
  return m ? Number(m[1] ?? m[2]) : null;
};

let done: string | null = null;

/** Run on route changes; `seriesId` null = not a series page. */
export function pickLatestSeason(seriesId: string | null) {
  if (!seriesId) return void (done = null); // left the show: the next visit picks again
  if (done === seriesId) return;
  done = seriesId;
  void run(seriesId);
}

async function run(seriesId: string) {
  const trigger = await waitFor(findTrigger, 10_000);
  if (!trigger || !onSeries(seriesId)) return;
  const current = seasonNo(trigger.querySelector('.trigger-title, [class*="trigger-title"]')?.textContent ?? trigger.textContent ?? '');
  const opened = () => {
    const o = findOptions(trigger);
    return o.length ? o : null;
  };
  // A plain click first (a full press could open on mousedown and close again on click), then the press.
  trigger.click();
  let options = await waitFor(opened, 600);
  if (!options) {
    press(trigger);
    options = await waitFor(opened, 1500);
  }
  if (!options || !onSeries(seriesId)) {
    console.info('[Crunchy+] season pick: menu did not open');
    return close(trigger);
  }
  const all = options.map((el) => {
    const label = labelOf(el);
    return { el, text: label, n: seasonNo(label) };
  });
  const ranked = all.filter((o) => o.n != null && !EXTRA.test(o.text) && !DUB.test(o.text)).sort((a, b) => b.n! - a.n!);
  const best = ranked[0];
  console.info('[Crunchy+] season pick:', JSON.stringify({ current, options: all.map((o) => o.text), pick: best?.text ?? null }));
  if (!best || best.n === current) return close(trigger);
  press(best.el);
}

/**
 * An option's own label. CR renders `<span>Season 3</span><span>4 Episodes</span>` with no space between,
 * so the whole textContent ("Season 34 Episodes") would read as season 34: take the first child's text.
 */
function labelOf(el: HTMLElement): string {
  const own = el.querySelector('[class*="extended-option__text"]') ?? el.firstElementChild;
  return (own?.textContent ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** A full pointer press: CR's dropdowns may act on pointerdown/mousedown rather than click. */
function press(el: HTMLElement) {
  const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.click();
}

const onSeries = (id: string) => location.pathname.includes(`/series/${id}`);

/**
 * The season menu button. CR: `.erc-seasons-select [role="button"][aria-haspopup="listbox"]` (aria-label
 * "Seasons"); fallback: a small clickable element whose whole text is a season label.
 */
function findTrigger(): HTMLElement | null {
  const known = document.querySelector<HTMLElement>('.erc-seasons-select [aria-haspopup], [aria-haspopup="listbox"][aria-label="Seasons"]');
  if (known?.offsetParent) return known;
  for (const el of document.querySelectorAll<HTMLElement>('button, [role="button"], [aria-haspopup]')) {
    const text = el.textContent?.trim() ?? '';
    // "S1 E3" is an episode card, not the menu.
    if (text.length < 40 && LABEL.test(text) && !OPTION.test(text) && !/\bE\d+/i.test(text) && el.offsetParent) return el;
  }
  return null;
}

/** Open menu entries: the listbox's options (via `aria-controls`), else innermost elements reading "<label> … N Episodes". */
function findOptions(trigger: HTMLElement): HTMLElement[] {
  const id = trigger.getAttribute('aria-controls');
  const box = id ? document.getElementById(id) : null;
  const listed = box ? [...box.querySelectorAll<HTMLElement>('[role="option"]')] : [];
  if (listed.length) return listed;
  const hits: HTMLElement[] = [];
  for (const el of document.body.querySelectorAll<HTMLElement>('li, [role="option"], [role="menuitem"], button, a, div')) {
    const text = el.textContent?.trim() ?? '';
    if (text.length > 200 || !LABEL.test(text) || !OPTION.test(text) || !el.offsetParent) continue;
    // Keep the innermost match only (the row, not the whole list).
    if ([...el.children].some((c) => LABEL.test(c.textContent ?? '') && OPTION.test(c.textContent ?? ''))) continue;
    hits.push(el);
  }
  return hits;
}

function close(trigger: HTMLElement) {
  if (trigger.getAttribute('aria-expanded') === 'true' || findOptions(trigger).length) press(trigger);
}

function waitFor<T>(probe: () => T | null, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const hit = probe();
    if (hit) return resolve(hit);
    const obs = new MutationObserver(() => {
      const v = probe();
      if (v) finish(v);
    });
    const timer = setTimeout(() => finish(null), ms);
    const finish = (v: T | null) => {
      obs.disconnect();
      clearTimeout(timer);
      resolve(v);
    };
    obs.observe(document.body, { childList: true, subtree: true });
  });
}
