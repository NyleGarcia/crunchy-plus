---
title: Now
tags: [plans]
updated: 2026-10-08
---
# Now
- [ ] Hide "[Crunchy+]" console logs behind a popup "Debug logging" toggle (off by default)
- [ ] `[Crunchy+] seasons query shape: {}` — seasons endpoint returning an empty object on some series; confirm the query-variant fallback still yields seasons
- [ ] Live-verify series + watch page selectors (need saved logged-in pages)
- [ ] Live-verify player auto-sync at 80% → AniList progress bump
- [ ] Live-verify export: CR watchlist add (`POST /content/v2/{id}/watchlist`), Crunchylists create/add/remove + limits — preview first
- [ ] Live-verify `/content/v2/discover/search` series results + accept threshold 0.82
- [ ] Profile name shows "unknown" in import confirm (id resolves correctly via page path)
- [ ] Root-cause unrecognized watchlist rows (Piacevole etc.); currently opt-in
- [ ] Simulcast calendar page (server-rendered HTML) — DOM-based dub hiding
- [ ] Dev mode: avoid WXT hot-reload re-registering the MAIN-world hook as ISOLATED
