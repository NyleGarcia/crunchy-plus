<script lang="ts">
  import { planUpdate } from '@/lib/anilist';
  import { progressBySegment, single, type Segment } from '@/lib/segments';
  import type { ProfileInfo } from '@/lib/cr-api';
  import { AUTO_ACCEPT, rank } from '@/lib/matcher';
  import { bg, crOp, type MatchResult, type Ranked, type ScrapedSeason } from '@/lib/messages';
  import { importLogItem, lastScanItem, type ScanSnapshot } from '@/lib/settings';
  import type { AniEntry, AniMedia, ListStatus } from '@/lib/types';
  import Segmented from '@/components/Segmented.svelte';
  import Hint from '@/components/Hint.svelte';
  import Busy from '@/components/Busy.svelte';
  import * as Card from '@/components/ui/card';
  import * as Command from '@/components/ui/command';
  import * as Select from '@/components/ui/select';
  import * as Table from '@/components/ui/table';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { Checkbox } from '@/components/ui/checkbox';
  import { Input } from '@/components/ui/input';
  import { cn } from '@/lib/utils';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import Check from '@lucide/svelte/icons/check';

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
  /** Ignore the scan cache: read all history and every season again. */
  let fullScan = $state(false);
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
  let stats = $state({ history: 0, historyNew: 0, watchlist: 0 });
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
      const scrape = await crOp('scrape', { full: fullScan });
      stats = { history: scrape.historyCount, historyNew: scrape.historyNew, watchlist: scrape.watchlistCount };
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
      stats = { history: 0, historyNew: 0, watchlist: 0 };
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

  const SORTS: { id: Sort; label: string }[] = [
    { id: 'recent', label: 'Recently played' },
    { id: 'pctDesc', label: 'Match % high → low' },
    { id: 'pctAsc', label: 'Match % low → high' },
    { id: 'title', label: 'Title' },
  ];
  const FILTER_LABEL: Record<Filter, string> = { all: 'All', matched: 'Matched', unmatched: 'Unmatched', skipped: 'Skipped', failed: 'Failed', review: 'Needs review', changed: 'Changed' };
  const filterOptions = $derived(
    (['all', 'matched', 'unmatched', ...(counts.skipped ? ['skipped' as const] : []), ...(counts.failed ? ['failed' as const] : []), 'review', ...(baseline ? ['changed' as const] : [])] as Filter[]).map(
      (id) => ({ id, label: FILTER_LABEL[id], count: counts[id] }),
    ),
  );
  /** Score pill colours: good ≥ auto-accept, mid ≥ 0.7, low below; saved = grey; jev = violet. */
  const PCT = 'h-[18px] px-[7px] text-[11px] font-bold tabular-nums';
  const pctClass = (t: 'good' | 'mid' | 'low' | 'saved' | 'jev' | 'jevTop') =>
    cn(
      PCT,
      t === 'good' && 'bg-success/15 text-success',
      t === 'mid' && 'bg-warning/15 text-warning',
      t === 'low' && 'bg-white/6 text-destructive',
      t === 'saved' && 'bg-white/6 text-muted-foreground',
      t === 'jev' && 'bg-[#a78bfa]/12 text-[#a78bfa]',
      t === 'jevTop' && 'bg-[#a78bfa]/25 text-[#a78bfa]',
    );
  const LINK = 'h-auto p-0 text-xs font-normal';
  const MUTED = 'text-muted-foreground';
  const SMALL = 'text-muted-foreground block text-xs';
</script>

