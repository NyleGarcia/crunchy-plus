<script lang="ts">
  import UpNext from '@/components/UpNext.svelte';
  import ImportPanel from '@/components/ImportPanel.svelte';
  import UndoPanel from '@/components/UndoPanel.svelte';
  import ExportPanel from '@/components/ExportPanel.svelte';
  import * as Tabs from '@/components/ui/tabs';
  import * as Tooltip from '@/components/ui/tooltip';

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
  // Local builds carry `X.Y.Z-dev (local <sha>)` in version_name (wxt.config.ts); releases only `version`.
  const manifest = browser.runtime.getManifest();
  const version = manifest.version_name ?? manifest.version;

  $effect(() => {
    const onHash = () => (tab = fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });

  /** Tabs → `#tab` (deep links from the popup / toasts); arrow keys, Home and End come from the Tabs primitive. */
  function select(id: string) {
    if (!TABS.some((t) => t.id === id)) return;
    tab = id as Tab;
    if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
  }
</script>

<Tooltip.Provider delayDuration={300}>
  <Tabs.Root value={tab} onValueChange={select} class="mx-auto max-w-[1100px] gap-6 px-6 pt-8 pb-12 max-[520px]:px-3">
    <header class="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 max-[520px]:flex-col max-[520px]:items-stretch">
      <div class="flex items-baseline gap-2">
        <h1 class="m-0 text-[22px] font-bold tracking-[-0.01em]">Crunchy<span class="text-primary">+</span></h1>
        <span class="text-muted-foreground text-xs tabular-nums">{version}</span>
      </div>
      <Tabs.List aria-label="Sections" class="grid h-auto w-auto grid-flow-col auto-cols-fr rounded-[10px] border border-border bg-white/5 p-[3px]">
        {#each TABS as t (t.id)}
          <Tabs.Trigger
            id={`tab-${t.id}`}
            value={t.id}
            class="rounded-lg px-4 py-2 text-[13px] font-semibold text-muted-foreground hover:text-foreground data-active:bg-primary data-active:text-primary-foreground data-active:shadow-none max-[520px]:px-1.5"
          >
            {t.label}
          </Tabs.Trigger>
        {/each}
      </Tabs.List>
    </header>

    {#each TABS as t (t.id)}
      <Tabs.Content value={t.id} class="min-w-0 text-[13px]">
        {#if tab === t.id}
          {#if t.id === 'upnext'}
            <UpNext />
          {:else if t.id === 'import'}
            <div class="grid gap-6">
              <ImportPanel />
              <UndoPanel />
            </div>
          {:else}
            <ExportPanel />
          {/if}
        {/if}
      </Tabs.Content>
    {/each}
  </Tabs.Root>
</Tooltip.Provider>
