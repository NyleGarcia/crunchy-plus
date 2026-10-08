import type { AniEntry, AniListItem, AniMedia, ListStatus } from './types';

const ENDPOINT = 'https://graphql.anilist.co';
/**
 * Pacing: AniList allows 90/min nominally but often runs degraded at 30/min. Go fast while the
 * X-RateLimit-Remaining header says there is headroom; fall back to the safe 30/min gap when low/unknown.
 */
const FAST_GAP_MS = 350;
const SAFE_GAP_MS = 2100;

let chain: Promise<unknown> = Promise.resolve();
let last = 0;
let remaining: number | null = null;
const gap = () => (remaining != null && remaining > 8 ? FAST_GAP_MS : SAFE_GAP_MS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AniListError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Serialized, rate-limited GraphQL call with 429 Retry-After handling. */
export function gql<T>(query: string, variables: Record<string, unknown>, token?: string | null): Promise<T> {
  const run = async (): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const wait = last + gap() - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query, variables }),
      });
      const rem = res.headers.get('X-RateLimit-Remaining');
      remaining = rem == null ? null : Number(rem);
      if (res.status === 429 && attempt < 3) {
        remaining = 0;
        await sleep((Number(res.headers.get('Retry-After')) || 60) * 1000);
        continue;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.errors?.length) {
        throw new AniListError(body.errors?.[0]?.message ?? `AniList HTTP ${res.status}`, res.status);
      }
      return body.data as T;
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

const MEDIA_FIELDS = `
  id episodes format seasonYear synonyms
  title { romaji english native }
  coverImage { medium large extraLarge color }
  popularity
  externalLinks { site url }
`;

export async function viewer(token: string) {
  const d = await gql<{ Viewer: { id: number; name: string; avatar: { medium: string } } }>(
    `query { Viewer { id name avatar { medium } } }`,
    {},
    token,
  );
  return d.Viewer;
}

export async function search(q: string, token?: string | null): Promise<AniMedia[]> {
  const d = await gql<{ Page: { media: AniMedia[] } }>(
    `query ($q: String) { Page(perPage: 8) { media(search: $q, type: ANIME, sort: SEARCH_MATCH) {
      ${MEDIA_FIELDS} ${token ? 'mediaListEntry { id mediaId status progress score }' : ''}
    } } }`,
    { q },
    token,
  );
  return d.Page.media;
}

export async function media(id: number, token?: string | null): Promise<AniMedia> {
  const d = await gql<{ Media: AniMedia }>(
    `query ($id: Int) { Media(id: $id, type: ANIME) {
      ${MEDIA_FIELDS} ${token ? 'mediaListEntry { id mediaId status progress score }' : ''}
    } }`,
    { id },
    token,
  );
  return d.Media;
}

/** Whole anime list of the viewer, keyed by media id. */
export async function myList(token: string, userId: number): Promise<Map<number, AniEntry>> {
  const d = await gql<{ MediaListCollection: { lists: { entries: AniEntry[] }[] } }>(
    `query ($userId: Int) { MediaListCollection(userId: $userId, type: ANIME) {
      lists { entries { id mediaId status progress score createdAt } }
    } }`,
    { userId },
    token,
  );
  const map = new Map<number, AniEntry>();
  for (const l of d.MediaListCollection.lists) for (const e of l.entries) map.set(e.mediaId, e);
  return map;
}

export async function saveEntry(
  token: string,
  mediaId: number,
  patch: { status?: ListStatus; progress?: number },
): Promise<AniEntry> {
  const d = await gql<{ SaveMediaListEntry: AniEntry }>(
    `mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int) {
      SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress) { id mediaId status progress score }
    }`,
    { mediaId, ...patch },
    token,
  );
  return d.SaveMediaListEntry;
}

