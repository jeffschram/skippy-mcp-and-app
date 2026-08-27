# Project Manager Agent

Status: Accepted (implemented as the `project-manager` skill in `convex/skills.ts`)

## Summary

The Project Manager Agent is the first genuinely new named-agent role (see
`docs/agents.md`): a scheduled, per-project run that keeps the plan healthy
between owner sessions. It reviews finished work, briefs proposed tasks
against the actual repo, flags what is stuck or stale, and tells the owner
what deserves attention — without taking any action the owner would want to
take themselves.

Settled by the Phase 5 decisions:

- **One `project-manager` skill parameterized by `projectId`.** Role keys are
  `pm:{projectId}`; display name is "PM: {project title}".
- **No new runtime and no agent messaging.** PM runs use the existing
  mac-mini runner / launchd wake pattern and communicate exclusively through
  shared Convex state.

Design goal for v1: **zero schema changes.** The PM is a skill plus
scheduling; every write it performs goes through existing MCP tools.

## What a PM run does

A single run operates on one project. In order:

### 1. Gather state (read-only)

- `get_project_plan` — phases, tasks, execution states, featured ordering.
- `list_tasks_by_state` for `in_review`, `blocked`, `in_progress`, and
  `proposed` scoped to the project.
- `get_project_notes` — read the notes pad for context only (never edit it;
  the pad is the owner's space and notes reviews are owner-initiated).
- The project repo, when `localPath` is available on the host — required for
  grounded briefs, used opportunistically for divergence checks.

### 2. Review results (`in_review` tasks)

For each task sitting in review: read `resultSummary`, `prUrl`/`prStatus`,
and artifacts, and distill **what the owner needs to know to approve or
reject** — one or two sentences per task, not a restatement. Recorded via
`record_entity_review` on the task (`reviewType: "status_check"`).

The PM never approves, rejects, or marks tasks done. Review remains the
owner's action.

### 3. Brief proposed tasks

For `proposed` tasks in the project: write grounded execution briefs with
`brief_task` — concrete files, existing patterns, verification steps —
exactly what a Task Agent needs to execute safely. This is the PM's highest-
leverage mutation and is explicitly safe: briefed tasks still wait for owner
promotion to Ready.

Skip tasks whose descriptions are too vague to brief honestly; flag those in
the digest instead of inventing scope.

### 4. Flag blocked and stale work

- `blocked` tasks: check whether the stated blocker still holds (e.g. the
  dependency has since completed). If evidently unblocked, say so in the
  digest; do not change state.
- Stale checks: `in_progress` tasks with no activity beyond a threshold
  (default: 7 days) and `in_review` tasks the owner hasn't touched (default:
  3 days) get a `record_entity_review` (`reviewType: "stale_check"`) and a
  digest line.

### 5. Notice plan/reality divergence

Compare the Plan against observable reality: phases described as pending that
the repo shows shipped, tasks referencing files or approaches that no longer
exist, dependency links that no longer make sense. Divergence is **reported,
never repaired** — the PM does not edit phase descriptions or reorder plans.

### 6. Suggest next promotions

Rank briefed tasks that look ready to go and list the top candidates in the
digest with one-line reasons. Promotion to Ready stays an owner action; the
PM only recommends.

### 7. Write the digest and record the run

- **Digest**: a concise per-project report recorded with
  `record_entity_review` on the **project** (`reviewType: "general"`), so it
  lands in the project's activity feed as durable, inspectable Convex state.
  Sections: results awaiting review, briefs written, flags (blocked/stale/
  divergence), suggested promotions. Empty sections are omitted; a run with
  nothing to say records nothing and stops quietly.
- **Run bookkeeping**: `record_ingestion_run` with
  `sourceSystemsChecked: ["skippy"]` and
  `metadata: { role: "pm:{projectId}" }`. This is deliberate reuse of the
  existing run table (documented here so it isn't mistaken for source
  ingestion); if PM runs later need richer bookkeeping, that is the moment to
  promote a dedicated table — not v1.

## What the PM may and may not do

| Allowed without approval | Report-only (digest) | Never |
| --- | --- | --- |
| `brief_task` on proposed tasks | Promotion recommendations | Promote tasks to Ready |
| `record_entity_review` (task reviews, stale/blocker flags, priority scores with reasons) | Plan/reality divergence | Approve, complete, or cancel tasks |
| Project digest via `record_entity_review` | Unblock observations | Edit the notes pad or phase descriptions |
| Run bookkeeping (`record_ingestion_run`) | Result summaries for the owner | External side effects (push, PR, email — anything approval-gated) |

The rule of thumb: the PM may mutate only what is **safe, reversible, and
inside Skippy state**, and only in ways that add information rather than
change decisions. Everything decision-shaped is a digest line.

## Cadence

- **v1: nightly**, one run per project with status `in_progress`, scheduled
  via the same launchd wake pattern as `task-heartbeat` on the mac-mini
  runner. Nightly is enough for a solo owner: results reviewed each morning,
  briefs ready before the workday.
- Runs are cheap to skip: if the project has no `in_review`, `proposed`,
  `blocked`, or stale tasks, the run stops quietly after step 1.
- **v2 (deferred): on-result triggers** — a PM pass fired when a Task Agent
  records a result, giving same-hour review summaries. Deferred because it
  needs a trigger mechanism (Convex scheduled function or runner hook) and
  nightly covers the need until run volume grows.

## Harness

Harness-neutral like every role: `harness-bootstrap` + `project-manager`
skill. Repo-grounded briefing works best on a host with the project checkout
(the mac-mini runner hosts already have worktree infrastructure); when no
checkout is available the PM still runs but marks briefs as ungrounded or
defers them with a digest note.

## Failure behavior

- Per-project isolation: a failure in one project's run must not abort other
  projects' runs.
- Errors land on the run record (`errors` array), never silently swallowed.
- The PM must be idempotent per day: re-running after a crash re-reads state
  and re-writes at most the same digest; `brief_task` calls are skipped for
  tasks already briefed in this cycle.

## Open questions for the owner

1. **Brief everything, or only on request?** v1 as specced auto-briefs all
   proposed tasks in active projects. Alternative: only brief tasks the owner
   has flagged. Current lean: auto-brief — briefs are additive and gated by
   owner promotion anyway.
2. **Stale thresholds** — 7 days (in_progress) / 3 days (in_review) are
   guesses; tune after a few weeks of digests.
3. **Digest surfacing** — v1 relies on the project activity feed. If digests
   prove useful, a dedicated "PM report" card on the project page is a
   natural follow-up (belongs with the UI attribution task).
