<script lang="ts">
  import { bg, type UndoRow } from '@/lib/messages';
  import { importLogItem, type ImportLogItem } from '@/lib/settings';
  import { STATUS_LABEL, type ListStatus } from '@/lib/types';

  type Log = { at: number; items: ImportLogItem[] };
  type Result = { deleted: number; restored: number; activitiesDeleted: number; failed: string[] };

  const HOURS = [1, 3, 6, 24, 72];

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
</script>

<section class="pane">
  <header>
    <h2>Undo an import</h2>
    <p class="muted">Roll back AniList changes made by a Crunchyroll import. Nothing changes until you review the list and click undo.</p>
  </header>

  <div class="sources">
    <div class="box">
      <h3>Recorded imports</h3>
      {#if logs.length}
        <ul class="rows">
          {#each logs as log (log.at)}
            <li>
              <span class="t">{when(log.at)}</span>
              <span class="muted">{log.items.length} {log.items.length === 1 ? 'entry' : 'entries'}</span>
              <button class="btn" disabled={busy} onclick={() => reviewLog(log)}>Review undo</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted">No recorded imports. The last 5 imports are recorded here when you apply them.</p>
      {/if}
    </div>

    <div class="box">
      <h3>By time window</h3>
      <p class="muted">For imports made before recording existed. Finds every AniList list change in the window.</p>
      <div class="ctl">
        <label>
          Changes in the last
          <select bind:value={hours} disabled={busy}>
            {#each HOURS as h}<option value={h}>{h < 24 ? `${h} hour${h === 1 ? '' : 's'}` : `${h / 24} day${h === 24 ? '' : 's'}`}</option>{/each}
          </select>
        </label>
        <button class="btn" disabled={busy} onclick={scan}>Scan</button>
      </div>
      <p class="note">
        Best guess: the "before" state is rebuilt from your activity history, so it can be wrong. It also picks up changes you made
        by hand in that window. Check each row.
      </p>
    </div>
  </div>

  {#if busy}<p class="status"><span class="spin"></span>{label || 'Working…'}</p>{/if}
  {#if error}<p class="err">{error}</p>{/if}

  {#if result}
    <div class="box result">
      <p>
        <span class="ok">Done.</span>
        {result.deleted} removed · {result.restored} restored · {result.activitiesDeleted} activity posts deleted
      </p>
      {#if Array.isArray(result.failed) && result.failed.length}
        <ul class="fails">
          {#each result.failed as f}<li class="err">{f}</li>{/each}
        </ul>
      {/if}
    </div>
  {/if}

  {#if source}
    {#if source.kind === 'scan'}
      <p class="note">Best-guess preview from the last {source.hours}h of activity. Review each row before undoing.</p>
    {/if}
    {#if rows.length}
      <p class="muted summary">
        {rows.length} entries · <b>{counts.delete}</b> remove · <b>{counts.restore}</b> restore · {counts.keep} keep
        {#if deleteActivities}· {counts.activities} activity posts{/if}
      </p>
      <table>
        <thead>
          <tr><th></th><th>Title</th><th>Now</th><th>Action</th></tr>
        </thead>
        <tbody>
          {#each rows as r (r.mediaId)}
            <tr class:off={r.action === 'keep'}>
              <td>{#if r.cover}<img src={r.cover} alt="" />{/if}</td>
              <td><a href={`https://anilist.co/anime/${r.mediaId}`} target="_blank" rel="noreferrer">{r.title}</a></td>
              <td>
                {#if r.current}{fmt(r.current.status)} · {r.current.progress}{:else}<span class="muted">not on list</span>{/if}
              </td>
              <td>
                <select bind:value={r.action} disabled={busy}>
                  <option value="delete" disabled={!r.current}>remove from list</option>
                  <option value="restore" disabled={!r.current || !r.before}>
                    {r.before ? `restore to ${beforeText(r.before)}` : 'restore (no earlier state)'}
                  </option>
                  <option value="keep">keep</option>
                </select>
                {#if r.note}<div class="muted">{r.note}</div>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <div class="actions">
        <label class="chk"><input type="checkbox" bind:checked={deleteActivities} disabled={busy} /> also delete activity posts</label>
        <span class="grow"></span>
        <button class="btn" disabled={busy} onclick={cancel}>Cancel</button>
        <button class="btn primary" disabled={busy || !changeCount} onclick={apply}>Undo {changeCount} changes</button>
      </div>
    {:else}
      <p class="muted">Nothing to undo{source.kind === 'scan' ? ' in that window' : ''}.</p>
    {/if}
  {/if}
</section>

<style>
  .pane {
    display: grid;
    gap: 16px;
  }
  h2 {
    margin: 0 0 4px;
    font-size: 24px;
    letter-spacing: -0.02em;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  p {
    margin: 0;
  }
  header p {
    max-width: 70ch;
  }
  .sources {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 12px;
  }
  .box {
    display: grid;
    gap: 8px;
    align-content: start;
    padding: 14px;
    border-radius: 14px;
    background: var(--surface);
    border: 1px solid var(--line);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .rows li {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 6px 0;
    border-bottom: 1px solid var(--line);
  }
  .rows li:last-child {
    border-bottom: 0;
  }
  .rows .t {
    flex: 1;
    min-width: 0;
  }
  .ctl {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  .note {
    font-size: 12px;
    color: var(--muted);
    border-left: 2px solid var(--accent);
    padding-left: 8px;
  }
  .summary b {
    color: var(--text);
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    text-align: left;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    font-weight: 600;
    padding: 6px 8px;
    border-bottom: 1px solid var(--line);
  }
  td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--line);
    vertical-align: middle;
  }
  td img {
    width: 30px;
    height: 42px;
    object-fit: cover;
    border-radius: 4px;
    display: block;
  }
  tr.off td {
    opacity: 0.5;
  }
  .actions {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  .grow {
    flex: 1;
  }
  .chk {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .fails {
    margin: 0;
    padding-left: 18px;
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
  .ok {
    color: var(--ok);
    font-weight: 600;
  }
  .err {
    color: var(--err);
  }
</style>
