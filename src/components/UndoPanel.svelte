<script lang="ts">
  import { bg, type UndoRow } from '@/lib/messages';
  import { importLogItem, type ImportLogItem } from '@/lib/settings';
  import { STATUS_LABEL, type ListStatus } from '@/lib/types';
  import Busy from '@/components/Busy.svelte';
  import * as Card from '@/components/ui/card';
  import * as Select from '@/components/ui/select';
  import * as Table from '@/components/ui/table';
  import { Button } from '@/components/ui/button';
  import { Checkbox } from '@/components/ui/checkbox';

  type Log = { at: number; items: ImportLogItem[] };
  type Result = { deleted: number; restored: number; activitiesDeleted: number; failed: string[] };

  const HOURS = [1, 3, 6, 24, 72];
  const hoursLabel = (h: number) => (h < 24 ? `${h} hour${h === 1 ? '' : 's'}` : `${h / 24} day${h === 24 ? '' : 's'}`);

  let logs = $state<Log[]>([]);
  let hours = $state(3);
  let rows = $state<UndoRow[]>([]);
  /** Where the current preview came from: a recorded import (its `at`) or a time-window scan. */
  let source = $state<{ kind: 'log'; at: number } | { kind: 'scan'; hours: number } | null>(null);
  let deleteActivities = $state(true);
  let busy = $state(false);
  let label = $state('');
  let error = $state('');
  let result = $state<Result | null>(null);

  const counts = $derived({
    delete: rows.filter((r) => r.action === 'delete').length,
    restore: rows.filter((r) => r.action === 'restore').length,
    keep: rows.filter((r) => r.action === 'keep').length,
    activities: rows.filter((r) => r.action !== 'keep').reduce((n, r) => n + r.activityIds.length, 0),
  });
  const changeCount = $derived(counts.delete + counts.restore);

  $effect(() => {
    let alive = true;
    importLogItem.getValue().then((v) => {
      if (alive) logs = Array.isArray(v) ? v : [];
    });
    const unwatch = importLogItem.watch((v) => (logs = Array.isArray(v) ? v : []));
    const l = (msg: { type?: string; label?: string }) => {
      if (msg?.type === 'cr:progress' && msg.label) label = msg.label;
    };
    browser.runtime.onMessage.addListener(l);
    return () => {
      alive = false;
      unwatch();
      browser.runtime.onMessage.removeListener(l);
    };
  });

  const fmt = (s: ListStatus | undefined) => (s ? STATUS_LABEL[s] : '—');
  const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const beforeText = (b: UndoRow['before']) => (b ? `${fmt(b.status)}${b.progress != null ? ` · ${b.progress}` : ''}` : '');
  const actionLabel = (r: UndoRow) =>
    r.action === 'delete' ? 'remove from list' : r.action === 'keep' ? 'keep' : r.before ? `restore to ${beforeText(r.before)}` : 'restore (no earlier state)';

  async function preview(load: () => Promise<UndoRow[]>, src: NonNullable<typeof source>) {
    busy = true;
    error = '';
    result = null;
    label = 'Reading your AniList history…';
    rows = [];
    source = null;
    try {
      const r = await load();
      rows = Array.isArray(r) ? r : [];
      source = src;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
      label = '';
    }
  }

  const reviewLog = (log: Log) =>
    preview(() => bg({ type: 'undo:fromLog', log: $state.snapshot(log) }), { kind: 'log', at: log.at });

  const scan = () =>
    preview(() => bg({ type: 'undo:scan', since: Math.floor(Date.now() / 1000) - hours * 3600 }), {
      kind: 'scan',
      hours,
    });

  async function apply() {
    if (!changeCount) return;
    busy = true;
    error = '';
    label = `Undoing ${changeCount} changes…`;
    try {
      const res = await bg({ type: 'undo:apply', rows: $state.snapshot(rows), deleteActivities });
      result = res;
      const failed = Array.isArray(res.failed) ? res.failed : [];
      if (!failed.length && source?.kind === 'log') {
        const at = source.at;
        const log = await importLogItem.getValue();
        await importLogItem.setValue((Array.isArray(log) ? log : []).filter((l) => l.at !== at));
      }
      rows = [];
      source = null;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
      label = '';
    }
  }

  function cancel() {
    rows = [];
    source = null;
  }

  const H3 = 'text-muted-foreground text-xs font-semibold tracking-[0.08em] uppercase';
  const NOTE = 'text-muted-foreground border-primary m-0 border-l-2 pl-2 text-xs';
</script>

