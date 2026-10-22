---
title: Release and Web Store publishing
tags: [release, ci, chrome-web-store]
updated: 2026-10-22
---
# Release and Web Store publishing

## Flow
1. `release-please` (`.github/workflows/release.yml`, on push to `main`) opens *chore(main): release X.Y.Z* from the conventional commits (minor bump for `feat`, patch for `fix`, pre-1.0). Its bot commit never triggers CI, so the PR's required `verify` check needs a normal commit on its branch or an admin merge.
2. Merge it → the `vX.Y.Z` GitHub release gets `crunchy-plus-X.Y.Z-{chrome,edge,brave,firefox}.zip` (+ `-sources.zip`), e.g. `https://github.com/NyleGarcia/crunchy-plus/releases/download/vX.Y.Z/crunchy-plus-X.Y.Z-chrome.zip`.
3. The `publish` job then submits the Chrome zip to the Chrome Web Store (`npx wxt submit --chrome-api-version v2`, [publish-browser-extension](https://github.com/aklinker1/publish-browser-extension)); Google's review still applies. Without the secrets below it only warns. **Only mainline releases go to the Web Store**; dev prereleases (`prerelease.yml`) are GitHub-only.

## One-time setup (Chrome Web Store API v2)
API v2 authenticates as a **Google Cloud service account** the developer dashboard trusts, and addresses the item by **publisher id** (dashboard → Account) and item id. Crunchy+ shares the Google Cloud project `rsi-plus-publish` (number 109799804481) and the service account `webstore-publisher@rsi-plus-publish.iam.gserviceaccount.com` with RSI+ — same developer account, same publisher id — and has its own Workload Identity Federation provider `crunchy-plus` (restricted to this repo). Set up 2026-10-22.

1. `gcloud auth login` (local SDK: `~/google-cloud-sdk/bin`), then `bash scripts/webstore-setup.sh` to (re)create the provider and binding; it prints the service account email (already listed in the dashboard → Account → Service accounts) and the GitHub variables.
2. GitHub: repository variables `GCP_WORKLOAD_IDENTITY_PROVIDER` (`projects/109799804481/locations/global/workloadIdentityPools/github/providers/crunchy-plus`) and `GCP_SERVICE_ACCOUNT`; environment `chrome-web-store` secrets `CHROME_PUBLISHER_ID` and `CHROME_EXTENSION_ID` (the Web Store item id — the first upload of a new item is done by hand in the dashboard; the API only updates). A required reviewer on the environment gates each publish.
3. Local check: `source scripts/webstore-token.sh && CHROME_EXTENSION_ID=<item id> CHROME_PUBLISHER_ID=<publisher id> npx wxt submit --dry-run --chrome-api-version v2 --chrome-zip .output/crunchy-plus-X.Y.Z-chrome.zip` (one-hour token for the service account through your gcloud login).

## Notes
- Nothing secret is needed locally: the service account is impersonated through your own gcloud login. Ids live in the GitHub environment (and the 1Password Environment `rsi-plus` holds the publisher id) — never in a plain env file.
- Release zips are production builds without the pinned manifest `key`, so the store item id differs from the dev id `mlfpneomdkdbknkiihofllhhecpdopcl` (docs/architecture.md).
