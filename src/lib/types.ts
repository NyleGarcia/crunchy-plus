export type Mode = 'sub' | 'dub' | 'all';

export type ListStatus = 'CURRENT' | 'PLANNING' | 'COMPLETED' | 'DROPPED' | 'PAUSED' | 'REPEATING';

/** Subset of a Crunchyroll episode object (cms/objects, watch-history panels, season episode lists). */
export interface CREpisode {
  id: string;
  title: string;
  type?: string;
  episode_metadata?: CREpisodeMeta;
}

export interface CREpisodeMeta {
  series_id: string;
  series_title: string;
  series_slug_title?: string;
  season_id: string;
  season_title: string;
  season_slug_title?: string;
  season_number: number;
  episode_number: number | null;
  sequence_number?: number;
  duration_ms?: number;
  /** Release dates (ISO). episode_air_date = original broadcast; premium_available_date = on CR. */
  episode_air_date?: string;
  premium_available_date?: string;
  audio_locale?: string;
  versions?: CRVersion[] | null;
}

export interface CRVersion {
  guid: string;
  audio_locale: string;
  original: boolean;
  season_guid?: string;
}

export interface CRSeason {
  id: string;
  title: string;
  slug_title?: string;
  series_id: string;
  season_number: number;
  /** CR's display label ("1", "2", "" for OVAs/specials in many series). */
  season_display_number?: string;
  number_of_episodes?: number;
  audio_locale?: string;
  versions?: CRVersion[] | null;
}

/** What the extension knows about the episode playing in a tab. */
export interface NowPlaying {
  episodeId: string;
  seriesId: string;
  seriesTitle: string;
  seasonId: string;
  seasonTitle: string;
  seasonNumber: number;
  /** 1-based position within the original-audio season (AniList progress unit). */
  progress: number;
  seasonEpisodes: number | null;
}

export interface AniMedia {
  id: number;
  title: { romaji: string | null; english: string | null; native: string | null };
  synonyms: string[];
  episodes: number | null;
  format: string | null;
  seasonYear: number | null;
  coverImage: { medium: string | null; large?: string | null; extraLarge?: string | null; color?: string | null };
  /** AniList users with this on their list. */
  popularity?: number | null;
  externalLinks?: { site: string; url: string | null }[];
  mediaListEntry?: AniEntry | null;
}

export interface AniEntry {
  id: number;
  mediaId: number;
  status: ListStatus;
  progress: number;
  score?: number;
  /** Unix seconds the entry was added (only fetched by myList; 0/absent = unknown). */
  createdAt?: number;
}

/** A list entry with the media details AniList → Crunchyroll features need. */
export interface AniListItem extends AniEntry {
  updatedAt: number;
  completedAt?: { year: number | null; month: number | null; day: number | null } | null;
  media: AniMedia & {
    status: string | null;
    nextAiringEpisode: { episode: number; airingAt: number } | null;
  };
}

export const STATUS_LABEL: Record<ListStatus, string> = {
  CURRENT: 'Watching',
  PLANNING: 'Planning',
  COMPLETED: 'Completed',
  PAUSED: 'Paused',
  DROPPED: 'Dropped',
  REPEATING: 'Rewatching',
};

/** An original-audio CR season and how many numbered episodes are out. */
export interface SeasonInfo {
  id: string;
  number: number;
  out: number;
  title?: string;
  /** A regular season (not an OVA/OAD/special/movie/recap listed as a season). */
  main?: boolean;
}

/** Season-level key used for match cache + import aggregation. */
export const seasonKey = (seriesId: string, seasonId: string) => `${seriesId}|${seasonId}`;
