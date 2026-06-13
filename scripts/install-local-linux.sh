#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This installer is only for Linux." >&2
  exit 1
fi

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required to install the generated .deb." >&2
  exit 1
fi

git fetch origin main
git checkout main
git pull --ff-only origin main

pnpm install --frozen-lockfile
pnpm tauri build --bundles deb --no-sign --config '{"bundle":{"createUpdaterArtifacts":false}}'

deb_path="$(
  find src-tauri/target/release/bundle/deb -maxdepth 1 -type f -name "*.deb" -printf "%T@ %p\n" \
    | sort -nr \
    | head -n 1 \
    | cut -d " " -f 2-
)"

if [[ -z "$deb_path" ]]; then
  echo "No .deb package was produced." >&2
  exit 1
fi

sudo apt install --reinstall -y "./$deb_path"
echo "Installed $deb_path"