<section class="grid gap-[18px]">
  <header>
    <h2 class="mb-1.5 text-2xl font-bold tracking-[-0.02em]">Crunchyroll <span class="text-primary">→ AniList</span></h2>
    <p class="text-muted-foreground m-0 max-w-[70ch]">
      Reads your Crunchyroll watch history and watchlist (from an open, logged-in Crunchyroll tab), matches each season on
      AniList, and shows exactly what would change. Nothing is written until you press Apply. Progress never goes
      backwards and completed entries are never downgraded.
    </p>
  </header>

  <Card.Root size="sm" class="shadow-none">
    <Card.Content class="flex flex-wrap items-center gap-x-[22px] gap-y-3.5">
      <label class="flex items-center gap-1.5">
        Played in last <Input type="number" class="h-7 w-16" min="1" max="365" bind:value={recentDays} onchange={replanAll} /> days → <b>Watching</b>
      </label>
      <span class="flex items-center gap-1.5">
        <span id="idle-status-label">Older, unfinished →</span>
        <Select.Root type="single" bind:value={() => idleStatus, (v) => ((idleStatus = v as ListStatus), replanAll())}>
          <Select.Trigger size="sm" aria-labelledby="idle-status-label">{fmt(idleStatus)}</Select.Trigger>
          <Select.Content>
            {#each STATUSES as s (s)}<Select.Item value={s} label={fmt(s)} />{/each}
          </Select.Content>
        </Select.Root>
      </span>
      <label class="flex items-center gap-1.5"><Checkbox bind:checked={onlyChanges} /> Only show changes</label>
      <Hint text="Shows on your Crunchyroll watchlist that you haven't watched become Planning on AniList">
        <label class="flex items-center gap-1.5">
          <Checkbox bind:checked={includeWatchlist} onCheckedChange={replanAll} /> Include watchlist (→ Planning)
        </label>
      </Hint>
      {#if phase === 'idle' || phase === 'done'}
        {#if hasSnapshot}
          <span class="inline-flex items-center gap-2">
            <Hint text="Re-run matching on the last scan's Crunchyroll data — no Crunchyroll requests">
              <Button variant="outline" onclick={() => replay(replayFresh)}>Replay last scan</Button>
            </Hint>
            <Hint text="Search AniList again for every row instead of using saved matches; nothing is saved">
              <label class="flex items-center gap-1.5"><Checkbox bind:checked={replayFresh} /> ignore saved matches</label>
            </Hint>
          </span>
        {/if}
      {/if}
      {#if phase === 'idle'}
        <Button class="ml-auto" onclick={checkProfile}>Scan Crunchyroll</Button>
      {:else if phase === 'review'}
        <Button class="ml-auto" disabled={!selectedCount} onclick={apply}>Apply {selectedCount} updates</Button>
      {:else if phase === 'done'}
        <Button variant="outline" class="ml-auto" onclick={checkProfile}>Rescan</Button>
      {/if}
    </Card.Content>
  </Card.Root>

  {#if phase === 'confirm' && profile}
    <Card.Root size="sm" class="ring-primary gap-2 shadow-none">
      <Card.Content class="grid gap-2">
        <p class="m-0">
          Read watch history from Crunchyroll profile
          <b>{profile.name ?? 'unknown name'}</b>{profile.profiles > 1 ? ` (one of ${profile.profiles} profiles on this account)` : ''}?
        </p>
        <p class="text-muted-foreground m-0">
          Wrong profile? Switch profiles on crunchyroll.com, reload that tab, then scan again.
          <small>(id …{profile.id.slice(-6)}, from {profile.source})</small>
        </p>
        {#if profile.source === 'account'}
          <p class="text-destructive m-0">
            Couldn't confirm which profile you're on — scanning now could read another profile's history.
            In the Crunchyroll tab, open <b>crunchyroll.com/history</b> on your profile, let it load, then press Retry.
          </p>
          <div class="flex gap-2">
            <Button onclick={checkProfile}>Retry</Button>
            <Button variant="outline" onclick={() => (phase = 'idle')}>Cancel</Button>
          </div>
        {:else}
          <div class="flex flex-wrap items-center gap-2">
            <Button onclick={start}>Yes, scan this profile</Button>
            <Button variant="outline" onclick={() => (phase = 'idle')}>Cancel</Button>
            <Hint text="Normally only history newer than the last scan is read and already-resolved seasons are reused">
              <label class="flex items-center gap-1.5"><Checkbox bind:checked={fullScan} /> full rescan (ignore cache)</label>
            </Hint>
          </div>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}

  {#if phase === 'profile' || phase === 'scraping' || phase === 'matching' || phase === 'applying'}
    <Busy {label} />
  {/if}
  {#if error}<p class="text-destructive m-0">{error}</p>{/if}

  {#if rows.length}
    <p class="text-muted-foreground m-0">
      {stats.history} history items{stats.historyNew < stats.history ? ` (${stats.historyNew} new)` : ''} · {stats.watchlist} watchlist · {rows.length} seasons
      {#if unmatched}· <b class="text-primary">{unmatched} need a match</b>{/if}
    </p>
    {#if baseline}
      <p class="text-muted-foreground m-0">
        {replayMode === 'fresh' ? 'Re-matched from scratch' : replayMode === 'saved' ? 'Replayed' : 'Compared'} against the scan from
        {new Date(baseline.at).toLocaleString()}:
        <b>{rows.filter((r) => diffOf(r) === 'same').length}</b> same ·
        <b class="text-primary">{rows.filter((r) => diffOf(r) === 'match').length}</b> match changed ·
        <b class="text-primary">{rows.filter((r) => diffOf(r) === 'plan').length}</b> plan changed ·
        {rows.filter((r) => diffOf(r) === 'new').length} new
      </p>
    {/if}
    <div class="flex flex-wrap items-center justify-between gap-3">
      <Segmented options={filterOptions} bind:value={filter} ariaLabel="Filter" size="sm" />
      {#if counts.failed && phase === 'review'}
        <Hint text="Matching failed for these rows (e.g. AniList rate limit) — try them again">
          <Button variant="outline" onclick={retryFailed}>Retry {counts.failed} failed</Button>
        </Hint>
      {/if}
      <span class="flex items-center gap-1.5">
        <span id="sort-label">Sort</span>
        <Select.Root type="single" bind:value={() => sort, (v) => (sort = v as Sort)}>
          <Select.Trigger size="sm" aria-labelledby="sort-label">{SORTS.find((s) => s.id === sort)?.label}</Select.Trigger>
          <Select.Content>
            {#each SORTS as s (s.id)}<Select.Item value={s.id} label={s.label} />{/each}
          </Select.Content>
        </Select.Root>
      </span>
    </div>
    <Table.Root class="table-fixed">
      <colgroup>
        <col style="width: 36px" />
        <col style="width: 32%" />
        <col style="width: 34%" />
        <col style="width: 14%" />
        <col />
      </colgroup>
      <Table.Header>
        <Table.Row class="hover:bg-transparent">
          <Table.Head class={MUTED}></Table.Head>
          <Table.Head class="text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase">Crunchyroll</Table.Head>
          <Table.Head class="text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase">AniList match</Table.Head>
          <Table.Head class="text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase max-md:hidden">Now</Table.Head>
          <Table.Head class="text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase">After</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each shown as r (r.season.key)}
          <Table.Row class={cn('align-middle [&>td]:px-2 [&>td]:py-2.5 [&>td]:whitespace-normal [&>td]:[overflow-wrap:anywhere]', !r.selected && '[&>td]:opacity-60')}>
            <Table.Cell><Checkbox bind:checked={r.selected} disabled={!r.plan || phase !== 'review'} aria-label="Apply {r.season.input.seriesTitle}" /></Table.Cell>
            <Table.Cell>
              <b>{r.season.input.seriesTitle}</b>
              <span class="block opacity-85">{seasonLabel(r.season.input)}</span>
              {#if diffOf(r) === 'match'}<span class="text-primary mt-0.5 inline-block text-[11px]">match changed</span>
              {:else if diffOf(r) === 'plan'}<span class="text-primary mt-0.5 inline-block text-[11px]">plan changed</span>
              {:else if diffOf(r) === 'new'}<span class="mt-0.5 inline-block text-[11px]">new</span>{/if}
              <small class={SMALL}>
                ep {r.season.progress}{r.season.input.seasonEpisodes ? ` · ${r.season.input.seasonEpisodes} on CR` : ''}
                · watched {r.season.watchedCount}{r.season.furthest > r.season.progress ? ` (furthest ep ${r.season.furthest})` : ''}
                {r.season.inWatchlist ? '· watchlist' : ''}
                {r.season.lastPlayed ? `· ${new Date(r.season.lastPlayed).toLocaleDateString()}` : ''}
              </small>
            </Table.Cell>
            <Table.Cell>
              {#if r.picking && r.match}
                <div class="grid max-w-[440px] gap-1">
                  <Command.Root shouldFilter={false} label="AniList candidates for {r.season.input.seasonTitle}" class="bg-transparent p-0">
                    <div class="flex items-center gap-1.5 [&>div]:flex-1 [&>div]:p-0">
                      <Command.Input
                        bind:value={r.q}
                        placeholder="Search AniList"
                        onkeydown={(e) => {
                          // Enter searches AniList (as the old form did) instead of picking the highlighted candidate.
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            searchFor(r);
                          }
                        }}
                      />
                      <Button variant="outline" size="sm" onclick={() => searchFor(r)}>Search</Button>
                    </div>
                    <Command.List class="max-h-none">
                      {#if r.loadingCands}<Command.Loading><span class={MUTED}>Searching…</span></Command.Loading>{/if}
                      {#each r.match.candidates as c (c.media.id)}
                        <Command.Item
                          value={String(c.media.id)}
                          onSelect={() => pick(r, c)}
                          class={cn('items-center gap-2.5 rounded-[9px] border border-transparent px-2 py-1.5 text-left', c.media.id === r.match.mediaId && 'border-primary')}
                        >
                          {#if c.media.coverImage.medium}<img src={c.media.coverImage.medium} alt="" class="h-[37px] w-[26px] shrink-0 rounded object-cover" />{/if}
                          <span class="grid min-w-0 flex-1">
                            <b class="truncate">{title(c.media)}</b>
                            <small class={MUTED}>{c.media.format ?? '?'} · {c.media.seasonYear ?? '?'} · {c.media.episodes ?? '?'} eps</small>
                          </span>
                          <Hint text="Title/season/episode score"><Badge variant="secondary" class={pctClass(tone(c.score))}>{pct(c.score)}%</Badge></Hint>
                          {#if r.match.jev}
                            <Hint text="Jev's probability"><Badge variant="secondary" class={pctClass(r.match.jev.choice === c.media.id ? 'jevTop' : 'jev')}>Jev {jevPct(r, c.media.id)}%</Badge></Hint>
                          {/if}
                        </Command.Item>
                      {/each}
                    </Command.List>
                  </Command.Root>
                  {#if r.match.jev && r.match.jev.choice == null}<small class="text-primary text-xs">Jev thinks none of these is the same season.</small>{/if}
                  {#if hasJev && !r.match.jev && r.match.candidates.length > 1}
                    <Button variant="link" class={cn(LINK, 'justify-start')} onclick={() => askJev(r)}>Ask Jev which one</Button>
                  {/if}
                  {#if r.match.mediaId}
                    <div class="grid gap-1 rounded-lg border border-dashed px-2 py-1.5">
                      {#if r.match.segments?.some((s) => s.seg.mediaId !== r.match!.mediaId)}
                        <small class="text-xs">Split across {r.match.segments.length} AniList entries.</small>
                        <Button variant="link" class={cn(LINK, 'justify-start')} onclick={() => setSplit(r, false)}>undo split</Button>
                      {:else}
                        <Button variant="link" class={cn(LINK, 'justify-start whitespace-normal')} onclick={() => setSplit(r, true)}>split across AniList parts (Part 1 / Part 2…)</Button>
                      {/if}
                      <label class="flex items-center gap-2">
                        <small class="text-xs">AniList ep before this season's ep 1</small>
                        <Input
                          type="number"
                          class="h-7 w-[70px]"
                          min="0"
                          value={r.match.segments?.[0]?.seg.aniOffset ?? 0}
                          onchange={(e) => setOffset(r, e.currentTarget.valueAsNumber)}
                        />
                      </label>
                    </div>
                  {/if}
                  <div class="flex items-center gap-2">
                    <Button variant="link" class={LINK} onclick={() => pick(r, 0)}>skip this season</Button>
                    <Button variant="link" class={LINK} onclick={() => (r.picking = false)}>cancel</Button>
                  </div>
                </div>
              {:else if r.match?.media}
                <div class="flex items-center gap-2.5">
                  {#if r.match.media.coverImage.medium}<img src={r.match.media.coverImage.medium} alt="" class="h-[42px] w-[30px] shrink-0 rounded-[5px] object-cover" />{/if}
                  <span class="grid min-w-0 justify-items-start gap-0.5">
                    <a href={`https://anilist.co/anime/${r.match.media.id}`} target="_blank" rel="noreferrer" class="text-foreground font-semibold no-underline hover:underline">{title(r.match.media)}</a>
                    <span class="flex flex-wrap items-center gap-2">
                      {#if r.match.source === 'saved' && r.match.score == null}
                        <Hint text="Saved match from an earlier scan or your pick"><Badge variant="secondary" class={pctClass('saved')}>saved</Badge></Hint>
                      {:else if r.match.source === 'jev'}
                        <Hint text="Picked by Jev ({jevPct(r, r.match.mediaId)}% probability)"><Badge variant="secondary" class={pctClass('jevTop')}>Jev pick</Badge></Hint>
                      {:else}
                        <Hint text="Match score: title, season and episode agreement (not a probability)"><Badge variant="secondary" class={pctClass(tone(r.match.score ?? 0))}>{pct(r.match.score)}%</Badge></Hint>
                      {/if}
                      {#if r.match.source !== 'jev' && jevAgrees(r)}
                        <Hint text="Jev picked the same entry ({jevPct(r, r.match.mediaId)}% probability)"><Badge variant="secondary" class={pctClass('jevTop')}>Jev <Check aria-hidden="true" /></Badge></Hint>
                      {:else if jevDisagrees(r)}
                        <Hint text="Jev's probability is spread across all options"><Badge variant="secondary" class={pctClass('mid')}>Jev prefers {jevPickTitle(r)}{r.match.jev?.choice != null ? ` (${jevPct(r, r.match.jev?.choice)}%)` : ''}</Badge></Hint>
                      {/if}
                      {#if r.match.candidates.length > 1}<small class="text-muted-foreground text-xs">{r.match.candidates.length - 1} other</small>{/if}
                      {#if r.parts.length > 1}<small class="text-xs text-[#7aa2ff]">split ×{r.parts.length}</small>{/if}
                      {#if r.parts.length === 1 && r.parts[0]!.seg.aniOffset}<small class="text-xs text-[#7aa2ff]">continues from ep {r.parts[0]!.seg.aniOffset + 1}</small>{/if}
                      <Button variant="link" class={LINK} onclick={() => openPicker(r)}>change</Button>
                    </span>
                  </span>
                </div>
              {:else if r.match?.mediaId === 0}
                <span class={MUTED}>skipped</span> <Button variant="link" class={LINK} onclick={() => openPicker(r)}>match</Button>
              {:else if r.match}
                <span class="inline-flex flex-wrap items-center gap-2">
                  {#if r.match.score != null}<Hint text="Best candidate"><Badge variant="secondary" class={pctClass(tone(r.match.score))}>{pct(r.match.score)}%</Badge></Hint>{/if}
                  <span class="text-primary">no confident match</span>
                  {#if r.match.jev?.choice != null}
                    <small class="text-muted-foreground text-xs">Jev leans {title(r.match.candidates.find((c) => c.media.id === r.match!.jev!.choice)?.media ?? r.match.candidates[0]!.media)} ({jevPct(r, r.match.jev.choice)}%)</small>
                  {/if}
                  <Button variant="link" class={LINK} onclick={() => openPicker(r)}>pick ({r.match.candidates.length})</Button>
                </span>
              {:else if r.result && r.result !== 'ok'}
                <Hint text={r.result}><span class="text-destructive">matching failed</span></Hint>
              {:else}
                <span class={MUTED}>…</span>
              {/if}
            </Table.Cell>
            {#if r.parts.length > 1}
              <Table.Cell class="max-md:hidden">
                {#each r.parts as p (p.media.id)}
                  <div class="whitespace-nowrap [&+&]:mt-1"><small class={SMALL}>{partLabel(p)}</small> {fmt(p.current?.status)} {p.current ? `· ${p.current.progress}` : ''}</div>
                {/each}
              </Table.Cell>
              <Table.Cell>
                {#if r.result && r.result !== 'ok'}<span class="text-destructive">{r.result}</span>{/if}
                {#each r.parts as p (p.media.id)}
                  <div class="whitespace-nowrap [&+&]:mt-1">
                    {#if p.plan}<b class={cn('inline-flex items-center gap-0.5', r.result === 'ok' && 'text-success', p.plan.backport && 'text-destructive')}>{#if r.result === 'ok'}<Check class="size-3.5" aria-hidden="true" />{/if}{#if p.plan.backport}<ArrowDown class="size-3.5" aria-label="backport" />{/if}{fmt(p.plan.status)}</b> · {p.plan.progress}
                    {:else}<span class={MUTED}>no change</span>{/if}
                  </div>
                {/each}
                {#if phase === 'review'}
                  <Hint text="Write Crunchyroll's progress and status exactly, even if lower than AniList" class="mt-0.5 block w-fit">
                    <label class="text-muted-foreground flex items-center gap-1 text-[11px]"><Checkbox class="size-3.5" bind:checked={r.backport} onCheckedChange={() => replan(r)} /> backport</label>
                  </Hint>
                {/if}
              </Table.Cell>
            {:else}
              <Table.Cell class="max-md:hidden">{fmt(r.current?.status)} {r.current ? `· ${r.current.progress}` : ''}</Table.Cell>
              <Table.Cell>
                {#if r.result === 'ok'}<span class="text-success inline-flex items-center gap-0.5"><Check class="size-3.5" aria-hidden="true" /> {fmt(r.plan?.status)} · {r.plan?.progress}</span>
                {:else if r.result}<span class="text-destructive">{r.result}</span>
                {:else if r.plan}<b class={cn('inline-flex items-center gap-0.5', r.plan.backport && 'text-destructive')}>{#if r.plan.backport}<ArrowDown class="size-3.5" aria-label="backport" />{/if}{fmt(r.plan.status)}</b> · {r.plan.progress}
                {:else}<span class={MUTED}>no change</span>{/if}
                {#if r.match?.mediaId && phase === 'review'}
                  <Hint text="Write Crunchyroll's progress and status exactly, even if lower than AniList" class="mt-0.5 block w-fit">
                    <label class="text-muted-foreground flex items-center gap-1 text-[11px]"><Checkbox class="size-3.5" bind:checked={r.backport} onCheckedChange={() => replan(r)} /> backport</label>
                  </Hint>
                {/if}
              </Table.Cell>
            {/if}
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  {/if}
</section>
