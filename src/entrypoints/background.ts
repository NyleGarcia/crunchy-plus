import * as anilist from '@/lib/anilist';
import { AUTO_ACCEPT, queriesFor, rank, type MatchInput } from '@/lib/matcher';
import { respond, type BgRequest, type BgResponses, type CrOp, type MatchResult, type Ranked, type UndoRow } from '@/lib/messages';
import * as jev from '@/lib/jev';
import { progressBySegment, segmentAt, single, splitSegments, type Segment } from '@/lib/segments';
import { getSettings, matchesItem, segmentsItem, tokenItem, typesafeKeyItem, type ImportLogItem } from '@/lib/settings';
import type { AniEntry, AniListItem, AniMedia } from '@/lib/types';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: BgRequest, _sender, sendResponse) => {
    respond(handle(msg)).then(sendResponse);
    return true; // async response
  });
});

let viewerCache: { token: string; user: Awaited<ReturnType<typeof anilist.viewer>> } | null = null;

async function currentUser() {
  const token = await tokenItem.getValue();
  if (!token) return null;
  if (viewerCache?.token === token) return viewerCache.user;
  try {
    const user = await anilist.viewer(token);
    viewerCache = { token, user };
    return user;
  } catch (e) {
    if (e instanceof anilist.AniListError && (e.status === 400 || e.status === 401)) {
      await tokenItem.setValue(null); // revoked/expired
      return null;
    }
    throw e;
  }
}

async function login() {
  const { anilistClientId } = await getSettings();
  if (!anilistClientId) throw new Error('Set your AniList client ID first (see setup in the popup).');
  const url = new URL('https://anilist.co/api/v2/oauth/authorize');
  url.searchParams.set('client_id', anilistClientId);
  url.searchParams.set('response_type', 'token');
  let redirect: string | undefined;
  try {
    redirect = await browser.identity.launchWebAuthFlow({ url: url.href, interactive: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/could not be loaded/i.test(msg)) {
      throw new Error(
        `AniList redirected somewhere this extension can't catch. In anilist.co/settings/developer set the client's ` +
          `Redirect URL to exactly ${browser.identity.getRedirectURL()} and check the client ID.`,
      );
    }
    throw e;
  }
  const token = new URLSearchParams(new URL(redirect!).hash.slice(1)).get('access_token');
  if (!token) throw new Error('AniList did not return a token.');
  await tokenItem.setValue(token);
  viewerCache = null;
}

async function resolve(key: string, input: MatchInput, force = false): Promise<MatchResult> {
  const [r] = await resolveMany([{ key, input }], force);
  return r!;
}

/** Searches packed into one AniList request. */
const SEARCH_BATCH = 12;

/**
 * Resolve many seasons with as few AniList requests as possible:
 * cached matches are fetched 50 per request; the rest are searched in rounds (most specific
 * query first), each round batching SEARCH_BATCH searches per request and only retrying
 * seasons that are still unsure with their next query.
 */
/** `force`: ignore saved matches and search again (to show alternatives); nothing is auto-saved then. */
async function resolveMany(items: { key: string; input: MatchInput }[], force = false): Promise<MatchResult[]> {
  const token = await tokenItem.getValue();
  const saved = force ? {} : await matchesItem.getValue();
  const results = new Map<string, MatchResult>();

  const cachedIds = [...new Set(items.map((i) => saved[i.key]).filter((id): id is number => !!id))];
  const cached = await anilist.mediaMany(cachedIds, token);
  for (const { key } of items) {
    const id = saved[key];
    if (id === 0) results.set(key, { key, mediaId: 0, media: null, candidates: [], score: null, source: 'saved' });
    else if (id) results.set(key, { key, mediaId: id, media: cached.get(id) ?? null, candidates: [], score: null, source: 'saved' });
  }

  const pending = items
    .filter((i) => !results.has(i.key))
    .map((i) => ({ ...i, queries: queriesFor(i.input), seen: new Map<number, AniMedia>(), ranked: [] as Ranked[] }));
  const learned: Record<string, number> = {};

  for (let round = 0; pending.length; round++) {
    const active = pending.filter((p) => p.queries[round]);
    for (let i = 0; i < active.length; i += SEARCH_BATCH) {
      const chunk = active.slice(i, i + SEARCH_BATCH);
      const found = await anilist.searchMany(chunk.map((p) => p.queries[round]!), token);
      chunk.forEach((p, j) => {
        for (const m of found[j] ?? []) p.seen.set(m.id, m);
        p.ranked = rank(p.input, [...p.seen.values()]);
      });
    }
    // Settle anything confident or out of queries; keep the rest for the next round.
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i]!;
      const top = p.ranked[0];
      const confident = !!top && top.score >= AUTO_ACCEPT && (p.ranked[1]?.score ?? 0) < top.score - 0.05;
      if (!confident && p.queries[round + 1]) continue;
      if (confident && !force) learned[p.key] = top.media.id;
      results.set(p.key, {
        key: p.key,
        mediaId: confident ? top.media.id : null,
        media: confident ? top.media : null,
        candidates: p.ranked.slice(0, 8),
        score: top?.score ?? null,
        source: confident ? 'auto' : 'none',
      });
      pending.splice(i, 1);
    }
  }
  await consultJev(items, results, force ? null : learned);
  if (Object.keys(learned).length) await matchesItem.setValue({ ...(await matchesItem.getValue()), ...learned });
  await attachSegments(items, results, token, !force);
  return items.map((i) => results.get(i.key)!);
}

