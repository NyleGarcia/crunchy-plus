# Security

Crunchy+ runs entirely in your browser and talks to three hosts: crunchyroll.com (the site it improves), the AniList GraphQL API (your list) and, only if you enter your own key, the TypeSafe API ([PRIVACY.md](PRIVACY.md)). It handles your Crunchyroll session token and an AniList OAuth token, so it is held to that standard.

## Reporting a vulnerability
- Preferred: [GitHub private vulnerability report](https://github.com/NyleGarcia/crunchy-plus/security/advisories/new) — only the maintainer sees it.
- Or a GitHub issue for anything that is not exploitable (hardening ideas, a permission that looks wider than needed).
- Expect an acknowledgement within 72 hours and a fix release for confirmed issues within 14 days; the advisory is published with the fix. Please do not test against accounts you do not own.

## Supported versions
The latest release on the Chrome Web Store / GitHub releases. Older versions get no backports — update.

## What is checked on every change
`.github/workflows/security.yml` ([docs/ci.md](docs/ci.md)): CodeQL on the code and the workflow files, `npm audit`, dependency review on PRs, gitleaks, and an extension audit — the built manifests must stay on the permission / host allowlist (`scripts/manifest-check.mjs`), no `eval` / `new Function` in the bundle, Mozilla's `web-ext lint` clean of errors. Actions are pinned by commit SHA; Dependabot bumps dependencies weekly; OpenSSF Scorecard grades the repo.

## Verifying a release
Every release zip from 0.2.0 on carries a SLSA build-provenance attestation (signed statement that GitHub Actions built it from the tagged commit) and a `SHA256SUMS` file:
```sh
scripts/verify-release.sh 0.2.0            # checksums + attestation + rebuild and diff
gh attestation verify crunchy-plus-0.2.0-chrome.zip -R NyleGarcia/crunchy-plus   # attestation alone
```
The zip submitted to the Chrome Web Store is the same CI artifact that is attached to the GitHub release ([docs/release.md](docs/release.md)).

## Design notes a reviewer should know
- Hosts: content scripts run only on `www.crunchyroll.com` / `static.crunchyroll.com`; `host_permissions` are `*://*.crunchyroll.com/*`, `https://graphql.anilist.co/*` and `https://api.typesafe.ai/*`. No analytics, no remote code, no other endpoints — Crunchyroll's own Datadog / Braze / Segment telemetry is stubbed in-page.
- Permissions: `storage` (settings, caches, AniList token) and `identity` (the AniList OAuth flow) — why each is needed is in `wxt.config.ts` and the store listing.
- The Crunchyroll session token is read from the page's own requests and used from the background only against Crunchyroll's API; the AniList token stays in extension storage. Uninstalling deletes everything.
- Writes happen only from actions you take: AniList progress after the episode threshold you set, "+ Plan", and the hub's import / export, which preview first and can be undone. Nothing is sent to TypeSafe unless you entered a key.
