import { mount, unmount } from 'svelte';
import UpNextRow from '@/components/UpNextRow.svelte';
import Widget from '@/components/Widget.svelte';
import * as cr from '@/lib/cr-api';
import { preferredVersion } from '@/lib/dub';
import { HOOK_CONFIG_KEY, HOOK_TAG, type HookConfig } from '@/lib/hook-config';
import { bg, respond, type CrOp, type CsRequest, type ExportPlan } from '@/lib/messages';
import { exportClaimItem, getSettings, lastExportCheckItem, settingsItem, upNextCacheItem, type Settings } from '@/lib/settings';
import { toast, ui } from '@/lib/state.svelte';
import { seasonKey, type CREpisode, type NowPlaying } from '@/lib/types';
import { startBadges, stopBadges } from './badges';
import { exportApply, exportPlan, upNext } from './reverse';
import { startRows } from './rows';
import { scrape } from './scrape';
import themeCss from './theme.css?inline';

export default defineContentScript({
  matches: ['*://www.crunchyroll.com/*', '*://static.crunchyroll.com/*'],
  allFrames: true,
  runAt: 'document_start',
  cssInjectionMode: 'ui',
  async main(ctx) {
    // Player iframes (if CR serves one) only report playback to the top frame.
    if (window.top !== window) return reportVideo(window.top!);
    if (location.hostname !== 'www.crunchyroll.com') return;

    applySettings(await getSettings(), null);
    console.info('%c[Crunchy+]', 'color:#ff7a1a', 'content script ready', { mode: ui.settings.mode });
    settingsItem.watch((s) => applySettings({ ...ui.settings, ...s }, ui.settings));

    window.addEventListener('message', (e) => {
      const kind = e.data?.[HOOK_TAG];
      if (!kind) return;
      if (kind === 'video' && /(^|\.)crunchyroll\.com$/.test(new URL(e.origin).hostname)) {
        onVideo(e.data.payload.t, e.data.payload.d);
      } else if (e.source === window && kind === 'token') cr.setToken(e.data.payload);
      else if (e.source === window && kind === 'accountPath') cr.setObservedPath(e.data.payload);
      else if (e.source === window && kind === 'episode') onEpisode(e.data.payload);
    });

    browser.runtime.onMessage.addListener((msg: CsRequest, _s, sendResponse) => {
      if (msg.type !== 'cr:op') return;
      const ops: Record<CrOp, () => Promise<unknown>> = {
        profile: () => cr.activeProfile(),
        scrape: () => scrape(),
        upnext: () => upNext(),
        exportPlan: () => exportPlan(),
        exportApply: () => exportApply(msg.args as ExportPlan),
      };
      respond(ops[msg.op]()).then(sendResponse);
      return true;
    });

    bg({ type: 'anilist:status' })
      .then((s) => {
        ui.loggedIn = !!s.user;
        if (!ui.loggedIn) return;
        if (ui.settings.badges || ui.settings.hideCompleted) startBadges().catch((e) => console.warn('[Crunchy+] badges', e));
        maybeAutoExport();
      })
      .catch(() => {});

    ctx.addEventListener(window, 'wxt:locationchange', () => onRoute());
    onRoute();
    reportVideo(window);

    const widget = await createShadowRootUi(ctx, {
      name: 'crunchy-plus',
      position: 'overlay',
      zIndex: 2147483000,
      anchor: 'html',
      onMount: (root) => mount(Widget, { target: root }),
      onRemove: (app) => app && unmount(app),
    });
    widget.mount();

    // "Up next from AniList" as the first feed row — below the hero (which must stay at the top,
    // under the header). `.dynamic-feed-wrapper` holds the home rows and is unhashed.
    const row = await createShadowRootUi(ctx, {
      name: 'crunchy-plus-upnext',
      position: 'inline',
      anchor: '.erc-feed .dynamic-feed-wrapper',
      append: 'first',
      onMount: (root, _shadow, host) => {
        matchFeedStyle(host);
        return mount(UpNextRow, { target: root, props: { load: cachedUpNext } });
      },
      onRemove: (app) => app && unmount(app),
    });
    let rowAuto = false;
    const syncRow = () => {
      const want = ui.settings.upNextRow && ui.loggedIn;
      if (want && !rowAuto) {
        row.autoMount(); // mounts whenever `.erc-feed` appears (SPA navigation)
        rowAuto = true;
      } else if (!want && rowAuto) {
        row.remove();
        rowAuto = false;
      }
    };
    settingsItem.watch(syncRow);
    bg({ type: 'anilist:status' })
      .then((s) => {
        ui.loggedIn = !!s.user;
        syncRow();
      })
      .catch(() => {});
  },
});

