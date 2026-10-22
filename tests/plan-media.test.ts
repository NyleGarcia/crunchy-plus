import { describe, expect, it } from 'vitest';
import { pickPlanMedia } from '@/lib/matcher';
import type { AniMedia } from '@/lib/types';

const media = (id: number, english: string | null, o: Partial<AniMedia> = {}): AniMedia => ({
  id,
  title: { romaji: null, english, native: null },
  synonyms: [],
  episodes: 12,
  format: 'TV',
  seasonYear: 2020,
  coverImage: { medium: null },
  ...o,
});

describe('pickPlanMedia', () => {
  it('picks the earliest TV season whose base title matches the card', () => {
    const hits = [
      media(3, 'Frieren Season 2', { seasonYear: 2026 }),
      media(2, 'Frieren', { seasonYear: 2019, format: 'MOVIE' }),
      media(1, 'Frieren', { seasonYear: 2023 }),
    ];
    expect(pickPlanMedia(hits, 'Frieren')?.id).toBe(1);
    // Only later seasons in the hits: a base-title match is still better than nothing.
    expect(pickPlanMedia([media(3, 'Frieren Season 2')], 'Frieren')?.id).toBe(3);
  });
  it('prefers TV over a movie/OVA with the same title', () => {
    const hits = [media(2, 'Spy x Family', { format: 'MOVIE', seasonYear: 2019 }), media(1, 'Spy x Family', { seasonYear: 2022 })];
    expect(pickPlanMedia(hits, 'SPY x FAMILY')?.id).toBe(1);
  });
  it('matches on romaji or synonyms too', () => {
    const hits = [media(5, null, { title: { romaji: 'Sousou no Frieren', english: null, native: null }, synonyms: ['Frieren: Beyond Journey’s End'] })];
    expect(pickPlanMedia(hits, "Frieren: Beyond Journey's End")?.id).toBe(5);
  });
  it('prefers the full-title match over a base-title one', () => {
    const hits = [media(2, 'Steins;Gate 0', { seasonYear: 2018 }), media(1, 'Steins;Gate', { seasonYear: 2011 })];
    expect(pickPlanMedia(hits, 'Steins;Gate')?.id).toBe(1);
    expect(pickPlanMedia(hits, 'Steins;Gate 0')?.id).toBe(2);
  });
  it('returns null without a title match instead of guessing', () => {
    expect(pickPlanMedia([media(1, 'Overlord')], 'Overlord IV')?.id).toBe(1);
    expect(pickPlanMedia([media(1, 'Overlord')], 'Oshi no Ko')).toBeNull();
    expect(pickPlanMedia([], 'Anything')).toBeNull();
    expect(pickPlanMedia([media(1, 'Anything')], '')).toBeNull();
  });
});
