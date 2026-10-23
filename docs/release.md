---
title: Release and Web Store publishing
tags: [release, ci, chrome-web-store]
updated: 2026-10-22
---
# Release and Web Store publishing

## Flow
1. Work lands on `dev` (every push → CI + Security + a `vX.Y.Z-devNNNN` GitHub prerelease with all zips, `.github/workflows/prerelease.yml`).
2. PR `dev` → `main`, merge. `release-please` (`.github/workflows/release.yml`) opens *chore(main): release X.Y.Z* from the conventional commits (minor bump for `feat`, patch for `fix`, pre-1.0). The `changelog` job then commits `scripts/roll-changelog.mjs X.Y.Z` onto that PR: `docs/changelog.md`'s *Unreleased* entries (the hand-written, user-facing log) move under `## X.Y.Z — date`; root `CHANGELOG.md` is release-please's commit-derived one. Write user-facing entries under *Unreleased* on `dev`; never add a version heading by hand. The bot's commits never trigger CI, so the release PR has no `verify` check — merge it as is.
3. Merge that PR → the `vX.Y.Z` GitHub release gets `crunchy-plus-X.Y.Z-{chrome,edge,brave,firefox}.zip` (+ `-sources.zip`), each with a SLSA provenance attestation, plus `SHA256SUMS` (`scripts/verify-release.sh X.Y.Z` checks them and rebuilds — [CI and security checks](ci.md)), e.g. `https://github.com/NyleGarcia/crunchy-plus/releases/download/vX.Y.Z/crunchy-plus-X.Y.Z-chrome.zip`.
4. The `publish` job then submits the Chrome zip to the Chrome Web Store (`npx wxt submit --chrome-api-version v2`, [publish-browser-extension](https://github.com/aklinker1/publish-browser-extension)); Google's review still applies. Without the secrets below it only warns. **Only mainline releases go to the Web Store**; dev prereleases are GitHub-only.

Repo settings this needs: *Actions → General → Allow GitHub Actions to create and approve pull requests* (release-please fails with "GitHub Actions is not permitted to create or approve pull requests" otherwise — hit 2026-10-22), and `dev` as the default branch (Scorecard scores it; `release-please` is pinned to `target-branch: main` so it does not care).

## One-time setup (Chrome Web Store API v2)
API v2 authenticates as a **Google Cloud service account** the developer dashboard trusts, and addresses the item by **publisher id** (dashboard → Account) and item id. Crunchy+ shares the Google Cloud project `rsi-plus-publish` (number 109799804481) and the service account `webstore-publisher@rsi-plus-publish.iam.gserviceaccount.com` with RSI+ — same developer account, same publisher id — and has its own Workload Identity Federation provider `crunchy-plus` (restricted to this repo). Set up 2026-10-22.

1. `gcloud auth login` (local SDK: `~/google-cloud-sdk/bin`), then `bash scripts/webstore-setup.sh` to (re)create the provider and binding; it prints the service account email (already listed in the dashboard → Account → Service accounts) and the GitHub variables.
2. GitHub: repository variables `GCP_WORKLOAD_IDENTITY_PROVIDER` (`projects/109799804481/locations/global/workloadIdentityPools/github/providers/crunchy-plus`) and `GCP_SERVICE_ACCOUNT`; environment `chrome-web-store` secrets `CHROME_PUBLISHER_ID` and `CHROME_EXTENSION_ID` (the Web Store item id — the first upload of a new item is done by hand in the dashboard; the API only updates). A required reviewer on the environment gates each publish (none set yet — add one under *Settings → Environments → chrome-web-store* to approve each store submit by hand).
3. Local check: `source scripts/webstore-token.sh && CHROME_EXTENSION_ID=<item id> CHROME_PUBLISHER_ID=<publisher id> npx wxt submit --dry-run --chrome-api-version v2 --chrome-zip .output/crunchy-plus-X.Y.Z-chrome.zip` (one-hour token for the service account through your gcloud login).

## Notes
- Nothing secret is needed locally: the service account is impersonated through your own gcloud login. Ids live in the GitHub environment (and the 1Password Environment `rsi-plus` holds the publisher id) — never in a plain env file.
- Release zips are production builds without the pinned manifest `key`, so the store item id differs from the dev id `mlfpneomdkdbknkiihofllhhecpdopcl` (docs/architecture.md).
