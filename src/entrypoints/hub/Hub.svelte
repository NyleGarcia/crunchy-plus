<script lang="ts">
  import UpNext from '@/components/UpNext.svelte';
  import ImportPanel from '@/components/ImportPanel.svelte';
  import UndoPanel from '@/components/UndoPanel.svelte';
  import ExportPanel from '@/components/ExportPanel.svelte';

  type Tab = 'upnext' | 'import' | 'export';
  const TABS: { id: Tab; label: string }[] = [
    { id: 'upnext', label: 'Up next' },
    { id: 'import', label: 'Import' },
    { id: 'export', label: 'Export' },
  ];

  function fromHash(): Tab {
    const h = location.hash.slice(1);
    return TABS.some((t) => t.id === h) ? (h as Tab) : 'upnext';
  }

  let tab = $state<Tab>(fromHash());

  $effect(() => {
    const onHash = () => (tab = fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });

  function select(id: Tab) {
    tab = id;
    if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
  }

  function onKey(e: KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === tab);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = TABS.length - 1;
    const next = TABS[n];
    if (!next) return;
    e.preventDefault();
    select(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }
</script>

<div class="wrap">
  <header>
    <h1>Crunchy<span>+</span></h1>
    <div class="tabs" role="tablist" aria-label="Sections" tabindex="-1" onkeydown={onKey}>
      {#each TABS as t (t.id)}
        <button
          id={`tab-${t.id}`}
          role="tab"
          aria-selected={tab === t.id}
          aria-controls="panel"
          tabindex={tab === t.id ? 0 : -1}
          class:on={tab === t.id}
          onclick={() => select(t.id)}
        >
          {t.label}
        </button>
      {/each}
    </div>
  </header>

  <div id="panel" class="panel" role="tabpanel" aria-labelledby={`tab-${tab}`} tabindex="0">
    {#if tab === 'upnext'}
      <UpNext />
    {:else if tab === 'import'}
      <div class="stack">
        <ImportPanel />
        <UndoPanel />
      </div>
    {:else}
      <ExportPanel />
    {/if}
  </div>
</div>

<style>
  .wrap {
    max-width: 1100px;
    margin: 0 auto;
    padding: 32px 24px 48px;
    display: grid;
    gap: 24px;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 20px;
  }
  h1 {
    margin: 0;
    font-size: 22px;
    letter-spacing: -0.01em;
  }
  h1 span {
    color: var(--accent);
  }
  .tabs {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    padding: 3px;
    border-radius: 10px;
    background: rgb(255 255 255 / 0.05);
    border: 1px solid var(--line);
  }
  .tabs button {
    border: 0;
    background: none;
    padding: 8px 16px;
    border-radius: 8px;
    color: var(--muted);
    font-weight: 650;
    white-space: nowrap;
  }
  .tabs button:hover {
    color: var(--text);
  }
  .tabs button.on {
    background: var(--accent);
    color: #160b02;
  }
  .tabs button:focus-visible,
  .panel:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .panel {
    min-width: 0;
  }
  .stack {
    display: grid;
    gap: 24px;
  }
  @media (max-width: 520px) {
    .wrap {
      padding: 32px 12px;
    }
    header {
      flex-direction: column;
      align-items: stretch;
    }
    .tabs button {
      padding: 8px 6px;
    }
  }
</style>