/**
 * Decide the entry update for "watched up to `progress`".
 *
 * - Progress never goes backwards; COMPLETED is never touched; REPEATING only advances.
 * - Reaching AniList's episode count completes any status.
 * - 0 episodes watched is PLANNING, never WATCHING (new entries, and existing "Watching · 0").
 * - The user's own status is kept: WATCHING stays, and PAUSED / DROPPED are never changed by an
 *   import (`idleStatus` only applies to new or PLANNING entries). With `live` (the user is
 *   watching this episode right now) PAUSED / DROPPED resume to CURRENT.
 *
 * Returns null when nothing would change.
 */
export function planUpdate(
  current: Pick<AniEntry, 'status' | 'progress'> | null | undefined,
  progress: number,
  total: number | null,
  idleStatus: ListStatus = 'CURRENT',
  opts: { live?: boolean } = {},
): { status: ListStatus; progress: number } | null {
  const done = total != null && total > 0 && progress >= total;
  if (current?.status === 'COMPLETED') return null;
  if (current?.status === 'REPEATING' && !done) {
    return progress > current.progress ? { status: 'REPEATING', progress } : null;
  }
  const next = Math.max(progress, current?.progress ?? 0);
  let status: ListStatus;
  if (done) status = 'COMPLETED';
  else if (!current || current.status === 'PLANNING') status = progress > 0 ? idleStatus : 'PLANNING';
  else if (current.status === 'PAUSED' || current.status === 'DROPPED')
    status = opts.live && progress > current.progress ? 'CURRENT' : current.status;
  // Watching with nothing watched is really Planning (e.g. left by an earlier import or another tool).
  else if (current.status === 'CURRENT' && next === 0) status = 'PLANNING';
  else status = current.status; // CURRENT (and anything else) keeps the user's choice
  if (current && current.progress === next && current.status === status) return null;
  if (!current && status === 'PLANNING' && progress === 0) return { status, progress: 0 };
  return { status, progress: done && total ? total : next };
}

const ENTRY_FIELDS = 'mediaListEntry { id mediaId status progress score }';

/** Run many searches in one request via GraphQL aliases. Splits the batch if AniList rejects it as too complex. */
export async function searchMany(queries: string[], token?: string | null): Promise<AniMedia[][]> {
  if (!queries.length) return [];
  try {
    const vars = queries.map((_, i) => `$s${i}: String`).join(', ');
    const body = queries
      .map(
        (_, i) => `q${i}: Page(perPage: 6) { media(search: $s${i}, type: ANIME, sort: SEARCH_MATCH) {
          ${MEDIA_FIELDS} ${token ? ENTRY_FIELDS : ''} } }`,
      )
      .join('\n');
    const d = await gql<Record<string, { media: AniMedia[] }>>(
      `query (${vars}) { ${body} }`,
      Object.fromEntries(queries.map((q, i) => [`s${i}`, q])),
      token,
    );
    return queries.map((_, i) => d[`q${i}`]?.media ?? []);
  } catch (e) {
    if (queries.length === 1 || (e instanceof AniListError && e.status === 429)) throw e;
    const mid = Math.ceil(queries.length / 2);
    return [...(await searchMany(queries.slice(0, mid), token)), ...(await searchMany(queries.slice(mid), token))];
  }
}

/** Fetch many media by id, 50 per request. */
export async function mediaMany(ids: number[], token?: string | null): Promise<Map<number, AniMedia>> {
  const out = new Map<number, AniMedia>();
  for (let i = 0; i < ids.length; i += 50) {
    const d = await gql<{ Page: { media: AniMedia[] } }>(
      `query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) {
        ${MEDIA_FIELDS} ${token ? ENTRY_FIELDS : ''} } } }`,
      { ids: ids.slice(i, i + 50) },
      token,
    );
    for (const m of d.Page.media) out.set(m.id, m);
  }
  return out;
}

export interface SaveItem {
  mediaId: number;
  status?: ListStatus;
  progress?: number;
}

