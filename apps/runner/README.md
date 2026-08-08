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
pnpm --filter @skippy/runner build
pnpm --filter @skippy/runner start
```

Harness auth: for Claude, log the service account into Claude Code
(subscription OAuth) or export `ANTHROPIC_API_KEY`; for Codex, install the
`codex` CLI and run `codex login` (ChatGPT). PR creation uses the `gh` CLI
when available; otherwise the run finishes with the branch pushed and no PR.

## Notes

- Work discovery and control state currently poll; switching to Convex
  websocket subscriptions is a latency optimization tracked for phase 3.
- The Codex adapter runs `codex exec --json` with the `workspace-write`
  sandbox scoped to the worktree (network off by default) — the boundary is
  sandbox-enforced rather than approval-escalated; the publish gate still
  goes through the web app. App Server-based interactive approvals are a
  later refinement.
- On restart the runner marks previously active runs `interrupted` rather than
  silently resuming into a worktree with unknown state; resume is explicit.
