import { describe, expect, it } from 'vitest';
import { countdown, hotkeyAction, quickPatch } from '@/lib/quick';

const key = (code: string, mods: Partial<{ altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
  code,
  altKey: true,
  shiftKey: true,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

describe('hotkeyAction', () => {
  it('maps Alt+Shift keys', () => {
    expect(hotkeyAction(key('KeyW'))).toEqual({ status: 'CURRENT' });
    expect(hotkeyAction(key('KeyP'))).toEqual({ status: 'PLANNING' });
    expect(hotkeyAction(key('KeyC'))).toEqual({ status: 'COMPLETED' });
    expect(hotkeyAction(key('ArrowUp'))).toEqual({ step: 1 });
    expect(hotkeyAction(key('Minus'))).toEqual({ step: -1 });
  });

  it('needs exactly Alt+Shift', () => {
    expect(hotkeyAction(key('KeyW', { shiftKey: false }))).toBeNull();
    expect(hotkeyAction(key('KeyW', { ctrlKey: true }))).toBeNull();
    expect(hotkeyAction(key('KeyX'))).toBeNull();
  });
});

describe('quickPatch', () => {
  it('+1 from nothing or Planning starts Watching', () => {
    expect(quickPatch(null, 12, { step: 1 })).toEqual({ status: 'CURRENT', progress: 1 });
    expect(quickPatch({ status: 'PLANNING', progress: 0 }, 12, { step: 1 })).toEqual({ status: 'CURRENT', progress: 1 });
  });

  it('+1 to the last episode completes; never past it', () => {
    expect(quickPatch({ status: 'CURRENT', progress: 11 }, 12, { step: 1 })).toEqual({ status: 'COMPLETED', progress: 12 });
    expect(quickPatch({ status: 'COMPLETED', progress: 12 }, 12, { step: 1 })).toBeNull();
  });

  it('−1 out of Completed goes back to Watching; never below 0', () => {
    expect(quickPatch({ status: 'COMPLETED', progress: 12 }, 12, { step: -1 })).toEqual({ status: 'CURRENT', progress: 11 });
    expect(quickPatch({ status: 'CURRENT', progress: 0 }, 12, { step: -1 })).toBeNull();
  });

  it('+1 resumes Paused, keeps Repeating, unknown total has no cap', () => {
    expect(quickPatch({ status: 'PAUSED', progress: 3 }, null, { step: 1 })).toEqual({ status: 'CURRENT', progress: 4 });
    expect(quickPatch({ status: 'REPEATING', progress: 3 }, 12, { step: 1 })).toEqual({ status: 'REPEATING', progress: 4 });
  });

  it('status keys keep progress; Completed fills it', () => {
    expect(quickPatch({ status: 'PLANNING', progress: 2 }, 12, { status: 'CURRENT' })).toEqual({ status: 'CURRENT', progress: 2 });
    expect(quickPatch({ status: 'CURRENT', progress: 5 }, 12, { status: 'COMPLETED' })).toEqual({ status: 'COMPLETED', progress: 12 });
    expect(quickPatch({ status: 'CURRENT', progress: 5 }, 12, { status: 'CURRENT' })).toBeNull();
  });
});

describe('countdown', () => {
  const now = 1_000_000_000_000;
  it('formats by magnitude', () => {
    expect(countdown(now + (2 * 86400 + 4 * 3600 + 59) * 1000, now)).toBe('2d 4h');
    expect(countdown(now + (3 * 3600 + 12 * 60) * 1000, now)).toBe('3h 12m');
    expect(countdown(now + (12 * 60 + 5) * 1000, now)).toBe('12m 05s');
    expect(countdown(now - 1000, now)).toBe('now');
  });
});
