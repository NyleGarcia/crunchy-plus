---
title: Architecture
tags: [architecture]
updated: 2026-10-08
---
# Architecture

| Piece | File | World | Job |
|---|---|---|---|
| Hook | `src/entrypoints/cr-hook.content.ts` | MAIN, document_start | Wraps `fetch` + XHR: captures CR bearer token, rewrites `/content/v2/*` list JSON per mode, forwards `/cms/objects` episode meta |
| CR content script | `src/entrypoints/crunchyroll.content/` | isolated, all frames | Settings → hook bridge (localStorage `crunchyplus:config` + postMessage), player tracker, audio-version redirect, Svelte widget (shadow root), theme CSS, scraper |
| Background | `src/entrypoints/background.ts` | SW | AniList OAuth (implicit, `identity.launchWebAuthFlow`), GraphQL (serialized, 2.1 s gap, 429 retry), match cache, sync, scrape relay |
| Popup | `src/entrypoints/popup/` | ext page | Mode, dub lang, AniList connect, threshold, theme |
| Import | `src/entrypoints/import/` | ext page | CR history+watchlist → per-season rows → match → diff vs AniList list → apply |

## Key rules
- **Dub classification** (`src/lib/dub.ts`): `versions[].original` for the item's own guid → else `audio_locale` ∈ {ja-JP, zh-CN, zh-TW, ko-KR} → else title `(… Dub)`. Unclassifiable items (series) always kept.
- **Never filtered**: `/cms/objects`, playheads, watch-history, up_next — player + continue-watching stay intact.
- **Progress** = 1-based position in the *original-audio* season's numbered episodes (specials excluded), so dub/sub watches merge and absolute numbering (e.g. ep 1000) maps to AniList per-season progress.
- **Match**: AniList search (season title → "series season N" → series), Dice bigram similarity + CR externalLink (+0.25) + season mention (+0.15) + ep count (+0.1). Auto-accept ≥ 0.9 with 0.05 margin; else user picks. Cached in `local:matches` (`seriesId|originalSeasonId` → media id; 0 = don't sync).
- **planUpdate**: never decreases progress, never downgrades COMPLETED, never demotes to PLANNING.

## AniList → Crunchyroll export (`src/entrypoints/crunchyroll.content/reverse.ts`)
- Runs in the CR content script (holds the CR session). `exportPlan()` builds a preview; `exportApply(plan)` writes only after the user clicks Apply on it.
- **Series mapping** (`mapSeries`): `local:crSeries` cache → AniList Crunchyroll externalLink → inverted import match cache → CR `discover/search` on `baseTitle()` (season/part/ordinal/Roman suffix stripped), `pickSeries()`: a single exact normalized title wins; several exact → unmapped; else best ≥ 0.82 and ≥ 0.05 ahead of the runner-up. Misses stored as `{missAt}` in `local:crSeriesMeta` and re-searched after 30 days; a search that *threw* is never cached. `CRSessionError` stops the run.
- **Watchlist: add-only.** Statuses in `exportWatchlist` (default Planning + Watching) are added if missing; nothing is ever removed from the user's own watchlist.
- **Crunchylists**: one extension-owned list per status in `exportLists`, titled `AniList · <STATUS_LABEL>`. Only lists with that exact title are touched. With `mirrorLists` on, entries not in the AniList status are removed from *those* lists (shown in the preview).
- **Auto mode** (`autoExport`, every `autoExportHours`, checked on a CR visit; one tab wins via the `local:exportClaim` nonce): default = toast "N changes ready to review" → `hub.html?review=1#export`. With `autoApplyAdds` on, **additions only** are applied without a click, and only once `activeProfile().source === 'page'` (waits up to 20 s; otherwise falls back to the reminder). Removals always need review.
- **Caps**: no new list if the account's Crunchylist limit (`maxLists - used`) is reached; per-list item cap (`max`, ~100) → most recently updated AniList entries win, the stale rest reported as overflow. All caps surface as preview warnings. Unmapped entries are listed, not guessed.

## Up next
- `upNext()`: AniList CURRENT + REPEATING → CR series (`mapSeries`) → season (exact import match, else `seasonNumberOf()` vs original-audio `season_number`, else title similarity) → episode at index `progress` = next to watch, plus count available. Sorted ready-to-watch first, then most recently updated. Read-only. UI: `src/components/UpNext.svelte`.

## Card badges (`src/entrypoints/crunchyroll.content/badges.ts`)
- AniList status chip on CR series cards (setting `badges`). Uses **offline mapping only** (`knownSeries`: crSeries cache, externalLinks, import matches) — browsing never triggers CR searches. Multiple entries per series → priority Watching > Rewatching > Paused > Planning > Completed > Dropped.

## Undo (background `undo:*`)
- **Exact**: each import records `local:importLog` (`{at, items[]}` with before-state per media). `undo:fromLog` → rows that delete newly-created entries or restore the prior status/progress, plus that run's activity ids (`activitiesSince(at - 5 s)`).
- **Fallback** (no log, e.g. imports from older versions): `undo:scan(since)` collects the user's list activities after `since`, reconstructs each media's prior state from its older activities via `stateFromActivities()` (newest-first; "watched/rewatched episode" ranges take the end number, "completed" uses `media.episodes`, paused/dropped borrow progress from an older activity), no prior activity → pre-select **delete only if the entry was created inside the window** (`createdAt`), else **keep** with a "no earlier state known" note.
- `undo:apply` only after the user reviews rows; optionally deletes the activity posts too.

## Multi-profile accounts
- Per-user CR URLs (history, watchlist, custom-lists) must use the **active profile** id, not the account id, or you read/write another profile's data. `account()` order: id the page itself uses in its own per-user requests (seen by the hook) → `profile_id` claim in the session JWT → account id. Reset on token change (profile switch).
- Import first shows the resolved profile name (`/accounts/v1/me/multiprofile`) and waits for the user to confirm before scraping.

## Fragile points (CR changes)
- All CR endpoints live in `src/lib/cr-api.ts`. Watch-history paging (`page`/`page_size`) and watchlist (`n`/`start`) are unverified against live CR, as are the write endpoints (watchlist POST, custom-lists create/add/remove), `discover/search` and `multiprofile`.
- Theme selectors use `[class*=…]` prefixes; failing ones just fall back to stock CR.

## AniList auth
- Manifest `key` pins the extension ID to `mlfpneomdkdbknkiihofllhhecpdopcl` for dev, prod and unpacked builds → redirect URL `https://mlfpneomdkdbknkiihofllhhecpdopcl.chromiumapp.org/`.
- "Authorization page could not be loaded" = the AniList client's Redirect URL doesn't match the line above (AniList always redirects to the URL saved on the client).
- Fallback (Brave and other Chromium builds where `launchWebAuthFlow` breaks): set the client's Redirect URL to `https://anilist.co/api/v2/oauth/pin`, authorize, paste the token into the popup (`anilist:setToken` checks it with `Viewer` before saving).

## Match review + Jev (optional)
- Import rows show a **match %** (scorer, clamped 0–100; ≥ 90 auto-accepts), a picker with every candidate (%, format, year, eps), AniList search, skip; filters All / Matched / Unmatched / Needs review (unmatched, < 90, or runner-up within 5) and sort by recent / % / title. Saved matches have no fresh score; opening the picker re-searches with `match:resolve {force}` (nothing saved).
- `local:matches.v2` — v1 held auto-matches from the old scorer (shared CR-link bonus, bare "Season N" queries) and was discarded.
- **Jev** (`src/lib/jev.ts`, background only): one `choice` per unsure row (no auto-match, or top-2 within 5 points), options = candidates + `none`, 4 in flight. Pick ≥ `jevAccept` (default 0.9) → `source: 'jev'` and remembered; otherwise the verdict is shown. 401/403 stops further calls. **Optional**: no TypeSafe key → no calls, no Jev UI.
- Key: `local:typesafeKey`, entered in the popup; local storage only, sent only to `api.typesafe.ai`. User's explicit choice over the usual server-side-key rule (extension has no server).

## Split seasons (`src/lib/segments.ts`, `local:segments`)
- A `Segment` maps CR positions `[crFrom, crFrom+count-1]` → AniList episodes `aniOffset+1…`. `progressBySegment` only returns entries the CR position has reached (watching Part 1 never creates Part 2).
- **CR season → several AniList parts**: auto when the match has fewer episodes than the CR season — follow AniList SEQUEL relations (TV/ONA) until counts add up (±1; last part may be airing). Manual: picker "split across AniList parts" / "undo split".
- **Several CR seasons → one AniList entry**: import detects consecutive CR seasons of a series matched to the same entry and saves an offset (`single(id, offset)`). Manual: picker "AniList ep before this season's ep 1".
- Used by the import (one plan per part, logged per entry for undo) and by player sync (every reached part; the panel shows the part containing the current episode).

## Status rules (`planUpdate`)
- Progress never goes backwards; COMPLETED untouched; REPEATING only advances; reaching AniList's episode count completes any status (CR's count is "aired so far" and is never used as the total).
- 0 episodes watched is always PLANNING: new entries, and existing "Watching · 0" entries (the import proposes that fix even for non-watchlist rows).
- The user's status is kept: CURRENT stays; PAUSED/DROPPED never change on import (progress still rises); the import's Watching/"older" status only applies to new or PLANNING entries. Player sync (`live`) resumes PAUSED/DROPPED to CURRENT when a newer episode is watched.

