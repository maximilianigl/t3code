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
exit 0
EOF
