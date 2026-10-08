<script lang="ts">
  import { sortUpNext, type UpNextItem, type UpNextSort } from '@/lib/messages';
  import { getSettings, patchSettings } from '@/lib/settings';

  let { load }: { load: () => Promise<UpNextItem[]> } = $props();
  let raw = $state<UpNextItem[] | null>(null);
  let failed = $state(false);
  let sort = $state<UpNextSort>('recent');
  const items = $derived(raw && sortUpNext(raw, sort));

  $effect(() => {
    getSettings().then((s) => (sort = s.upNextSort));
  });
  function setSort(next: UpNextSort) {
    sort = next;
    patchSettings({ upNextSort: next });
  }

  $effect(() => {
    load()
      .then((r) => (raw = Array.isArray(r) ? r.filter((i) => i.nextEpisode) : []))
      .catch(() => (failed = true));
  });
</script>

{#if !failed && (items === null || items.length)}
  <section class="row" aria-label="Up next from AniList">
    <header>
      <h2>Up next <span>from AniList</span></h2>
      <div class="seg" role="radiogroup" aria-label="Order">
        <button role="radio" aria-checked={sort === 'recent'} class:on={sort === 'recent'} onclick={() => setSort('recent')}>Last watched</button>
        <button role="radio" aria-checked={sort === 'popular'} class:on={sort === 'popular'} onclick={() => setSort('popular')}>Most popular</button>
      </div>
    </header>
    <div class="scroller">
      {#if items === null}
        {#each Array(6) as _}<div class="card skeleton"></div>{/each}
      {:else}
        {#each items as it (it.aniId)}
          <a class="card" href={it.nextEpisode!.url}>
            <div class="art">
              {#if it.cover}<img src={it.cover} alt="" loading="lazy" />{/if}
              {#if it.available && it.available > 1}<span class="count">{it.available} new</span>{/if}
              <span class="play" aria-hidden="true">▶</span>
            </div>
            <b>{it.title}</b>
            <small>Ep {it.progress + 1}{it.nextEpisode!.title ? ` · ${it.nextEpisode!.title}` : ''}</small>
          </a>
        {/each}
      {/if}
    </div>
  </section>
{/if}

<style>
  /* Gutter/font come from CR's own rows (set on the host by matchFeedStyle). */
  .row {
    /* Inherited properties cross the shadow boundary (font-size: 0, text-fill, visibility… set on
       CR's feed wrappers hid all text). Reset everything, then declare what the row needs. */
    all: initial;
    display: block;
    -webkit-text-fill-color: currentColor;
    visibility: visible;
    --accent: #ff7a1a;
    --muted: #a0a0a0;
    box-sizing: border-box;
    width: 100%;
    max-width: var(--cr-max-width, none);
    margin: 0 auto 32px;
    padding: 0 var(--cr-gutter-right, 4vw) 0 var(--cr-gutter-left, 4vw);
    /* Family from CR; size set explicitly — CR wrappers use font-size: 0 for inline layout. */
    font-family: var(--cr-title-font, Lato, 'Helvetica Neue', system-ui, sans-serif);
    font-size: 14px;
    line-height: 1.4;
    color: #fff;
    overflow: hidden; /* never widen the page */
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .seg {
    display: inline-flex;
    padding: 3px;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.08);
  }
  .seg button {
    font: 600 12px/1 system-ui, sans-serif;
    color: var(--muted);
    background: none;
    border: 0;
    padding: 6px 12px;
    border-radius: 999px;
    cursor: pointer;
  }
  .seg button.on {
    background: var(--accent);
    color: #160b02;
  }
  h2 {
    margin: 0;
    font-family: var(--cr-title-font, inherit);
    font-size: var(--cr-title-size, 22px);
    font-weight: var(--cr-title-weight, 700);
  }
  h2 span {
    color: var(--accent);
    font-weight: 700;
    font-size: 15px;
    margin-left: 6px;
  }
  .scroller {
    min-width: 0;
    max-width: 100%;
    overscroll-behavior-x: contain;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: clamp(140px, 13vw, 190px);
    gap: 16px;
    overflow-x: auto;
    padding-bottom: 10px;
    scroll-snap-type: x proximity;
    scrollbar-width: thin;
  }
  .card {
    display: grid;
    gap: 4px;
    color: inherit;
    text-decoration: none;
    scroll-snap-align: start;
  }
  .art {
    position: relative;
    aspect-ratio: 2 / 3;
    border-radius: 12px;
    overflow: hidden;
    background: #1c1f27;
    transition:
      transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1),
      box-shadow 200ms ease;
  }
  .card:hover .art,
  .card:focus-visible .art {
    transform: translateY(-3px);
    box-shadow: 0 16px 34px -16px rgb(0 0 0 / 0.85);
  }
  .card:focus-visible {
    outline: none;
  }
  .card:focus-visible .art {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  b {
    font-size: 14px;
    font-weight: 700;
  }
  small {
    font-size: 12px;
  }
  .count {
    position: absolute;
    left: 8px;
    bottom: 8px;
    padding: 3px 8px;
    border-radius: 999px;
    background: var(--accent);
    color: #160b02;
    font: 700 11px/1.3 system-ui, sans-serif;
  }
  .play {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 30px;
    color: #fff;
    background: rgb(0 0 0 / 0.35);
    opacity: 0;
    transition: opacity 160ms ease;
  }
  .card:hover .play {
    opacity: 1;
  }
  b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  small {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .skeleton {
    aspect-ratio: 2 / 3;
    border-radius: 12px;
    background: linear-gradient(90deg, #1c1f27, #242832, #1c1f27);
    background-size: 200% 100%;
    animation: shimmer 1.2s linear infinite;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .art,
    .play,
    .skeleton {
      transition: none;
      animation: none;
    }
  }
</style>
