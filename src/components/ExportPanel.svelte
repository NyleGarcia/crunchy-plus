<script lang="ts">
  import { crOp, type ExportPlan, type ExportResult } from '@/lib/messages';
  import { getSettings, lastExportItem, patchSettings, type Settings } from '@/lib/settings';
  import { STATUS_LABEL, type ListStatus } from '@/lib/types';

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
</script>

<section class="pane">
  <header class="head">
    <div>
      <h2>Export to Crunchyroll</h2>
      <p class="muted">
        Push your AniList list onto Crunchyroll's Watchlist and Crunchylists. Nothing changes until you preview and apply.
        {#if lastExport}Last export {ago(lastExport)}.{/if}
      </p>
    </div>
    <button class="btn primary" disabled={loading || applying || !settings} onclick={preview}>
      {loading ? 'Planning…' : 'Preview'}
    </button>
  </header>

  {#if settings}
    <div class="card settings">
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Add to Crunchyroll Watchlist</th>
            <th>Mirror as Crunchylists “AniList · &lt;status&gt;”</th>
          </tr>
        </thead>
        <tbody>
          {#each STATUSES as st (st)}
            <tr>
              <td>{STATUS_LABEL[st]}</td>
              <td>
                <input
                  type="checkbox"
                  aria-label="Watchlist: {STATUS_LABEL[st]}"
                  checked={settings.exportWatchlist.includes(st)}
                  onchange={(e) => toggleStatus('exportWatchlist', st, e.currentTarget.checked)}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  aria-label="Crunchylist: {STATUS_LABEL[st]}"
                  checked={settings.exportLists.includes(st)}
                  onchange={(e) => toggleStatus('exportLists', st, e.currentTarget.checked)}
                />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="note muted">The Watchlist is add-only — Crunchy+ never removes anything from it.</p>

      <label class="row">
        <input type="checkbox" checked={settings.mirrorLists} onchange={(e) => save({ mirrorLists: e.currentTarget.checked })} />
        <span>
          Mirror lists
          <span class="muted">— remove shows that left the status (only touches lists Crunchy+ created)</span>
        </span>
      </label>

      <div class="row">
        <label class="row">
          <input type="checkbox" checked={settings.autoExport} onchange={(e) => save({ autoExport: e.currentTarget.checked })} />
          <span>Check for changes every</span>
        </label>
        <input
          class="hours"
          type="number"
          min="1"
          max="72"
          value={settings.autoExportHours}
          disabled={!settings.autoExport}
          onchange={(e) => setHours(e.currentTarget.valueAsNumber)}
        />
        <span>hours</span>
      </div>
      {#if settings.autoExport}
        <label class="row">
          <input type="checkbox" checked={settings.autoApplyAdds} onchange={(e) => save({ autoApplyAdds: e.currentTarget.checked })} />
          <span>Apply additions automatically</span>
        </label>
        <p class="note muted">
          On your next Crunchyroll visit after {settings.autoExportHours} hours, Crunchy+ checks for changes.
          {settings.autoApplyAdds
            ? 'Additions are applied automatically, only after the page confirms which profile you are on. Removals always wait for your review.'
            : 'You get a reminder with a preview; nothing is applied without your click.'}
        </p>
      {/if}
    </div>
  {/if}

  {#if loading || applying}<p class="status"><span class="spin"></span>{label || (applying ? 'Updating Crunchyroll…' : 'Loading…')}</p>{/if}
  {#if error}<p class="err">{error}</p>{/if}

  {#if result}
    <div class="card">
      <p><b class="ok">{result.done} change{result.done === 1 ? '' : 's'} applied.</b>
        {#if Array.isArray(result.failed) && result.failed.length}<span class="err">{result.failed.length} failed.</span>{/if}
      </p>
      {#if Array.isArray(result.failed) && result.failed.length}
        <ul class="list">
          {#each result.failed as f, i (i)}
            <li><b>{f.what}</b> <span class="err">{f.error}</span></li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  {#if plan}
    {#if Array.isArray(plan.warnings) && plan.warnings.length}
      <ul class="warn">
        {#each plan.warnings as w, i (i)}<li>{w}</li>{/each}
      </ul>
    {/if}

    <h3>Watchlist</h3>
    {#if Array.isArray(plan.watchlistAdd) && plan.watchlistAdd.length}
      <ul class="list">
        {#each plan.watchlistAdd as r (r.seriesId)}<li><span class="plus">+</span> {r.title} <span class="muted">→ <a href="https://www.crunchyroll.com/series/{r.seriesId}" target="_blank" rel="noreferrer">{r.crTitle ?? 'Crunchyroll'}</a></span></li>{/each}
      </ul>
    {:else}
      <p class="muted">Nothing to add.</p>
    {/if}

    {#if Array.isArray(plan.lists)}
      {#each plan.lists as l (l.status)}
        <h3>
          {l.title}
          <em class="tag">{l.listId ? 'existing' : 'new'}</em>
        </h3>
        {#if !(l.add?.length || l.remove?.length || l.overflow)}
          <p class="muted">Up to date.</p>
        {:else}
          <ul class="list">
            {#each Array.isArray(l.add) ? l.add : [] as r (r.seriesId)}<li><span class="plus">+</span> {r.title} <span class="muted">→ <a href="https://www.crunchyroll.com/series/{r.seriesId}" target="_blank" rel="noreferrer">{r.crTitle ?? 'Crunchyroll'}</a></span></li>{/each}
            {#each Array.isArray(l.remove) ? l.remove : [] as r (r.entryId)}<li><span class="minus">−</span> {r.title}</li>{/each}
          </ul>
          {#if l.overflow}<p class="muted">{l.overflow} more didn't fit under the list cap.</p>{/if}
        {/if}
      {/each}
    {/if}

    {#if Array.isArray(plan.unmapped) && plan.unmapped.length}
      <details>
        <summary class="muted">{plan.unmapped.length} show{plan.unmapped.length === 1 ? '' : 's'} not found on Crunchyroll</summary>
        <ul class="list">
          {#each plan.unmapped as u (u.aniId)}
            <li><a href="https://anilist.co/anime/{u.aniId}" target="_blank" rel="noreferrer">{u.title}</a></li>
          {/each}
        </ul>
      </details>
    {/if}

    <div class="actions">
      <button class="btn primary" disabled={!changes || applying} onclick={apply}>
        {applying ? 'Applying…' : `Apply ${changes} change${changes === 1 ? '' : 's'}`}
      </button>
      <button class="btn" disabled={applying} onclick={() => (plan = null)}>Discard</button>
    </div>
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
    margin: 4px 0 0;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  p {
    margin: 0;
  }
  .card {
    padding: 14px;
    border-radius: 14px;
    background: var(--surface);
    border: 1px solid var(--line);
    display: grid;
    gap: 10px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th {
    font-weight: 600;
    font-size: 12px;
    color: var(--muted);
    text-align: center;
    padding: 0 8px 6px;
  }
  td {
    padding: 4px 8px;
    border-top: 1px solid var(--line);
    text-align: center;
  }
  td:first-child {
    text-align: left;
    font-weight: 600;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .hours {
    width: 64px;
  }
  .note {
    font-size: 12px;
  }
  .tag {
    font-style: normal;
    text-transform: none;
    letter-spacing: 0;
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 99px;
    background: var(--surface-2);
    border: 1px solid var(--line);
  }
  .list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 3px;
  }
  .plus {
    color: var(--ok);
    font-weight: 700;
  }
  .minus {
    color: var(--err);
    font-weight: 700;
  }
  .ok {
    color: var(--ok);
  }
  .err {
    color: var(--err);
  }
  .warn {
    margin: 0;
    padding: 10px 14px 10px 28px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  details summary {
    cursor: pointer;
  }
  details .list {
    margin-top: 8px;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
  }
  .spin {
    width: 14px;
    height: 14px;
    border: 2px solid var(--line);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
