#!/usr/bin/env bash
# Report the state of the t3 boot service on a remote machine: unit health,
# active pinned version, and any t3 server processes running OUTSIDE the
# systemd unit (manually launched `npx t3`, stale old versions, ...).
#
# Usage: scripts/check-fork-server.sh <ssh-host>
set -euo pipefail

host="${1:?usage: check-fork-server.sh <ssh-host>}"
ssh "$host" 'bash -s' <<'EOF'
set -uo pipefail
echo "== host =="
hostname
echo
echo "== unit =="
systemctl --user is-active t3code || true
main_pid="$(systemctl --user show t3code -p MainPID --value 2>/dev/null || echo 0)"
echo "MainPID: $main_pid"
echo
echo "== active version (service-state.json) =="
cat "$HOME/.t3/runtime/service-state.json" 2>/dev/null || echo "(no state file)"
echo
echo "== installed pinned runtimes =="
ls "$HOME/.t3/runtime/versions/" 2>/dev/null || echo "(none)"
echo
echo "== t3 server processes =="
# Every process in the unit's cgroup is legitimate (server + its children).
unit_pids="$(systemctl --user show t3code -p ControlGroup --value 2>/dev/null | sed 's|^/||')"
if [ -n "$unit_pids" ]; then
  in_unit="$(cat "/sys/fs/cgroup/$unit_pids/cgroup.procs" 2>/dev/null | tr '\n' ' ')"
else
  in_unit=""
fi
echo "unit cgroup PIDs: ${in_unit:-'(none)'}"
echo
echo "== t3-looking processes outside the unit =="
found=0
while read -r pid args; do
  case " $in_unit " in
    *" $pid "*) ;; # inside the unit: fine
    *)
      echo "STRAY pid=$pid: $args"
      found=1
      ;;
  esac
done < <(ps -eo pid=,args= | grep -E "t3/dist/bin\.mjs|node_modules/t3/dist|service-launcher\.mjs|npx t3|npm exec t3" | grep -v grep | awk '{pid=$1; $1=""; print pid, $0}')
[ "$found" -eq 0 ] && echo "(none — only the systemd unit is running t3)"
echo
echo "== suspect t3 parents (processes that spawned provider CLIs) =="
for ppid in $(ps -eo ppid=,args= | grep -E "codex|claude|cursor-agent|opencode" | grep -vE "grep|check-fork" | awk '{print $1}' | sort -u); do
  ps -o pid=,ppid=,etime=,args= -p "$ppid" 2>/dev/null | cut -c1-220
done
echo
echo "== listeners on t3-ish ports =="
ss -tlnp 2>/dev/null | grep -E ":(3774|3775|40219)\b" || echo "(none)"
echo
echo "== provider CLI processes (codex/claude/agents) with parentage =="
ps -eo pid,ppid,etime,args | grep -E "codex|claude|cursor-agent|opencode" | grep -vE "grep|check-fork" | head -15 || true
echo
echo "== sockets of t3 processes (listening + established) =="
pids="$(pgrep -f "t3/dist/bin.mjs|node_modules/t3/dist|service-launcher" | tr '\n' ',' | sed 's/,$//')"
if [ -n "$pids" ]; then
  ss -tnp 2>/dev/null | grep -E "pid=(${pids//,/|pid=})" | head -15 || echo "(no sockets)"
else
  echo "(no t3 processes)"
fi
echo
echo "== relay tunnel activity (last 40 log lines) =="
tail -n 400 "$HOME/.t3/userdata/logs/boot-service.log" 2>/dev/null \
  | grep -iE "tunnel|relay|error|fail" | tail -n 40 || echo "(no log)"
echo
echo "== recent server log (errors/relay/connect) =="
latest_log="$(ls -t "$HOME"/.t3/userdata/logs/*.log 2>/dev/null | grep -v boot-service | head -1)"
if [ -n "$latest_log" ]; then
  echo "file: $latest_log"
  tail -n 300 "$latest_log" | grep -iE "error|relay|connect|update|version" | tail -n 25
else
  echo "(no server log found; unit journal follows)"
  journalctl --user -u t3code --no-pager -n 25 2>/dev/null || true
fi
exit 0
EOF
