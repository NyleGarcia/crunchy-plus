---
title: CI and security checks
tags: [ci, security]
updated: 2026-10-22
---
# CI and security checks

Three workflows on every push to `main` / `dev` and every PR; release flow in [release and Web Store publishing](release.md). Same setup as RSI+ (its `docs/ci.md` is the reference when the two drift).

| Workflow | Job | What fails it |
|---|---|---|
| CI (`ci.yml`) | `verify` | `svelte-check` errors, failing vitest |
| CI | `zip` | a browser target that does not build (chrome, edge, brave, firefox) |
| Security (`security.yml`) | `codeql` | CodeQL `security-and-quality` findings for JS/TS and for the workflow files (results under *Security → Code scanning*) |
| Security | `audit` | `npm audit`: moderate+ in shipped deps, high+ anywhere |
| Security | `dependency-review` (PRs) | a PR adding a dependency with a high+ advisory or a denied license |
| Security | `secrets` | gitleaks finds a credential anywhere in history |
| Security | `extension` | built manifest off the allowlist (`scripts/manifest-check.mjs`), `eval` / `new Function` in the bundle, `web-ext lint` errors |
| Scorecard (`scorecard.yml`) | `scorecard` | never fails; publishes the OpenSSF score (README badge) and its findings to Code scanning. Runs on `dev` (the default branch — the score is taken there), `main` and weekly |

Security also runs weekly (Monday 06:17 UTC) so new advisories get caught against unchanged code, and on *Actions → Security → Run workflow*.

## Extension audit
`scripts/manifest-check.mjs` reads the built manifests (`npx wxt build`, `npx wxt build -b firefox`) and fails on: a permission outside `storage, identity`; a host permission other than `*://*.crunchyroll.com/*`, `https://graphql.anilist.co/*`, `https://api.typesafe.ai/*`; a content-script or `web_accessible_resources` match outside `www.` / `static.crunchyroll.com`; any optional permissions; `externally_connectable`; a CSP with `unsafe-eval` or remote script sources; any `http://` or other third-party URL in the manifest. Adding a permission or host is deliberate: extend the allowlist in the script in the same commit and say why in `wxt.config.ts`.

`web-ext lint` (Mozilla's add-on linter, the AMO review tool) fails the job on errors. Its warnings are reported, not fatal: the `innerHTML` warnings come from Svelte's runtime cloning static templates (app code never assigns `innerHTML`), and the manifest-key warnings are the AMO data-collection key against the Firefox minimum version.

## Supply chain
Every `uses:` in the workflows is pinned to a commit SHA with the version in a comment (`actions/checkout@fbc6…  # v5.1.0`); Dependabot's `github-actions` updates move the SHA and the comment together. A moving tag (`@v5`) can be re-pointed by whoever controls the action's repo; a SHA cannot.

Release zips carry SLSA build provenance (`actions/attest-build-provenance` in the `assets` job, verifiable with `gh attestation verify <zip> -R NyleGarcia/crunchy-plus`) and the release gets a `SHA256SUMS` (`checksums` job). `scripts/verify-release.sh <version>` downloads the release, checks both, clones the tag, runs `npm ci && npx wxt zip -b chrome` and diffs the unpacked zips (RSI+ builds proved byte-identical across Node 22 / 24; run it on the first Crunchy+ release that has sums). `SECURITY.md` holds the reporting policy.

## Dependabot
`.github/dependabot.yml`: weekly npm and GitHub Actions bumps, minor/patch grouped into one PR each, so CI and Security run once per batch. Turn on secret scanning + push protection and Dependabot security updates in the repo settings as well.

## Local
```sh
npm audit --omit=dev --audit-level=moderate && npm audit --audit-level=high
npx wxt build && npx wxt build -b firefox
node scripts/manifest-check.mjs .output/chrome-mv3/manifest.json .output/firefox-mv2/manifest.json
npx --yes web-ext lint --source-dir .output/firefox-mv2 --no-config-discovery
```
