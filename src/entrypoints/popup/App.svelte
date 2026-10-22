<script lang="ts">
  import { bg, type BgResponses } from '@/lib/messages';
  import { DECLUTTER_LABEL, ROW_PRESETS, getSettings, patchSettings, typesafeKeyItem, type DeclutterKey, type Settings } from '@/lib/settings';
  import type { Mode } from '@/lib/types';
  import Segmented from '@/components/Segmented.svelte';
  import Hint from '@/components/Hint.svelte';
  import * as Card from '@/components/ui/card';
  import * as Collapsible from '@/components/ui/collapsible';
  import * as Select from '@/components/ui/select';
  import * as Tooltip from '@/components/ui/tooltip';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';
  import { Switch } from '@/components/ui/switch';
  import { cn } from '@/lib/utils';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Plus from '@lucide/svelte/icons/plus';

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

  /** Settings toggles rendered as a Switch row. */
  const TOGGLES: { key: 'theme' | 'badges' | 'hideCompleted' | 'upNextRow' | 'compactHero'; label: string; hint?: string }[] = [
    { key: 'theme', label: 'Modern theme' },
    { key: 'badges', label: 'Status badges on cards' },
    {
      key: 'hideCompleted',
      label: 'Hide completed shows',
      hint: "Hidden unless a new original-audio episode came out after you completed it (new dubs don't count)",
    },
    { key: 'upNextRow', label: '"Up next from AniList" row on home' },
    { key: 'compactHero', label: 'Compact hero banner' },
  ];

  const LINE = 'flex items-center justify-between gap-2.5';
  const LINK = 'h-auto p-0 text-left text-[13px] font-normal';
  const H2 = 'text-muted-foreground m-0 flex items-center gap-1 text-xs font-semibold tracking-[0.08em] uppercase';
  const HINT = 'text-muted-foreground m-0 text-xs';
</script>

