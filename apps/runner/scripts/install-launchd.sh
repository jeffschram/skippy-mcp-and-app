#!/bin/bash
# Install the Skippy runner as a macOS LaunchAgent so it runs continuously
# and restarts on crash/reboot (docs/mac-mini-agent-workbench.md).
#
# Reads configuration from the environment (same variables as running the
# daemon directly):
#   SKIPPY_CONVEX_URL            required
#   SKIPPY_RUNNER_HOST_TOKEN     required
#   SKIPPY_RUNNER_ALLOWED_ROOT   required
#   SKIPPY_RUNNER_HARNESSES      default: claude
#   SKIPPY_RUNNER_MAX_CONCURRENCY default: 1
#
# The token is written into the plist, which is chmod 600 in the user's own
# LaunchAgents dir. Note: this runs the daemon as the CURRENT user. The spec's
# stricter model — a dedicated `skippy-runner` service account that cannot see
# the primary user's data — is a manual migration; this script gets you
# always-on first.
set -euo pipefail

LABEL="com.skippy.runner"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RUNNER_MAIN="$REPO_ROOT/apps/runner/dist/main.js"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"
NODE_BIN="$(command -v node)"

: "${SKIPPY_CONVEX_URL:?SKIPPY_CONVEX_URL is required}"
: "${SKIPPY_RUNNER_HOST_TOKEN:?SKIPPY_RUNNER_HOST_TOKEN is required}"
: "${SKIPPY_RUNNER_ALLOWED_ROOT:?SKIPPY_RUNNER_ALLOWED_ROOT is required}"
SKIPPY_RUNNER_HARNESSES="${SKIPPY_RUNNER_HARNESSES:-claude}"
SKIPPY_RUNNER_MAX_CONCURRENCY="${SKIPPY_RUNNER_MAX_CONCURRENCY:-1}"

if [ ! -f "$RUNNER_MAIN" ]; then
  echo "error: $RUNNER_MAIN not found — run 'pnpm --filter @skippy/runner build' first" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$RUNNER_MAIN</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO_ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <!-- git, gh, claude, codex all live under /opt/homebrew/bin -->
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>SKIPPY_CONVEX_URL</key><string>$SKIPPY_CONVEX_URL</string>
    <key>SKIPPY_RUNNER_HOST_TOKEN</key><string>$SKIPPY_RUNNER_HOST_TOKEN</string>
    <key>SKIPPY_RUNNER_ALLOWED_ROOT</key><string>$SKIPPY_RUNNER_ALLOWED_ROOT</string>
    <key>SKIPPY_RUNNER_HARNESSES</key><string>$SKIPPY_RUNNER_HARNESSES</string>
    <key>SKIPPY_RUNNER_MAX_CONCURRENCY</key><string>$SKIPPY_RUNNER_MAX_CONCURRENCY</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/skippy-runner.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/skippy-runner.log</string>
</dict>
</plist>
PLIST_EOF
chmod 600 "$PLIST"

# Reload cleanly whether or not it was already installed.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart "gui/$(id -u)/$LABEL"

echo "installed: $PLIST"
echo "logs:      $LOG_DIR/skippy-runner.log"
echo "status:    launchctl print gui/$(id -u)/$LABEL | head -20"
echo "stop:      launchctl bootout gui/$(id -u)/$LABEL"