async function remember(key: string, mediaId: number) {
  await matchesItem.setValue({ ...(await matchesItem.getValue()), [key]: mediaId });
}

async function requireToken() {
  const token = await tokenItem.getValue();
  if (!token) throw new Error('Not connected to AniList.');
  return token;
}

async function handle(msg: BgRequest): Promise<BgResponses[BgRequest['type']]> {
  // Any AniList write makes the cached full list stale.
  if (['anilist:save', 'anilist:saveMany', 'sync:episode', 'undo:apply'].includes(msg.type)) listCache = null;
  switch (msg.type) {
    case 'anilist:status':
      return { user: await currentUser(), redirectUrl: browser.identity.getRedirectURL() };
    case 'anilist:login':
      await login();
      return { ok: true };
    case 'anilist:setToken': {
      // PIN flow fallback: user pastes the token AniList shows at /api/v2/oauth/pin.
      const token = msg.token.trim();
      try {
        await anilist.viewer(token);
      } catch {
        throw new Error('AniList rejected that token — copy the whole thing from the PIN page.');
      }
      await tokenItem.setValue(token);
      viewerCache = null;
      return { ok: true };
    }
    case 'anilist:logout':
      await tokenItem.setValue(null);
      viewerCache = null;
      return { ok: true };
    case 'anilist:search':
      return anilist.search(msg.q, await tokenItem.getValue());
    case 'anilist:list': {
      const token = await requireToken();
      const user = await currentUser();
      if (!user) throw new Error('Not connected to AniList.');
      return [...(await anilist.myList(token, user.id))];
    }
    case 'anilist:save':
      return anilist.saveEntry(await requireToken(), msg.mediaId, msg.patch);
    case 'match:resolve':
      return resolve(msg.key, msg.input, msg.force);
    case 'match:resolveMany':
      return resolveMany(msg.items, msg.force);
    case 'anilist:saveMany':
      return (await anilist.saveMany(await requireToken(), msg.items)).map((r) =>
        r instanceof Error ? { error: r.message } : r,
      );
    case 'jev:choose': {
      const key = await typesafeKeyItem.getValue();
      if (!key) throw new Error('Add your TypeSafe API key in the Crunchy+ popup to use Jev.');
      return jev.chooseSeason(key, msg.input, msg.candidates);
    }
    case 'jev:status': {
      const s = await getSettings();
      return { hasKey: !!(await typesafeKeyItem.getValue()), enabled: s.jevEnabled };
    }
    case 'match:set':
      await remember(msg.key, msg.mediaId);
      await setSegments(msg.key, null); // a new pick starts as a plain 1:1 mapping
      return resolve(msg.key, {} as MatchInput);
    case 'match:setSegments':
      await setSegments(msg.key, msg.segments);
      return resolve(msg.key, {} as MatchInput);
    case 'match:split': {
      // User asked to split this season across the match and its AniList sequels.
      const token = await tokenItem.getValue();
      const head = (await anilist.mediaMany([msg.mediaId], token)).get(msg.mediaId);
      const segs = head && msg.input.seasonEpisodes ? await detectSplit(head, msg.input.seasonEpisodes, token, true) : null;
      if (!segs) throw new Error("Couldn't find AniList sequels whose episodes add up to this Crunchyroll season.");
      await setSegments(msg.key, segs);
      return resolve(msg.key, msg.input);
    }
    case 'sync:episode':
      return syncEpisode(msg.np);
    case 'anilist:listFull': {
      const token = await requireToken();
      const user = await currentUser();
      if (!user) throw new Error('Not connected to AniList.');
      if (!msg.fresh && listCache && listCache.user === user.id && Date.now() - listCache.at < 5 * 60e3) return listCache.items;
      const items = await anilist.myListFull(token, user.id);
      listCache = { user: user.id, at: Date.now(), items };
      return items;
    }
    case 'undo:scan':
      return undoScan(msg.since);
    case 'undo:fromLog':
      return undoFromLog(msg.log);
    case 'undo:apply':
      return undoApply(msg.rows, msg.deleteActivities);
    case 'cr:op':
      return crTabOp(msg.op, msg.args);
    case 'hub:open': {
      // ?review=1 makes the Export tab build a fresh preview; applying still needs the user's click.
      const url = `${browser.runtime.getURL('/hub.html')}${msg.review ? '?review=1' : ''}#${msg.tab}`;
      await browser.tabs.create({ url });
      return { ok: true };
    }
  }
}

