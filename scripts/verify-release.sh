#!/usr/bin/env bash
# Verify a published Crunchy+ release without trusting the maintainer's machine: download the zips from the GitHub
# release, check SHA256SUMS, verify the SLSA build-provenance attestation (GitHub Actions built them from the tagged
# commit), then rebuild the tag from source and diff the unpacked Chrome zip against it byte for byte.
#   scripts/verify-release.sh 0.2.0            # everything
#   scripts/verify-release.sh 0.2.0 --no-rebuild
# Needs gh (logged in or not — public repo), node 22+, npm, unzip. SECURITY.md / docs/ci.md.
set -euo pipefail
VERSION="${1:?usage: verify-release.sh <version> [--no-rebuild]}"
REBUILD=1; [ "${2:-}" = "--no-rebuild" ] && REBUILD=0
REPO="${REPO:-NyleGarcia/crunchy-plus}"
TAG="v$VERSION"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
ok() { echo "✔ $*"; }; warn() { echo "⚠ $*" >&2; }; fail() { echo "✖ $*" >&2; exit 1; }

echo "== $REPO $TAG → $WORK"
mkdir -p "$WORK/release" && cd "$WORK/release"
gh release download "$TAG" -R "$REPO" -p '*.zip' -p 'SHA256SUMS' 2>/dev/null || gh release download "$TAG" -R "$REPO" -p '*.zip'
ls -1

if [ -f SHA256SUMS ]; then
  sha256sum -c --quiet SHA256SUMS && ok "SHA256SUMS match"
else
  warn "no SHA256SUMS on this release (releases before 0.2.0 have none)"
fi

ATTESTED=0
for z in *.zip; do
  if gh attestation verify "$z" -R "$REPO" >/dev/null 2>&1; then ok "attestation: $z built by GitHub Actions from $REPO"; ATTESTED=1
  else warn "no valid attestation for $z (releases before 0.2.0 have none)"; fi
done

if [ "$REBUILD" = 1 ]; then
  CHROME=$(ls crunchy-plus-*-chrome.zip | head -1) || fail "no chrome zip"
  echo "== rebuilding $TAG from source"
  git clone -q --depth 1 --branch "$TAG" "https://github.com/$REPO.git" "$WORK/src"
  (cd "$WORK/src" && npm ci --silent && CI=1 npx wxt zip -b chrome >/dev/null 2>&1)
  mkdir -p "$WORK/a" "$WORK/b"
  unzip -qo "$CHROME" -d "$WORK/a"
  unzip -qo "$WORK/src/.output/"crunchy-plus-*-chrome.zip -d "$WORK/b"
  if diff -rq "$WORK/a" "$WORK/b"; then ok "reproducible: $CHROME is byte-identical to a fresh build of $TAG"
  else fail "rebuild differs from the released zip — open an issue with this output"; fi
fi
echo "== done"
