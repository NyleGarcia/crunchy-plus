/**
 * Jev (TypeSafe System One) — picks the AniList entry for a Crunchyroll season when the
 * score-based matcher is unsure. Background-only: the key never reaches page scripts.
 */
import type { MatchInput } from './matcher';
import type { AniMedia } from './types';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const NONE = 'none';

export interface JevVerdict {
  /** AniList id Jev picked, or null for "none of these". */
  choice: number | null;
  /** AniList id → probability. */
  probs: Record<number, number>;
  confidence: number;
}

export class JevError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const describe = (m: AniMedia) => {
  const names = [m.title.english, m.title.romaji].filter((t, i, a): t is string => !!t && a.indexOf(t) === i);
  return `${names.join(' / ')} — ${m.format ?? 'unknown format'}, ${m.seasonYear ?? 'unknown year'}, ${m.episodes ?? 'unknown'} episodes`;
};

export async function chooseSeason(key: string, input: MatchInput, candidates: AniMedia[]): Promise<JevVerdict> {
  const options: Record<string, string> = {};
  for (const m of candidates.slice(0, 12)) options[`a${m.id}`] = describe(m);
  options[NONE] = 'None of these is the same season';
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'jev-latest',
      state: {
        crunchyroll: {
          series: input.seriesTitle,
          season_title: input.seasonTitle,
          season_number: input.seasonNumber,
          episodes: input.seasonEpisodes,
        },
      },
      questions: {
        season: {
          type: 'choice',
          instructions:
            'Which AniList entry is the same anime season as the Crunchyroll season in `crunchyroll`? Match the specific season, not just the franchise. If AniList splits this season into several parts or cours, pick the entry for the first part. Movies, OVAs, recaps and specials are not seasons. Choose "none" only if no entry is this season or its first part.',
          criteria: options,
        },
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new JevError(body?.error?.message ?? body?.detail ?? `TypeSafe HTTP ${res.status}`, res.status);
  const a = body?.answers?.season;
  if (!a?.probabilities) throw new JevError('TypeSafe returned no answer', res.status);
  const probs: Record<number, number> = {};
  for (const [k, p] of Object.entries(a.probabilities as Record<string, number>)) if (k !== NONE) probs[Number(k.slice(1))] = p;
  return { choice: a.choice === NONE ? null : Number(String(a.choice).slice(1)), probs, confidence: a.confidence ?? 0 };
}
