<script lang="ts">
  import { crOp, type UpNextItem, sortUpNext, type UpNextSort } from '@/lib/messages';
  import { getSettings, patchSettings } from '@/lib/settings';
  import Segmented from '@/components/Segmented.svelte';
  import Busy from '@/components/Busy.svelte';
  import * as Table from '@/components/ui/table';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import Play from '@lucide/svelte/icons/play';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';

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
  const SORTS: { id: UpNextSort; label: string }[] = [
    { id: 'recent', label: 'Last watched' },
    { id: 'popular', label: 'Most popular' },
  ];
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

<section class="grid gap-4">
  <header class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <h2 class="mb-1 text-2xl font-bold tracking-[-0.02em]">Up next</h2>
      <p class="text-muted-foreground m-0">Your AniList <b>Watching</b> list, matched to Crunchyroll. Play picks up at the episode after your AniList progress.</p>
    </div>
    <div class="flex items-center gap-2.5">
      <Segmented options={SORTS} value={sort} ariaLabel="Order" size="sm" onchange={setSort} />
      <Button variant="outline" disabled={loading} onclick={load}>
        <RefreshCw class={loading ? 'animate-spin' : ''} aria-hidden="true" />{loading ? 'Loading…' : 'Refresh'}
      </Button>
    </div>
  </header>

  {#if loading && !items}<Busy {label} />{/if}
  {#if error}<p class="text-destructive m-0">{error}</p>{/if}

  {#if items}
    {#if ready.length}
      <div class="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
        {#each ready as it (it.aniId)}
          <a
            class="bg-card text-card-foreground group relative flex gap-3 rounded-[14px] p-2.5 no-underline ring-1 ring-foreground/10 transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:ring-primary focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            href={it.nextEpisode!.url}
            target="_blank"
            rel="noreferrer"
          >
            {#if it.cover}<img src={it.cover} alt="" class="h-[86px] w-[60px] flex-none rounded-lg object-cover" />{/if}
            <div class="grid min-w-0 content-center gap-0.5">
              <b class="truncate">{it.title}</b>
              <span class="text-muted-foreground truncate">Ep {it.progress + 1}{it.nextEpisode!.title ? ` · ${it.nextEpisode!.title}` : ''}</span>
              <span class="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
                {#if it.available && it.available > 1}<Badge class="h-4 px-1.5 text-[11px]">{it.available} to watch</Badge>{/if}
                {it.progress}{it.total ? `/${it.total}` : ''} on AniList
              </span>
            </div>
            <Play class="text-primary absolute right-3 bottom-2.5 size-4 fill-current opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
          </a>
        {/each}
      </div>
    {:else if !loading}
      <p class="text-muted-foreground m-0">Nothing ready to watch — you're caught up.</p>
    {/if}

    {#if waiting.length}
      <h3 class="text-muted-foreground mt-3 text-xs font-semibold tracking-[0.08em] uppercase">Caught up / not found</h3>
      <Table.Root>
        <Table.Body>
          {#each waiting as it (it.aniId)}
            <Table.Row class="hover:bg-transparent">
              <Table.Cell class="w-full px-0 whitespace-normal">{it.title}</Table.Cell>
              <Table.Cell class="text-muted-foreground px-3">
                {#if !it.seriesId}not found on Crunchyroll
                {:else if it.error}<span class="text-destructive">{it.error}</span>
                {:else if it.airing}ep {it.airing.episode} airs {airsIn(it.airing.airingAt)}
                {:else}caught up ({it.progress}{it.total ? `/${it.total}` : ''}){/if}
              </Table.Cell>
              <Table.Cell class="px-0 text-right">
                {#if it.seriesId}<a href={`https://www.crunchyroll.com/series/${it.seriesId}`} target="_blank" rel="noreferrer">series</a>{/if}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {/if}
  {/if}
</section>
