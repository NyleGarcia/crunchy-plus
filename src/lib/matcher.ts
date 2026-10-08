import type { AniMedia } from './types';

export interface MatchInput {
  seriesId: string;
  seriesTitle: string;
  seasonTitle: string;
  seasonNumber: number;
  seasonEpisodes: number | null;
}

const ROMAN = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\((?:[^)]*dub|[^)]*sub)\)/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s/g, '');
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice over character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = bigrams(x);
  const B = bigrams(y);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  const total = [...A.values(), ...B.values()].reduce((s, n) => s + n, 0);
  return total ? (2 * inter) / total : 0;
}

const DUB_SUFFIX = /\s*\((?:[^)]*dub|[^)]*sub)\)/gi;

/** CR often titles seasons just "Season 2" / "Part 1" / "Final Season" — useless as a search on its own. */
export function isGenericSeasonTitle(seasonTitle: string, seriesTitle: string): boolean {
  const t = normalize(seasonTitle);
  if (!t) return true;
  if (/^(season|part|cour)\s*\d+$|^\d+(st|nd|rd|th) season$|^(the )?final season( part \d+)?$/.test(t)) return true;
  // A season title that shares nothing with the series title is still worth trying on its own.
  return similarity(t, seriesTitle) < 0.3 && t.split(' ').length <= 3 && /\d|season|part/.test(t);
}

/** Search strings to try against AniList, most specific first. */
export function queriesFor(input: MatchInput): string[] {
  const { seriesTitle, seasonTitle, seasonNumber } = input;
  const season = isGenericSeasonTitle(seasonTitle, seriesTitle) ? `${seriesTitle} ${seasonTitle}` : seasonTitle;
  const qs = [season];
  if (seasonNumber > 1) qs.push(`${seriesTitle} season ${seasonNumber}`);
  qs.push(seriesTitle);
  return [...new Set(qs.map((q) => q.replace(DUB_SUFFIX, '').trim()).filter(Boolean))];
}

function mentionsSeason(title: string, n: number): boolean {
  const t = normalize(title);
  return (
    new RegExp(`\\b(season|part|cour) ${n}\\b`).test(t) ||
    new RegExp(`\\b${ORDINAL[n]} season\\b`).test(t) ||
    (n > 1 && new RegExp(`\\b${ROMAN[n]}$|\\b${n}$`).test(t))
  );
}

/** Season marker in an AniList title: a number, 'final', or null for "no marker" (i.e. first season). */
export function seasonMarker(title: string): number | 'final' | null {
  const t = normalize(title);
  if (/\bfinal (season|chapters?|part)\b|\bthe final\b/.test(t)) return 'final';
  const m =
    t.match(/\b(?:season|part|cour)\s*(\d+)\b/) ??
    t.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/) ??
    t.match(/\s(ii|iii|iv|v|vi|vii|viii|ix|x)$/);
  if (!m?.[1]) return null;
  const roman = ROMAN.indexOf(m[1]);
  return roman > 0 ? roman : Number(m[1]);
}

/** Score an AniList candidate for a CR season. ~1 = sure. */
export function scoreCandidate(input: MatchInput, m: AniMedia): number {
  const titles = [m.title.romaji, m.title.english, m.title.native, ...(m.synonyms ?? [])].filter(
    (t): t is string => !!t,
  );
  const targets = queriesFor(input);
  let best = 0;
  for (const t of titles) for (const q of targets) best = Math.max(best, similarity(t, q));
  let score = best;

  // AniList links every season of a show to the same CR series, so this only breaks ties.
  const crLink = m.externalLinks?.some(
    (l) => l.site === 'Crunchyroll' && l.url?.toLowerCase().includes(input.seriesId.toLowerCase()),
  );
  if (crLink) score += 0.08;

  // Season agreement, judged on the main titles (synonyms are noisy).
  const markers = [m.title.romaji, m.title.english].filter((t): t is string => !!t).map(seasonMarker);
  const n = input.seasonNumber;
  if (n <= 1) {
    if (markers.some((k) => k !== null && k !== 1)) score -= 0.3;
  } else if (markers.some((k) => k === n) || titles.some((t) => mentionsSeason(t, n))) {
    score += 0.15;
  } else if (markers.some((k) => k !== null)) {
    score -= 0.15; // a different season (or "final") than the one on CR
  } else {
    score -= 0.1;
  }

  if (input.seasonEpisodes && m.episodes) {
    const diff = Math.abs(m.episodes - input.seasonEpisodes);
    if (diff === 0) score += 0.1;
    else if (diff >= 2) score -= 0.15;
  }
  if (m.format && !['TV', 'TV_SHORT', 'ONA'].includes(m.format)) score -= 0.1;
  // Bonuses can't rescue a weak title match: cap the score so it never auto-accepts.
  if (best < 0.75) score = Math.min(score, best);
  return score;
}

export const AUTO_ACCEPT = 0.9;

export function rank(input: MatchInput, candidates: AniMedia[]) {
  return candidates
    .map((media) => ({ media, score: scoreCandidate(input, media) }))
    .sort((a, b) => b.score - a.score);
}
