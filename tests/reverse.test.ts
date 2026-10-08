import { describe, expect, it } from 'vitest';
import { baseTitle, pickSeries, seasonNumberOf } from '@/entrypoints/crunchyroll.content/reverse';
import type { AniListItem } from '@/lib/types';

const item = (english: string | null, romaji: string | null = null, synonyms: string[] = []): AniListItem => ({
  id: 1,
  mediaId: 1,
  status: 'CURRENT',
  progress: 0,
  updatedAt: 0,
  media: {
    id: 1,
    title: { english, romaji, native: null },
    synonyms,
    episodes: 12,
    format: 'TV',
    seasonYear: 2024,
    coverImage: { medium: null },
    status: 'RELEASING',
    nextAiringEpisode: null,
  },
});

describe('baseTitle', () => {
  it('strips "Season N"', () =>
    expect(baseTitle('Re:ZERO -Starting Life in Another World- Season 3')).toBe(
      baseTitle('Re:ZERO -Starting Life in Another World-'),
    ));
  it('strips ordinal season', () => expect(baseTitle('Mushoku Tensei 2nd Season')).toBe(baseTitle('Mushoku Tensei')));
  it('strips "Part N"', () => expect(baseTitle('Spy x Family Part 2')).toBe(baseTitle('Spy x Family')));
  it('strips Roman numeral suffix', () => expect(baseTitle('Overlord IV')).toBe(baseTitle('Overlord')));
  it('strips trailing number', () => expect(baseTitle('Kaguya-sama 2')).toBe(baseTitle('Kaguya-sama')));
  it('leaves plain titles alone', () => expect(baseTitle('Frieren')).toBe('frieren'));
});

describe('seasonNumberOf', () => {
  it('"Season 3"', () => expect(seasonNumberOf(item('Re:ZERO -Starting Life in Another World- Season 3'))).toBe(3));
  it('"2nd Season"', () => expect(seasonNumberOf(item('Mushoku Tensei 2nd Season'))).toBe(2));
  it('"Part 2"', () => expect(seasonNumberOf(item('Spy x Family Part 2'))).toBe(2));
  it('falls back to romaji', () => expect(seasonNumberOf(item(null, 'Shingeki no Kyojin Season 3'))).toBe(3));
  it('checks synonyms', () => expect(seasonNumberOf(item('Foo', null, ['Foo Season 4']))).toBe(4));
  it('defaults to 1', () => expect(seasonNumberOf(item('Frieren: Beyond Journey’s End'))).toBe(1));
});

describe('pickSeries', () => {
  const sg = { id: 'SG', title: 'Steins;Gate' };
  const sg0 = { id: 'SG0', title: 'Steins;Gate 0' };
  it('exact title beats a baseTitle tie, whatever the hit order', () => {
    expect(pickSeries([sg, sg0], ['Steins;Gate 0'])?.id).toBe('SG0');
    expect(pickSeries([sg0, sg], ['Steins;Gate 0'])?.id).toBe('SG0');
  });
  it('ties without an exact match stay unmapped', () =>
    expect(pickSeries([sg, sg0], ['Steins;Gate Season 2'])).toBeNull());
  it('maps a season title to its series when unambiguous', () =>
    expect(pickSeries([{ id: 'F', title: 'Frieren' }], ['Frieren Season 2'])?.id).toBe('F'));
  it('rejects weak hits', () => expect(pickSeries([{ id: 'X', title: 'Something Else' }], ['Frieren'])).toBeNull());
  it('ignores duplicate hits of the same series', () =>
    expect(pickSeries([{ id: 'F', title: 'Frieren' }, { id: 'F', title: 'Frieren' }], ['Frieren Season 2'])?.id).toBe('F'));
});
