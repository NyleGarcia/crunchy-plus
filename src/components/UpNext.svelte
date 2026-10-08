<script lang="ts">
  import { crOp, type UpNextItem, sortUpNext, type UpNextSort } from '@/lib/messages';
  import { getSettings, patchSettings } from '@/lib/settings';

  let items = $state<UpNextItem[] | null>(null);
  let loading = $state(false);
  let label = $state('');
  let error = $state('');

  let sort = $state<UpNextSort>('recent');
  $effect(() => {
    getSettings().then((s) => (sort = s.upNextSort));
  });
  function setSort(next: UpNextSort) {
    sort = next;
    patchSettings({ upNextSort: next });
  }
  const ready = $derived(sortUpNext(items?.filter((i) => i.nextEpisode) ?? [], sort));
  const waiting = $derived(items?.filter((i) => !i.nextEpisode) ?? []);

  $effect(() => {
    const l = (msg: { type?: string; label?: string }) => {
      if (msg?.type === 'cr:progress' && msg.label) label = msg.label;
    };
    browser.runtime.onMessage.addListener(l);
    load();
    return () => browser.runtime.onMessage.removeListener(l);
  });

  async function load() {
    loading = true;
    error = '';
    try {
      items = await crOp('upnext');
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  function airsIn(at: number) {
    const h = Math.round((at * 1000 - Date.now()) / 3600e3);
    return h < 1 ? 'within the hour' : h < 48 ? `in ${h}h` : `in ${Math.round(h / 24)}d`;
  }
</script>

<section class="pane">
  <header class="head">
    <div>
      <h2>Up next</h2>
      <p class="muted">Your AniList <b>Watching</b> list, matched to Crunchyroll. Play picks up at the episode after your AniList progress.</p>
    </div>
    <div class="actions">
      <div class="seg" role="radiogroup" aria-label="Order">
        <button role="radio" aria-checked={sort === 'recent'} class:on={sort === 'recent'} onclick={() => setSort('recent')}>Last watched</button>
        <button role="radio" aria-checked={sort === 'popular'} class:on={sort === 'popular'} onclick={() => setSort('popular')}>Most popular</button>
      </div>
      <button class="btn" disabled={loading} onclick={load}>{loading ? 'Loading…' : 'Refresh'}</button>
    </div>
  </header>

  {#if loading && !items}<p class="status"><span class="spin"></span>{label || 'Loading…'}</p>{/if}
  {#if error}<p class="err">{error}</p>{/if}

  {#if items}
    {#if ready.length}
      <div class="grid">
        {#each ready as it (it.aniId)}
          <a class="card" href={it.nextEpisode!.url} target="_blank" rel="noreferrer">
            {#if it.cover}<img src={it.cover} alt="" />{/if}
            <div class="body">
              <b>{it.title}</b>
              <span class="ep">Ep {it.progress + 1}{it.nextEpisode!.title ? ` · ${it.nextEpisode!.title}` : ''}</span>
              <span class="meta">
                {#if it.available && it.available > 1}<em class="new">{it.available} to watch</em>{/if}
                {it.progress}{it.total ? `/${it.total}` : ''} on AniList
              </span>
            </div>
            <span class="play" aria-hidden="true">▶</span>
          </a>
        {/each}
      </div>
    {:else if !loading}
      <p class="muted">Nothing ready to watch — you're caught up.</p>
    {/if}

    {#if waiting.length}
      <h3>Caught up / not found</h3>
      <ul class="rows">
        {#each waiting as it (it.aniId)}
          <li>
            <span class="t">{it.title}</span>
            <span class="muted">
              {#if !it.seriesId}not found on Crunchyroll
              {:else if it.error}<span class="err">{it.error}</span>
              {:else if it.airing}ep {it.airing.episode} airs {airsIn(it.airing.airingAt)}
              {:else}caught up ({it.progress}{it.total ? `/${it.total}` : ''}){/if}
            </span>
            {#if it.seriesId}<a href={`https://www.crunchyroll.com/series/${it.seriesId}`} target="_blank" rel="noreferrer">series</a>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .pane {
    display: grid;
    gap: 16px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
  }
  h2 {
    margin: 0 0 4px;
    font-size: 24px;
    letter-spacing: -0.02em;
  }
  h3 {
    margin: 12px 0 0;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  p {
    margin: 0;
  }
  .actions {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .seg {
    display: inline-flex;
    padding: 3px;
    border-radius: 10px;
    background: rgb(255 255 255 / 0.05);
  }
  .seg button {
    border: 0;
    background: none;
    padding: 6px 12px;
    border-radius: 8px;
    color: var(--muted);
    font-weight: 600;
  }
  .seg button.on {
    background: var(--accent);
    color: #160b02;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 12px;
  }
  .card {
    position: relative;
    display: flex;
    gap: 12px;
    padding: 10px;
    border-radius: 14px;
    background: var(--surface);
    border: 1px solid var(--line);
    color: var(--text);
    text-decoration: none;
    transition:
      transform 160ms ease,
      border-color 160ms ease;
  }
  .card:hover {
    transform: translateY(-2px);
    border-color: var(--accent);
  }
  .card img {
    width: 60px;
    height: 86px;
    object-fit: cover;
    border-radius: 8px;
    flex: none;
  }
  .body {
    display: grid;
    align-content: center;
    gap: 3px;
    min-width: 0;
  }
  .body b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ep {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: 12px;
    color: var(--muted);
  }
  .new {
    font-style: normal;
    color: var(--accent);
    font-weight: 600;
    margin-right: 6px;
  }
  .play {
    position: absolute;
    right: 12px;
    bottom: 10px;
    color: var(--accent);
    opacity: 0;
    transition: opacity 160ms ease;
  }
  .card:hover .play {
    opacity: 1;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .rows li {
    display: flex;
    gap: 12px;
    align-items: baseline;
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
  }
  .rows .t {
    flex: 1;
    min-width: 0;
  }
  .status {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .spin {
    width: 12px;
    height: 12px;
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
  .err {
    color: var(--err);
  }
</style>
