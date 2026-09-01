#!/usr/bin/env bash
# Terminate t3 servers on a remote machine that are NOT the t3code systemd
# unit, along with the provider (codex) processes they spawned. Leaves the
# unit's cgroup and unrelated processes (including codex's own global
# app-server daemon) alone.
#
# Usage: scripts/kill-stale-t3-servers.sh <ssh-host>
set -euo pipefail

host="${1:?usage: kill-stale-t3-servers.sh <ssh-host>}"
ssh "$host" 'bash -s' <<'EOF'
set -uo pipefail
unit_cgroup="$(systemctl --user show t3code -p ControlGroup --value 2>/dev/null | sed 's|^/||')"
unit_pids=" $(cat "/sys/fs/cgroup/$unit_cgroup/cgroup.procs" 2>/dev/null | tr '\n' ' ') "

# t3 servers in any launch shape: bundled dist entry, npx cache .bin shim,
# global bin, `t3 serve`.
mapfile -t candidates < <(ps -eo pid=,args= \
  | grep -E "t3/dist/bin\.mjs|node_modules/t3/dist|node_modules/\.bin/t3 |/bin/t3 serve|t3 serve --" \
  | grep -vE "grep|kill-stale" | awk '{print $1}')

killed=0
for pid in "${candidates[@]:-}"; do
  [ -z "$pid" ] && continue
  case "$unit_pids" in *" $pid "*) continue ;; esac
  echo "killing stale t3 server pid=$pid: $(ps -o args= -p "$pid" | cut -c1-160)"
  # Children (codex app-servers etc.) first, then the server.
  for child in $(ps -eo pid=,ppid= | awk -v p="$pid" '$2==p {print $1}'); do
    pkill -TERM -P "$child" 2>/dev/null || true
    kill -TERM "$child" 2>/dev/null || true
  done
  kill -TERM "$pid" 2>/dev/null || true
  killed=1
done

sleep 3
# Codex app-servers whose t3 MCP endpoint points at a port nothing serves
# anymore are leftovers of a killed server; sweep them and their descendants.
for pid in $(pgrep -f 'codex app-server -c mcp_servers\.t3-code\.url' 2>/dev/null); do
  case "$unit_pids" in *" $pid "*) continue ;; esac
  ppid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
  if [ -z "$ppid" ] || [ "$ppid" = "1" ]; then
    echo "killing orphaned codex app-server pid=$pid"
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    killed=1
  fi
done

sleep 2
echo
echo "== remaining t3/codex processes =="
ps -eo pid,ppid,etime,args | grep -E "node_modules/\.bin/t3 |t3/dist/bin\.mjs|t3 serve|codex app-server" \
  | grep -vE "grep|kill-stale" | cut -c1-200 || true
[ "$killed" -eq 0 ] && echo "(nothing needed killing)"
exit 0
EOF
