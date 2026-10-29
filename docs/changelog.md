---
title: Changelog
tags: [changelog]
updated: 2026-10-22
---
# Changelog

## Unreleased
- Card badges with an English-audio Crunchyroll profile: CR lists every season as its dub, so nearly all episodes were dropped as dubs ("Watching 4 of 2 out"). Seasons are now counted from their original-audio version; seasons are no longer all flagged as extras when CR leaves display numbers empty (new-season pills work again), and a "Season N" title beats CR's season number when matching (MHA S7 was matched to "Memories").
- Leaving a Crunchyroll tab open across an extension reload shows one "reload this page" notice instead of repeated "Extension context invalidated" errors.
- Series pages open on the newest regular season (popup switch "Open shows on the newest season"), not season 1 or the last one watched; extras and dubs never win.
- Card badges never show fewer episodes out than you've watched: a short count re-reads Crunchyroll, then floors at your progress and logs why episodes were dropped (`[Crunchy+] fewer episodes out than watched`).
- Import page no longer crashes on a malformed entry in the saved last scan (it is dropped and re-matched).
- Fewer AniList requests: the viewer and the full list (with media) are cached in storage instead of service-worker memory (which restarts every ~30 s idle), concurrent requests are shared, our own saves patch the cached list instead of discarding it, matches already on your list read their media from it, and split-season detection remembers "no split" until the season gains episodes.
- Upcoming: the Up next tab lists shows on Watching / Rewatching / Planning / Paused with a live countdown to the next episode; the episode-page widget shows it too.
- Hotkeys on Crunchyroll episode pages (popup switch): Alt+Shift+W Watching, P Planning, C Completed, ↑ / ↓ one episode up / down (+1 starts Watching and completes at the last episode). The widget's −/+ follow the same rules.
- Quick bar on episode pages, beside the SUB/DUB pill (popup switch): −/+ one episode, status, and the next-episode countdown; "+ Watching" / "+ Planning" when the show isn't on your list. Also on series pages (acts on the show's most actionable entry), where the hotkeys work too. "+ Plan" on cards stays clickable while CR's hover card is open (a copy is put on top of it).
- Hub header shows the build version (`X.Y.Z`, or `X.Y.Z-dev (local <sha>)` on a local build), like RSI+.
- Import is incremental end to end: history reading stops at the newest cached play date, and only seasons with new plays (or not seen before) are re-matched — the rest keep the last scan's match, so AniList searches, split detection and Jev calls don't rerun for the whole library each time. The profile confirm step is skipped when it is the same confirmed profile as the last scan; "full rescan" (now next to Scan) still redoes everything. `unlimitedStorage` so the scan cache can't silently fail to save past the 10 MB quota.
- "+ Plan" shows on an empty AniList too; a remake (same full title, different years) is left to the widget picker instead of planning the older series; Enter in the import candidate picker picks the highlighted row again (it only searches when the query changed).
- Security workflow (CodeQL, npm audit, dependency review, gitleaks, manifest allowlist + web-ext lint), OpenSSF Scorecard, Dependabot, actions pinned by SHA, least-privilege tokens; releases get SLSA provenance + `SHA256SUMS` (`scripts/verify-release.sh`); release PR rolls this file's Unreleased section automatically; `SECURITY.md`. `dev` is the working branch.
- Hub and popup rebuilt on shadcn-svelte (bits-ui) + Tailwind v4 with lucide icons: Tabs hub shell, Cards, Switches, Selects, Checkboxes, Tooltips, Collapsibles, a Command-based AniList candidate picker and Badge score pills. Same palette (brand orange), features, copy, shortcuts and deep links; `base.css` removed. Crunchyroll page UI (widget, Up next row, theme, badges) unchanged and still vanilla/scoped.
- Import scan is incremental: watch history is read newest-first only until an already-cached entry, season episode lists are reused unless the season got new plays, and watchlist series lookups are cached (`local:scanCache.v1`, per profile). "Full rescan (ignore cache)" toggle on the profile confirm step.
- Hide completed hides the card's grid slot instead of the bare card; on My Lists (history, watchlist), whose rows are virtualised and can't reflow, completed shows are dimmed (hover to see them) instead of leaving holes.
- "+ Plan" button on Crunchyroll cards that aren't on your AniList: adds the show (first season, exact title match only) as Planning without leaving the page.
- CI/CD matches RSI+: CI zips Chrome, Edge, Brave and Firefox builds on every push/PR; release-please cuts semver releases with all four zips (+ AMO sources zip); pushes to `dev` publish `vX.Y.Z-devNNNN` prereleases. Firefox manifest (gecko id, min 128); local builds show `X.Y.Z-dev (local <sha>)`.
- Background → Crunchyroll tab ops skip discarded tabs and, on "Receiving end does not exist" (tab opened before the extension loaded), reload the tab and retry once instead of failing.

## 0.1.0 — 2026-10-08
Initial version.
- Sub / Dub / All modes: dub filtering of CR list payloads (MAIN-world fetch/XHR hook), player audio redirect.
- AniList: OAuth (pinned extension ID + PIN fallback), auto-sync at 80% watched, status preservation (Dropped/Paused kept, 0 watched → Planning).
- Import: CR watch history + watchlist → AniList, profile-checked, match % + picker, filters/sort, optional Jev (TypeSafe) matching, split-season parts, replay/diff, backport, undo.
- AniList → CR: Up next (last watched / most popular), Planning → watchlist, statuses → Crunchylists, card badges.
- CR site UI: theme, compact hero, declutter, hide rows by title, Up next row, "Watching N of M out" pills, hide completed (original-audio aware).
- Telemetry stub: Datadog / Braze / Segment uploads short-circuited in-page.
- Verified live: token capture, per-user id, home feed filtering, hide completed, telemetry stub.
