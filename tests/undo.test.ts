import { describe, expect, it } from 'vitest';
import { planUpdate, stateFromActivities, type ListActivity } from '@/lib/anilist';

let nextId = 1;
const act = (status: string, progress: string | null = null, episodes: number | null = 12): ListActivity => ({
  id: nextId++,
  status,
  progress,
  createdAt: 0,
  media: { id: 1, episodes, title: { romaji: null, english: 'Show' }, coverImage: { medium: null } },
});

describe('stateFromActivities (newest first)', () => {
  it('empty → null', () => expect(stateFromActivities([])).toBeNull());
  it('watched episode range → CURRENT at range end', () =>
    expect(stateFromActivities([act('watched episode', '1 - 3')])).toEqual({ status: 'CURRENT', progress: 3 }));
  it('watched single episode', () =>
    expect(stateFromActivities([act('watched episode', '7')])).toEqual({ status: 'CURRENT', progress: 7 }));
  it('completed → COMPLETED with media.episodes', () =>
    expect(stateFromActivities([act('completed', null, 24)])).toEqual({ status: 'COMPLETED', progress: 24 }));
  it('completed with unknown total → last known progress', () =>
    expect(stateFromActivities([act('completed', null, null), act('watched episode', '10', null)])).toEqual({
      status: 'COMPLETED',
      progress: 10,
    }));
  it('plans to watch → PLANNING 0', () =>
    expect(stateFromActivities([act('plans to watch')])).toEqual({ status: 'PLANNING', progress: 0 }));
  it('paused takes progress from older activity', () =>
    expect(stateFromActivities([act('paused watching'), act('watched episode', '4 - 5')])).toEqual({
      status: 'PAUSED',
      progress: 5,
    }));
  it('dropped takes progress from older activity', () =>
    expect(stateFromActivities([act('dropped'), act('watched episode', '2')])).toEqual({ status: 'DROPPED', progress: 2 }));
  it('rewatched episode → REPEATING', () =>
    expect(stateFromActivities([act('rewatched episode', '2 - 4')])).toEqual({ status: 'REPEATING', progress: 4 }));
  it('status match is case-insensitive', () =>
    expect(stateFromActivities([act('Watched episode', '3')])).toEqual({ status: 'CURRENT', progress: 3 }));
});

describe('planUpdate edge', () => {
  it('REPEATING reaching total → COMPLETED', () =>
    expect(planUpdate({ status: 'REPEATING', progress: 10 }, 12, 12)).toEqual({ status: 'COMPLETED', progress: 12 }));
  it('REPEATING overshooting total clamps to total', () =>
    expect(planUpdate({ status: 'REPEATING', progress: 10 }, 13, 12)).toEqual({ status: 'COMPLETED', progress: 12 }));
});
