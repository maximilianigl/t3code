#!/usr/bin/env bash
# Deploy this fork's t3 server build to a remote machine's boot service.
#
# The stock `t3 service install/update` flow installs the pinned runtime with
# `npm install t3@<version>` from the public npm registry, which would fetch
# the upstream package instead of this fork. This script pre-seeds the pinned
# runtime directory (~/.t3/runtime/versions/<version>) with the fork tarball —
# the boot service sees a completed install for that version and skips npm —
# then runs `service install` from the fork binary itself so the systemd unit,
# launcher, and active version all point at the fork.
#
# Usage: scripts/deploy-fork-server.sh <ssh-host>
#
# Prereqs: `vp run --filter t3 build` and `node scripts/pack-fork-server.mjs`
# have run, and the remote has node >= 22.16 and npm on PATH.
set -euo pipefail

host="${1:?usage: deploy-fork-server.sh <ssh-host>}"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p "require('$repo_root/apps/server/package.json').version")"
tarball="$repo_root/release/t3-$version.tgz"

if [[ ! -f "$tarball" ]]; then
  echo "Missing $tarball — build it first:" >&2
  echo "  vp run --filter t3 build && node scripts/pack-fork-server.mjs" >&2
  exit 1
fi

echo "Deploying t3@$version to $host"
scp "$tarball" "$host:/tmp/t3-$version.tgz"
ssh "$host" "VERSION=$version bash -s" <<'EOF'
set -euo pipefail
dir="$HOME/.t3/runtime/versions/$VERSION"
# A previous partial deploy of the same fork version must not survive as a
# plausible-looking runtime; the sentinel is only written after npm exits 0.
rm -rf "$dir"
mkdir -p "$dir"
npm install --prefix "$dir" --no-fund --no-audit "/tmp/t3-$VERSION.tgz"
printf '%s\n' "$VERSION" > "$dir/.install-complete"
node "$dir/node_modules/t3/dist/bin.mjs" service install
node "$dir/node_modules/t3/dist/bin.mjs" service status
rm -f "/tmp/t3-$VERSION.tgz"
EOF
echo "Done. The remote service now runs t3@$version."
