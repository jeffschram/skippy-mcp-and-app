# Codex Heartbeat For Requested Ready Tasks

Skippy uses the Ready column as the agent queue. A Ready task is only picked up by an automation when it is agent-owned and has `agentRequestStatus: "requested"`.

## Queue Contract

The heartbeat should poll Skippy MCP `list_requested_ready_tasks`.

Each returned task is expected to include:

- `taskId` / `_id`
- `title`
- `projectId`
- `projectTitle`
- `kind`
- `project.repoUrl` or `repoUrl` when the project is connected to GitHub
- `project.defaultBaseBranch` when configured
- `executionBrief`
- `acceptanceCriteria`
- `agentRequestStatus`
- `requestedHarness`
- `agentRequestedAt`
- `agentRequestMessage`

## Heartbeat Behavior

On each wake:

1. Call `list_requested_ready_tasks` with a small limit.
2. If no tasks are returned, stop quietly.
3. Process all queued tasks that can be completed safely in the wake.
4. For each task, call `mark_task_in_progress` before editing files or taking meaningful action.
5. Execute each task using its task brief and acceptance criteria.
6. Run relevant checks for each completed task.
7. For coding tasks in projects with a GitHub repo:
   - Create or reuse a dedicated branch named `agent/task-<taskId>-<slug>`.
   - Commit only files owned by the task; leave unrelated dirty files untouched.
   - Push the branch and create or reuse a GitHub PR.
   - Prefer the project's `defaultBaseBranch`; otherwise use the repo default branch.
8. If a project has no GitHub repo configured, do not attempt branch/PR work; record a clear result or blocker message.
9. Call `record_task_result` with a concise summary and any PR, commit, or artifact URL. Include `gitBranchName`, `prUrl`, `prNumber`, and `prStatus` when a PR exists.
10. Leave each task in review for the owner unless the owner explicitly allowed automatic completion.
11. If a task becomes blocked or unsafe to continue, record a clear result/status for that task and continue only with independent queued tasks.

## Suggested Codex Heartbeat Prompt

```text
Check Skippy for requested Ready agent tasks using list_requested_ready_tasks.
If no tasks are queued, stop quietly.
If tasks are queued, process all queued tasks that can be completed safely in this wake.
For each task, before doing meaningful work, mark the task in progress.
Execute each task according to its execution brief and acceptance criteria.
Run relevant verification for each completed task.
For coding tasks in projects with a GitHub repo, create or reuse a dedicated branch named agent/task-<taskId>-<slug>, commit only task-owned files, push the branch, create or reuse a GitHub PR, and include gitBranchName, prUrl, prNumber, prStatus, and resultUrl when recording the task result.
If the project has no repo configured, do not attempt branch/PR work; record a clear result or blocker message instead.
Report each result back to Skippy with record_task_result so the task moves to In Review.
Do not mark tasks done unless the owner explicitly requested automatic completion.
If a task becomes blocked or unsafe to continue, record a clear result or status for that task and continue with the next queued task only when it is independent and safe to do so.
```

## Activation

The actual Codex heartbeat should be created only after the owner chooses the cadence. A reasonable starting cadence is every 15 or 30 minutes while actively working on the project.
