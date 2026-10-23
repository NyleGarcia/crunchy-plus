// Roll docs/changelog.md's "## Unreleased" entries into a version section (the release PR runs this, release.yml):
//   node scripts/roll-changelog.mjs 0.3.0 [2026-11-01]
// Leaves an empty "## Unreleased" on top; a no-op when there is nothing under it.
import { readFileSync, writeFileSync } from 'node:fs';

const [version, date = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+/.test(version ?? '')) {
  console.error('usage: node scripts/roll-changelog.mjs <version> [YYYY-MM-DD]');
  process.exit(2);
}
const file = 'docs/changelog.md';
const src = readFileSync(file, 'utf8');
const m = src.match(/^## Unreleased\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
if (!m) {
  console.error('no "## Unreleased" section');
  process.exit(1);
}
const body = m[1].replace(/\s+$/, '');
if (!body.trim()) {
  console.log('nothing to roll');
  process.exit(0);
}
if (src.includes(`\n## ${version} —`)) {
  console.log(`${version} already has a section`);
  process.exit(0);
}
const rolled = src.replace(m[0], `## Unreleased\n\n## ${version} — ${date}\n${body}\n\n`).replace(/^updated: .*$/m, `updated: ${date}`);
writeFileSync(file, rolled);
console.log(`rolled ${body.split('\n').filter((l) => l.startsWith('- ')).length} entries into ${version} — ${date}`);
