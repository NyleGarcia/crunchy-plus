import { describe, expect, it } from 'vitest';
import { AUTO_ACCEPT, normalize, queriesFor, rank, similarity } from '@/lib/matcher';
import type { AniMedia } from '@/lib/types';

const media = (id: number, romaji: string, english: string | null, episodes: number | null, extra: Partial<AniMedia> = {}): AniMedia => ({
  id, title: { romaji, english, native: null }, synonyms: [], episodes, format: 'TV', seasonYear: 2020, coverImage: { medium: null }, ...extra,
});

describe('normalize/similarity', () => {
  it('strips dub tags + punctuation', () => expect(normalize('Re:ZERO (English Dub)')).toBe('re zero'));
  it('identical → 1', () => expect(similarity('Frieren', 'frieren')).toBe(1));
  it('different → low', () => expect(similarity('Frieren', 'One Piece')).toBeLessThan(0.3));
});

describe('rank', () => {
  const s1 = { seriesId: 'GRGG9798R', seriesTitle: 'Re:ZERO -Starting Life in Another World-', seasonTitle: 'Re:ZERO -Starting Life in Another World-', seasonNumber: 1, seasonEpisodes: 25 };
  const s3 = { ...s1, seasonTitle: 'Re:ZERO -Starting Life in Another World- Season 3', seasonNumber: 3, seasonEpisodes: 16 };
  const pool = [
    media(21355, 'Re:Zero kara Hajimeru Isekai Seikatsu', 'Re:ZERO -Starting Life in Another World-', 25),
    media(108632, 'Re:Zero kara Hajimeru Isekai Seikatsu 2nd Season', 'Re:ZERO -Starting Life in Another World- Season 2', 13),
    media(163134, 'Re:Zero kara Hajimeru Isekai Seikatsu 3rd Season', 'Re:ZERO -Starting Life in Another World- Season 3', 16),
  ];
  it('season 1 picks base entry confidently', () => {
    const [top, next] = rank(s1, pool);
    expect(top!.media.id).toBe(21355);
    expect(top!.score).toBeGreaterThanOrEqual(AUTO_ACCEPT);
    expect(next!.score).toBeLessThan(top!.score - 0.05);
  });
  it('season 3 picks 3rd season', () => expect(rank(s3, pool)[0]!.media.id).toBe(163134));
  it('crunchyroll external link boosts', () => {
    const a = media(1, 'Foo', null, 12);
    const b = media(2, 'Foo', null, 12, { externalLinks: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/GABC/foo' }] });
    const [top] = rank({ seriesId: 'GABC', seriesTitle: 'Foo', seasonTitle: 'Foo', seasonNumber: 1, seasonEpisodes: 12 }, [a, b]);
    expect(top!.media.id).toBe(2);
  });
  it('queries drop dub suffix and dedupe', () => {
    expect(queriesFor({ ...s1, seasonTitle: 'Re:ZERO -Starting Life in Another World- (English Dub)' })).toEqual(['Re:ZERO -Starting Life in Another World-']);
  });
});
