#!/usr/bin/env bash
# Fit raw screenshots to the Chrome Web Store size (1280x800, no alpha).
# Usage: store/frame.sh store/raw/*.png   -> store/screenshots/<name>.png
set -euo pipefail
out=store/screenshots
mkdir -p "$out"
for f in "$@"; do
  n=$(basename "${f%.*}")
  magick "$f" -resize 1280x800^ -gravity north -extent 1280x800 -background '#141418' -alpha remove -strip "$out/$n.png"
  echo "$out/$n.png"
done
