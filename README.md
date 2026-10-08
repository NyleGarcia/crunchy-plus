# Crunchy+

Chrome/Firefox MV3 extension that makes Crunchyroll better.

- **Sub / Dub / All modes** — Sub hides dubbed episodes, seasons and feed cards and forces original audio in the player. Dub prefers your dub language. All = stock CR.
- **AniList sync** — progress bumped after N% of an episode (default 80%). Dropped/Paused never overwritten; 0 watched → Planning.
- **Import** — scrape CR watch history + watchlist (profile-checked), match % + picker, filters, split-season parts, replay/diff, backport, undo. Optional [TypeSafe Jev](https://typesafe.ai) assist for ambiguous matches.
- **AniList → Crunchyroll** — Up next (last watched / most popular), Planning → watchlist, statuses → Crunchylists, card badges ("Watching 5 of 8 out").
- **Site UI** — modern theme, compact hero, declutter, hide rows by title, Up next row, hide completed (only reappears for new original-audio episodes).
- **Quieter page** — Crunchyroll's Datadog / Braze / Segment telemetry uploads are stubbed in-page.

## Setup
```sh
npm install
npm run dev          # Chrome with the extension + HMR (fully reload the extension if the page hook stops working)
npm run build        # .output/chrome-mv3 → chrome://extensions → Load unpacked
npm test             # vitest
npm run check        # svelte-check / tsc
```

AniList: create a client at https://anilist.co/settings/developer with redirect URL
`https://mlfpneomdkdbknkiihofllhhecpdopcl.chromiumapp.org/` (the manifest `key` pins the extension ID), paste the client ID in the popup, Connect.

Jev (optional): paste a TypeSafe API key in the popup. It is stored in `chrome.storage.local` only.

Docs: [docs/README.md](docs/README.md) · [architecture](docs/architecture.md) · [changelog](docs/changelog.md).