/** Save many list entries in one request via aliased mutations. Per-item errors come back as Error values. */
export async function saveMany(token: string, items: SaveItem[]): Promise<(AniEntry | Error)[]> {
  if (!items.length) return [];
  try {
    const vars = items.map((_, i) => `$m${i}: Int, $s${i}: MediaListStatus, $p${i}: Int`).join(', ');
    const body = items
      .map((_, i) => `e${i}: SaveMediaListEntry(mediaId: $m${i}, status: $s${i}, progress: $p${i}) { id mediaId status progress score }`)
      .join('\n');
    const variables: Record<string, unknown> = {};
    items.forEach((it, i) => Object.assign(variables, { [`m${i}`]: it.mediaId, [`s${i}`]: it.status, [`p${i}`]: it.progress }));
    const d = await gql<Record<string, AniEntry>>(`mutation (${vars}) { ${body} }`, variables, token);
    return items.map((_, i) => d[`e${i}`] ?? new Error('No result'));
  } catch (e) {
    if (items.length === 1) return [e instanceof Error ? e : new Error(String(e))];
    if (e instanceof AniListError && e.status === 429) throw e;
    // One bad item fails the whole batch — split to isolate it.
    const mid = Math.ceil(items.length / 2);
    return [...(await saveMany(token, items.slice(0, mid))), ...(await saveMany(token, items.slice(mid)))];
  }
}

/** Whole anime list with media details (titles, links, airing) in one request. */
export async function myListFull(token: string, userId: number): Promise<AniListItem[]> {
  const d = await gql<{ MediaListCollection: { lists: { entries: AniListItem[] }[] } }>(
    `query ($userId: Int) { MediaListCollection(userId: $userId, type: ANIME) {
      lists { entries { id mediaId status progress score updatedAt completedAt { year month day }
        media { ${MEDIA_FIELDS} status nextAiringEpisode { episode airingAt } } } }
    } }`,
    { userId },
    token,
  );
  const seen = new Set<number>();
  // Custom lists repeat entries; keep the first occurrence of each media.
  return d.MediaListCollection.lists.flatMap((l) => l.entries).filter((e) => !seen.has(e.mediaId) && seen.add(e.mediaId));
}

// ---- Undo support ----

export interface ListActivity {
  id: number;
  status: string;
  progress: string | null;
  createdAt: number;
  media: { id: number; episodes: number | null; title: { romaji: string | null; english: string | null }; coverImage: { medium: string | null } };
}

const ACTIVITY_FIELDS = `... on ListActivity { id status progress createdAt
  media { id episodes title { romaji english } coverImage { medium } } }`;

/** All of the user's anime list activities created after `since` (unix seconds), newest first. */
export async function activitiesSince(token: string, userId: number, since: number): Promise<ListActivity[]> {
  const out: ListActivity[] = [];
  for (let page = 1; page < 40; page++) {
    const d = await gql<{ Page: { pageInfo: { hasNextPage: boolean }; activities: (ListActivity | {})[] } }>(
      `query ($u: Int, $since: Int, $page: Int) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage }
        activities(userId: $u, type: ANIME_LIST, sort: ID_DESC, createdAt_greater: $since) { ${ACTIVITY_FIELDS} } } }`,
      { u: userId, since, page },
      token,
    );
    out.push(...(d.Page.activities.filter((a) => 'id' in a) as ListActivity[]));
    if (!d.Page.pageInfo.hasNextPage) break;
  }
  return out;
}

/** For each media, the user's last few list activities before `before` (unix seconds). Aliased, 10 per request. */
export async function activitiesBefore(
  token: string,
  userId: number,
  mediaIds: number[],
  before: number,
): Promise<Map<number, ListActivity[]>> {
  const out = new Map<number, ListActivity[]>();
  for (let i = 0; i < mediaIds.length; i += 10) {
    const chunk = mediaIds.slice(i, i + 10);
    const vars = chunk.map((_, j) => `$m${j}: Int`).join(', ');
    const body = chunk
      .map(
        (_, j) => `a${j}: Page(perPage: 5) { activities(userId: $u, mediaId: $m${j}, type: ANIME_LIST, sort: ID_DESC,
          createdAt_lesser: $before) { ${ACTIVITY_FIELDS} } }`,
      )
      .join('\n');
    const variables: Record<string, unknown> = { u: userId, before };
    chunk.forEach((id, j) => (variables[`m${j}`] = id));
    const d = await gql<Record<string, { activities: ListActivity[] }>>(
      `query ($u: Int, $before: Int, ${vars}) { ${body} }`,
      variables,
      token,
    );
    chunk.forEach((id, j) => out.set(id, (d[`a${j}`]?.activities ?? []).filter((a) => 'id' in a)));
  }
  return out;
}