<section class="grid gap-4">
  <header>
    <h2 class="mb-1 text-2xl font-bold tracking-[-0.02em]">Undo an import</h2>
    <p class="text-muted-foreground m-0 max-w-[70ch]">Roll back AniList changes made by a Crunchyroll import. Nothing changes until you review the list and click undo.</p>
  </header>

  <div class="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
    <Card.Root size="sm" class="content-start gap-2 shadow-none">
      <Card.Header><Card.Title class={H3}>Recorded imports</Card.Title></Card.Header>
      <Card.Content class="grid gap-2">
        {#if logs.length}
          <ul class="m-0 list-none p-0">
            {#each logs as log (log.at)}
              <li class="flex items-center gap-3 border-b py-1.5 last:border-b-0">
                <span class="min-w-0 flex-1">{when(log.at)}</span>
                <span class="text-muted-foreground">{log.items.length} {log.items.length === 1 ? 'entry' : 'entries'}</span>
                <Button variant="outline" size="sm" disabled={busy} onclick={() => reviewLog(log)}>Review undo</Button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-muted-foreground m-0">No recorded imports. The last 5 imports are recorded here when you apply them.</p>
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root size="sm" class="content-start gap-2 shadow-none">
      <Card.Header><Card.Title class={H3}>By time window</Card.Title></Card.Header>
      <Card.Content class="grid gap-2">
        <p class="text-muted-foreground m-0">For imports made before recording existed. Finds every AniList list change in the window.</p>
        <div class="flex flex-wrap items-center gap-2.5">
          <span class="flex items-center gap-2">
            <span id="undo-window-label">Changes in the last</span>
            <Select.Root type="single" value={String(hours)} onValueChange={(v) => (hours = Number(v))} disabled={busy}>
              <Select.Trigger aria-labelledby="undo-window-label">{hoursLabel(hours)}</Select.Trigger>
              <Select.Content>
                {#each HOURS as h (h)}<Select.Item value={String(h)} label={hoursLabel(h)} />{/each}
              </Select.Content>
            </Select.Root>
          </span>
          <Button variant="outline" disabled={busy} onclick={scan}>Scan</Button>
        </div>
        <p class={NOTE}>
          Best guess: the "before" state is rebuilt from your activity history, so it can be wrong. It also picks up changes you made by hand in that
          window. Check each row.
        </p>
      </Card.Content>
    </Card.Root>
  </div>

  {#if busy}<Busy {label} fallback="Working…" />{/if}
  {#if error}<p class="text-destructive m-0">{error}</p>{/if}

  {#if result}
    <Card.Root size="sm" class="gap-2 shadow-none">
      <Card.Content class="grid gap-2">
        <p class="m-0">
          <span class="text-success font-semibold">Done.</span>
          {result.deleted} removed · {result.restored} restored · {result.activitiesDeleted} activity posts deleted
        </p>
        {#if Array.isArray(result.failed) && result.failed.length}
          <ul class="m-0 list-disc pl-[18px]">
            {#each result.failed as f, i (i)}<li class="text-destructive">{f}</li>{/each}
          </ul>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}

  {#if source}
    {#if source.kind === 'scan'}
      <p class={NOTE}>Best-guess preview from the last {source.hours}h of activity. Review each row before undoing.</p>
    {/if}
    {#if rows.length}
      <p class="text-muted-foreground m-0 [&_b]:text-foreground">
        {rows.length} entries · <b>{counts.delete}</b> remove · <b>{counts.restore}</b> restore · {counts.keep} keep
        {#if deleteActivities}· {counts.activities} activity posts{/if}
      </p>
      <Table.Root>
        <Table.Header>
          <Table.Row class="hover:bg-transparent">
            <Table.Head class={H3}></Table.Head>
            <Table.Head class={H3}>Title</Table.Head>
            <Table.Head class={H3}>Now</Table.Head>
            <Table.Head class={H3}>Action</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each rows as r (r.mediaId)}
            <Table.Row class={r.action === 'keep' ? 'opacity-50' : ''}>
              <Table.Cell class="w-10">{#if r.cover}<img src={r.cover} alt="" class="block h-[42px] w-[30px] rounded object-cover" />{/if}</Table.Cell>
              <Table.Cell class="whitespace-normal"><a href={`https://anilist.co/anime/${r.mediaId}`} target="_blank" rel="noreferrer">{r.title}</a></Table.Cell>
              <Table.Cell>
                {#if r.current}{fmt(r.current.status)} · {r.current.progress}{:else}<span class="text-muted-foreground">not on list</span>{/if}
              </Table.Cell>
              <Table.Cell class="whitespace-normal">
                <Select.Root type="single" bind:value={() => r.action, (v) => (r.action = v as UndoRow['action'])} disabled={busy}>
                  <Select.Trigger size="sm" aria-label="Action for {r.title}">{actionLabel(r)}</Select.Trigger>
                  <Select.Content>
                    <Select.Item value="delete" disabled={!r.current} label="remove from list" />
                    <Select.Item value="restore" disabled={!r.current || !r.before} label={r.before ? `restore to ${beforeText(r.before)}` : 'restore (no earlier state)'} />
                    <Select.Item value="keep" label="keep" />
                  </Select.Content>
                </Select.Root>
                {#if r.note}<div class="text-muted-foreground mt-1">{r.note}</div>{/if}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
      <div class="flex flex-wrap items-center gap-2.5">
        <label class="flex items-center gap-1.5"><Checkbox bind:checked={deleteActivities} disabled={busy} /> also delete activity posts</label>
        <span class="flex-1"></span>
        <Button variant="outline" disabled={busy} onclick={cancel}>Cancel</Button>
        <Button disabled={busy || !changeCount} onclick={apply}>Undo {changeCount} changes</Button>
      </div>
    {:else}
      <p class="text-muted-foreground m-0">Nothing to undo{source.kind === 'scan' ? ' in that window' : ''}.</p>
    {/if}
  {/if}
</section>