## Jev display
- Scorer % = agreement score (not a probability). Jev % = probability spread over all options, so it can read lower when two entries are plausible. The UI therefore compares *picks*: "Jev ✓" when Jev agrees, "Jev prefers X (p%)" + Needs review when it doesn't. Prompt asks for the first part of split seasons.

## Replay, diff, backport (import)
- Every real scan saves `local:lastScan` (CR seasons + per-row match ids and planned updates). **Replay last scan** re-runs matching/planning on it with no CR requests; "ignore saved matches" re-searches every row (`match:resolveMany {force}`, nothing saved) to test the matcher. Rows are tagged new / match changed / plan changed against the baseline; a **Changed** filter lists them. Replays don't overwrite the snapshot.
- **Backport** (per row): write CR's exact progress and implied status even if lower than AniList (`forcedPlan`, shown as "↓"). Logged for undo like any import.
- Apply merges every part that targets the same AniList entry into one write (backport > Completed > furthest progress), so split/continuing seasons can't move an entry backwards. Undo-from-log dedupes entries (first `before` wins).

## Crunchyroll page UI (`theme.css`, `badges.ts`, `UpNextRow.svelte`)
- Selectors verified against the logged-in home page (2026-10). CR classes are BEM + 5-char hash (`browse-card--esJdT`) → match `[class*="block--"]` / `[class*="block__el--"]`; prefer unhashed `data-t` hooks. Exceptions: `.erc-feed`, `.collection-item` are unhashed.
- Stylesheet always injected; `<html>` classes switch parts: `crunchy-plus` (theme), `cp-compact-hero`, `cp-hide-{banners,manga,news,games,store,music}`. Feed rows are numbered `personalized-collection-N` (unstable) → rows are hidden by the card type they contain via `:has()`.
- Badges: bottom-left of the poster/thumbnail (CR uses top-left for Sub/Dub tags, top-right for the watchlist mark). Episode cards resolve their series via `a[data-t="series-title"]`.
- **Pills**: "Watching 5 of 8 out (12)" = AniList progress of the original-audio episodes out on CR (AniList season total in brackets, "(?)" while unknown; "Watching 5/12" until the CR check returns). Colour for Watching/Rewatching: green = behind, teal = caught up & airing (tooltip: next airing from AniList), yellow = caught up & season finished (mark Completed?) for that entry's season (`seriesSeasons`: original seasons with released numbered-episode counts, dubs/specials excluded, cached 6 h in `local:crSeasons`; `seasonOf`: exact import match → title season number → last). Best entry per series = most actionable status, ties → latest season. An orange pill marks unwatched content only: "N to watch" (aired > progress, any status but Planning) or, for completed shows, "New season" (a later original CR season than any of your entries). Episode cards never get the extra pill; on series pages episode cards get nothing.
- **Card mapping fallback**: cards with no known mapping are matched offline by exact `baseTitle` (season/part markers stripped) against the user's AniList titles; matches are persisted to `local:crSeries` (never overwriting link/import/search mappings).
- **Hide completed** (`hideCompleted`): hidden when every mapped AniList entry is COMPLETED, unless the same check finds "N new" or "New season". Check failed/unknown → shown.
- **Up next row**: shadow-root UI auto-mounted as first child of `.erc-feed`; data = `upNext()` cached 15 min (`local:upNextCache`).
- Series and watch pages: selectors not yet verified (need a saved logged-in page).
- **Hidden rows** (`rows.ts`, setting `hiddenRows`): rows hidden by heading text (case-insensitive substring), since row numbers change per visit. Row root = `[data-t^="personalized-collection-"]`, else the direct child of `.dynamic-feed-wrapper`. Each heading gets a hover "Hide row" button (Undo toast); popup lists hidden rows with Show, presets (`ROW_PRESETS`), and free-text patterns.
- **Telemetry stub** (cr-hook): fetch/XHR/sendBeacon to Datadog RUM, Braze, Segment (`isTelemetry`) get an empty local 204/`data:` response — nothing sent, no blocked-request spam. Video/account/CR API hosts never match.