/** Translate an activity trail (newest first) into the list state it implies. */
export function stateFromActivities(acts: ListActivity[]): { status: ListStatus; progress?: number } | null {
  const last = acts[0];
  if (!last) return null;
  const num = (a: ListActivity) => {
    const m = a.progress?.match(/(\d+)\s*$/);
    return m ? Number(m[1]) : undefined;
  };
  const lastProgress = acts.map(num).find((n) => n != null);
  const s = last.status.toLowerCase();
  if (s.startsWith('watched episode')) return { status: 'CURRENT', progress: num(last) };
  if (s.startsWith('rewatched episode')) return { status: 'REPEATING', progress: num(last) };
  if (s.startsWith('completed') || s === 'rewatched') return { status: 'COMPLETED', progress: last.media.episodes ?? lastProgress };
  if (s.startsWith('plans to watch')) return { status: 'PLANNING', progress: 0 };
  if (s.startsWith('paused')) return { status: 'PAUSED', progress: lastProgress };
  if (s.startsWith('dropped')) return { status: 'DROPPED', progress: lastProgress };
  return { status: 'CURRENT', progress: lastProgress };
}

async function aliasedDelete(token: string, field: 'DeleteMediaListEntry' | 'DeleteActivity', ids: number[]) {
  let ok = 0;
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const vars = chunk.map((_, j) => `$i${j}: Int`).join(', ');
    const body = chunk.map((_, j) => `d${j}: ${field}(id: $i${j}) { deleted }`).join('\n');
    const variables = Object.fromEntries(chunk.map((id, j) => [`i${j}`, id]));
    try {
      const d = await gql<Record<string, { deleted: boolean }>>(`mutation (${vars}) { ${body} }`, variables, token);
      ok += chunk.filter((_, j) => d[`d${j}`]?.deleted).length;
    } catch {
      // isolate failures one by one
      for (const id of chunk) {
        try {
          await gql(`mutation ($id: Int) { ${field}(id: $id) { deleted } }`, { id }, token);
          ok++;
        } catch {}
      }
    }
  }
  return ok;
}

export const deleteEntries = (token: string, entryIds: number[]) => aliasedDelete(token, 'DeleteMediaListEntry', entryIds);
export const deleteActivities = (token: string, ids: number[]) => aliasedDelete(token, 'DeleteActivity', ids);

/**
 * Follow SEQUEL relations from `id` (TV/ONA only), up to `max` entries — the AniList parts that
 * continue a Crunchyroll season split into "Part 1 / Part 2" or cours.
 */
export async function sequelChain(id: number, token: string | null | undefined, max = 4): Promise<AniMedia[]> {
  const out: AniMedia[] = [];
  let cur = id;
  for (let i = 0; i < max; i++) {
    const d = await gql<{ Media: { relations: { edges: { relationType: string; node: AniMedia & { type: string } }[] } } }>(
      `query ($id: Int) { Media(id: $id) { relations { edges { relationType node { type ${MEDIA_FIELDS}
        ${token ? 'mediaListEntry { id mediaId status progress score }' : ''} } } } } }`,
      { id: cur },
      token,
    );
    const next = d.Media.relations.edges.find(
      (e) => e.relationType === 'SEQUEL' && e.node.type === 'ANIME' && ['TV', 'TV_SHORT', 'ONA'].includes(e.node.format ?? ''),
    )?.node;
    if (!next) break;
    out.push(next);
    cur = next.id;
  }
  return out;
}
