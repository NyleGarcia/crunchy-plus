<script lang="ts">
  import { planUpdate } from '@/lib/anilist';
  import { progressBySegment, single, type Segment } from '@/lib/segments';
  import type { ProfileInfo } from '@/lib/cr-api';
  import { AUTO_ACCEPT, rank } from '@/lib/matcher';
  import { bg, crOp, type MatchResult, type Ranked, type ScrapedSeason } from '@/lib/messages';
  import { importLogItem, lastScanItem, type ScanSnapshot } from '@/lib/settings';
  import type { AniEntry, AniMedia, ListStatus } from '@/lib/types';

  type Phase = 'idle' | 'profile' | 'confirm' | 'scraping' | 'matching' | 'review' | 'applying' | 'done';
  interface Row {
    season: ScrapedSeason;
    match: MatchResult | null;
    current: AniEntry | null;
    plan: { status: ListStatus; progress: number; backport?: boolean } | null;
    /** One per AniList entry this row updates (several when the CR season is split into parts). */
    parts: Part[];
    selected: boolean;
    /** Write Crunchyroll's state exactly, even if it lowers progress or changes status. */
    backport?: boolean;
    result?: 'ok' | string;
    picking?: boolean;
    loadingCands?: boolean;
    q?: string;
  }

  interface Part {
    media: AniMedia;
    seg: Segment;
    current: AniEntry | null;
    plan: { status: ListStatus; progress: number; backport?: boolean } | null;
  }

  /**
   * Backport: CR's state wins — exact progress (may be lower) and the status it implies.
   * Only for rows the user explicitly marks; still recorded for undo like any import.
   */
  function forcedPlan(current: AniEntry | null, progress: number, total: number | null, idle: ListStatus) {
    const p = total ? Math.min(progress, total) : progress;
    const status: ListStatus = total && p >= total ? 'COMPLETED' : p > 0 ? idle : 'PLANNING';
    if (current && current.progress === p && current.status === status) return null;
    return { status, progress: p, backport: true };
  }

  type Filter = 'all' | 'matched' | 'unmatched' | 'skipped' | 'failed' | 'review' | 'changed';
  type Sort = 'recent' | 'pctDesc' | 'pctAsc' | 'title';
  let filter = $state<Filter>('all');
  /** Previous scan to diff against, and whether this view is a replay of it. */
  let baseline = $state<ScanSnapshot | null>(null);
  let replayMode = $state<'saved' | 'fresh' | null>(null);
  let hasSnapshot = $state(false);
  let replayFresh = $state(false);
  $effect(() => {
    lastScanItem.getValue().then((s) => (hasSnapshot = !!s));
  });
  let sort = $state<Sort>('recent');
  /** Jev is optional: its UI only shows when a TypeSafe key is set. */
  let hasJev = $state(false);
  $effect(() => {
    bg({ type: 'jev:status' })
      .then((s) => (hasJev = s.hasKey && s.enabled))
      .catch(() => {});
  });
  /** Jev's probability is spread over all options, so compare its *pick* with ours, not the numbers. */
  const jevAgrees = (r: Row) => !!r.match?.jev && r.match.jev.choice != null && r.match.jev.choice === r.match.mediaId;
  const jevDisagrees = (r: Row) => !!r.match?.jev && !!r.match.mediaId && r.match.jev.choice !== r.match.mediaId;
  const jevPickTitle = (r: Row) => {
    const id = r.match?.jev?.choice;
    if (id == null) return 'none of these';
    const m = r.match?.candidates.find((c) => c.media.id === id)?.media;
    return m ? title(m) : `#${id}`;
  };
  const jevPct = (r: Row, id: number | null | undefined) =>
    id != null && r.match?.jev ? pct(r.match.jev.probs[id] ?? 0) : null;

  async function askJev(r: Row) {
    if (!r.match?.candidates.length) return;
    r.loadingCands = true;
    try {
      r.match.jev = await bg({ type: 'jev:choose', input: r.season.input, candidates: r.match.candidates.map((c) => c.media) });
    } catch (e) {
      r.result = (e as Error).message;
    } finally {
      r.loadingCands = false;
    }
  }

  let phase = $state<Phase>('idle');
  let label = $state('');
  let error = $state('');
  let rows = $state<Row[]>([]);
  let stats = $state({ history: 0, watchlist: 0 });
  let recentDays = $state(45);
  let idleStatus = $state<ListStatus>('PAUSED');
  let onlyChanges = $state(true);
  /** Watchlist-only rows (nothing watched → Planning) are opt-in. */
  let includeWatchlist = $state(false);
  let list = new Map<number, AniEntry>();

  /** Displayed confidence 0–100. Saved/manual picks have no fresh score and count as confirmed. */
  const pct = (s: number | null | undefined) => (s == null ? null : Math.round(Math.min(1, Math.max(0, s)) * 100));
  const scoreOf = (r: Row) =>
    r.match?.source === 'saved' && r.match.mediaId
      ? 1
      : Math.max(r.match?.score ?? 0, r.match?.mediaId ? (r.match.jev?.probs[r.match.mediaId] ?? 0) : 0);
  const tone = (s: number) => (s >= AUTO_ACCEPT ? 'good' : s >= 0.7 ? 'mid' : 'low');
  /** Unmatched, below auto-accept, or a runner-up within 5 points. */
  function needsReview(r: Row) {
    if (!r.match || r.match.mediaId === null) return true;
    if (r.match.mediaId === 0) return false;
    if (jevDisagrees(r)) return true;
    if (r.match.source === 'saved' || r.match.source === 'jev') return false;
    const [a, b] = r.match.candidates;
    return (r.match.score ?? 0) < AUTO_ACCEPT || (!!a && !!b && b.score > a.score - 0.05);
  }
  const counts = $derived({
    all: rows.length,
    matched: rows.filter((r) => (r.match?.mediaId ?? 0) > 0).length,
    unmatched: rows.filter((r) => r.match?.mediaId === null).length,
    skipped: rows.filter((r) => r.match?.mediaId === 0).length,
    failed: rows.filter((r) => !r.match).length,
    review: rows.filter(needsReview).length,
    changed: rows.filter((r) => { const d = diffOf(r); return d === 'match' || d === 'plan' || d === 'new'; }).length,
  });
  const shown = $derived.by(() => {
    let out = onlyChanges ? rows.filter((r) => r.plan || !r.match?.mediaId) : [...rows];
    if (filter === 'matched') out = out.filter((r) => (r.match?.mediaId ?? 0) > 0);
    else if (filter === 'unmatched') out = out.filter((r) => r.match?.mediaId === null);
    else if (filter === 'skipped') out = out.filter((r) => r.match?.mediaId === 0);
    else if (filter === 'failed') out = out.filter((r) => !r.match);
    else if (filter === 'review') out = out.filter(needsReview);
    else if (filter === 'changed') out = out.filter((r) => { const d = diffOf(r); return d === 'match' || d === 'plan' || d === 'new'; });
    if (sort === 'pctDesc') out.sort((a, b) => scoreOf(b) - scoreOf(a));
    else if (sort === 'pctAsc') out.sort((a, b) => scoreOf(a) - scoreOf(b));
    else if (sort === 'title')
      out.sort(
        (a, b) =>
          a.season.input.seriesTitle.localeCompare(b.season.input.seriesTitle) ||
          a.season.input.seasonNumber - b.season.input.seasonNumber,
      );
    return out; // 'recent' keeps scrape order (last played first)
  });
  const selectedCount = $derived(rows.filter((r) => r.selected && r.plan).length);
  const unmatched = $derived(rows.filter((r) => r.match && r.match.mediaId === null).length);

  $effect(() => {
    const l = (msg: { type?: string; label?: string }) => {
      if (msg?.type === 'cr:progress' && msg.label) label = msg.label;
    };
    browser.runtime.onMessage.addListener(l);
    return () => browser.runtime.onMessage.removeListener(l);
  });

  function replan(r: Row) {
    const media = r.match?.media;
    if (!media || !r.match?.mediaId) {
      r.plan = null;
      r.parts = [];
      r.selected = false;
      return;
    }
    const { progress, lastPlayed, inWatchlist } = r.season;
    const recent = lastPlayed && Date.now() - Date.parse(lastPlayed) < recentDays * 864e5;
    const idle: ListStatus = recent ? 'CURRENT' : idleStatus;
    const segs = r.match.segments?.length
      ? r.match.segments.filter((s): s is { seg: Segment; media: AniMedia } => !!s.media)
      : [{ seg: single(media.id)[0]!, media }];
    // Nothing watched: Planning on the first entry — for watchlist shows (opt-in), or to fix an
    // existing "Watching · 0" entry.
    const first = segs[0]!.seg.mediaId;
    const watching0 = list.get(first)?.status === 'CURRENT' && list.get(first)?.progress === 0;
    const targets =
      progress === 0
        ? (inWatchlist && includeWatchlist) || watching0
          ? [{ mediaId: first, progress: 0 }]
          : []
        : progressBySegment(
            segs.map((s) => s.seg),
            progress,
          );
    r.parts = segs.map(({ seg, media: m }) => {
      const current = list.get(m.id) ?? null;
      const target = targets.find((t) => t.mediaId === m.id);
      // Only AniList's episode count can complete an entry. CR's count is just what has aired so far.
      const total = m.episodes ?? null;
      const plan = !target
        ? null
        : r.backport
          ? forcedPlan(current, target.progress, total, idle)
          : planUpdate(current, Math.min(target.progress, total ?? target.progress), total, idle);
      return { media: m, seg, current, plan };
    });
    r.current = r.parts[0]?.current ?? null;
    r.plan = r.parts.find((p) => p.plan)?.plan ?? null;
    r.selected = !!r.plan;
  }

  /**
   * Case 2: consecutive CR seasons of one series matched to the same AniList entry (CR split one
   * AniList season in two). Offset the later season so its ep 1 continues after the earlier one.
   */
  async function detectOffsets() {
    const bySeries = new Map<string, Row[]>();
    for (const r of rows) {
      if (!r.match?.mediaId || r.match.segments?.length) continue;
      const list = bySeries.get(r.season.input.seriesId) ?? [];
      list.push(r);
      bySeries.set(r.season.input.seriesId, list);
    }
    for (const group of bySeries.values()) {
      group.sort((a, b) => a.season.input.seasonNumber - b.season.input.seasonNumber);
      let offset = 0;
      for (let i = 1; i < group.length; i++) {
        const prev = group[i - 1]!;
        const cur = group[i]!;
        const media = cur.match!.media;
        const prevCount = prev.season.input.seasonEpisodes;
        if (cur.match!.mediaId !== prev.match!.mediaId || !prevCount) {
          offset = 0;
          continue;
        }
        offset += prevCount;
        // The AniList entry must be long enough to hold both CR seasons.
        if (media?.episodes && media.episodes < offset + 1) continue;
        try {
          cur.match = await bg({ type: 'match:setSegments', key: cur.season.key, segments: single(cur.match!.mediaId!, offset) });
          replan(cur);
        } catch {}
      }
    }
  }

  async function setSplit(r: Row, on: boolean) {
    if (!r.match?.mediaId) return;
    r.loadingCands = true;
    try {
      r.match = on
        ? await bg({ type: 'match:split', key: r.season.key, input: r.season.input, mediaId: r.match.mediaId })
        : await bg({ type: 'match:setSegments', key: r.season.key, segments: null });
      replan(r);
    } catch (e) {
      r.result = (e as Error).message;
    } finally {
      r.loadingCands = false;
    }
  }

  async function setOffset(r: Row, offset: number) {
    if (!r.match?.mediaId) return;
    const n = Math.max(0, Math.round(offset) || 0);
    r.match = await bg({ type: 'match:setSegments', key: r.season.key, segments: n ? single(r.match.mediaId, n) : null });
    replan(r);
  }

  const replanAll = () => phase === 'review' && rows.forEach(replan);

  let profile = $state<ProfileInfo | null>(null);

  /** Step 1: show which Crunchyroll profile will be read, and wait for the user's OK. */
  async function checkProfile() {
    error = '';
    phase = 'profile';
    label = 'Checking Crunchyroll profile…';
    try {
      profile = await crOp('profile');
      phase = 'confirm';
    } catch (e) {
      error = (e as Error).message;
      phase = 'idle';
    }
  }

  async function start() {
    error = '';
    try {
      phase = 'scraping';
      label = 'Connecting to Crunchyroll tab…';
      const scrape = await crOp('scrape');
      stats = { history: scrape.historyCount, watchlist: scrape.watchlistCount };
      baseline = await lastScanItem.getValue();
      replayMode = null;
      await runMatching(scrape.seasons, false);
      await saveSnapshot(scrape.seasons);
      phase = 'review';
    } catch (e) {
      error = (e as Error).message;
      phase = 'idle';
    }
  }

  /**
   * Re-run matching + planning on the last scan's Crunchyroll data (no CR requests) and diff it
   * against that scan. `fresh` ignores saved matches to test the matcher; nothing is saved then.
   */
  async function replay(fresh: boolean) {
    error = '';
    const snap = await lastScanItem.getValue();
    if (!snap) return;
    try {
      baseline = snap;
      replayMode = fresh ? 'fresh' : 'saved';
      stats = { history: 0, watchlist: 0 };
      await runMatching(snap.seasons, fresh);
      phase = 'review';
    } catch (e) {
      error = (e as Error).message;
      phase = 'idle';
    }
  }

  async function runMatching(seasons: ScrapedSeason[], force: boolean) {
    label = 'Loading your AniList list…';
    list = new Map(await bg({ type: 'anilist:list' }));
    rows = seasons.map((season) => ({ season, match: null, current: null, plan: null, parts: [], selected: false }));
    phase = 'matching';
    // Chunks of 30 seasons per background call: progress stays visible, AniList requests stay batched.
    const CHUNK = 30;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      label = `Matching ${Math.min(i + CHUNK, rows.length)}/${rows.length}…`;
      try {
        const res = await bg({
          type: 'match:resolveMany',
          items: chunk.map((r) => ({ key: r.season.key, input: r.season.input })),
          force,
        });
        chunk.forEach((r, j) => (r.match = res[j] ?? null));
      } catch (e) {
        chunk.forEach((r) => (r.result = (e as Error).message));
      }
      chunk.forEach(replan);
    }
    if (!force) {
      label = 'Checking split seasons…';
      await detectOffsets();
    }
  }

  /** Re-match rows whose matching request failed (rate limit, network). */
  async function retryFailed() {
    const failed = rows.filter((r) => !r.match);
    phase = 'matching';
    for (let i = 0; i < failed.length; i += 30) {
      const chunk = failed.slice(i, i + 30);
      label = `Retrying ${Math.min(i + 30, failed.length)}/${failed.length}…`;
      try {
        const res = await bg({ type: 'match:resolveMany', items: chunk.map((r) => ({ key: r.season.key, input: r.season.input })) });
        chunk.forEach((r, j) => {
          r.match = res[j] ?? null;
          if (r.match) r.result = undefined;
        });
      } catch (e) {
        chunk.forEach((r) => (r.result = (e as Error).message));
      }
      chunk.forEach(replan);
    }
    phase = 'review';
  }

  const snapResult = (r: Row): ScanSnapshot['results'][string] => ({
    mediaId: r.match?.mediaId ?? null,
    parts: r.parts.map((p) => ({ mediaId: p.media.id, plan: p.plan ? { status: p.plan.status, progress: p.plan.progress } : null })),
  });

  async function saveSnapshot(seasons: ScrapedSeason[]) {
    await lastScanItem.setValue({
      at: Date.now(),
      profileId: profile?.id ?? null,
      seasons: $state.snapshot(seasons),
      results: Object.fromEntries(rows.map((r) => [r.season.key, snapResult(r)])),
    });
  }

  /** How this row compares with the baseline scan. */
  function diffOf(r: Row): 'new' | 'same' | 'match' | 'plan' | null {
    if (!baseline) return null;
    const before = baseline.results[r.season.key];
    if (!before) return 'new';
    const now = snapResult(r);
    if (before.mediaId !== now.mediaId || before.parts.map((p) => p.mediaId).join() !== now.parts.map((p) => p.mediaId).join())
      return 'match';
    const key = (x: typeof now) => x.parts.map((p) => (p.plan ? `${p.plan.status}:${p.plan.progress}` : '-')).join();
    return key(before) === key(now) ? 'same' : 'plan';
  }


  async function openPicker(r: Row) {
    r.picking = true;
    r.q ??= r.season.input.seasonTitle;
    if (r.match && !r.match.candidates.length && !r.loadingCands) {
      // Saved matches carry no alternatives — search again (nothing is saved by this).
      r.loadingCands = true;
      try {
        const fresh = await bg({ type: 'match:resolve', key: r.season.key, input: r.season.input, force: true });
        if (r.match) r.match.candidates = fresh.candidates;
      } catch (e) {
        r.result = (e as Error).message;
      } finally {
        r.loadingCands = false;
      }
    }
  }

  async function searchFor(r: Row) {
    const q = r.q?.trim();
    if (!q || !r.match) return;
    r.loadingCands = true;
    try {
      const found = await bg({ type: 'anilist:search', q });
      const merged = new Map<number, Ranked>(r.match.candidates.map((c) => [c.media.id, c]));
      for (const c of rank(r.season.input, Array.isArray(found) ? found : [])) merged.set(c.media.id, c);
      r.match.candidates = [...merged.values()].sort((a, b) => b.score - a.score);
    } finally {
      r.loadingCands = false;
    }
  }

  async function pick(r: Row, c: Ranked | 0) {
    const keep = r.match?.candidates ?? [];
    const res = await bg({ type: 'match:set', key: r.season.key, mediaId: c === 0 ? 0 : c.media.id });
    r.match = { ...res, candidates: keep, score: c === 0 ? null : c.score };
    r.picking = false;
    replan(r);
  }

  async function apply() {
    phase = 'applying';
    // Several rows can target the same AniList entry (split / continuing seasons). Merge them so one
    // write per entry carries the furthest progress — saving them one by one could move it backwards.
    const rank = (s: ListStatus) => (s === 'COMPLETED' ? 2 : s === 'PLANNING' ? 0 : 1);
    const merged = new Map<number, { r: Row; p: Part; rows: Row[] }>();
    for (const r of rows.filter((x) => x.selected && x.match?.mediaId)) {
      for (const p of r.parts.filter((x) => x.plan)) {
        const prev = merged.get(p.media.id);
        const better =
          !prev ||
          (p.plan!.backport && !prev.p.plan!.backport) ||
          rank(p.plan!.status) > rank(prev.p.plan!.status) ||
          (rank(p.plan!.status) === rank(prev.p.plan!.status) && p.plan!.progress > prev.p.plan!.progress);
        if (better) merged.set(p.media.id, { r, p, rows: [...(prev?.rows ?? []), r] });
        else prev.rows.push(r);
      }
    }
    const todo = [...merged.values()];
    // Record exact before-states first so this apply can always be undone precisely.
    const log = await importLogItem.getValue();
    await importLogItem.setValue(
      [
        {
          at: Date.now(),
          items: todo.map(({ p }) => ({
            mediaId: p.media.id,
            title: title(p.media),
            before: p.current ? { status: p.current.status, progress: p.current.progress } : null,
          })),
        },
        ...log,
      ].slice(0, 5),
    );
    const BATCH = 10; // aliased mutations per AniList request
    for (let i = 0; i < todo.length; i += BATCH) {
      const chunk = todo.slice(i, i + BATCH);
      label = `Updating ${Math.min(i + BATCH, todo.length)}/${todo.length}…`;
      try {
        const res = await bg({
          type: 'anilist:saveMany',
          items: chunk.map(({ p }) => ({ mediaId: p.media.id, ...p.plan! })),
        });
        chunk.forEach(({ rows: touched }, j) => {
          const out = res[j];
          if (out && 'mediaId' in out) list.set(out.mediaId, out);
          for (const r of touched) {
            if (out && 'mediaId' in out) {
              if (r.result === undefined || r.result === 'ok') r.result = 'ok'; // keep an earlier part's error
            } else r.result = out?.error ?? 'No result';
          }
        });
      } catch (e) {
        chunk.forEach(({ rows: touched }) => touched.forEach((r) => (r.result = (e as Error).message)));
      }
    }
    phase = 'done';
  }

  /** "CR 1–12 · Part title" label for a split part. */
  function partLabel(p: Part) {
    const end = p.seg.count != null ? p.seg.crFrom + p.seg.count - 1 : null;
    return `CR ${p.seg.crFrom}${end ? `–${end}` : '+'} · ${title(p.media)}`;
  }

  /** CR season titles are often just "Season 3"; strip a repeated series name, fall back to the number. */
  function seasonLabel(i: ScrapedSeason['input']) {
    const t = i.seasonTitle.trim();
    const rest = t.toLowerCase().startsWith(i.seriesTitle.toLowerCase()) ? t.slice(i.seriesTitle.length).replace(/^[\s:–-]+/, '') : t;
    return rest || `Season ${i.seasonNumber}`;
  }
  const title = (m: AniMedia) => m.title.english ?? m.title.romaji ?? `#${m.id}`;
  const fmt = (s: ListStatus | undefined) => (s ? s[0] + s.slice(1).toLowerCase() : '—');
  const STATUSES: ListStatus[] = ['CURRENT', 'PAUSED', 'DROPPED'];
