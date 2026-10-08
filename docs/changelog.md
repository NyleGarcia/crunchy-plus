---
title: Changelog
tags: [changelog]
updated: 2026-10-08
---
# Changelog

## 0.1.0 — 2026-10-08
Initial version.
- Sub / Dub / All modes: dub filtering of CR list payloads (MAIN-world fetch/XHR hook), player audio redirect.
- AniList: OAuth (pinned extension ID + PIN fallback), auto-sync at 80% watched, status preservation (Dropped/Paused kept, 0 watched → Planning).
- Import: CR watch history + watchlist → AniList, profile-checked, match % + picker, filters/sort, optional Jev (TypeSafe) matching, split-season parts, replay/diff, backport, undo.
- AniList → CR: Up next (last watched / most popular), Planning → watchlist, statuses → Crunchylists, card badges.
- CR site UI: theme, compact hero, declutter, hide rows by title, Up next row, "Watching N of M out" pills, hide completed (original-audio aware).
- Telemetry stub: Datadog / Braze / Segment uploads short-circuited in-page.
- Verified live: token capture, per-user id, home feed filtering, hide completed, telemetry stub.
