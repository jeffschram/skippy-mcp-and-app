# @skippy/runner

Always-on Mac mini execution daemon for the Skippy agent workbench
(`docs/mac-mini-agent-workbench.md`). Outbound-only: it authenticates to the
Convex control plane with a revocable host token, claims queued runs whose
harness it supports, executes them in dedicated git worktrees, and streams
structured progress, approvals, and results back to Convex.

## Setup

1. In the Skippy web app, create a host (Settings → Agent hosts) and copy the
   one-time token.
2. Configure a project's execution mapping (host + allowlisted local repo path).
3. Run the daemon under a dedicated macOS account:

```sh
export SKIPPY_CONVEX_URL="https://<deployment>.convex.cloud"
export SKIPPY_RUNNER_HOST_TOKEN="skippyhost_..."
export SKIPPY_RUNNER_ALLOWED_ROOT="/Users/skippy-runner/projects"
export SKIPPY_RUNNER_HARNESSES="claude"        # comma-separated: claude,codex
export SKIPPY_RUNNER_MAX_CONCURRENCY="1"
# Skippy MCP, injected explicitly into every harness session (required):
export SKIPPY_MCP_URL="https://skippy.jeffschram.dev/api/mcp"
export SKIPPY_MCP_TOKEN="<bearer token>"
# Optional: approval wait bound (ms). Default 86400000 (24 h); 0 = wait forever.
export SKIPPY_RUNNER_APPROVAL_TIMEOUT_MS="86400000"
pnpm --filter @skippy/runner build
pnpm --filter @skippy/runner start
```

Harness auth: for Claude, log the service account into Claude Code
(subscription OAuth) or export `ANTHROPIC_API_KEY`; for Codex, install the
`codex` CLI and run `codex login` (ChatGPT). PR creation uses the `gh` CLI
when available; otherwise the run finishes with the branch pushed and no PR.

## Always-on (launchd)

Install the runner as a LaunchAgent so it restarts on crash and login:

```sh
export SKIPPY_CONVEX_URL=... SKIPPY_RUNNER_HOST_TOKEN=... SKIPPY_RUNNER_ALLOWED_ROOT=... SKIPPY_RUNNER_HARNESSES=claude,codex
pnpm --filter @skippy/runner build
bash apps/runner/scripts/install-launchd.sh
```

Logs land in `~/Library/Logs/skippy-runner.log`. Re-run the script after a
rebuild to pick up new code (`launchctl kickstart -k gui/$UID/com.skippy.runner`
also restarts it in place). This runs as the current user; migrating to the
spec's dedicated `skippy-runner` service account is a separate hardening step.

## Notes

- Skippy MCP: the runner injects the remote Skippy MCP server into every
  harness session explicitly from `SKIPPY_MCP_URL`/`SKIPPY_MCP_TOKEN` — it
  does NOT depend on `claude mcp add -s user` host registration (which
  silently vanished on 2026-08-18). `claude mcp add -s user --transport http
  skippy <url> --header "Authorization: Bearer <token>"` remains useful for
  interactive local terminal sessions only. Claude sessions that come up
  without `mcp__skippy*` tools emit a loud `error` event in the run/chat feed;
  the codex path is wired via `-c mcp_servers.skippy.*` config overrides but
  has no equivalent detection (codex JSONL lists no tools).
- Approval timeout: a code run waits at most `SKIPPY_RUNNER_APPROVAL_TIMEOUT_MS`
  (default 24 h, `0` = forever) for any single approval. On expiry the
  approval doc is `cancelled` with a reason and the run fails with
  `approval timed out: <command>`. This is the only approval timeout in the
  system; the Convex claim lease renews on heartbeat while waiting.
- Resilience: SDK transport errors racing a harness teardown (e.g.
  `ProcessTransport is not ready for writing` after SIGTERM/exit 143) are
  logged and suppressed — by the Claude adapter when catchable, and by
  process-level `uncaughtException`/`unhandledRejection` backstops otherwise.
  One session's teardown never crashes the daemon or sibling work.
- Work discovery and control state currently poll; switching to Convex
  websocket subscriptions is a latency optimization tracked for phase 3.
- The Codex adapter runs `codex exec --json` with the `workspace-write`
  sandbox scoped to the worktree (network off by default) — the boundary is
  sandbox-enforced rather than approval-escalated; the publish gate still
  goes through the web app. App Server-based interactive approvals are a
  later refinement.
- On restart the runner marks previously active runs `interrupted` rather than
  silently resuming into a worktree with unknown state; resume is explicit.