<Tooltip.Provider delayDuration={300}>
  <main class="grid w-[320px] gap-3.5 p-4">
    <h1 class="m-0 text-lg font-bold tracking-[-0.01em]">Crunchy<span class="text-primary">+</span></h1>

    {#if s}
      <Card.Root size="sm" class="gap-2.5 shadow-none">
        <Card.Content class="grid gap-2.5">
          <Segmented options={MODES} value={s.mode} ariaLabel="Audio mode" grow onchange={(m) => set('mode', m)} />
          <p class={HINT}>{MODES.find((m) => m.id === s!.mode)?.hint}</p>
          {#if s.mode === 'dub'}
            <div class={LINE}>
              <span id="dub-locale-label">Dub language</span>
              <Select.Root type="single" value={s.dubLocale} onValueChange={(v) => set('dubLocale', v)}>
                <Select.Trigger size="sm" aria-labelledby="dub-locale-label">{s.dubLocale}</Select.Trigger>
                <Select.Content>
                  {#each LOCALES as l (l)}<Select.Item value={l} label={l} />{/each}
                </Select.Content>
              </Select.Root>
            </div>
          {/if}
        </Card.Content>
      </Card.Root>

      <Card.Root size="sm" class="gap-2.5 shadow-none">
        <Card.Header><Card.Title class={H2}>AniList</Card.Title></Card.Header>
        <Card.Content class="grid gap-2.5">
          {#if status?.user}
            <div class="flex items-center gap-2.5">
              <img src={status.user.avatar.medium} alt="" class="size-[30px] rounded-full" />
              <b class="flex-1 truncate">{status.user.name}</b>
              <Button variant="outline" size="sm" onclick={logout}>Sign out</Button>
            </div>
            <label class={LINE}>
              Auto-sync after watching
              <Switch checked={s.autoSync} onCheckedChange={(v) => set('autoSync', v)} />
            </label>
            <label class={cn(LINE, !s.autoSync && 'opacity-50')}>
              <span>Threshold <b>{Math.round(s.syncThreshold * 100)}%</b></span>
              <input
                type="range"
                class="accent-primary w-32"
                min="0.5"
                max="0.98"
                step="0.01"
                value={s.syncThreshold}
                oninput={(e) => set('syncThreshold', Number(e.currentTarget.value))}
              />
            </label>
            <label class={LINE}>
              Auto-sync AniList → Crunchyroll
              <Switch checked={s.autoExport} onCheckedChange={(v) => set('autoExport', v)} />
            </label>
            {#if s.autoExport}
              <label class={LINE}>
                Apply additions automatically
                <Switch checked={s.autoApplyAdds} onCheckedChange={(v) => set('autoApplyAdds', v)} />
              </label>
              <label class={LINE}>
                Every
                <span class="flex items-center gap-1.5">
                  <Input
                    type="number"
                    class="h-7 w-16"
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
            <label class="grid gap-1.5">
              AniList client ID
              <Input
                value={s.anilistClientId}
                inputmode="numeric"
                placeholder="e.g. 12345"
                onchange={(e) => set('anilistClientId', e.currentTarget.value.trim())}
              />
            </label>
            <Button class="w-full" disabled={busy || !s.anilistClientId} onclick={login}>
              {busy ? 'Connecting…' : 'Connect AniList'}
            </Button>
            <Button variant="link" class={cn(LINK, 'justify-start')} onclick={() => (showSetup = !showSetup)}>How do I get a client ID?</Button>
            {#if showSetup}
              <ol class="text-muted-foreground m-0 grid list-decimal gap-1 pl-[18px]">
                <li>
                  Open <a href="https://anilist.co/settings/developer" target="_blank" rel="noreferrer">anilist.co/settings/developer</a> → Create new
                  client.
                </li>
                <li>Redirect URL: <code class="text-foreground break-all">{status?.redirectUrl}</code></li>
                <li>Paste the client ID above, then Connect.</li>
              </ol>
              <p class={HINT}>
                <b>Connect fails?</b> (e.g. Brave/other Chromium) Set the client's Redirect URL to
                <code class="text-foreground break-all">https://anilist.co/api/v2/oauth/pin</code>, then
                <a href={`https://anilist.co/api/v2/oauth/authorize?client_id=${s.anilistClientId}&response_type=token`} target="_blank" rel="noreferrer"
                  >authorize here</a
                >
                and paste the token AniList shows:
              </p>
              <div class="flex gap-1.5">
                <Input bind:value={pasted} placeholder="Paste AniList token" class="min-w-0 flex-1" />
                <Button variant="outline" disabled={busy || !pasted.trim() || !s.anilistClientId} onclick={usePin}>Use</Button>
              </div>
            {/if}
          {/if}
        </Card.Content>
      </Card.Root>

      <Card.Root size="sm" class="gap-2.5 shadow-none">
        <Card.Header>
          <Card.Title class={H2}>Jev matching <Badge variant="outline" class="h-4 px-1.5 text-[10px] font-normal tracking-normal normal-case">optional</Badge></Card.Title>
        </Card.Header>
        <Card.Content class="grid gap-2.5">
          <p class={HINT}>Jev (TypeSafe) double-checks AniList matches the scorer isn't sure about. Without a key, matching works as usual.</p>
          {#if hasJevKey}
            <label class={LINE}>
              Use Jev for unsure matches
              <Switch checked={s.jevEnabled} onCheckedChange={(v) => set('jevEnabled', v)} />
            </label>
            <label class={cn(LINE, !s.jevEnabled && 'opacity-50')}>
              <span>Auto-accept at <b>{Math.round(s.jevAccept * 100)}%</b></span>
              <input type="range" class="accent-primary w-32" min="0.7" max="0.99" step="0.01" value={s.jevAccept} oninput={(e) => set('jevAccept', Number(e.currentTarget.value))} />
            </label>
            <Button variant="link" class={cn(LINK, 'justify-start')} onclick={removeJevKey}>Remove TypeSafe key</Button>
          {:else}
            <div class="flex gap-1.5">
              <Input type="password" bind:value={jevKey} placeholder="TypeSafe API key" autocomplete="off" class="min-w-0 flex-1" />
              <Button variant="outline" disabled={!jevKey.trim()} onclick={saveJevKey}>Save</Button>
            </div>
            <p class={HINT}>Stored only in this browser (not synced) and sent only to api.typesafe.ai.</p>
          {/if}
        </Card.Content>
      </Card.Root>

      <Card.Root size="sm" class="gap-2.5 shadow-none">
        <Card.Content class="grid gap-2.5">
          {#each TOGGLES as t (t.key)}
            <label class={LINE}>
              {#if t.hint}<Hint text={t.hint}>{t.label}</Hint>{:else}{t.label}{/if}
              <Switch checked={s[t.key]} onCheckedChange={(v) => set(t.key, v)} />
            </label>
          {/each}

          <Collapsible.Root class="grid gap-2">
            <Collapsible.Trigger class="text-muted-foreground hover:text-foreground group flex items-center gap-1 text-left">
              <ChevronRight class="size-3.5 transition-transform group-data-[state=open]:rotate-90" aria-hidden="true" />
              Hidden home rows ({s.hiddenRows.length})
            </Collapsible.Trigger>
            <Collapsible.Content class="grid gap-2">
              <p class={HINT}>Matches row titles (partial text works). Tip: hover a row title on Crunchyroll → “Hide row”.</p>
              <div class="flex flex-wrap gap-1.5">
                {#each ROW_PRESETS.filter((p) => !s!.hiddenRows.includes(p)) as p (p)}
                  <Button
                    variant="outline"
                    size="xs"
                    class="text-muted-foreground hover:border-primary hover:text-foreground rounded-full border-dashed bg-transparent font-normal"
                    onclick={() => set('hiddenRows', [...s!.hiddenRows, p])}
                  >
                    <Plus aria-hidden="true" />{p}
                  </Button>
                {/each}
              </div>
              {#each s.hiddenRows as r (r)}
                <div class={LINE}>
                  <span class="truncate">{r}</span>
                  <Button variant="link" class={LINK} onclick={() => set('hiddenRows', s!.hiddenRows.filter((x) => x !== r))}>Show</Button>
                </div>
              {/each}
              <form
                class="flex gap-1.5"
                onsubmit={(e) => {
                  e.preventDefault();
                  const v = rowInput.trim();
                  if (v && !s!.hiddenRows.includes(v)) set('hiddenRows', [...s!.hiddenRows, v]);
                  rowInput = '';
                }}
              >
                <Input bind:value={rowInput} placeholder="Row title to hide" class="min-w-0 flex-1" />
                <Button variant="outline" type="submit" disabled={!rowInput.trim()}>Hide</Button>
              </form>
            </Collapsible.Content>
          </Collapsible.Root>

          <Collapsible.Root class="grid gap-2">
            <Collapsible.Trigger class="text-muted-foreground hover:text-foreground group flex items-center gap-1 text-left">
              <ChevronRight class="size-3.5 transition-transform group-data-[state=open]:rotate-90" aria-hidden="true" />
              Hide on Crunchyroll
            </Collapsible.Trigger>
            <Collapsible.Content class="grid gap-2">
              {#each Object.entries(DECLUTTER_LABEL) as [key, name] (key)}
                <label class={LINE}>
                  {name}
                  <Switch checked={s.declutter[key as DeclutterKey]} onCheckedChange={(v) => set('declutter', { ...s!.declutter, [key]: v })} />
                </label>
              {/each}
            </Collapsible.Content>
          </Collapsible.Root>
        </Card.Content>
      </Card.Root>

      <nav class="grid grid-cols-3 gap-2" aria-label="Open Crunchy+ hub">
        <Button variant="outline" onclick={() => openHub('upnext')}>Up next</Button>
        <Button variant="outline" onclick={() => openHub('import')}>Import</Button>
        <Button variant="outline" onclick={() => openHub('export')}>Export</Button>
      </nav>
    {/if}

    {#if error}<p class="text-destructive m-0">{error}</p>{/if}
  </main>
</Tooltip.Provider>
