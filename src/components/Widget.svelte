<script lang="ts">
  import { bg } from '@/lib/messages';
  import { patchSettings } from '@/lib/settings';
  import { toast, ui } from '@/lib/state.svelte';
  import { seasonKey, type AniMedia, type ListStatus, type Mode } from '@/lib/types';

  let open = $state(false);
  let picking = $state(false);
  let query = $state('');
  let results = $state<AniMedia[]>([]);

  const media = $derived(ui.match?.media ?? null);
  const total = $derived(media?.episodes ?? ui.np?.seasonEpisodes ?? null);
  const needsPick = $derived(!!ui.np && ui.loggedIn && ui.match?.mediaId === null);
  const candidates = $derived(results.length ? results : (ui.match?.candidates ?? []).map((c) => c.media));

  const MODES: { id: Mode; label: string; hint: string }[] = [
    { id: 'sub', label: 'Sub', hint: 'Original audio only — dubs hidden' },
    { id: 'dub', label: 'Dub', hint: 'Your dub language when available' },
    { id: 'all', label: 'All', hint: 'Stock Crunchyroll' },
  ];
  const STATUSES: ListStatus[] = ['CURRENT', 'PLANNING', 'COMPLETED', 'PAUSED', 'DROPPED', 'REPEATING'];
  const label = (s: string) => s[0] + s.slice(1).toLowerCase();
  const titleOf = (m: AniMedia) => m.title.english ?? m.title.romaji ?? m.title.native ?? `#${m.id}`;

  async function setMode(mode: Mode) {
    await patchSettings({ mode });
  }

  async function save(patch: { status?: ListStatus; progress?: number }) {
    if (!media) return;
    try {
      ui.entry = await bg({ type: 'anilist:save', mediaId: media.id, patch });
      toast('Saved to AniList');
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }

  async function search() {
    if (!query.trim()) return;
    results = await bg({ type: 'anilist:search', q: query.trim() }).catch(() => []);
  }

  async function pick(id: number) {
    if (!ui.np) return;
    const key = seasonKey(ui.np.seriesId, ui.np.seasonId);
    ui.match = await bg({ type: 'match:set', key, mediaId: id });
    ui.entry = ui.match.media?.mediaListEntry ?? null;
    picking = false;
    results = [];
    if (id && ui.watched >= ui.settings.syncThreshold) {
      const r = await bg({ type: 'sync:episode', np: ui.np });
      if (r.entry) ui.entry = r.entry;
      ui.synced = true;
    }
  }

  function startPick() {
    picking = true;
    query = ui.np?.seasonTitle ?? '';
  }
</script>

<div class="root">
  <div class="toasts" aria-live="polite">
    {#each ui.toasts as t (t.id)}
      <div class="toast {t.tone}">
        <span>{t.text}</span>
        {#if t.action}<button onclick={t.action.run}>{t.action.label}</button>{/if}
      </div>
    {/each}
  </div>

  {#if open}
    <section class="panel" aria-label="Crunchy+">
      <header>
        <strong>Crunchy+</strong>
        <button class="ghost" aria-label="Close" onclick={() => (open = false)}>✕</button>
      </header>

      <div class="seg" role="radiogroup" aria-label="Audio mode">
        {#each MODES as m}
          <button
            role="radio"
            aria-checked={ui.settings.mode === m.id}
            class:on={ui.settings.mode === m.id}
            title={m.hint}
            onclick={() => setMode(m.id)}>{m.label}</button
          >
        {/each}
      </div>

      {#if !ui.loggedIn}
        <p class="muted">Connect AniList from the extension popup to sync progress.</p>
      {:else if !ui.np}
        <p class="muted">Open an episode to see its AniList entry.</p>
      {:else if needsPick || picking}
        <p class="muted">Which AniList entry is <b>{ui.np.seasonTitle}</b>?</p>
        <form class="search" onsubmit={(e) => (e.preventDefault(), search())}>
          <input bind:value={query} placeholder="Search AniList" />
          <button>Search</button>
        </form>
        <ul class="cands">
          {#each candidates as c (c.id)}
            <li>
              <button onclick={() => pick(c.id)}>
                {#if c.coverImage.medium}<img src={c.coverImage.medium} alt="" />{/if}
                <span>
                  <b>{titleOf(c)}</b>
                  <small>{c.format ?? '?'} · {c.seasonYear ?? '?'} · {c.episodes ?? '?'} eps</small>
                </span>
              </button>
            </li>
          {/each}
        </ul>
        <button class="ghost small" onclick={() => pick(0)}>Not on AniList — don't sync this season</button>
      {:else if ui.match?.mediaId === 0}
        <p class="muted">Sync disabled for this season.</p>
        <button class="ghost small" onclick={startPick}>Pick an entry</button>
      {:else if media}
        <div class="entry">
          {#if media.coverImage.medium}<img src={media.coverImage.medium} alt="" />{/if}
          <div>
            <a href={`https://anilist.co/anime/${media.id}`} target="_blank" rel="noreferrer">{titleOf(media)}</a>
            <small>CR ep {ui.np.progress}{total ? ` / ${total}` : ''}</small>
            <div class="row">
              <select
                value={ui.entry?.status ?? ''}
                onchange={(e) => save({ status: (e.currentTarget as HTMLSelectElement).value as ListStatus })}
              >
                {#if !ui.entry}<option value="" disabled>Not on list</option>{/if}
                {#each STATUSES as s}<option value={s}>{label(s)}</option>{/each}
              </select>
              <div class="stepper">
                <button aria-label="Decrease progress" onclick={() => save({ progress: Math.max(0, (ui.entry?.progress ?? 0) - 1) })}>−</button>
                <span>{ui.entry?.progress ?? 0}</span>
                <button aria-label="Increase progress" onclick={() => save({ progress: (ui.entry?.progress ?? 0) + 1 })}>+</button>
              </div>
            </div>
          </div>
        </div>
        <div class="bar" title="Watched">
          <i style:width={`${Math.min(100, ui.watched * 100)}%`}></i>
          <em style:left={`${ui.settings.syncThreshold * 100}%`}></em>
        </div>
        <small class="muted">
          {ui.synced ? '✓ Synced this episode' : ui.settings.autoSync ? `Auto-sync at ${Math.round(ui.settings.syncThreshold * 100)}%` : 'Auto-sync off'}
          · <button class="link" onclick={startPick}>wrong entry?</button>
        </small>
      {:else}
        <p class="muted">Finding AniList entry…</p>
      {/if}
    </section>
  {/if}

  <button class="pill" class:alert={needsPick} onclick={() => (open = !open)} aria-expanded={open}>
    <span class="dot" class:ok={ui.synced}></span>
    {ui.settings.mode.toUpperCase()}
    {#if ui.busy}<span class="spin"></span>{/if}
  </button>
</div>

<style>
  .root {
    --bg: rgb(17 18 24 / 0.92);
    --line: rgb(255 255 255 / 0.09);
    --text: #eceef3;
    --muted: #9da1b0;
    --accent: #ff7a1a;
    --ok: #3ddc97;
    position: fixed;
    right: 18px;
    bottom: 18px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: var(--text);
  }
  button {
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--bg);
    backdrop-filter: blur(14px);
    font-weight: 650;
    letter-spacing: 0.06em;
    box-shadow: 0 10px 30px -12px rgb(0 0 0 / 0.7);
    transition: transform 150ms ease;
  }
  .pill:hover {
    transform: translateY(-1px);
  }
  .pill.alert {
    border-color: var(--accent);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
  }
  .dot.ok {
    background: var(--ok);
  }
  .spin {
    width: 10px;
    height: 10px;
    border: 2px solid var(--muted);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .panel {
    width: 320px;
    max-height: 70vh;
    overflow: auto;
    padding: 14px;
    border-radius: 16px;
    border: 1px solid var(--line);
    background: var(--bg);
    backdrop-filter: blur(18px) saturate(150%);
    box-shadow: 0 24px 60px -20px rgb(0 0 0 / 0.85);
    display: grid;
    gap: 12px;
    animation: rise 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .ghost {
    background: none;
    border: 0;
    color: var(--muted);
    padding: 4px;
  }
  .small {
    font-size: 12px;
    text-align: left;
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
  }
  .muted {
    color: var(--muted);
    margin: 0;
  }
  .seg {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    padding: 3px;
    border-radius: 10px;
    background: rgb(255 255 255 / 0.05);
  }
  .seg button {
    border: 0;
    background: none;
    padding: 6px 0;
    border-radius: 8px;
    color: var(--muted);
    font-weight: 600;
  }
  .seg button.on {
    background: var(--accent);
    color: #160b02;
  }
  .entry {
    display: flex;
    gap: 12px;
  }
  .entry img {
    width: 56px;
    height: 80px;
    object-fit: cover;
    border-radius: 8px;
  }
  .entry > div {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .entry a {
    color: var(--text);
    font-weight: 650;
    text-decoration: none;
  }
  .entry small {
    color: var(--muted);
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  select,
  input {
    font: inherit;
    color: var(--text);
    background: rgb(255 255 255 / 0.06);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 5px 8px;
  }
  .stepper {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .stepper button {
    border: 0;
    background: none;
    width: 26px;
    height: 28px;
  }
  .stepper span {
    min-width: 24px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .bar {
    position: relative;
    height: 4px;
    border-radius: 2px;
    background: rgb(255 255 255 / 0.08);
  }
  .bar i {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent);
    border-radius: 2px;
  }
  .bar em {
    position: absolute;
    top: -3px;
    width: 2px;
    height: 10px;
    background: var(--text);
    opacity: 0.5;
  }
  .search {
    display: flex;
    gap: 6px;
  }
  .search input {
    flex: 1;
  }
  .search button {
    border: 1px solid var(--line);
    background: rgb(255 255 255 / 0.06);
    border-radius: 8px;
    padding: 0 10px;
  }
  .cands {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .cands button {
    width: 100%;
    display: flex;
    gap: 10px;
    align-items: center;
    text-align: left;
    border: 1px solid transparent;
    background: none;
    padding: 6px;
    border-radius: 10px;
  }
  .cands button:hover {
    border-color: var(--line);
    background: rgb(255 255 255 / 0.04);
  }
  .cands img {
    width: 32px;
    height: 46px;
    object-fit: cover;
    border-radius: 5px;
  }
  .cands span {
    display: grid;
  }
  .cands small {
    color: var(--muted);
  }
  .toasts {
    display: grid;
    gap: 8px;
    justify-items: end;
  }
  .toast {
    display: flex;
    gap: 10px;
    align-items: center;
    max-width: 340px;
    padding: 10px 14px;
    border-radius: 12px;
    background: var(--bg);
    border: 1px solid var(--line);
    border-left: 3px solid var(--ok);
    box-shadow: 0 12px 30px -14px rgb(0 0 0 / 0.8);
    animation: rise 160ms ease;
  }
  .toast.warn {
    border-left-color: var(--accent);
  }
  .toast.err {
    border-left-color: #ff5470;
  }
  .toast button {
    border: 0;
    background: none;
    color: var(--accent);
    font-weight: 600;
  }
  @media (prefers-reduced-motion: reduce) {
    .panel,
    .toast,
    .pill {
      animation: none;
      transition: none;
    }
  }
</style>
