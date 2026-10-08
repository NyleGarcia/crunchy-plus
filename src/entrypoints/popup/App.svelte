<script lang="ts">
  import { bg, type BgResponses } from '@/lib/messages';
  import { DECLUTTER_LABEL, ROW_PRESETS, getSettings, patchSettings, typesafeKeyItem, type DeclutterKey, type Settings } from '@/lib/settings';
  import type { Mode } from '@/lib/types';

  let s = $state<Settings | null>(null);
  let status = $state<BgResponses['anilist:status'] | null>(null);
  let error = $state('');
  let busy = $state(false);
  let showSetup = $state(false);
  let rowInput = $state('');
  // Jev is optional: no key → matching works as before, Jev UI stays hidden.
  let jevKey = $state('');
  let hasJevKey = $state(false);
  $effect(() => {
    typesafeKeyItem.getValue().then((k) => (hasJevKey = !!k));
  });
  async function saveJevKey() {
    const k = jevKey.trim();
    if (!k) return;
    await typesafeKeyItem.setValue(k);
    jevKey = '';
    hasJevKey = true;
  }
  async function removeJevKey() {
    await typesafeKeyItem.setValue(null);
    hasJevKey = false;
  }
  let pasted = $state('');

  async function usePin() {
    busy = true;
    error = '';
    try {
      await bg({ type: 'anilist:setToken', token: pasted });
      pasted = '';
      await refresh();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    getSettings().then((v) => (s = v));
    refresh();
  });

  async function refresh() {
    try {
      status = await bg({ type: 'anilist:status' });
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    if (!s) return;
    s[k] = v;
    await patchSettings({ [k]: v });
  }

  async function login() {
    busy = true;
    error = '';
    try {
      await bg({ type: 'anilist:login' });
      await refresh();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function openHub(tab: 'upnext' | 'import' | 'export') {
    await browser.tabs.create({ url: browser.runtime.getURL(`/hub.html#${tab}`) });
    window.close();
  }

  async function logout() {
    await bg({ type: 'anilist:logout' });
    await refresh();
  }

  const MODES: { id: Mode; label: string; hint: string }[] = [
    { id: 'sub', label: 'Sub', hint: 'Dubs never appear. Player always uses original audio.' },
    { id: 'dub', label: 'Dub', hint: 'Prefer your dub language; originals only when no dub exists.' },
    { id: 'all', label: 'All', hint: 'Stock Crunchyroll listings.' },
  ];
  const LOCALES = ['en-US', 'es-419', 'es-ES', 'pt-BR', 'fr-FR', 'de-DE', 'it-IT', 'ru-RU', 'ar-SA', 'hi-IN'];
</script>

<main>
  <h1>Crunchy<span>+</span></h1>

  {#if s}
    <section>
      <div class="seg" role="radiogroup" aria-label="Audio mode">
        {#each MODES as m}
          <button role="radio" aria-checked={s.mode === m.id} class:on={s.mode === m.id} onclick={() => set('mode', m.id)}>
            {m.label}
          </button>
        {/each}
      </div>
      <p class="muted hint">{MODES.find((m) => m.id === s!.mode)?.hint}</p>
      {#if s.mode === 'dub'}
        <label class="line">
          Dub language
          <select value={s.dubLocale} onchange={(e) => set('dubLocale', e.currentTarget.value)}>
            {#each LOCALES as l}<option value={l}>{l}</option>{/each}
          </select>
        </label>
      {/if}
    </section>

    <section>
      <h2>AniList</h2>
      {#if status?.user}
        <div class="user">
          <img src={status.user.avatar.medium} alt="" />
          <b>{status.user.name}</b>
          <button class="btn" onclick={logout}>Sign out</button>
        </div>
        <label class="line">
          Auto-sync after watching
          <input type="checkbox" checked={s.autoSync} onchange={(e) => set('autoSync', e.currentTarget.checked)} />
        </label>
        <label class="line" class:dim={!s.autoSync}>
          Threshold <b>{Math.round(s.syncThreshold * 100)}%</b>
          <input
            type="range"
            min="0.5"
            max="0.98"
            step="0.01"
            value={s.syncThreshold}
            oninput={(e) => set('syncThreshold', Number(e.currentTarget.value))}
          />
        </label>
        <label class="line">
          Auto-sync AniList → Crunchyroll
          <input type="checkbox" checked={s.autoExport} onchange={(e) => set('autoExport', e.currentTarget.checked)} />
        </label>
        {#if s.autoExport}
          <label class="line">
            Apply additions automatically
            <input type="checkbox" checked={s.autoApplyAdds} onchange={(e) => set('autoApplyAdds', e.currentTarget.checked)} />
          </label>
          <label class="line">
            Every
            <span class="hours">
              <input
                type="number"
                min="1"
                max="168"
                step="1"
                value={s.autoExportHours}
                onchange={(e) => {
                  const n = Math.round(Number(e.currentTarget.value));
                  const v = Number.isFinite(n) ? Math.min(168, Math.max(1, n)) : 6;
                  e.currentTarget.value = String(v);
                  set('autoExportHours', v);
                }}
              />
              hours
            </span>
          </label>
        {/if}
      {:else}
        <label class="line col">
          AniList client ID
          <input
            value={s.anilistClientId}
            inputmode="numeric"
            placeholder="e.g. 12345"
            onchange={(e) => set('anilistClientId', e.currentTarget.value.trim())}
          />
        </label>
        <button class="btn primary wide" disabled={busy || !s.anilistClientId} onclick={login}>
          {busy ? 'Connecting…' : 'Connect AniList'}
        </button>
        <button class="linkish" onclick={() => (showSetup = !showSetup)}>How do I get a client ID?</button>
        {#if showSetup}
          <ol class="muted setup">
            <li>Open <a href="https://anilist.co/settings/developer" target="_blank" rel="noreferrer">anilist.co/settings/developer</a> → Create new client.</li>
            <li>Redirect URL: <code>{status?.redirectUrl}</code></li>
            <li>Paste the client ID above, then Connect.</li>
          </ol>
          <p class="muted setup-alt">
            <b>Connect fails?</b> (e.g. Brave/other Chromium) Set the client's Redirect URL to
            <code>https://anilist.co/api/v2/oauth/pin</code>, then
            <a href={`https://anilist.co/api/v2/oauth/authorize?client_id=${s.anilistClientId}&response_type=token`} target="_blank" rel="noreferrer">authorize here</a>
            and paste the token AniList shows:
          </p>
          <div class="pin">
            <input bind:value={pasted} placeholder="Paste AniList token" />
            <button class="btn" disabled={busy || !pasted.trim() || !s.anilistClientId} onclick={usePin}>Use</button>
          </div>
        {/if}
      {/if}
    </section>

    <section>
      <h2>Jev matching <span class="opt">optional</span></h2>
      <p class="muted hint">Jev (TypeSafe) double-checks AniList matches the scorer isn't sure about. Without a key, matching works as usual.</p>
      {#if hasJevKey}
        <label class="line">
          Use Jev for unsure matches
          <input type="checkbox" checked={s.jevEnabled} onchange={(e) => set('jevEnabled', e.currentTarget.checked)} />
        </label>
        <label class="line" class:dim={!s.jevEnabled}>
          Auto-accept at <b>{Math.round(s.jevAccept * 100)}%</b>
          <input type="range" min="0.7" max="0.99" step="0.01" value={s.jevAccept} oninput={(e) => set('jevAccept', Number(e.currentTarget.value))} />
        </label>
        <button class="linkish" onclick={removeJevKey}>Remove TypeSafe key</button>
      {:else}
        <div class="pin">
          <input type="password" bind:value={jevKey} placeholder="TypeSafe API key" autocomplete="off" />
          <button class="btn" disabled={!jevKey.trim()} onclick={saveJevKey}>Save</button>
        </div>
        <p class="muted hint">Stored only in this browser (not synced) and sent only to api.typesafe.ai.</p>
      {/if}
    </section>

    <section>
      <label class="line">
        Modern theme
        <input type="checkbox" checked={s.theme} onchange={(e) => set('theme', e.currentTarget.checked)} />
      </label>
      <label class="line">
        Status badges on cards
        <input type="checkbox" checked={s.badges} onchange={(e) => set('badges', e.currentTarget.checked)} />
      </label>
      <label class="line" title="Hidden unless a new original-audio episode came out after you completed it (new dubs don't count)">
        Hide completed shows
        <input type="checkbox" checked={s.hideCompleted} onchange={(e) => set('hideCompleted', e.currentTarget.checked)} />
      </label>
      <label class="line">
        "Up next from AniList" row on home
        <input type="checkbox" checked={s.upNextRow} onchange={(e) => set('upNextRow', e.currentTarget.checked)} />
      </label>
      <label class="line">
        Compact hero banner
        <input type="checkbox" checked={s.compactHero} onchange={(e) => set('compactHero', e.currentTarget.checked)} />
      </label>
      <details class="declutter">
        <summary>Hidden home rows ({s.hiddenRows.length})</summary>
        <p class="muted hint">Matches row titles (partial text works). Tip: hover a row title on Crunchyroll → “Hide row”.</p>
        <div class="presets">
          {#each ROW_PRESETS.filter((p) => !s!.hiddenRows.includes(p)) as p}
            <button class="chip" onclick={() => set('hiddenRows', [...s!.hiddenRows, p])}>+ {p}</button>
          {/each}
        </div>
        {#each s.hiddenRows as r}
          <div class="line">
            <span class="rowname">{r}</span>
            <button class="linkish" onclick={() => set('hiddenRows', s!.hiddenRows.filter((x) => x !== r))}>Show</button>
          </div>
        {/each}
        <form class="pin" onsubmit={(e) => { e.preventDefault(); const v = rowInput.trim(); if (v && !s!.hiddenRows.includes(v)) set('hiddenRows', [...s!.hiddenRows, v]); rowInput = ''; }}>
          <input bind:value={rowInput} placeholder="Row title to hide" />
          <button class="btn" disabled={!rowInput.trim()}>Hide</button>
        </form>
      </details>
      <details class="declutter">
        <summary>Hide on Crunchyroll</summary>
        {#each Object.entries(DECLUTTER_LABEL) as [key, name]}
          <label class="line">
            {name}
            <input
              type="checkbox"
              checked={s.declutter[key as DeclutterKey]}
              onchange={(e) => set('declutter', { ...s!.declutter, [key]: e.currentTarget.checked })}
            />
          </label>
        {/each}
      </details>
    </section>

    <nav class="hub" aria-label="Open Crunchy+ hub">
      <button class="btn" onclick={() => openHub('upnext')}>Up next</button>
      <button class="btn" onclick={() => openHub('import')}>Import</button>
      <button class="btn" onclick={() => openHub('export')}>Export</button>
    </nav>
  {/if}

  {#if error}<p class="err">{error}</p>{/if}
</main>

<style>
  main {
    width: 320px;
    padding: 16px;
    display: grid;
    gap: 14px;
  }
  h1 {
    margin: 0;
    font-size: 18px;
    letter-spacing: -0.01em;
  }
  h1 span {
    color: var(--accent);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  section {
    display: grid;
    gap: 10px;
    padding: 12px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--line);
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
    padding: 8px 0;
    border-radius: 8px;
    color: var(--muted);
    font-weight: 650;
  }
  .seg button.on {
    background: var(--accent);
    color: #160b02;
  }
  .hint {
    margin: 0;
    font-size: 12px;
  }
  .line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }
  .line.col {
    flex-direction: column;
    align-items: stretch;
  }
  .dim {
    opacity: 0.5;
  }
  .wide {
    width: 100%;
  }
  .user {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .user img {
    width: 30px;
    height: 30px;
    border-radius: 50%;
  }
  .user b {
    flex: 1;
  }
  .linkish {
    background: none;
    border: 0;
    color: var(--accent);
    padding: 0;
    text-align: left;
  }
  .setup {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 4px;
  }
  code {
    word-break: break-all;
    color: var(--text);
  }
  .setup-alt {
    margin: 0;
    font-size: 12px;
  }
  .pin {
    display: flex;
    gap: 6px;
  }
  .pin input {
    flex: 1;
    min-width: 0;
  }
  .hours {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hours input {
    width: 64px;
  }
  .hub {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .declutter {
    display: grid;
    gap: 8px;
  }
  .declutter summary {
    cursor: pointer;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    border: 1px dashed var(--line);
    background: none;
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 12px;
    color: var(--muted);
  }
  .chip:hover {
    color: var(--text);
    border-color: var(--accent);
  }
  .rowname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .opt {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid var(--line);
    text-transform: none;
    letter-spacing: 0;
    margin-left: 4px;
  }
  .err {
    color: var(--err);
    margin: 0;
  }
</style>
