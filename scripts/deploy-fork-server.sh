#!/usr/bin/env bash
# Deploy this fork's t3 server build to a remote machine's boot service.
#
# The stock `t3 service install/update` flow installs the pinned runtime with
# `npm install t3@<version>` from the public npm registry, which would fetch
# the upstream package instead of this fork. This script pre-seeds the pinned
# runtime directory (~/.t3/runtime/versions/<version>) with the fork's
# self-contained CLI archive, then runs `service install` from that executable
# so the systemd unit, launcher, and active version all point at the fork. The
# npm tarball is still installed globally for Desktop SSH launchers.
#
# Usage: scripts/deploy-fork-server.sh <ssh-host>
#
# Prereqs: the server, npm tarball, and target CLI archive have been built, and
# the remote has node >= 22.16 and npm on PATH.
set -euo pipefail

host="${1:?usage: deploy-fork-server.sh <ssh-host>}"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p "require('$repo_root/apps/server/package.json').version")"
tarball="$repo_root/release/t3-$version.tgz"

remote_platform="$(ssh "$host" 'case "$(uname -s)" in Darwin) echo mac ;; Linux) echo linux ;; *) exit 1 ;; esac')"
remote_arch="$(ssh "$host" 'case "$(uname -m)" in arm64|aarch64) echo arm64 ;; x86_64|amd64) echo x64 ;; *) exit 1 ;; esac')"
archive_name="t3-$version-$remote_platform-$remote_arch.tar.gz"
archive="$repo_root/release/$archive_name"

if [[ ! -f "$tarball" ]]; then
  echo "Missing $tarball — build it first:" >&2
  echo "  vp run --filter t3 build && node scripts/pack-fork-server.mjs" >&2
  exit 1
fi
if [[ ! -f "$archive" ]]; then
  echo "Missing $archive — build the target executable and CLI archive first." >&2
  exit 1
fi

echo "Deploying t3@$version to $host"
scp "$tarball" "$archive" "$host:/tmp/"
ssh "$host" "VERSION=$version ARCHIVE_NAME=$archive_name bash -s" <<'EOF'
set -euo pipefail
# The desktop app's SSH environments launch their own server via
# ~/.t3/ssh-launch/<key>/run-t3.sh, which runs `t3` from PATH when present and
# otherwise falls back to `npx t3@<client version>` — a registry fetch that
# 404s for fork versions. A global install of the fork tarball keeps that
# `command -v t3` hook pointing at the fork.
npm install -g --no-fund --no-audit "/tmp/t3-$VERSION.tgz"
hash -r 2>/dev/null || true
echo "global t3: $(command -v t3 || echo '(not on this shell PATH)') -> $(t3 --version 2>/dev/null || true)"

versions="$HOME/.t3/runtime/versions"
dir="$versions/$VERSION"
mkdir -p "$versions"
staging="$(mktemp -d "$versions/.staging-$VERSION-XXXXXX")"
trap 'rm -rf "$staging"' EXIT
tar -xzf "/tmp/$ARCHIVE_NAME" -C "$staging" --strip-components=1
# A Linux archive cross-built on macOS cannot compile node-pty. The global npm
# install above builds it on the target host, so reuse that native output when
# the archive does not already contain one.
global_node_pty="$(npm root -g)/t3/node_modules/node-pty"
if [ ! -f "$staging/node_modules/node-pty/build/Release/pty.node" ] && [ -d "$global_node_pty/build" ]; then
  mkdir -p "$staging/node_modules/node-pty/build"
  cp -R "$global_node_pty/build/Release" "$staging/node_modules/node-pty/build/"
fi
"$staging/t3" --version | grep -F "t3 v$VERSION"
printf '%s\n' "$VERSION" > "$staging/.install-complete"
rm -rf "$dir"
mv "$staging" "$dir"
trap - EXIT
"$dir/t3" service install
"$dir/t3" service status
rm -f "/tmp/t3-$VERSION.tgz" "/tmp/$ARCHIVE_NAME"
EOF
echo "Done. The remote service now runs t3@$version."