/** Copy CR's row gutter and heading font onto our host so the row lines up with native rows. */
function matchFeedStyle(host: HTMLElement) {
  // The container that wraps a row *title* has the page gutter (carousel containers are edge-to-edge).
  const title = document.querySelector<HTMLElement>('.dynamic-feed-wrapper [class*="feed-header__title--"]');
  const container = title?.closest<HTMLElement>('[class*="container--"]') ?? null;
  const c = container ? getComputedStyle(container) : null;
  const t = title ? getComputedStyle(title) : null;
  host.style.display = 'block';
  if (c) {
    host.style.setProperty('--cr-gutter-left', c.paddingLeft);
    host.style.setProperty('--cr-gutter-right', c.paddingRight);
    host.style.setProperty('--cr-max-width', c.maxWidth);
  }
  if (t) {
    host.style.setProperty('--cr-title-font', t.fontFamily);
    host.style.setProperty('--cr-title-size', t.fontSize);
    host.style.setProperty('--cr-title-weight', t.fontWeight);
  }
}

/** Up next for the home row: reuse a result younger than 15 min (it costs AniList + CR calls). */
async function cachedUpNext() {
  const hit = await upNextCacheItem.getValue();
  if (hit && Date.now() - hit.at < 15 * 60e3) return hit.items;
  const items = await upNext();
  await upNextCacheItem.setValue({ at: Date.now(), items });
  return items;
}

function applySettings(next: Settings, prev: Settings | null) {
  ui.settings = next;
  const cfg: HookConfig = { mode: next.mode, dubLocale: next.dubLocale };
  try {
    localStorage.setItem(HOOK_CONFIG_KEY, JSON.stringify(cfg));
  } catch {}
  window.postMessage({ [HOOK_TAG]: 'config', config: cfg }, location.origin);
  applyLook(next);
  if (!prev || prev.hiddenRows.join('\n') !== next.hiddenRows.join('\n')) startRows().catch(() => {});
  if (prev && ui.loggedIn && (prev.badges !== next.badges || prev.hideCompleted !== next.hideCompleted)) {
    if (next.badges || next.hideCompleted) startBadges().catch((e) => console.warn('[Crunchy+] badges', e));
    else stopBadges();
  }
  // Lists already on screen were fetched under the old mode; reload so the filter applies.
  if (prev && (prev.mode !== next.mode || prev.dubLocale !== next.dubLocale)) {
    if (watchId()) handleRedirect();
    else location.reload();
  }
}

/**
 * The stylesheet is always present; root classes switch its parts on:
 * `crunchy-plus` = modern theme, `cp-compact-hero`, and one `cp-hide-<key>` per declutter switch.
 */
function applyLook(s: Settings) {
  const id = 'crunchy-plus-theme';
  if (!document.getElementById(id)) {
    const style = Object.assign(document.createElement('style'), { id, textContent: themeCss });
    (document.head ?? document.documentElement).append(style);
  }
  const root = document.documentElement.classList;
  root.toggle('crunchy-plus', s.theme);
  root.toggle('cp-compact-hero', s.compactHero);
  for (const [key, on] of Object.entries(s.declutter ?? {})) root.toggle(`cp-hide-${key}`, !!on);
}

const watchId = () => location.pathname.match(/\/watch\/([A-Z0-9]+)/i)?.[1] ?? null;

let current: CREpisode | null = null;

function onRoute() {
  const id = watchId();
  if (!id) {
    current = null;
    ui.np = null;
    ui.match = null;
    return;
  }
  if (current?.id === id) return;
  // The hook usually delivers this first; fetch ourselves if it didn't within a moment.
  setTimeout(() => {
    if (watchId() === id && current?.id !== id) cr.episode(id).then(onEpisode, () => {});
  }, 2500);
}

async function onEpisode(ep: CREpisode) {
  if (!ep?.episode_metadata || ep.id !== watchId() || current?.id === ep.id) return;
  current = ep;
  ui.np = null;
  ui.match = null;
  ui.entry = null;
  ui.watched = 0;
  ui.synced = false;
  if (handleRedirect()) return;

  const m = ep.episode_metadata;
  try {
    const season = await cr.originalSeason(m.season_id, m.versions);
    const np: NowPlaying = {
      episodeId: ep.id,
      seriesId: m.series_id,
      seriesTitle: m.series_title,
      seasonId: season.seasonId,
      seasonTitle: m.season_title,
      seasonNumber: m.season_number,
      progress: cr.positionIn(season.episodes, ep),
      seasonEpisodes: season.episodes.length || null,
    };
    if (current?.id !== ep.id) return;
    ui.np = np;
    console.info('%c[Crunchy+]', 'color:#ff7a1a', 'now playing', np);
    if (!ui.loggedIn) return;
    ui.match = await bg({
      type: 'match:resolve',
      key: seasonKey(np.seriesId, np.seasonId),
      input: { ...np },
    });
    ui.entry = ui.match.media?.mediaListEntry ?? null;
  } catch (e) {
    console.warn('[Crunchy+]', e);
  }
}

