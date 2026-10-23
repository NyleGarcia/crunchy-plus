---
title: Changelog
tags: [changelog]
updated: 2026-10-22
---
# Changelog

## Unreleased
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
