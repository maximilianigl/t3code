#!/usr/bin/env bash
# Inspect the desktop SSH-launch state on a remote machine: which runner each
# ssh-launch entry uses and what its server log says. This is the server the
# desktop app actually talks to for SSH environments (separate from the
# t3code boot service unit).
#
# Usage: scripts/check-ssh-launch.sh <ssh-host>
set -euo pipefail

host="${1:?usage: check-ssh-launch.sh <ssh-host>}"
ssh "$host" 'bash -s' <<'EOF'
set -uo pipefail
echo "== non-interactive environment =="
echo "PATH=$PATH"
echo "t3:   $(command -v t3 || echo '(not found)')"
echo "node: $(command -v node || echo '(not found)')"
echo "npx:  $(command -v npx || echo '(not found)')"
echo "sh -c t3: $(sh -c 'command -v t3' || echo '(not found)')"
echo
base="$HOME/.t3/ssh-launch"
if [ ! -d "$base" ]; then
  echo "(no ssh-launch state at $base)"
  exit 0
fi
for dir in "$base"/*/; do
  echo "== $dir =="
  ls -la "$dir" 2>/dev/null
  echo "-- run-t3.sh (t3 resolution lines) --"
  grep -E "T3_PACKAGE_SPEC|T3_NODE_SCRIPT_PATH|npx|exec t3|exec node" "$dir/run-t3.sh" 2>/dev/null | head -8
  echo "-- port/pid --"
  cat "$dir/port" 2>/dev/null || echo "(no port)"
  cat "$dir/pid" 2>/dev/null || echo "(no pid)"
  echo "-- server.log tail --"
  tail -n 25 "$dir/server.log" 2>/dev/null || echo "(no log)"
  echo
done
exit 0
EOF
