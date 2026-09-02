#!/bin/bash
# Restart the Skippy runner LaunchAgent safely — including from a harness
# session the runner itself spawned (docs/mac-mini-agent-workbench.md).
#
# Incident 2026-09-02: a web-chat turn ran `launchctl bootout … ; sleep 2 ;
# launchctl bootstrap …` to pick up a fresh build. The harness executing that
# command is a CHILD of the runner, so:
#   1. bootout SIGTERMs the runner, which drains before exiting — and the work
#      it is draining is the very chat turn running the command. Deadlock.
#   2. launchd tears down the job's whole process group, killing the harness
#      mid-command, so the turn never reports a result and strands its lease.
#   3. bootout UNLOADS the job, and the bootstrap two seconds later fails
#      because the old process is still draining. The runner stays dead until
#      a human bootstraps it from a terminal. This happened three times in
#      under an hour.
#
# This script avoids all three:
#   - it never calls bootout, so the job stays loaded and launchd owns the
#     relaunch (KeepAlive + `kickstart -k`);
#   - it detaches the actual restart into its own session (setsid via node's
#     `detached`), so killing the caller's process group cannot kill it;
#   - it returns IMMEDIATELY, so the requesting turn finishes and reports its
#     result before the restart lands.
#
# Usage:
#   apps/runner/scripts/restart-runner.sh [--delay SECONDS]
#   apps/runner/scripts/restart-runner.sh --wait      # block until healthy
#                                                     # (terminal use ONLY —
#                                                     # never from a chat turn)
#
# Outcome is appended to ~/Library/Logs/skippy-runner-restart.log; the caller
# cannot wait for it, so read that file (or the runner log) afterwards.
set -euo pipefail

LABEL="com.skippy.runner"
DOMAIN="gui/$(id -u)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"
RUNNER_LOG="$LOG_DIR/skippy-runner.log"
RESTART_LOG="$LOG_DIR/skippy-runner-restart.log"
# Grace period before the kill lands, so the turn that requested the restart
# can finish its reply and release its lease first.
DELAY="${SKIPPY_RESTART_DELAY_SECONDS:-15}"
MODE="detach"

while [ $# -gt 0 ]; do
  case "$1" in
    --delay) DELAY="$2"; shift 2 ;;
    --wait) MODE="wait"; shift ;;
    --exec) MODE="exec"; shift ;;   # internal: the detached child
    -h|--help) sed -n '2,34p' "$0"; exit 0 ;;
    *) echo "error: unknown argument $1" >&2; exit 2 ;;
  esac
done

stamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
note() { echo "[restart-runner $(stamp)] $*"; }

job_loaded() { launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }
job_pid() { launchctl print "$DOMAIN/$LABEL" 2>/dev/null | awk -F'= ' '/^\tpid = /{print $2; exit}'; }

# The actual restart. Runs either in the detached child (--exec) or inline
# (--wait), never in a runner-owned harness's own process group.
do_restart() {
  note "restart requested (delay ${DELAY}s, caller pid $PPID)"
  if [ "$DELAY" -gt 0 ]; then sleep "$DELAY"; fi

  local before after waited log_mark
  before="$(job_pid || true)"
  # Mark where the runner log ends now, so the health check can only match a
  # "runner ready" line written by the NEW process. Matching the tail outright
  # reports success against the previous boot's line.
  log_mark="$(wc -l <"$RUNNER_LOG" 2>/dev/null || echo 0)"
  if job_loaded; then
    # kickstart -k: launchd SIGTERMs the job (the runner drains in-flight work,
    # then exits) and relaunches it. Deliberately NOT bootout — an unloaded job
    # has nobody to bring it back.
    note "kickstart -k $DOMAIN/$LABEL (pid before: ${before:-none})"
    launchctl kickstart -k "$DOMAIN/$LABEL" 2>&1 | sed 's/^/  /' || note "kickstart returned $?"
  else
    # Job is unloaded — the state a previous bootout left behind. Bootstrap is
    # the only way back.
    note "job not loaded; bootstrapping from $PLIST"
    launchctl bootstrap "$DOMAIN" "$PLIST" 2>&1 | sed 's/^/  /' || note "bootstrap returned $?"
  fi

  # Health check: a NEW pid, plus a fresh "runner ready" line in the runner log.
  waited=0
  while [ "$waited" -lt 90 ]; do
    after="$(job_pid || true)"
    if [ -n "$after" ] && [ "$after" != "$before" ]; then
      if tail -n "+$((log_mark + 1))" "$RUNNER_LOG" 2>/dev/null | grep -q "runner ready"; then
        note "healthy: pid $after, runner ready"
        return 0
      fi
    fi
    sleep 3
    waited=$((waited + 3))
  done
  note "UNHEALTHY after ${waited}s: pid=${after:-none}; check $RUNNER_LOG"
  return 1
}

case "$MODE" in
  exec)
    do_restart >>"$RESTART_LOG" 2>&1
    ;;
  wait)
    do_restart
    ;;
  detach)
    mkdir -p "$LOG_DIR"
    # `detached: true` calls setsid(2), so the child leaves the caller's process
    # group. When launchd tears the runner's group down, this survives.
    node -e '
      const { spawn } = require("node:child_process");
      const fs = require("node:fs");
      const out = fs.openSync(process.argv[1], "a");
      spawn(process.argv[2], process.argv.slice(3), {
        detached: true,
        stdio: ["ignore", out, out],
      }).unref();
    ' "$RESTART_LOG" "$0" --exec --delay "$DELAY"
    echo "restart scheduled in ${DELAY}s (detached); this shell is not waiting for it"
    echo "outcome: tail -5 $RESTART_LOG"
    echo "runner:  tail -5 $RUNNER_LOG"
    ;;
esac
