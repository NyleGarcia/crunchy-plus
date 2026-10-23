# Crunchy+

[![CI](https://github.com/NyleGarcia/crunchy-plus/actions/workflows/ci.yml/badge.svg)](https://github.com/NyleGarcia/crunchy-plus/actions/workflows/ci.yml) [![Security](https://github.com/NyleGarcia/crunchy-plus/actions/workflows/security.yml/badge.svg)](https://github.com/NyleGarcia/crunchy-plus/actions/workflows/security.yml) [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/NyleGarcia/crunchy-plus/badge)](https://scorecard.dev/viewer/?uri=github.com/NyleGarcia/crunchy-plus) [![Release](https://img.shields.io/github/v/release/NyleGarcia/crunchy-plus?sort=semver)](https://github.com/NyleGarcia/crunchy-plus/releases)

Chrome/Firefox MV3 extension that makes Crunchyroll better. Stack: WXT + Svelte 5 + TypeScript; hub and popup UI on shadcn-svelte (bits-ui) + Tailwind v4 + lucide icons; the Crunchyroll page scripts stay vanilla.

- **Sub / Dub / All modes** — Sub hides dubbed episodes, seasons and feed cards and forces original audio in the player. Dub prefers your dub language. All = stock CR.
- **AniList sync** — progress bumped after N% of an episode (default 80%). Dropped/Paused never overwritten; 0 watched → Planning.
- **Import** — scrape CR watch history + watchlist (profile-checked), match % + picker, filters, split-season parts, replay/diff, backport, undo. Optional [TypeSafe Jev](https://typesafe.ai) assist for ambiguous matches.
- **AniList → Crunchyroll** — Up next (last watched / most popular), Planning → watchlist, statuses → Crunchylists, card badges ("Watching 5 of 8 out"), "+ Plan" on cards not on your list.
- **Site UI** — modern theme, compact hero, declutter, hide rows by title, Up next row, hide completed (only reappears for new original-audio episodes).
- **Quieter page** — Crunchyroll's Datadog / Braze / Segment telemetry uploads are stubbed in-page.

## Setup
```sh
npm install
npm run dev          # Chrome with the extension + HMR (fully reload the extension if the page hook stops working)
npx wxt build --mode development   # .output/chrome-mv3-dev (pinned ID, no dev server) → chrome://extensions → Load unpacked
npm run zip:all      # .output/crunchy-plus-<v>-{chrome,edge,brave,firefox}.zip (+ -sources.zip for AMO)
npm test             # vitest
npm run check        # svelte-check / tsc
```

AniList: create a client at https://anilist.co/settings/developer with redirect URL
`https://mlfpneomdkdbknkiihofllhhecpdopcl.chromiumapp.org/` (the manifest `key` pins the extension ID), paste the client ID in the popup, Connect.

Install from a [release](https://github.com/NyleGarcia/crunchy-plus/releases): **Chrome** / **Edge** / **Brave** → unzip `crunchy-plus-<v>-<browser>.zip` → extensions page → Developer mode → *Load unpacked*. **Firefox** → `-firefox.zip` via `about:debugging` → *This Firefox* → *Load Temporary Add-on* (unverified; AniList connects with the PIN flow). Release zips are production builds without the pinned `key`, so their extension ID differs: add that ID's `https://<id>.chromiumapp.org/` redirect to the AniList client or use the PIN flow.

Jev (optional): paste a TypeSafe API key in the popup. It is stored in `chrome.storage.local` only.

Docs: [docs/README.md](docs/README.md) · [architecture](docs/architecture.md) · [changelog](docs/changelog.md).
