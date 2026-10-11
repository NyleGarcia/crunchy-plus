import { describe, expect, it } from 'vitest';
import { isKnown, knownKeys, mergeHistory, toPlay, trimEpisode, type PlayLike } from '@/lib/scan-cache';
import type { CREpisode } from '@/lib/types';

const ep = (id: string, extra: Partial<CREpisode['episode_metadata']> = {}): CREpisode => ({
  id,
  title: `Ep ${id}`,
  type: 'episode',
  episode_metadata: {
    series_id: 'S', series_title: 'Show', season_id: 'A', season_title: 'Season 1', season_number: 1,
    episode_number: Number(id.slice(1)), sequence_number: Number(id.slice(1)), duration_ms: 1_400_000,
    versions: [
      { guid: 'dub', audio_locale: 'en-US', original: false, season_guid: 'A-dub' },
      { guid: id, audio_locale: 'ja-JP', original: true, season_guid: 'A' },
    ],
    ...extra,
  } as any,
});
const play = (id: string, at: string, playhead = 1400): PlayLike => ({ date_played: at, fully_watched: true, playhead, panel: ep(id) });

describe('trimEpisode', () => {
  it('keeps scraper fields, drops the rest, keeps only the original version', () => {
    const t = trimEpisode({ ...ep('e1'), images: { thumbnail: [] } } as any);
    expect((t as any).images).toBeUndefined();
    expect(t.episode_metadata!.series_id).toBe('S');
    expect(t.episode_metadata!.versions).toEqual([{ guid: 'e1', audio_locale: 'ja-JP', original: true, season_guid: 'A' }]);
  });
});

describe('mergeHistory', () => {
  const cached = [play('e3', '2026-10-03'), play('e2', '2026-10-02'), play('e1', '2026-10-01')].map(toPlay);

  it('first scan: everything is new', () => {
    const { history, changed } = mergeHistory([], [play('e2', '2026-10-02'), play('e1', '2026-10-01')]);
    expect(history.map((h) => h.id)).toEqual(['e2', 'e1']);
    expect(changed).toEqual(new Set(['e2', 'e1']));
  });

  it('adds only the new entries from an overlapping page', () => {
    const { history, changed } = mergeHistory(cached, [play('e4', '2026-10-04'), play('e3', '2026-10-03'), play('e2', '2026-10-02')]);
    expect(history.map((h) => h.id)).toEqual(['e4', 'e3', 'e2', 'e1']);
    expect(changed).toEqual(new Set(['e4']));
  });

  it('a rewatch replaces the old entry and moves it to the top', () => {
    const { history, changed } = mergeHistory(cached, [play('e1', '2026-10-09')]);
    expect(history.map((h) => h.id)).toEqual(['e1', 'e3', 'e2']);
    expect(history[0]!.at).toBe('2026-10-09');
    expect(changed).toEqual(new Set(['e1']));
  });

  it('a progressed playhead counts as changed', () => {
    const partial = toPlay(play('e5', '2026-10-05', 100));
    const { changed } = mergeHistory([partial], [play('e5', '2026-10-05', 1200)]);
    expect(changed).toEqual(new Set(['e5']));
  });

  it('isKnown matches on episode id + date', () => {
    const keys = knownKeys(cached);
    expect(isKnown(keys, play('e2', '2026-10-02'))).toBe(true);
    expect(isKnown(keys, play('e2', '2026-10-08'))).toBe(false);
    expect(isKnown(keys, play('e9', '2026-10-02'))).toBe(false);
  });
});
