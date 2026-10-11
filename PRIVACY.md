# Crunchy+ Privacy Policy

_Last updated: 2026-10-11_

Crunchy+ is a browser extension that improves the Crunchyroll website and syncs watch progress with AniList. It runs entirely in your browser. There is no Crunchy+ server, account, or analytics.

## What the extension accesses

- **Crunchyroll (crunchyroll.com):** your session token (read from the page's own requests), watch history, watchlist, Crunchylists, and the episode you are watching. Used to filter sub/dub content, show badges, and build the import/export to AniList.
- **AniList (anilist.co):** an OAuth access token you grant, and your anime list. Used to read and update list entries (status, progress).
- **TypeSafe (api.typesafe.ai), optional:** only if you enter your own TypeSafe API key, season titles are sent to it to help pick the right AniList entry. Off by default.

## Where data is stored

All data (settings, tokens, cached Crunchyroll history and season lists, AniList matches, import logs) is stored in your browser's extension storage on your device. Nothing is sent anywhere except to the three services above, and only to perform the action you asked for.

## What is not done

- No data is sold, shared, or transferred to third parties.
- No tracking, analytics, or advertising. The extension additionally short-circuits Crunchyroll's own analytics uploads (Datadog, Braze, Segment) in the page.
- No remote code is loaded.

## Removal

Uninstalling the extension deletes all its stored data. You can revoke the AniList authorization at <https://anilist.co/settings/apps>.

## Contact

Open an issue at <https://github.com/NyleGarcia/crunchy-plus/issues>.
