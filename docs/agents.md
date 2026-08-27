# Named Agents & Skills: Agents as Roles

Status: Accepted (Phase 5 architecture note)

## Summary

**An agent is not a harness.** Claude and Codex are interchangeable engines. An
agent is a *role* defined by data stored in Skippy:

- **Instructions** — one or more Skippy-hosted skills (`harnessSkills` table):
  canonical, versioned, harness-neutral Markdown served via the `get_skill`
  MCP tool, MCP prompts, or `https://skippy.jeffschram.dev/skills/<slug>`.
- **Access** — MCP token scope: which tools the role may call, plus the
  approval-gate policy (`pendingActions`) for side effects.
- **Context** — the importance rubric, related entities, and memory anchors
  the role reads before acting.
- **Harness preference** — a knob (`preferredHarness`, `requestedHarness`),
  never an identity.

A run is the triple **(agent role, harness, work)**: "the Agenda Agent ran on
Codex at 6am." The role explains *what* and *why*; the harness is merely *how*.

## Decisions (settled)

These were open questions in the original sketch; both are now decided:

1. **No `agentRoles` Convex table to start.** A role is a skill slug plus a
   token scope. Run attribution is a plain `role` string on run records
   (`ingestionRuns`, `sourceSyncStatuses`, `agentRuns` — via a field or
   `metadata`). If roles later accrue real per-role config (schedules,
   budgets, model prefs), promote to a table then; the string key becomes the
   foreign key and nothing breaks.
2. **One `project-manager` skill parameterized by `projectId`.** There is a
   single PM skill; each active project gets periodic PM runs of that skill
   with a different `projectId`. Role keys are namespaced: `pm:{projectId}`.

## Coordination: blackboard, not messaging

Agents never message each other. They coordinate through **shared Convex
state** (blackboard model): each agent's outputs are durable state that other
agents' skills tell them to read.

- The Agenda Agent writes accepted objects, sync status, and the focus
  summary; everything downstream reads those.
- The Financial Agent writes transactions, balances, and reports; Skippy
  "knows about" finances by reading financial reports, not by talking to the
  Financial Agent.
- The PM Agent reads task results (`in_review` state, `resultSummary`,
  `prUrl`) that Task Agents wrote, and writes briefs and flags that Task
  Agents and the owner read.

This keeps every interaction inspectable, replayable, and independent of
which harness happened to perform either side.

## The roles

| Role key | Skill(s) | Tool scope | Cadence | Status today |
| --- | --- | --- | --- | --- |
| `task-executor` | `harness-bootstrap` + `task-heartbeat` | Task execution: `list_requested_ready_tasks`, `get_task_brief`, `mark_task_in_progress`, `record_task_result`, project files/artifacts | Scheduled wake (mac-mini runner / launchd) | **Exists** — runner + skill shipped |
| `agenda` | `harness-bootstrap` + `agenda-ingestion` | Ingestion + memory: source reading, `ingest_object`, quick-capture handling, `update_source_sync_status`, focus summary, `record_ingestion_run`. **No** task execution, **no** finance writes | Scheduled wake (morning + periodic) | Exists functionally as anonymous ingestion runs; needs the skill + attribution |
| `finance` | `harness-bootstrap` + `finance-sync` | Financial tools only: `upsert_financial_account`, `record_financial_transactions`, `record_financial_balances`, ingestion-run recording | Scheduled wake (daily) | Exists functionally as Plaid sync prompts; judgment needs canonicalizing into the skill |
| `pm:{projectId}` | `harness-bootstrap` + `project-manager` | Briefing/planning: `get_project_plan`, `brief_task`, `record_entity_review`, task-state reads, notes reads. Reports rather than mutates where owner approval matters | Nightly per active project, and/or on-result | **Does not exist** — the genuinely new piece |

Stretch roles (after the core four are proven): `memory-hygiene` /
`weekly-review` (dedupe memories, prune stale candidates, surface items about
to auto-archive) and `code-review` (defines what a good review checks for the
existing `review` task kind, enabling cross-harness review where one engine
writes and another reviews).

## How this maps to existing infrastructure

The pattern is already half-built; naming it is mostly formalization:

- **Skills** (`convex/skills.ts`, `harnessSkills` table): versioned,
  `isCurrent`-flagged, served three ways (MCP prompt, `get_skill`, HTTP).
  `task-heartbeat` + `harness-bootstrap` prove the pattern: *every agent =
  harness-bootstrap + one role skill.* New roles are new rows, not new code.
- **Runs** (`ingestionRuns`, `sourceSyncStatuses`, `agentRuns`): all already
  record `harness`. Role attribution adds the role key alongside — start with
  `metadata.role`, promote to a first-class indexed field when the UI needs
  to query by it.
- **Access** (`mcpTokens`): today every token has full tool access. Per-role
  scoping adds an optional tool allowlist to the token (or a policy layer at
  `/api/mcp`), keyed by the same role strings. The approval gate
  (`pendingActions`) stays brain-scoped and applies to all roles.
- **Scheduling**: the mac-mini runner + launchd wake pattern
  (`com.skippy.runner`, `docs/mac-mini-agent-workbench.md`) is the shared
  cadence mechanism. Agenda/finance/PM wakes reuse it rather than inventing
  new schedulers.
- **Harness resolution** already treats harness as preference, not identity:
  explicit pick → `task.requestedHarness` → project `preferredHarness` →
  default. Roles slot in above that chain without changing it.

## What "attribution" means concretely

The app UI (activity feeds, run history, sync status, task results) should
answer "which agent did this" with the **role first, harness second**:

> Agenda Agent ran on Codex · 6:02am · gmail, calendar, imessage
> PM: Skippy MCP and APP ran on Claude · 11:30pm · 2 briefs, 1 flag

Rules:

- Role is required on new run records; legacy runs without a role render as
  the bare harness name (no backfill needed).
- Role display names are derived from the role key (`agenda` → "Agenda
  Agent", `pm:{projectId}` → "PM: {project title}").
- Harness is never hidden — it matters for debugging and cost.

## The Project Manager Agent (new)

The one role with no existing functional equivalent. Per project, a PM run:

1. Reviews `in_review` task results and summarizes them for the owner.
2. Briefs `proposed` tasks against the actual repo (`brief_task`).
3. Flags blocked and stale tasks.
4. Notices when the Plan and reality have diverged.
5. Optionally suggests next promotions to Ready — but does not promote;
   promotion stays an owner action.

Boundaries: the PM *reports* by default and *mutates* only what is safe and
reversible (briefs, reviews, flags). Anything with side effects outside
Skippy state goes through the existing approval gate. Detailed behavior is
specified in the PM design task and canonicalized in the `project-manager`
skill.

## Non-goals

- **No agent-to-agent messaging protocol.** Blackboard only.
- **No new runtime.** Roles run on existing harnesses via existing wake
  mechanisms; there is no "agent framework" layer.
- **No `agentRoles` table yet** (see Decisions). Revisit only when a role
  needs config that doesn't fit a skill body or token scope.
- **No per-role model/engine pinning.** Harness stays a preference.

## Rollout order

1. `agenda-ingestion` skill authored (moves scheduler prompt text into a
   versioned skill) → attribute ingestion runs to `agenda`.
2. `finance-sync` skill (canonicalizes CSP mapping judgment) → attribute to
   `finance`.
3. PM design → `project-manager` skill + scheduled per-project runs.
4. UI attribution across feeds/runs/results.
5. Per-role MCP tool scoping on tokens.
6. Stretch: `memory-hygiene`, `code-review`.