async function syncEpisode(np: Extract<BgRequest, { type: 'sync:episode' }>['np']) {
  const key = `${np.seriesId}|${np.seasonId}`;
  const match = await resolve(key, {
    seriesId: np.seriesId,
    seriesTitle: np.seriesTitle,
    seasonTitle: np.seasonTitle,
    seasonNumber: np.seasonNumber,
    seasonEpisodes: np.seasonEpisodes,
  });
  if (!match.mediaId || !match.media) {
    return { match, entry: null, changed: false, reason: match.mediaId === 0 ? 'disabled' : 'unmatched' };
  }
  const token = await requireToken();
  // Split seasons / continuing entries: each AniList entry the CR position has reached.
  const parts = match.segments?.length ? match.segments : [{ seg: single(match.mediaId)[0]!, media: match.media }];
  const here = segmentAt(parts.map((p) => p.seg), np.progress);
  let shown: AniEntry | null = null;
  let changed = false;
  for (const { mediaId, progress } of progressBySegment(parts.map((p) => p.seg), np.progress)) {
    const media = parts.find((p) => p.seg.mediaId === mediaId)?.media;
    const current = media?.mediaListEntry ?? null;
    // AniList's count only: CR's is "aired so far" and would complete airing shows early.
    // live: you're watching it now, so a Paused/Dropped entry resumes to Watching.
    const plan = anilist.planUpdate(current, progress, media?.episodes ?? null, 'CURRENT', { live: true });
    const entry = plan ? await anilist.saveEntry(token, mediaId, plan) : current;
    changed ||= !!plan;
    if (mediaId === here?.mediaId) shown = entry;
  }
  return { match, entry: shown, changed, reason: changed ? undefined : 'up-to-date' };
}

let listCache: { user: number; at: number; items: AniListItem[] } | null = null;

/** Run an operation inside a Crunchyroll tab (it holds the session); open one if needed. */
async function crTabOp(op: CrOp, args: unknown): Promise<unknown> {
  let [tab] = await browser.tabs.query({ url: '*://www.crunchyroll.com/*' });
  if (!tab?.id) {
    tab = await browser.tabs.create({ url: 'https://www.crunchyroll.com/history', active: false });
    await new Promise<void>((done) => {
      const l = (id: number, info: { status?: string }) => {
        if (id === tab!.id && info.status === 'complete') {
          browser.tabs.onUpdated.removeListener(l);
          done();
        }
      };
      browser.tabs.onUpdated.addListener(l);
    });
  }
  const r = await browser.tabs.sendMessage(tab.id!, { type: 'cr:op', op, args });
  if (!r?.ok) throw new Error(r?.error ?? 'Crunchyroll tab did not answer — reload it and retry.');
  return r.data;
}

