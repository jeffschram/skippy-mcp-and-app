# Skippy monorepo

Personal second-brain + agent system. One owner, one Convex deployment, one Mac mini runner.

## Layout

- `convex/` — Convex backend: schema, viewer (`*ForViewer`, Clerk auth) and runner (`host*`, host-token auth) functions. Control plane for agent runs and chat turns.
- `apps/web` — Next.js PWA (app router lives in `apps/web/app/`, NOT `src/app`). Hub pages in `app/hubs/`.
- `apps/mcp-server` — Skippy MCP server (HTTP; role-scoped tokens with deny-by-default tool allowlists).
- `apps/runner` — Mac mini daemon: claims runs/chat turns from Convex, executes via Claude/Codex harness adapters in git worktrees.
- `packages/shared`, `packages/ai` — build these before dependents (root scripts already do).
- `docs/` — design docs are the source of truth; read the doc named in a file header before changing that area.

## Commands

- Verify everything: `pnpm check` (= `pnpm typecheck && pnpm test`; root scripts build shared/ai first — do not hand-roll per-package builds).
- One package: `pnpm --filter @skippy/runner test` (vitest), `pnpm --filter @skippy/web typecheck`, etc.
- Convex types only: `pnpm convex:typecheck`. Never run `convex deploy`/`convex dev` unless explicitly asked.

## Conventions

- pnpm@8, node >= 20, ESM everywhere: runner/mcp-server import local files with explicit `.js` extensions.
- Convex: money is integer cents; ingestion writes need `rubricDecision` + `sourceRefs`; tables use lease-based claiming for runner work — preserve idempotency (seq/high-water-mark) patterns.
- Tests are colocated (`foo.test.ts` beside `foo.ts`); extract pure helpers into `*-helpers.ts` files so they're testable without React/Convex.
- Comments explain WHY (incident dates, design tradeoffs) — keep that style; don't strip them.

## Working agreement

- Branch as `agent/<topic>` off `main`; open a PR and leave review/merge to the owner. Never merge, never mark Skippy tasks done — report results and leave them in review.
- Be token-frugal (docs/token-efficiency.md): don't re-read large files you've already seen, prefer Grep/Glob over exploratory dumps, keep replies and diffs minimal.