/** Jump to the audio version the current mode wants. Returns true if navigating away. */
function handleRedirect(): boolean {
  const m = current?.episode_metadata;
  if (!current || !m) return false;
  const target = preferredVersion(current.id, m.versions, ui.settings.mode, ui.settings.dubLocale);
  const guard = `crunchyplus:redirected:${current.id}`;
  if (!target || sessionStorage.getItem(guard)) return false;
  sessionStorage.setItem(guard, '1'); // never bounce twice for the same episode
  location.replace(location.href.replace(current.id, target));
  return true;
}

function reportVideo(target: Window) {
  const seen = new WeakSet<HTMLVideoElement>();
  const attach = (v: HTMLVideoElement) => {
    if (seen.has(v)) return;
    seen.add(v);
    v.addEventListener('timeupdate', () => {
      if (v.duration > 60) target.postMessage({ [HOOK_TAG]: 'video', payload: { t: v.currentTime, d: v.duration } }, '*');
    });
  };
  new MutationObserver(() => document.querySelectorAll('video').forEach(attach)).observe(document, {
    childList: true,
    subtree: true,
  });
}

async function onVideo(t: number, d: number) {
  const np = ui.np;
  if (!np || np.episodeId !== watchId()) return;
  ui.watched = t / d;
  if (ui.synced || ui.busy || !ui.settings.autoSync || !ui.loggedIn || ui.watched < ui.settings.syncThreshold) return;
  ui.busy = true;
  try {
    const r = await bg({ type: 'sync:episode', np });
    ui.match = r.match;
    ui.synced = true;
    if (r.entry) ui.entry = r.entry;
    if (r.changed && r.entry) {
      const title = r.match.media?.title.english ?? r.match.media?.title.romaji ?? np.seriesTitle;
      toast(`AniList: ${title} → ep ${r.entry.progress}${r.entry.status === 'COMPLETED' ? ' · completed 🎉' : ''}`);
    } else if (r.reason === 'unmatched') {
      toast(`Couldn't match “${np.seasonTitle}” on AniList — pick it in the Crunchy+ panel.`, 'warn');
    }
  } catch (e) {
    toast(`AniList sync failed: ${(e as Error).message}`, 'err');
  } finally {
    ui.busy = false;
  }
}

/**
 * Periodic AniList → Crunchyroll export *reminder*. Builds a read-only preview at most once per
 * configured interval and, if anything would change, offers to open the Export tab — nothing is
 * written to Crunchyroll until the user previews and clicks Apply there.
 */
async function maybeAutoExport() {
  const s = ui.settings;
  if (!s.autoExport) return;
  const last = await lastExportCheckItem.getValue();
  if (Date.now() - last < s.autoExportHours * 3600e3) return;
  // Claim the run across tabs: write a nonce, wait, and only proceed if ours survived.
  const me = Math.random().toString(36).slice(2);
  await exportClaimItem.setValue({ at: Date.now(), by: me });
  await new Promise((r) => setTimeout(r, 800));
  if ((await exportClaimItem.getValue())?.by !== me) return;
  await lastExportCheckItem.setValue(Date.now());
  try {
    const plan = await exportPlan({ fresh: false });
    const adds =
      (Array.isArray(plan.watchlistAdd) ? plan.watchlistAdd.length : 0) +
      (Array.isArray(plan.lists) ? plan.lists.reduce((k, l) => k + (l.add?.length ?? 0), 0) : 0);
    const removes = Array.isArray(plan.lists) ? plan.lists.reduce((k, l) => k + (l.remove?.length ?? 0), 0) : 0;
    if (!adds && !removes) return;
    const review = { label: 'Review', run: () => void bg({ type: 'hub:open', tab: 'export', review: true }).catch(() => {}) };

    if (s.autoApplyAdds && adds) {
      // Only write when we know the profile from the page's own requests (never fall back to a guess).
      const profile = await waitForPageProfile();
      if (profile) {
        const r = await exportApply({ ...plan, lists: plan.lists.map((l) => ({ ...l, remove: [] })) });
        const parts = [`${r.done} added${profile.name ? ` on “${profile.name}”` : ''}`];
        if (r.failed.length) parts.push(`${r.failed.length} failed`);
        if (removes) parts.push(`${removes} removal${removes === 1 ? '' : 's'} need review`);
        toast(`AniList → Crunchyroll: ${parts.join(', ')}.`, r.failed.length ? 'warn' : 'ok', removes ? review : undefined, 15000);
        if (ui.settings.badges || ui.settings.hideCompleted) startBadges().catch(() => {});
        return;
      }
      console.info('[Crunchy+] auto-apply skipped: active profile not confirmed by the page yet');
    }
    const n = adds + removes;
    toast(`AniList → Crunchyroll: ${n} change${n === 1 ? '' : 's'} ready to review.`, 'ok', review, 15000);
  } catch (e) {
    console.warn('[Crunchy+] export check', e);
  }
}

/** Resolve the active profile only once the page itself has revealed it (up to 20s). */
async function waitForPageProfile() {
  for (let i = 0; i < 40; i++) {
    const p = await cr.activeProfile().catch(() => null);
    if (p?.source === 'page') return p;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}
