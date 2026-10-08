import { describe, expect, it } from 'vitest';
import { progressBySegment, segmentAt, single, splitSegments } from '@/lib/segments';

describe('splitSegments', () => {
  it('24-ep CR season = two 12-ep AniList parts', () => {
    expect(splitSegments(24, [{ id: 1, episodes: 12 }, { id: 2, episodes: 12 }])).toEqual([
      { mediaId: 1, crFrom: 1, count: 12, aniOffset: 0 },
      { mediaId: 2, crFrom: 13, count: 12, aniOffset: 0 },
    ]);
  });
  it('tolerates ±1 (recap episode)', () => expect(splitSegments(25, [{ id: 1, episodes: 12 }, { id: 2, episodes: 12 }])).not.toBeNull());
  it('airing last part (unknown count)', () => expect(splitSegments(20, [{ id: 1, episodes: 12 }, { id: 2, episodes: null }])).not.toBeNull());
  it("rejects counts that don't line up", () => expect(splitSegments(24, [{ id: 1, episodes: 12 }, { id: 2, episodes: 25 }])).toBeNull());
  it('needs at least two parts', () => expect(splitSegments(12, [{ id: 1, episodes: 12 }])).toBeNull());
});

describe('progressBySegment', () => {
  const split = splitSegments(24, [{ id: 1, episodes: 12 }, { id: 2, episodes: 12 }])!;
  it('inside part 1 only touches part 1', () => expect(progressBySegment(split, 5)).toEqual([{ mediaId: 1, progress: 5 }]));
  it('end of part 1', () => expect(progressBySegment(split, 12)).toEqual([{ mediaId: 1, progress: 12 }]));
  it('into part 2 completes part 1', () =>
    expect(progressBySegment(split, 15)).toEqual([{ mediaId: 1, progress: 12 }, { mediaId: 2, progress: 3 }]));
  it('offset: CR season 2 continues one AniList entry', () =>
    expect(progressBySegment(single(9, 12), 3)).toEqual([{ mediaId: 9, progress: 15 }]));
  it('nothing watched', () => expect(progressBySegment(split, 0)).toEqual([]));
  it('segmentAt picks the containing part', () => {
    expect(segmentAt(split, 3)!.mediaId).toBe(1);
    expect(segmentAt(split, 13)!.mediaId).toBe(2);
  });
});

import { sortUpNext, type UpNextItem } from '@/lib/messages';
describe('sortUpNext', () => {
  const it_ = (aniId: number, o: Partial<UpNextItem>): UpNextItem => ({
    aniId, title: `#${aniId}`, cover: null, status: 'CURRENT', progress: 1, total: 12, seriesId: null,
    nextEpisode: { id: 'x', title: '', number: 2, url: '' }, available: 1, airing: null, updatedAt: 0, lastWatched: null, popularity: null, ...o,
  });
  const items = [
    it_(1, { lastWatched: 1000, popularity: 50 }),
    it_(2, { lastWatched: 3000, popularity: 10 }),
    it_(3, { lastWatched: null, updatedAt: 2, popularity: 900 }), // AniList fallback: 2000 ms
    it_(4, { nextEpisode: null, lastWatched: 9999, popularity: 9999 }), // caught up → always last
  ];
  it('last watched: CR history first, then the rest', () => expect(sortUpNext(items, 'recent').map((i) => i.aniId)).toEqual([2, 1, 3, 4]));
  it('most popular', () => expect(sortUpNext(items, 'popular').map((i) => i.aniId)).toEqual([3, 1, 2, 4]));
});
