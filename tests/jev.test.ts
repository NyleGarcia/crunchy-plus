import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseSeason, JevError } from '@/lib/jev';
import type { AniMedia } from '@/lib/types';

const m = (id: number, english: string, episodes: number): AniMedia => ({
  id, title: { romaji: null, english, native: null }, synonyms: [], episodes, format: 'TV', seasonYear: 2016, coverImage: { medium: null },
});
const input = { seriesId: 'G1', seriesTitle: 'My Hero Academia', seasonTitle: 'Season 1', seasonNumber: 1, seasonEpisodes: 13 };

afterEach(() => vi.unstubAllGlobals());

describe('chooseSeason', () => {
  it('sends a choice over candidates + none, parses ids/probabilities', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(Object.keys(body.questions.season.criteria)).toEqual(['a1', 'a2', 'none']);
      expect(body.state.crunchyroll.episodes).toBe(13);
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
      return new Response(JSON.stringify({ answers: { season: { type: 'choice', choice: 'a1', confidence: 0.99, probabilities: { a1: 0.97, a2: 0.02, none: 0.01 } } } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const v = await chooseSeason('k', input, [m(1, 'My Hero Academia', 13), m(2, 'My Hero Academia FINAL SEASON', 11)]);
    expect(v).toEqual({ choice: 1, probs: { 1: 0.97, 2: 0.02 }, confidence: 0.99 });
  });
  it('maps "none" to null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ answers: { season: { choice: 'none', confidence: 0.8, probabilities: { a1: 0.1, none: 0.9 } } } }))));
    expect((await chooseSeason('k', input, [m(1, 'X', 12)])).choice).toBeNull();
  });
  it('throws JevError with status on auth failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'bad key' }), { status: 401 })));
    await expect(chooseSeason('k', input, [m(1, 'X', 12)])).rejects.toMatchObject({ status: 401 });
    await expect(chooseSeason('k', input, [m(1, 'X', 12)])).rejects.toBeInstanceOf(JevError);
  });
});
