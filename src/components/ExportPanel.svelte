<script lang="ts">
  import { crOp, type ExportPlan, type ExportResult } from '@/lib/messages';
  import { getSettings, lastExportItem, patchSettings, type Settings } from '@/lib/settings';
  import { STATUS_LABEL, type ListStatus } from '@/lib/types';
  import Busy from '@/components/Busy.svelte';
  import * as Card from '@/components/ui/card';
  import * as Collapsible from '@/components/ui/collapsible';
  import * as Table from '@/components/ui/table';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { Checkbox } from '@/components/ui/checkbox';
  import { Input } from '@/components/ui/input';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Minus from '@lucide/svelte/icons/minus';
  import Plus from '@lucide/svelte/icons/plus';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  const STATUSES = Object.keys(STATUS_LABEL) as ListStatus[];

  let settings = $state<Settings | null>(null);
  let plan = $state<ExportPlan | null>(null);
  let result = $state<ExportResult | null>(null);
  let loading = $state(false);
  let applying = $state(false);
  let label = $state('');
  let error = $state('');
  let lastExport = $state(0);

  const changes = $derived(
    plan
      ? (Array.isArray(plan.watchlistAdd) ? plan.watchlistAdd.length : 0) +
          (Array.isArray(plan.lists) ? plan.lists.reduce((n, l) => n + (l.add?.length ?? 0) + (l.remove?.length ?? 0), 0) : 0)
      : 0,
  );

  $effect(() => {
    const l = (msg: { type?: string; label?: string }) => {
      if (msg?.type === 'cr:progress' && msg.label) label = msg.label;
    };
    browser.runtime.onMessage.addListener(l);
    let alive = true;
    getSettings().then((s) => {
      if (!alive) return;
      settings = s;
      // Opened from the "changes ready — Review" toast: build the preview; Apply still needs a click.
      if (new URLSearchParams(location.search).has('review')) {
        history.replaceState(null, '', location.pathname + location.hash);
        preview();
      }
    });
    lastExportItem.getValue().then((t) => {
      if (alive) lastExport = t;
    });
    return () => {
      alive = false;
      browser.runtime.onMessage.removeListener(l);
    };
  });

  async function save(patch: Partial<Settings>) {
    if (!settings) return;
    settings = { ...settings, ...patch };
    // Settings changed → the old preview no longer reflects them.
    plan = null;
    result = null;
    try {
      await patchSettings(patch);
    } catch (e) {
      error = (e as Error).message;
    }
  }

  function toggleStatus(key: 'exportWatchlist' | 'exportLists', status: ListStatus, on: boolean) {
    if (!settings) return;
    const cur = Array.isArray(settings[key]) ? settings[key] : [];
    const next = on ? [...new Set([...cur, status])] : cur.filter((s) => s !== status);
    // Keep a stable order (the planner builds lists in this order).
    save({ [key]: STATUSES.filter((s) => next.includes(s)) });
  }

  function setHours(v: number) {
    const h = Math.min(72, Math.max(1, Math.round(Number.isFinite(v) ? v : 6)));
    save({ autoExportHours: h });
  }

  async function preview() {
    loading = true;
    error = '';
    label = '';
    plan = null;
    result = null;
    try {
      plan = await crOp('exportPlan');
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function apply() {
    if (!plan || !changes) return;
    applying = true;
    error = '';
    label = '';
    try {
      result = await crOp('exportApply', $state.snapshot(plan) as ExportPlan);
      if (result && result.done > 0) {
        const now = Date.now();
        await lastExportItem.setValue(now);
        lastExport = now;
      }
      plan = null;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      applying = false;
    }
  }

  const ago = (t: number) => {
    const m = Math.round((Date.now() - t) / 60e3);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
  };

  const H3 = 'text-muted-foreground mt-1 flex items-center gap-2 text-xs font-semibold tracking-[0.08em] uppercase';
  const ROW = 'flex items-center gap-2';
  const LIST = 'm-0 grid list-none gap-1 p-0';
</script>

{#snippet add(title: string, seriesId: string, crTitle: string | null | undefined)}
  <li class="flex items-center gap-1.5">
    <Plus class="text-success size-3.5 shrink-0" aria-hidden="true" /> {title}
    <span class="text-muted-foreground">→ <a href="https://www.crunchyroll.com/series/{seriesId}" target="_blank" rel="noreferrer">{crTitle ?? 'Crunchyroll'}</a></span>
  </li>
{/snippet}

<section class="grid gap-4">
  <header class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <h2 class="mb-1 text-2xl font-bold tracking-[-0.02em]">Export to Crunchyroll</h2>
      <p class="text-muted-foreground m-0">
        Push your AniList list onto Crunchyroll's Watchlist and Crunchylists. Nothing changes until you preview and apply.
        {#if lastExport}Last export {ago(lastExport)}.{/if}
      </p>
    </div>
    <Button disabled={loading || applying || !settings} onclick={preview}>
      {loading ? 'Planning…' : 'Preview'}
    </Button>
  </header>

  {#if settings}
    <Card.Root size="sm" class="gap-2.5 shadow-none">
      <Card.Content class="grid gap-2.5">
        <Table.Root>
          <Table.Header>
            <Table.Row class="hover:bg-transparent">
              <Table.Head></Table.Head>
              <Table.Head class="text-muted-foreground h-auto pb-1.5 text-center text-xs whitespace-normal">Add to Crunchyroll Watchlist</Table.Head>
              <Table.Head class="text-muted-foreground h-auto pb-1.5 text-center text-xs whitespace-normal">Mirror as Crunchylists “AniList · &lt;status&gt;”</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each STATUSES as st (st)}
              <Table.Row class="hover:bg-transparent">
                <Table.Cell class="py-1 font-semibold">{STATUS_LABEL[st]}</Table.Cell>
                <Table.Cell class="py-1 text-center [&:has([role=checkbox])]:pr-2">
                  <Checkbox
                    class="mx-auto"
                    aria-label="Watchlist: {STATUS_LABEL[st]}"
                    checked={settings.exportWatchlist.includes(st)}
                    onCheckedChange={(v) => toggleStatus('exportWatchlist', st, v)}
                  />
                </Table.Cell>
                <Table.Cell class="py-1 text-center [&:has([role=checkbox])]:pr-2">
                  <Checkbox
                    class="mx-auto"
                    aria-label="Crunchylist: {STATUS_LABEL[st]}"
                    checked={settings.exportLists.includes(st)}
                    onCheckedChange={(v) => toggleStatus('exportLists', st, v)}
                  />
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
        <p class="text-muted-foreground m-0 text-xs">The Watchlist is add-only — Crunchy+ never removes anything from it.</p>

        <label class={ROW}>
          <Checkbox checked={settings.mirrorLists} onCheckedChange={(v) => save({ mirrorLists: v })} />
          <span>
            Mirror lists
            <span class="text-muted-foreground">— remove shows that left the status (only touches lists Crunchy+ created)</span>
          </span>
        </label>

        <div class={ROW}>
          <label class={ROW}>
            <Checkbox checked={settings.autoExport} onCheckedChange={(v) => save({ autoExport: v })} />
            <span>Check for changes every</span>
          </label>
          <Input
            class="h-7 w-16"
            type="number"
            min="1"
            max="72"
            aria-label="Hours between checks"
            value={settings.autoExportHours}
            disabled={!settings.autoExport}
            onchange={(e) => setHours(e.currentTarget.valueAsNumber)}
          />
          <span>hours</span>
        </div>
        {#if settings.autoExport}
          <label class={ROW}>
            <Checkbox checked={settings.autoApplyAdds} onCheckedChange={(v) => save({ autoApplyAdds: v })} />
            <span>Apply additions automatically</span>
          </label>
          <p class="text-muted-foreground m-0 text-xs">
            On your next Crunchyroll visit after {settings.autoExportHours} hours, Crunchy+ checks for changes.
            {settings.autoApplyAdds
              ? 'Additions are applied automatically, only after the page confirms which profile you are on. Removals always wait for your review.'
              : 'You get a reminder with a preview; nothing is applied without your click.'}
          </p>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}

  {#if loading || applying}<Busy {label} fallback={applying ? 'Updating Crunchyroll…' : 'Loading…'} />{/if}
  {#if error}<p class="text-destructive m-0">{error}</p>{/if}

  {#if result}
    <Card.Root size="sm" class="gap-2.5 shadow-none">
      <Card.Content class="grid gap-2.5">
        <p class="m-0">
          <b class="text-success">{result.done} change{result.done === 1 ? '' : 's'} applied.</b>
          {#if Array.isArray(result.failed) && result.failed.length}<span class="text-destructive">{result.failed.length} failed.</span>{/if}
        </p>
        {#if Array.isArray(result.failed) && result.failed.length}
          <ul class={LIST}>
            {#each result.failed as f, i (i)}
              <li><b>{f.what}</b> <span class="text-destructive">{f.error}</span></li>
            {/each}
          </ul>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}

  {#if plan}
    {#if Array.isArray(plan.warnings) && plan.warnings.length}
      <div class="border-primary/40 bg-primary/8 flex gap-2.5 rounded-[10px] border px-3.5 py-2.5" role="alert">
        <TriangleAlert class="text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <ul class="m-0 grid list-disc gap-1 pl-4">
          {#each plan.warnings as w, i (i)}<li>{w}</li>{/each}
        </ul>
      </div>
    {/if}

    <h3 class={H3}>Watchlist</h3>
    {#if Array.isArray(plan.watchlistAdd) && plan.watchlistAdd.length}
      <ul class={LIST}>
        {#each plan.watchlistAdd as r (r.seriesId)}{@render add(r.title, r.seriesId, r.crTitle)}{/each}
      </ul>
    {:else}
      <p class="text-muted-foreground m-0">Nothing to add.</p>
    {/if}

    {#if Array.isArray(plan.lists)}
      {#each plan.lists as l (l.status)}
        <h3 class={H3}>
          {l.title}
          <Badge variant="outline" class="bg-popover h-[18px] px-[7px] text-[11px] font-normal tracking-normal normal-case">{l.listId ? 'existing' : 'new'}</Badge>
        </h3>
        {#if !(l.add?.length || l.remove?.length || l.overflow)}
          <p class="text-muted-foreground m-0">Up to date.</p>
        {:else}
          <ul class={LIST}>
            {#each Array.isArray(l.add) ? l.add : [] as r (r.seriesId)}{@render add(r.title, r.seriesId, r.crTitle)}{/each}
            {#each Array.isArray(l.remove) ? l.remove : [] as r (r.entryId)}
              <li class="flex items-center gap-1.5"><Minus class="text-destructive size-3.5 shrink-0" aria-hidden="true" /> {r.title}</li>
            {/each}
          </ul>
          {#if l.overflow}<p class="text-muted-foreground m-0">{l.overflow} more didn't fit under the list cap.</p>{/if}
        {/if}
      {/each}
    {/if}

    {#if Array.isArray(plan.unmapped) && plan.unmapped.length}
      <Collapsible.Root class="grid gap-2">
        <Collapsible.Trigger class="text-muted-foreground hover:text-foreground group flex w-fit items-center gap-1 text-left">
          <ChevronRight class="size-3.5 transition-transform group-data-[state=open]:rotate-90" aria-hidden="true" />
          {plan.unmapped.length} show{plan.unmapped.length === 1 ? '' : 's'} not found on Crunchyroll
        </Collapsible.Trigger>
        <Collapsible.Content>
          <ul class={LIST}>
            {#each plan.unmapped as u (u.aniId)}
              <li><a href="https://anilist.co/anime/{u.aniId}" target="_blank" rel="noreferrer">{u.title}</a></li>
            {/each}
          </ul>
        </Collapsible.Content>
      </Collapsible.Root>
    {/if}

    <div class="flex gap-2">
      <Button disabled={!changes || applying} onclick={apply}>
        {applying ? 'Applying…' : `Apply ${changes} change${changes === 1 ? '' : 's'}`}
      </Button>
      <Button variant="outline" disabled={applying} onclick={() => (plan = null)}>Discard</Button>
    </div>
  {/if}
</section>
