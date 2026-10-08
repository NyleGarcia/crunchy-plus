import { describe, expect, it } from 'vitest';
import { filterPayload, isFilterableUrl, keepItem, preferredVersion } from '@/lib/dub';

const versions = [
  { guid: 'JP1', audio_locale: 'ja-JP', original: true, season_guid: 'SJP' },
  { guid: 'EN1', audio_locale: 'en-US', original: false, season_guid: 'SEN' },
  { guid: 'ES1', audio_locale: 'es-419', original: false, season_guid: 'SES' },
];
const ep = (id: string, audio_locale: string) => ({ id, title: 't', episode_metadata: { audio_locale, versions } });
const season = (id: string, audio_locale: string, title = 'S') => ({ id, title, season_number: 1, audio_locale, versions: versions.map((v) => ({ ...v, guid: v.season_guid })) });

describe('keepItem', () => {
  it('sub mode keeps only original audio', () => {
    expect(keepItem(ep('JP1', 'ja-JP'), 'sub', 'en-US')).toBe(true);
    expect(keepItem(ep('EN1', 'en-US'), 'sub', 'en-US')).toBe(false);
    expect(keepItem({ panel: ep('ES1', 'es-419') }, 'sub', 'en-US')).toBe(false);
  });
  it('dub mode prefers chosen dub, hides other dubs and dubbed originals', () => {
    expect(keepItem(ep('EN1', 'en-US'), 'dub', 'en-US')).toBe(true);
    expect(keepItem(ep('JP1', 'ja-JP'), 'dub', 'en-US')).toBe(false);
    expect(keepItem(ep('ES1', 'es-419'), 'dub', 'en-US')).toBe(false);
    expect(keepItem({ id: 'X', episode_metadata: { audio_locale: 'ja-JP', versions: [{ guid: 'X', audio_locale: 'ja-JP', original: true }] } }, 'dub', 'en-US')).toBe(true);
  });
  it('classifies seasons', () => {
    expect(keepItem(season('SJP', 'ja-JP'), 'sub', 'en-US')).toBe(true);
    expect(keepItem(season('SEN', 'en-US'), 'sub', 'en-US')).toBe(false);
  });
  it('falls back to title when no audio info', () => {
    expect(keepItem({ id: 'a', title: 'Foo (English Dub)', season_number: 2, versions: null }, 'sub', 'en-US')).toBe(false);
    expect(keepItem({ id: 'a', title: 'Foo', season_number: 2, versions: null }, 'sub', 'en-US')).toBe(true);
  });
  it('leaves unclassifiable items (series) alone', () => {
    expect(keepItem({ id: 'G1', type: 'series', series_metadata: {} }, 'sub', 'en-US')).toBe(true);
  });
});

describe('filterPayload', () => {
  it('filters nested arrays and fixes total', () => {
    const out = filterPayload({ total: 3, data: [ep('JP1', 'ja-JP'), ep('EN1', 'en-US'), { id: 'feed', items: [ep('EN1', 'en-US'), ep('JP1', 'ja-JP')] }] }, 'sub', 'en-US');
    expect(out.data.map((x: any) => x.id)).toEqual(['JP1', 'feed']);
    expect((out.data[1] as any).items.map((x: any) => x.id)).toEqual(['JP1']);
    expect(out.total).toBe(2);
  });
  it('is identity in all mode', () => {
    const p = { data: [ep('EN1', 'en-US')] };
    expect(filterPayload(p, 'all', 'en-US')).toBe(p);
  });
});

describe('preferredVersion', () => {
  it('redirects dub → original in sub mode', () => expect(preferredVersion('EN1', versions, 'sub', 'en-US')).toBe('JP1'));
  it('stays on original in sub mode', () => expect(preferredVersion('JP1', versions, 'sub', 'en-US')).toBeNull());
  it('redirects to chosen dub in dub mode', () => expect(preferredVersion('JP1', versions, 'dub', 'es-419')).toBe('ES1'));
  it('no-op without versions', () => expect(preferredVersion('JP1', null, 'sub', 'en-US')).toBeNull());
});

describe('isFilterableUrl', () => {
  it.each([
    ['https://www.crunchyroll.com/content/v2/discover/browse?n=36', true],
    ['https://www.crunchyroll.com/content/v2/cms/series/G1/seasons', true],
    ['https://www.crunchyroll.com/content/v2/cms/objects/G1', false],
    ['https://www.crunchyroll.com/content/v2/abc/watch-history', false],
    ['https://evil.com/content/v2/discover/browse', false],
  ])('%s → %s', (u, want) => expect(isFilterableUrl(u)).toBe(want));
});

describe('isOriginal tolerance', () => {
  it('missing original flag falls back to locale', () => {
    const s = { id: 'S1', title: 'X', season_number: 1, audio_locale: 'ja-JP', versions: [{ guid: 'S1', audio_locale: 'ja-JP' }] };
    expect(keepItem(s, 'sub', 'en-US')).toBe(true);
    const d = { id: 'S2', title: 'X', season_number: 1, audio_locale: 'en-US', versions: [{ guid: 'S2', audio_locale: 'en-US' }] };
    expect(keepItem(d, 'sub', 'en-US')).toBe(false);
  });
});
