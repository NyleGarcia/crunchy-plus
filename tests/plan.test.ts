import { describe, expect, it } from 'vitest';
import { planUpdate } from '@/lib/anilist';

describe('planUpdate', () => {
  it('new entry → CURRENT', () => expect(planUpdate(null, 3, 12)).toEqual({ status: 'CURRENT', progress: 3 }));
  it('last episode → COMPLETED', () => expect(planUpdate({ status: 'CURRENT', progress: 11 }, 12, 12)).toEqual({ status: 'COMPLETED', progress: 12 }));
  it('never goes backwards', () => expect(planUpdate({ status: 'CURRENT', progress: 8 }, 5, 12)).toBeNull());
  it('never downgrades COMPLETED', () => expect(planUpdate({ status: 'COMPLETED', progress: 12 }, 3, 12)).toBeNull());
  it('repeating bumps progress', () => expect(planUpdate({ status: 'REPEATING', progress: 2 }, 4, 12)).toEqual({ status: 'REPEATING', progress: 4 }));
  it('planning for watchlist-only', () => expect(planUpdate(null, 0, 12)).toEqual({ status: 'PLANNING', progress: 0 }));
  it('does not demote tracked entry to planning', () => expect(planUpdate({ status: 'PAUSED', progress: 0 }, 0, 12)).toBeNull());
  it('idle status applies', () => expect(planUpdate(null, 4, 12, 'PAUSED')).toEqual({ status: 'PAUSED', progress: 4 }));
  it('unknown total stays current', () => expect(planUpdate(null, 50, null)).toEqual({ status: 'CURRENT', progress: 50 }));
});

describe('planUpdate keeps the user\'s status', () => {
  it('DROPPED stays DROPPED on import (progress still rises)', () =>
    expect(planUpdate({ status: 'DROPPED', progress: 3 }, 5, 12, 'PAUSED')).toEqual({ status: 'DROPPED', progress: 5 }));
  it('DROPPED never becomes PAUSED', () => expect(planUpdate({ status: 'DROPPED', progress: 5 }, 5, 12, 'PAUSED')).toBeNull());
  it('PAUSED stays PAUSED on import', () =>
    expect(planUpdate({ status: 'PAUSED', progress: 2 }, 4, 12, 'CURRENT')).toEqual({ status: 'PAUSED', progress: 4 }));
  it('CURRENT is not demoted to the idle status', () =>
    expect(planUpdate({ status: 'CURRENT', progress: 2 }, 4, 12, 'PAUSED')).toEqual({ status: 'CURRENT', progress: 4 }));
  it('PLANNING with watched episodes takes the idle status', () =>
    expect(planUpdate({ status: 'PLANNING', progress: 0 }, 4, 12, 'PAUSED')).toEqual({ status: 'PAUSED', progress: 4 }));
  it('live watching resumes DROPPED to CURRENT', () =>
    expect(planUpdate({ status: 'DROPPED', progress: 3 }, 4, 12, 'CURRENT', { live: true })).toEqual({ status: 'CURRENT', progress: 4 }));
  it('live re-watching an old episode of a DROPPED show changes nothing', () =>
    expect(planUpdate({ status: 'DROPPED', progress: 6 }, 4, 12, 'CURRENT', { live: true })).toBeNull());
  it('finishing completes even a DROPPED show', () =>
    expect(planUpdate({ status: 'DROPPED', progress: 10 }, 12, 12, 'PAUSED')).toEqual({ status: 'COMPLETED', progress: 12 }));
});

describe('0 watched is Planning', () => {
  it('new entry with 0 → PLANNING', () => expect(planUpdate(null, 0, 12)).toEqual({ status: 'PLANNING', progress: 0 }));
  it('new entry with 0 and idle status still PLANNING', () => expect(planUpdate(null, 0, 12, 'CURRENT')).toEqual({ status: 'PLANNING', progress: 0 }));
  it('existing Watching · 0 → PLANNING', () => expect(planUpdate({ status: 'CURRENT', progress: 0 }, 0, 12)).toEqual({ status: 'PLANNING', progress: 0 }));
  it('Watching with progress stays Watching', () => expect(planUpdate({ status: 'CURRENT', progress: 3 }, 0, 12)).toBeNull());
  it('PAUSED · 0 is left alone', () => expect(planUpdate({ status: 'PAUSED', progress: 0 }, 0, 12)).toBeNull());
  it('backport-style live sync of ep 1 from Planning → Watching', () =>
    expect(planUpdate({ status: 'PLANNING', progress: 0 }, 1, 12, 'CURRENT', { live: true })).toEqual({ status: 'CURRENT', progress: 1 }));
});
