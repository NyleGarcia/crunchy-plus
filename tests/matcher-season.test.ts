import { describe, expect, it } from 'vitest';
import { AUTO_ACCEPT, isGenericSeasonTitle, queriesFor, rank, seasonMarker } from '@/lib/matcher';
import { progressFrom } from '@/lib/progress';
import type { AniMedia } from '@/lib/types';

const media = (id: number, romaji: string, english: string | null, episodes: number | null, link = true): AniMedia => ({
  id, title: { romaji, english, native: null }, synonyms: [], episodes, format: 'TV', seasonYear: 2016, coverImage: { medium: null },
  externalLinks: link ? [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/G6NQ5DWZ6/my-hero-academia' }] : [],
});

const mha = [
  media(21459, 'Boku no Hero Academia', 'My Hero Academia', 13),
  media(21856, 'Boku no Hero Academia 2', 'My Hero Academia Season 2', 25),
  media(182896, 'Boku no Hero Academia: FINAL SEASON', 'My Hero Academia FINAL SEASON', 11),
];
const s1 = { seriesId: 'G6NQ5DWZ6', seriesTitle: 'My Hero Academia', seasonTitle: 'Season 1', seasonNumber: 1, seasonEpisodes: 13 };

describe('generic CR season titles', () => {
  it('detects bare season titles', () => {
    expect(isGenericSeasonTitle('Season 1', 'My Hero Academia')).toBe(true);
    expect(isGenericSeasonTitle('Final Season', 'Attack on Titan')).toBe(true);
    expect(isGenericSeasonTitle('Re:ZERO -Starting Life in Another World- Season 3', 'Re:ZERO')).toBe(false);
  });
  it('never searches a bare "Season N"', () => {
    expect(queriesFor(s1)[0]).toBe('My Hero Academia Season 1');
    expect(queriesFor({ ...s1, seasonTitle: 'Season 2', seasonNumber: 2 })).not.toContain('Season 2');
  });
});

describe('season markers', () => {
  it.each([
    ['My Hero Academia FINAL SEASON', 'final'],
    ['Boku no Hero Academia 2', null],
    ['Mushoku Tensei 2nd Season', 2],
    ['Overlord IV', 4],
    ['Frieren', null],
  ])('%s → %s', (t, want) => expect(seasonMarker(t)).toBe(want));
});

describe('MHA season 1 regression', () => {
  it('picks season 1, not FINAL SEASON', () => {
    const [top, next] = rank(s1, mha);
    expect(top!.media.id).toBe(21459);
    expect(top!.score).toBeGreaterThanOrEqual(AUTO_ACCEPT);
    expect(next!.score).toBeLessThan(top!.score - 0.05);
    expect(rank(s1, [mha[2]!])[0]!.score).toBeLessThan(AUTO_ACCEPT);
  });
  it('weak title match never auto-accepts even with link + episode bonus', () => {
    const gon = media(1, 'GON 2', null, 13);
    const r = rank({ ...s1, seasonTitle: 'Season 2', seasonNumber: 2 }, [gon]);
    expect(r[0]!.score).toBeLessThan(AUTO_ACCEPT);
  });
});

describe('progressFrom', () => {
  it('sequential', () => expect(progressFrom([1, 2, 3, 4])).toBe(4));
  it('skip-ahead stays at the contiguous part', () => expect(progressFrom([1, 2, 3, 13])).toBe(3));
  it('tolerates one missing history entry', () => expect(progressFrom([1, 2, 3, 5])).toBe(5));
  it('only the last episode watched → nothing', () => expect(progressFrom([13])).toBe(0));
  it('empty', () => expect(progressFrom([])).toBe(0));
  it('full season with a couple of gaps', () => expect(progressFrom([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13])).toBe(13));
});
