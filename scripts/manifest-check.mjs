// Guards the built manifests against permission creep and remote code — run after `wxt build` (-b firefox too):
//   node scripts/manifest-check.mjs .output/chrome-mv3/manifest.json .output/firefox-mv2/manifest.json
// Every permission must be on the allowlist, hosts must stay on Crunchyroll + the AniList GraphQL API + the optional
// TypeSafe (Jev) API, content scripts only on crunchyroll.com, no CSP loosening (unsafe-eval / remote script sources),
// no http:// or other third-party URLs anywhere. Adding a permission or host is a deliberate change: extend the
// allowlist here in the same commit (and say why in wxt.config.ts). docs/ci.md.
import { readFileSync } from 'node:fs';

const PERMISSIONS = new Set(['storage', 'unlimitedStorage', 'identity']);
const HOSTS = new Set(['*://*.crunchyroll.com/*', 'https://graphql.anilist.co/*', 'https://api.typesafe.ai/*']);
const CONTENT_SCRIPT_HOSTS = ['*://www.crunchyroll.com/', '*://static.crunchyroll.com/'];
const URL_ALLOW = /^https:\/\/(graphql\.anilist\.co|api\.typesafe\.ai|([a-z0-9-]+\.)*crunchyroll\.com)\//;
const BAD_CSP = /unsafe-eval|wasm-unsafe-eval|http:|https:\/\/(?!([a-z0-9-]+\.)*crunchyroll\.com)/;

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node scripts/manifest-check.mjs <manifest.json>...');
  process.exit(2);
}

let failed = false;
const fail = (file, msg) => {
  failed = true;
  console.error(`✖ ${file}: ${msg}`);
};

for (const file of files) {
  const m = JSON.parse(readFileSync(file, 'utf8'));
  const perms = m.permissions ?? [];
  const hosts = m.manifest_version === 2 ? perms.filter((p) => p.includes('/')) : (m.host_permissions ?? []);
  for (const p of perms.filter((p) => !p.includes('/'))) if (!PERMISSIONS.has(p)) fail(file, `permission not on the allowlist: ${p}`);
  for (const h of hosts) if (!HOSTS.has(h)) fail(file, `host permission not on the allowlist: ${h}`);
  for (const k of ['optional_permissions', 'optional_host_permissions']) if (m[k]?.length) fail(file, `${k} set: ${m[k].join(', ')}`);
  for (const cs of m.content_scripts ?? [])
    for (const pat of [...(cs.matches ?? []), ...(cs.exclude_matches ?? [])])
      if (!CONTENT_SCRIPT_HOSTS.some((h) => pat.startsWith(h))) fail(file, `content script match outside crunchyroll.com: ${pat}`);
  for (const war of m.web_accessible_resources ?? [])
    for (const pat of war.matches ?? [])
      if (!CONTENT_SCRIPT_HOSTS.some((h) => pat.startsWith(h))) fail(file, `web_accessible_resources match outside crunchyroll.com: ${pat}`);
  const csp = m.content_security_policy;
  const csps = typeof csp === 'string' ? [csp] : Object.values(csp ?? {});
  for (const c of csps) if (BAD_CSP.test(c)) fail(file, `content_security_policy loosened: ${c}`);
  if (m.externally_connectable) fail(file, 'externally_connectable set');
  const text = JSON.stringify(m);
  if (/http:\/\//.test(text)) fail(file, 'plain http:// URL in manifest');
  for (const url of text.match(/https:\/\/[^"\s]+/g) ?? [])
    if (!URL_ALLOW.test(url)) fail(file, `third-party URL in manifest: ${url}`);
  if (!failed) console.log(`✔ ${file}: ${perms.length} permissions, hosts ${[...hosts].join(', ')}`);
}

process.exit(failed ? 1 : 0);