</script>

<section class="pane">
  <header>
    <h2>Crunchyroll <span>→ AniList</span></h2>
    <p class="muted">
      Reads your Crunchyroll watch history and watchlist (from an open, logged-in Crunchyroll tab), matches each season on
      AniList, and shows exactly what would change. Nothing is written until you press Apply. Progress never goes
      backwards and completed entries are never downgraded.
    </p>
  </header>

  <section class="rules">
    <label>Played in last <input type="number" min="1" max="365" bind:value={recentDays} onchange={replanAll} /> days → <b>Watching</b></label>
    <label>
      Older, unfinished →
      <select bind:value={idleStatus} onchange={replanAll}>{#each STATUSES as s}<option value={s}>{fmt(s)}</option>{/each}</select>
    </label>
    <label><input type="checkbox" bind:checked={onlyChanges} /> Only show changes</label>
    <label title="Shows on your Crunchyroll watchlist that you haven't watched become Planning on AniList">
      <input type="checkbox" bind:checked={includeWatchlist} onchange={replanAll} /> Include watchlist (→ Planning)
    </label>
    {#if phase === 'idle' || phase === 'done'}
      {#if hasSnapshot}
        <span class="replay">
          <button class="btn" onclick={() => replay(replayFresh)} title="Re-run matching on the last scan's Crunchyroll data — no Crunchyroll requests">Replay last scan</button>
          <label title="Search AniList again for every row instead of using saved matches; nothing is saved"><input type="checkbox" bind:checked={replayFresh} /> ignore saved matches</label>
        </span>
      {/if}
    {/if}
    {#if phase === 'idle'}
      <button class="btn primary" onclick={checkProfile}>Scan Crunchyroll</button>
    {:else if phase === 'review'}
      <button class="btn primary" disabled={!selectedCount} onclick={apply}>Apply {selectedCount} updates</button>
    {:else if phase === 'done'}
      <button class="btn" onclick={checkProfile}>Rescan</button>
    {/if}
  </section>

  {#if phase === 'confirm' && profile}
    <div class="confirm">
      <p>
        Read watch history from Crunchyroll profile
        <b>{profile.name ?? 'unknown name'}</b>{profile.profiles > 1 ? ` (one of ${profile.profiles} profiles on this account)` : ''}?
      </p>
      <p class="muted">
        Wrong profile? Switch profiles on crunchyroll.com, reload that tab, then scan again.
        <small>(id …{profile.id.slice(-6)}, from {profile.source})</small>
      </p>
      {#if profile.source === 'account'}
        <p class="err">
          Couldn't confirm which profile you're on — scanning now could read another profile's history.
          In the Crunchyroll tab, open <b>crunchyroll.com/history</b> on your profile, let it load, then press Retry.
        </p>
        <div class="row">
          <button class="btn primary" onclick={checkProfile}>Retry</button>
          <button class="btn" onclick={() => (phase = 'idle')}>Cancel</button>
        </div>
      {:else}
        <div class="row">
          <button class="btn primary" onclick={start}>Yes, scan this profile</button>
          <button class="btn" onclick={() => (phase = 'idle')}>Cancel</button>
        </div>
      {/if}
    </div>
  {/if}

  {#if phase === 'profile' || phase === 'scraping' || phase === 'matching' || phase === 'applying'}
    <p class="status"><span class="spin"></span>{label}</p>
  {/if}
  {#if error}<p class="err">{error}</p>{/if}

  {#if rows.length}
    <p class="muted">
      {stats.history} history items · {stats.watchlist} watchlist · {rows.length} seasons
      {#if unmatched}· <b class="warn">{unmatched} need a match</b>{/if}
    </p>
    {#if baseline}
      <p class="muted diffsum">
        {replayMode === 'fresh' ? 'Re-matched from scratch' : replayMode === 'saved' ? 'Replayed' : 'Compared'} against the scan from
        {new Date(baseline.at).toLocaleString()}:
        <b>{rows.filter((r) => diffOf(r) === 'same').length}</b> same ·
        <b class="warn">{rows.filter((r) => diffOf(r) === 'match').length}</b> match changed ·
        <b class="warn">{rows.filter((r) => diffOf(r) === 'plan').length}</b> plan changed ·
        {rows.filter((r) => diffOf(r) === 'new').length} new
      </p>
    {/if}
    <div class="toolbar">
      <div class="seg" role="radiogroup" aria-label="Filter">
        {#each [['all', 'All'], ['matched', 'Matched'], ['unmatched', 'Unmatched'], ...(counts.skipped ? [['skipped', 'Skipped']] : []), ...(counts.failed ? [['failed', 'Failed']] : []), ['review', 'Needs review'], ...(baseline ? [['changed', 'Changed']] : [])] as [id, name]}
          <button role="radio" aria-checked={filter === id} class:on={filter === id} onclick={() => (filter = id as Filter)}>
            {name} <small>{counts[id as Filter]}</small>
          </button>
        {/each}
      </div>
      {#if counts.failed && phase === 'review'}
        <button class="btn" onclick={retryFailed} title="Matching failed for these rows (e.g. AniList rate limit) — try them again">
          Retry {counts.failed} failed
        </button>
      {/if}
      <label>
        Sort
        <select bind:value={sort}>
          <option value="recent">Recently played</option>
          <option value="pctDesc">Match % high → low</option>
          <option value="pctAsc">Match % low → high</option>
          <option value="title">Title</option>
        </select>
      </label>
    </div>
    <table>
      <colgroup>
        <col style="width: 36px" />
        <col style="width: 32%" />
        <col style="width: 34%" />
        <col style="width: 14%" />
        <col />
      </colgroup>
      <thead>
        <tr><th></th><th>Crunchyroll</th><th>AniList match</th><th>Now</th><th>After</th></tr>
      </thead>
      <tbody>
        {#each shown as r (r.season.key)}
          <tr class:off={!r.selected}>
            <td><input type="checkbox" bind:checked={r.selected} disabled={!r.plan || phase !== 'review'} /></td>
            <td>
              <b>{r.season.input.seriesTitle}</b>
              <span class="season">{seasonLabel(r.season.input)}</span>
              {#if diffOf(r) === 'match'}<span class="diff warn">match changed</span>
              {:else if diffOf(r) === 'plan'}<span class="diff warn">plan changed</span>
              {:else if diffOf(r) === 'new'}<span class="diff">new</span>{/if}
              <small>
                ep {r.season.progress}{r.season.input.seasonEpisodes ? ` · ${r.season.input.seasonEpisodes} on CR` : ''}
                · watched {r.season.watchedCount}{r.season.furthest > r.season.progress ? ` (furthest ep ${r.season.furthest})` : ''}
                {r.season.inWatchlist ? '· watchlist' : ''}
                {r.season.lastPlayed ? `· ${new Date(r.season.lastPlayed).toLocaleDateString()}` : ''}
              </small>
            </td>
            <td>
              {#if r.picking && r.match}
                <div class="picker">
                  {#if r.loadingCands}<span class="muted">Searching…</span>{/if}
                  {#each r.match.candidates as c (c.media.id)}
                    <button class="cand" class:current={c.media.id === r.match.mediaId} onclick={() => pick(r, c)}>
                      {#if c.media.coverImage.medium}<img src={c.media.coverImage.medium} alt="" />{/if}
                      <span class="ct">
                        <b>{title(c.media)}</b>
                        <small>{c.media.format ?? '?'} · {c.media.seasonYear ?? '?'} · {c.media.episodes ?? '?'} eps</small>
                      </span>
                      <span class="pct {tone(c.score)}" title="Title/season/episode score">{pct(c.score)}%</span>
                      {#if r.match.jev}
                        <span class="pct jev" class:top={r.match.jev.choice === c.media.id} title="Jev's probability">Jev {jevPct(r, c.media.id)}%</span>
                      {/if}
                    </button>
                  {/each}
                  {#if r.match.jev && r.match.jev.choice == null}<small class="warn">Jev thinks none of these is the same season.</small>{/if}
                  {#if hasJev && !r.match.jev && r.match.candidates.length > 1}
                    <button class="link" onclick={() => askJev(r)}>Ask Jev which one</button>
                  {/if}
                  {#if r.match.mediaId}
                    <div class="split">
                      {#if r.match.segments?.some((s) => s.seg.mediaId !== r.match!.mediaId)}
                        <small>Split across {r.match.segments.length} AniList entries.</small>
                        <button class="link" onclick={() => setSplit(r, false)}>undo split</button>
                      {:else}
                        <button class="link" onclick={() => setSplit(r, true)}>split across AniList parts (Part 1 / Part 2…)</button>
                      {/if}
                      <label>
                        <small>AniList ep before this season's ep 1</small>
                        <input
                          type="number"
                          min="0"
                          value={r.match.segments?.[0]?.seg.aniOffset ?? 0}
                          onchange={(e) => setOffset(r, e.currentTarget.valueAsNumber)}
                        />
                      </label>
                    </div>
                  {/if}
                  <form class="search" onsubmit={(e) => (e.preventDefault(), searchFor(r))}>
                    <input bind:value={r.q} placeholder="Search AniList" />
                    <button class="btn">Search</button>
                  </form>
                  <div class="row">
                    <button class="link" onclick={() => pick(r, 0)}>skip this season</button>
                    <button class="link" onclick={() => (r.picking = false)}>cancel</button>
                  </div>
                </div>
              {:else if r.match?.media}
                <div class="m">
                  {#if r.match.media.coverImage.medium}<img src={r.match.media.coverImage.medium} alt="" />{/if}
                  <span>
                    <a href={`https://anilist.co/anime/${r.match.media.id}`} target="_blank" rel="noreferrer">{title(r.match.media)}</a>
                    <span class="row">
                      {#if r.match.source === 'saved' && r.match.score == null}
                        <span class="pct saved" title="Saved match from an earlier scan or your pick">saved</span>
                      {:else if r.match.source === 'jev'}
                        <span class="pct jev top" title="Picked by Jev ({jevPct(r, r.match.mediaId)}% probability)">Jev pick</span>
                      {:else}
                        <span class="pct {tone(r.match.score ?? 0)}" title="Match score: title, season and episode agreement (not a probability)">{pct(r.match.score)}%</span>
                      {/if}
                      {#if r.match.source !== 'jev' && jevAgrees(r)}
                        <span class="pct jev top" title="Jev picked the same entry ({jevPct(r, r.match.mediaId)}% probability)">Jev ✓</span>
                      {:else if jevDisagrees(r)}
                        <span class="pct mid" title="Jev's probability is spread across all options">Jev prefers {jevPickTitle(r)}{r.match.jev?.choice != null ? ` (${jevPct(r, r.match.jev?.choice)}%)` : ''}</span>
                      {/if}
                      {#if r.match.candidates.length > 1}<small class="muted">{r.match.candidates.length - 1} other</small>{/if}
                      {#if r.parts.length > 1}<small class="split-tag">split ×{r.parts.length}</small>{/if}
                      {#if r.parts.length === 1 && r.parts[0]!.seg.aniOffset}<small class="split-tag">continues from ep {r.parts[0]!.seg.aniOffset + 1}</small>{/if}
                      <button class="link" onclick={() => openPicker(r)}>change</button>
                    </span>
                  </span>
                </div>
              {:else if r.match?.mediaId === 0}
                <span class="muted">skipped</span> <button class="link" onclick={() => openPicker(r)}>match</button>
              {:else if r.match}
                <span class="row">
                  {#if r.match.score != null}<span class="pct {tone(r.match.score)}" title="Best candidate">{pct(r.match.score)}%</span>{/if}
                  <span class="warn">no confident match</span>
                  {#if r.match.jev?.choice != null}
                    <small class="muted">Jev leans {title(r.match.candidates.find((c) => c.media.id === r.match!.jev!.choice)?.media ?? r.match.candidates[0]!.media)} ({jevPct(r, r.match.jev.choice)}%)</small>
                  {/if}
                  <button class="link" onclick={() => openPicker(r)}>pick ({r.match.candidates.length})</button>
                </span>
              {:else if r.result && r.result !== 'ok'}
                <span class="err" title={r.result}>matching failed</span>
              {:else}
                <span class="muted">…</span>
              {/if}
            </td>
            {#if r.parts.length > 1}
              <td>
                {#each r.parts as p (p.media.id)}
                  <div class="part"><small class="muted">{partLabel(p)}</small> {fmt(p.current?.status)} {p.current ? `· ${p.current.progress}` : ''}</div>
                {/each}
              </td>
              <td>
                {#if r.result && r.result !== 'ok'}<span class="err">{r.result}</span>{/if}
                {#each r.parts as p (p.media.id)}
                  <div class="part">
                    {#if p.plan}<b class:ok={r.result === 'ok'} class:back={p.plan.backport}>{r.result === 'ok' ? '✓ ' : ''}{p.plan.backport ? '↓ ' : ''}{fmt(p.plan.status)}</b> · {p.plan.progress}
                    {:else}<span class="muted">no change</span>{/if}
                  </div>
                {/each}
                {#if phase === 'review'}
                  <label class="bp" title="Write Crunchyroll's progress and status exactly, even if lower than AniList">
                    <input type="checkbox" bind:checked={r.backport} onchange={() => replan(r)} /> backport
                  </label>
                {/if}
              </td>
            {:else}
              <td>{fmt(r.current?.status)} {r.current ? `· ${r.current.progress}` : ''}</td>
              <td>
                {#if r.result === 'ok'}<span class="ok">✓ {fmt(r.plan?.status)} · {r.plan?.progress}</span>
                {:else if r.result}<span class="err">{r.result}</span>
                {:else if r.plan}<b class:back={r.plan.backport}>{r.plan.backport ? '↓ ' : ''}{fmt(r.plan.status)}</b> · {r.plan.progress}
                {:else}<span class="muted">no change</span>{/if}
                {#if r.match?.mediaId && phase === 'review'}
                  <label class="bp" title="Write Crunchyroll's progress and status exactly, even if lower than AniList">
                    <input type="checkbox" bind:checked={r.backport} onchange={() => replan(r)} /> backport
                  </label>
                {/if}
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .pane {
    display: grid;
    gap: 18px;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 24px;
    letter-spacing: -0.02em;
  }
  h2 span {
    color: var(--accent);
  }
  header p {
    max-width: 70ch;
    margin: 0;
  }
  .rules {
    display: flex;
    flex-wrap: wrap;
    gap: 14px 22px;
    align-items: center;
    padding: 14px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--line);
  }
  .rules input[type='number'] {
    width: 64px;
  }
  .rules .btn {
    margin-left: auto;
  }
  .confirm {
    display: grid;
    gap: 8px;
    padding: 14px;
    border-radius: 12px;
    border: 1px solid var(--accent);
    background: var(--surface);
  }
  .confirm p {
    margin: 0;
  }
  .confirm .row {
    display: flex;
    gap: 8px;
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
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed; /* columns keep their share instead of sizing to content */
  }
  td {
    overflow-wrap: anywhere;
  }
  th {
    text-align: left;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    padding: 8px;
    border-bottom: 1px solid var(--line);
  }
  td {
    padding: 10px 8px;
    border-bottom: 1px solid var(--line);
    vertical-align: middle;
  }
  td small {
    display: block;
    color: var(--muted);
  }
  tr.off td {
    opacity: 0.6;
  }
  .m {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .m img {
    width: 30px;
    height: 42px;
    object-fit: cover;
    border-radius: 5px;
  }
  .m span {
    display: grid;
    justify-items: start;
  }
  .m a {
    color: var(--text);
    text-decoration: none;
    font-weight: 600;
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font-size: 12px;
  }
  .season {
    display: block;
    color: var(--text);
    opacity: 0.85;
  }
  .diff {
    display: inline-block;
    font-size: 11px;
    margin-top: 2px;
  }
  .replay {
    display: inline-flex;
    gap: 8px;
    align-items: center;
  }
  .diffsum {
    margin: 0;
  }
  .bp {
    display: flex;
    gap: 4px;
    align-items: center;
    font-size: 11px;
    color: var(--muted);
    margin-top: 2px;
  }
  .back {
    color: var(--err);
  }
  .part {
    white-space: nowrap;
  }
  .part + .part {
    margin-top: 4px;
  }
  .split {
    display: grid;
    gap: 4px;
    padding: 6px 8px;
    border: 1px dashed var(--line);
    border-radius: 8px;
  }
  .split label {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .split input {
    width: 70px;
  }
  .split-tag {
    color: #7aa2ff;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
  }
  .seg {
    display: inline-flex;
    padding: 3px;
    border-radius: 10px;
    background: rgb(255 255 255 / 0.05);
  }
  .seg button {
    border: 0;
    background: none;
    padding: 6px 12px;
    border-radius: 8px;
    color: var(--muted);
    font-weight: 600;
  }
  .seg button.on {
    background: var(--accent);
    color: #160b02;
  }
  .seg small {
    opacity: 0.75;
    margin-left: 4px;
  }
  .row {
    display: inline-flex;
    gap: 8px;
    align-items: center;
  }
  .pct {
    font-size: 11px;
    font-weight: 700;
    padding: 1px 7px;
    border-radius: 999px;
    font-variant-numeric: tabular-nums;
  }
  .pct.good {
    background: rgb(61 220 151 / 0.15);
    color: var(--ok);
  }
  .pct.mid {
    background: rgb(255 180 84 / 0.15);
    color: #ffb454;
  }
  .pct.low,
  .pct.saved {
    background: rgb(255 255 255 / 0.06);
    color: var(--muted);
  }
  .pct.low {
    color: var(--err);
  }
  .pct.jev {
    background: rgb(167 139 250 / 0.12);
    color: #a78bfa;
  }
  .pct.jev.top {
    background: rgb(167 139 250 / 0.25);
  }
  .picker {
    display: grid;
    gap: 4px;
    max-width: 440px;
  }
  .cand {
    display: flex;
    gap: 10px;
    align-items: center;
    text-align: left;
    padding: 5px 8px;
    border-radius: 9px;
    border: 1px solid transparent;
    background: none;
  }
  .cand:hover {
    border-color: var(--line);
    background: rgb(255 255 255 / 0.04);
  }
  .cand.current {
    border-color: var(--accent);
  }
  .cand img {
    width: 26px;
    height: 37px;
    object-fit: cover;
    border-radius: 4px;
  }
  .ct {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .ct small {
    color: var(--muted);
  }
  .search {
    display: flex;
    gap: 6px;
  }
  .search input {
    flex: 1;
    min-width: 0;
  }
  .ok {
    color: var(--ok);
  }
  .warn {
    color: var(--accent);
  }
  .err {
    color: var(--err);
  }
  @media (max-width: 720px) {
    th:nth-child(4),
    td:nth-child(4) {
      display: none;
    }
  }
</style>
