import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

/**
 * Version label for a local build of commits not released yet: `0.2.0-dev (local a31e2a6)` instead of the last
 * release's number, so a reloaded unpacked build shows it is newer. WXT derives the manifest `version` from it (0.2.0).
 * Untouched in CI (the Prerelease workflow sets `X.Y.Z-devNNNN` itself; release builds keep `X.Y.Z`), for a
 * prerelease package.json version, and on a commit tagged with the package.json version.
 */
function localVersionName(): string | undefined {
  if (process.env.CI) return undefined;
  try {
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
    if (version.includes('-')) return undefined;
    const sh = (cmd: string) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const tags = sh('git tag --points-at HEAD').split('\n');
    if (tags.includes(`v${version}`)) return undefined;
    const next = sh('bash scripts/next-prerelease.sh').replace(/-dev.*$/, '');
    const dirty = sh('git status --porcelain --untracked-files=no') ? '+' : '';
    return `${next}-dev (local ${sh('git rev-parse --short HEAD')}${dirty})`;
  } catch {
    return undefined;
  }
}
const versionName = localVersionName();

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  // Tailwind v4 (shadcn-svelte) — imported only by the hub / popup pages; content scripts stay vanilla so nothing
  // bleeds into Crunchyroll's own pages.
  vite: () => ({ plugins: [tailwindcss()] }),
  // Targets: chrome, edge, brave (same MV3 build as chrome, own file name), firefox. `wxt zip -b <target>`; CI builds all four.
  manifest: ({ mode, browser }) => ({
    // Dev/unpacked Chromium loads only: the public key pins the extension ID (mlfpneomdkdbknkiihofllhhecpdopcl)
    // so the AniList redirect URL https://mlfpneomdkdbknkiihofllhhecpdopcl.chromiumapp.org/ never changes.
    // The Chrome Web Store rejects a manifest with `key` and assigns its own ID, so production
    // builds (`wxt build` / `wxt zip`) omit it.
    ...(mode === 'production' || browser === 'firefox' ? {} : { key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw0O4EJ59riwJMyq+BMfZ39Z1fATA2WcRcTU71zilf5YbZx5C2LuFNYcTo+e+rHHp2eAcFw5TPwh6+NRkNWaeVb+XwjTF1FH7E+a8hG4GrYP4x0dpIzh6hOGe7ELpdfMWvzDUkKMmsG8Zy+qBGbgPxSMgtBshGqPFWB0dySdGL+6YIt/P2TbE/4boKuzBWy96ZTChtdMp0L2tM51RveghGT6Nh2/d5HSrp5UPtTxKRAUe1QdM1c21L5KuIQXNuHyJZ5m8VUrl+p+gaUmfY3pu4YQEN5pc7wjGIa4SrgltyObQ7agZMB9mD5ccwFgeyIXw5RkGfAJBsXntPLJrs9KgfQIDAQAB' }),
    name: 'Crunchy+',
    // Firefox ignores version_name; Chromium shows it on the extensions page.
    ...(versionName && browser !== 'firefox' ? { version_name: versionName } : {}),
    description: 'Sub/dub modes, a modern Crunchyroll UI, and AniList sync + import.',
    permissions: ['storage', 'identity'],
    host_permissions: ['*://*.crunchyroll.com/*', 'https://graphql.anilist.co/*', 'https://api.typesafe.ai/*'],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'crunchy-plus@nylegarcia.github.io',
              // 128: `world: "MAIN"` content scripts in the manifest (cr-hook).
              strict_min_version: '128.0',
              // AMO requires a data-collection declaration for new submissions; nothing leaves the browser (PRIVACY.md).
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
  }),
  // Firefox's sources zip (for AMO review) needs the code, not the store kit, docs or local tooling.
  zip: { excludeSources: ['store/**', 'docs/**', 'public/undo/**', '*.zip', '.claude/**', '.agents/**'] },
});
