# Skippy v2 (`v2-claude`) — Change Log

This document details the v2 rebuild on the `v2-claude` branch. v2 reshapes Skippy around two pillars: a **connected second brain** and a **supervised software-project dashboard**.

## Goals addressed

1. **Hard-to-use UI** → full frontend rebuild, 16 flat nav items collapsed to 5 hubs.
2. **Disconnected data types** → hubs unify previously-scattered surfaces; entity detail pulls related data together.
3. **No project automation** → new "Skippy plans, a coding agent executes" engine.

## Core decision: the execution model

**Skippy plans; a coding agent (e.g. Claude Code) executes. Skippy never writes code itself.**

- Skippy decomposes a project into ordered **task briefs** (context + acceptance criteria + dependencies).
- A human or coding agent executes a brief and reports the result back.
- Results default to an **in-review** state for owner approval — the human stays in the loop.

---

## Backend (Convex + packages)

### Schema (`convex/schema.ts`)
- Extended `tasks` with a supervised-execution lifecycle (all additive/optional):
  - `kind` (`coding` | `research` | `design` | `manual` | `planning`)
  - `executionState` (`unplanned` → `briefed` → `ready` → `in_progress` → `in_review` → `done`/`blocked`) — distinct from the user-facing `status`
  - `executionBrief`, `acceptanceCriteria`, `orderIndex`, `briefReadyAt`, `planRunId`
  - `resultSummary`, `resultUrl`, `resultRecordedAt`
  - New indexes: `by_brain_execution_state`, `by_brain_plan`
- New `projectPlans` table — audit of AI planning runs (mirrors `ingestionRuns`).
- Task dependencies reuse the existing `relationships` `depends_on` / `belongs_to` edges.

### AI package (`packages/ai/src/index.ts`)
- New `generateProjectPlan()` workflow + `parseProjectPlan()` (robust JSON extraction, dependency validation).
- Added a low-level `complete()` primitive to every LLM provider (OpenAI, Anthropic, OpenRouter, local, disabled).
- Parametrized `max_tokens` for multi-task plans.
- **"Now heading" fix**: the focus-summary prompt now emits an explicit `Summary:` headline summarizing all bullets (previously the heading was just the first bullet).

### Planning + supervision (`convex/planning.ts`, `convex/projects.ts`, `convex/taskExecution.ts`)
- `planProject` (viewer) / `planProjectForBrain` (MCP) actions: load project + goals + existing tasks, call the planner, insert tasks (`ownerType: "agent"`), project links, and dependency edges; record a `projectPlans` run.
- `projectBoardForViewer` — tasks grouped by execution state, progress %, ready/blocked/in-review counts, latest plan.
- `readyTasksForViewer` / `readyTasksForBrain` — dependency-aware "what to work on next" queue.
- `getTaskBriefForViewer` / `ForBrain`, `recordTaskResultForViewer` / `ForBrain`.
- **Auto-advance**: completing a task promotes its now-unblocked dependents from `briefed`/`blocked` to `ready`. Wired into `markTaskDone` and `markTaskDoneForViewer`.
- `createProjectForViewer` — create a project directly from the web app.

### MCP server (`apps/mcp-server`)
- New tools: `plan_project`, `list_ready_tasks`, `get_task_brief`, `record_task_result`.
- `mark_task_in_progress` / `mark_task_done` now drive `executionState`.
- New slash commands `/plan`, `/next`, `/brief`, `/result`; updated `skippy_slash_commands` and `skippy_skills` prompts.
- `skills/skippy-harness/SKILL.md` documents the plan→execute loop.

---

## Frontend (`apps/web`)

### Information architecture: 16 nav items → 5 hubs
| Hub | Absorbs |
| --- | --- |
| **Today** (`/`) | Focus + ready-to-work + review queue + active projects |
| **Projects** (`/projects`, `/projects/[id]`) | Projects, tasks, goals + the AI **plan board** |
| **Brain** (`/brain`) | Library, Inbox, Contacts, Goals, Interviews, Map (tabs) |
| **Review** (`/review`) | Triage signals, Pending actions, Routines (tabs) |
| **Settings** (`/settings`) | Settings, Activity logs, About (tabs) |

Old routes (`/tasks`, `/goals`, `/triage`, `/about`, etc.) **307-redirect** to their new hub so deep links keep working.

### Component library (`apps/web/app/components/`)
Bespoke React + CSS Modules library built on the existing warm beige/blue tokens in `globals.css` — **no Tailwind/shadcn**. Includes Button, IconButton, Card, Section, Badge, Tabs, Drawer, Dialog, Toast, ProgressBar, Field/TextInput/TextArea/Select, EmptyState, Spinner, plus the sidebar `AppShell`.

### Key new surfaces (`apps/web/app/hubs/`)
- **Today** — focus hero with the new summary headline, dependency-aware "Ready to work", review counts, active projects.
- **Project board** — "Plan with AI" button, kanban columns by execution state, a task drawer with **Copy brief** (paste into a coding agent), dependency badges, and supervise controls (submit for review / mark done).
- **Brain / Review / Settings** — tabbed hubs that reuse the existing working `Live*` components.

The legacy `live-pages.tsx` components are reused under the new IA rather than rewritten.

---

## Verification

- `pnpm typecheck` — all workspaces + Convex pass.
- `pnpm test` — 59 tests pass (added plan-parsing + focus-headline coverage).
- `next build` — 24 routes compile.
- Runtime smoke — all 5 hubs return 200; old routes 307-redirect.
- Backend deployed to the dev Convex deployment via `convex codegen`.

## To enable automated planning

1. Set an LLM provider for the brain in **Settings** (`llmProviderMode` defaults to `none`).
2. Add the matching API key as a Convex env var on the deployment (e.g. `OPENAI_API_KEY`).

Until configured, **Plan with AI** returns a clear "configure a provider" message.

## Environment notes

- Use Homebrew Node/pnpm: `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm ...` (system `node` is v16).
- Schema changes require `pnpm exec convex codegen`.
- `@skippy/ai` was added to root `package.json` so Convex actions can bundle it.