/** Reconstruct what changed on AniList since `since` (unix s) and what it looked like before. */
async function undoScan(since: number): Promise<UndoRow[]> {
  const token = await requireToken();
  const user = await currentUser();
  if (!user) throw new Error('Not connected to AniList.');
  const acts = await anilist.activitiesSince(token, user.id, since);
  const byMedia = new Map<number, anilist.ListActivity[]>();
  for (const a of acts) byMedia.set(a.media.id, [...(byMedia.get(a.media.id) ?? []), a]);
  const ids = [...byMedia.keys()];
  const [prior, list] = await Promise.all([
    anilist.activitiesBefore(token, user.id, ids, since),
    anilist.myList(token, user.id),
  ]);
  return ids.map((id) => {
    const recent = byMedia.get(id)!;
    const entry = list.get(id);
    const before = anilist.stateFromActivities(prior.get(id) ?? []);
    const m = recent[0]!.media;
    return {
      mediaId: id,
      title: m.title.english ?? m.title.romaji ?? `#${id}`,
      cover: m.coverImage.medium,
      current: entry ? { entryId: entry.id, status: entry.status, progress: entry.progress } : null,
      before,
      activityIds: recent.map((a) => a.id),
      // No earlier activity is not proof the entry is new (MAL/CSV imports, deleted activities): only
      // preselect "remove" when AniList says the entry itself was created inside the window.
      action: !entry ? 'keep' : before ? 'restore' : entry.createdAt && entry.createdAt >= since ? 'delete' : 'keep',
      ...(entry && !before && !(entry.createdAt && entry.createdAt >= since) ? { note: 'no earlier state known' } : {}),
    } satisfies UndoRow;
  });
}

async function undoApply(rows: UndoRow[], deleteActs: boolean) {
  const token = await requireToken();
  const failed: string[] = [];
  const toDelete = rows.filter((r) => r.action === 'delete' && r.current).map((r) => r.current!.entryId);
  const deleted = await anilist.deleteEntries(token, toDelete);
  if (deleted < toDelete.length) failed.push(`${toDelete.length - deleted} entries could not be removed`);
  const restores = rows.filter((r) => r.action === 'restore' && r.before);
  const saved = await anilist.saveMany(
    token,
    restores.map((r) => ({ mediaId: r.mediaId, status: r.before!.status, progress: r.before!.progress })),
  );
  saved.forEach((s, i) => s instanceof Error && failed.push(`${restores[i]!.title}: ${s.message}`));
  const acts = deleteActs ? rows.filter((r) => r.action !== 'keep').flatMap((r) => r.activityIds) : [];
  const activitiesDeleted = acts.length ? await anilist.deleteActivities(token, acts) : 0;
  return { deleted, restored: saved.filter((s) => !(s instanceof Error)).length, activitiesDeleted, failed };
}

/** Exact undo rows from a recorded import (before-states known), plus that run's activity posts. */
async function undoFromLog(log: { at: number; items: ImportLogItem[] }): Promise<UndoRow[]> {
  const token = await requireToken();
  const user = await currentUser();
  if (!user) throw new Error('Not connected to AniList.');
  const ids = new Set(log.items.map((i) => i.mediaId));
  const [list, acts, media] = await Promise.all([
    anilist.myList(token, user.id),
    anilist.activitiesSince(token, user.id, Math.floor(log.at / 1000) - 5),
    anilist.mediaMany([...ids], token),
  ]);
  // One row per entry: several CR seasons can touch the same AniList entry. Every item's `before`
  // was read before the apply, so the first occurrence is the true pre-import state.
  const unique = [...new Map(log.items.toReversed().map((it) => [it.mediaId, it])).values()].toReversed();
  return unique.map((it) => {
    const entry = list.get(it.mediaId);
    return {
      mediaId: it.mediaId,
      title: it.title,
      cover: media.get(it.mediaId)?.coverImage.medium ?? null,
      current: entry ? { entryId: entry.id, status: entry.status, progress: entry.progress } : null,
      before: it.before,
      activityIds: acts.filter((a) => a.media.id === it.mediaId).map((a) => a.id),
      action: !entry ? 'keep' : it.before ? 'restore' : 'delete',
    } satisfies UndoRow;
  });
}

/** Rows the scorer wasn't sure about: no auto-match, or a runner-up within 5 points. */
function unsure(r: MatchResult) {
  if (r.source !== 'none' && r.source !== 'auto') return false;
  const [a, b] = r.candidates;
  return r.mediaId === null ? r.candidates.length > 0 : !!a && !!b && b.score > a.score - 0.05;
}

/**
 * Ask Jev to pick among candidates for unsure rows (4 in flight). A pick at or above `jevAccept`
 * becomes the match (and is remembered unless `learned` is null); otherwise the verdict is attached
 * for the user to see. Failures (no key, bad key, network) leave rows untouched.
 */
async function consultJev(
  items: { key: string; input: MatchInput }[],
  results: Map<string, MatchResult>,
  learned: Record<string, number> | null,
) {
  const s = await getSettings();
  const key = await typesafeKeyItem.getValue();
  if (!s.jevEnabled || !key) return;
  const todo = items.filter((i) => {
    const r = results.get(i.key);
    return r && unsure(r);
  });
  let next = 0;
  let stop = false;
  const worker = async () => {
    for (let it = todo[next++]; it && !stop; it = todo[next++]) {
      const r = results.get(it.key)!;
      try {
        const v = await jev.chooseSeason(key, it.input, r.candidates.map((c) => c.media));
        r.jev = v;
        const pick = v.choice != null ? r.candidates.find((c) => c.media.id === v.choice) : undefined;
        if (pick && (v.probs[pick.media.id] ?? 0) >= s.jevAccept) {
          Object.assign(r, { mediaId: pick.media.id, media: pick.media, score: pick.score, source: 'jev' });
          if (learned) learned[it.key] = pick.media.id;
        } else if (v.choice == null && r.source === 'auto' && (v.probs[r.mediaId!] ?? 0) < 0.2) {
          // Jev is confident none fit and the auto pick was a near-tie: hand it back to the user.
          Object.assign(r, { mediaId: null, media: null, source: 'none' });
          if (learned) delete learned[it.key];
        }
      } catch (e) {
        console.warn('[Crunchy+] Jev', e);
        if (e instanceof jev.JevError && (e.status === 401 || e.status === 403)) stop = true; // bad key: don't retry every row
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
}

async function setSegments(key: string, segs: Segment[] | null) {
  const all = { ...(await segmentsItem.getValue()) };
  if (segs?.length) all[key] = segs;
  else delete all[key];
  await segmentsItem.setValue(all);
}

/**
 * Split a CR season across `head` and its AniList sequels when the match has fewer episodes than
 * the CR season and consecutive parts add up to it. `force` tries even without the shortfall hint.
 */
async function detectSplit(head: AniMedia, crEpisodes: number, token: string | null, force = false): Promise<Segment[] | null> {
  if (!force && !(head.episodes && crEpisodes > head.episodes + 1)) return null;
  const chain = await anilist.sequelChain(head.id, token);
  const parts = [head];
  for (const next of chain) {
    if (parts.reduce((n, p) => n + (p.episodes ?? 0), 0) >= crEpisodes - 1) break;
    parts.push(next);
  }
  return splitSegments(
    crEpisodes,
    parts.map((p) => ({ id: p.id, episodes: p.episodes })),
  );
}

/** Attach saved segments, and (when `learn`) auto-detect splits for fresh matches. */
async function attachSegments(
  items: { key: string; input: MatchInput }[],
  results: Map<string, MatchResult>,
  token: string | null,
  learn: boolean,
) {
  const saved = await segmentsItem.getValue();
  const learned: Record<string, Segment[]> = {};
  const segsFor = new Map<MatchResult, Segment[]>();
  for (const { key, input } of items) {
    const r = results.get(key);
    if (!r?.mediaId || !r.media) continue;
    let segs = saved[key];
    if (!segs && learn && input.seasonEpisodes) {
      try {
        segs = (await detectSplit(r.media, input.seasonEpisodes, token)) ?? undefined;
        if (segs) learned[key] = segs;
      } catch (e) {
        console.warn('[Crunchy+] split detection', e);
      }
    }
    // Only non-trivial mappings (several entries, or an offset) are worth carrying.
    if (segs?.length && segs.some((s) => s.mediaId !== r.mediaId || s.aniOffset)) segsFor.set(r, segs);
  }
  // One request for every segment's media (with the viewer's list entries).
  const ids = [...new Set([...segsFor.values()].flat().map((s) => s.mediaId))];
  const media = ids.length ? await anilist.mediaMany(ids, token) : new Map<number, AniMedia>();
  for (const [r, segs] of segsFor) {
    r.segments = segs.map((seg) => ({ seg, media: media.get(seg.mediaId) ?? (seg.mediaId === r.mediaId ? r.media : null) }));
  }
  if (Object.keys(learned).length) await segmentsItem.setValue({ ...(await segmentsItem.getValue()), ...learned });
}
