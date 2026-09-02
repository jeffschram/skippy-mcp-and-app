# Skippy Mac Mini Agent Workbench

Status: Proposed  
Scope: Product and development specification  
Primary execution target: Always-on Mac mini  
Future execution target: Isolated cloud sandboxes

## Summary

Add a page-aware chat and agent-execution experience to the Skippy web app. Each Skippy project can have multiple persistent chats. A chat can remain conversational or become an executable coding session attached to a dedicated Git worktree and branch for projects. For other pages like the homepage, financial, etc. these also have a dedicated chat session.

Tasks on a project's Kanban board gain an **Execute** action. Executing a Ready, agent-owned task creates a durable run in Convex. A trusted runner on an always-on Mac mini claims the run, starts or resumes a coding harness in the correct project workspace, and sends structured progress back to Convex. The web app updates reactively and provides chat, plans, command results, diffs, approvals, verification status, and the final pull request.

Convex is the durable control plane. The Mac mini is the initial execution plane. GitHub is the durable source of code changes. No inbound public connection to the Mac mini is required.

## Problem

Skippy already stores projects, executable task briefs, acceptance criteria, agent-request state, branches, and pull-request results. Execution currently depends on a desktop terminal harness such as Codex or Claude Code running interactively on a local computer.

This creates several limitations:

- Work cannot be started, monitored, approved, or resumed conveniently from the Skippy web app.
- Project conversation context is fragmented across terminal harnesses.
- A task marked for agent work still requires a person to open a terminal and perform the handoff.
- Terminal sessions are not a durable, structured source for plans, approvals, diffs, and execution status.
- Switching between projects and tasks can accidentally mix working directories, branches, or uncommitted changes.

## Goals

- Provide persistent chats scoped to a Skippy project.
- Support multiple chats per project, including a default General chat and task-specific chats.
- Allow an eligible Kanban task to be executed from the web app.
- Run coding work on an always-on Mac mini without requiring the user's current device to remain online.
- Stream durable, structured execution updates through Convex.
- Isolate each code-changing chat in its own Git worktree and branch.
- Preserve human approval for sensitive operations and finish coding work in review rather than silently marking it done.
- Keep the execution-host abstraction open so cloud sandboxes can be added later.
- Reuse Skippy's existing project, task, MCP, auth, and result-recording concepts.

## Non-goals for the first version

- Automatically merge pull requests.
- Automatically deploy to production.
- Expose the Mac mini's SSH, terminal, or agent ports publicly.
- Support arbitrary computers or multiple users immediately.
- Provide a full browser IDE.
- Mirror every byte of terminal output into Convex.
- Let a chat freely move between project directories.
- Execute untrusted repositories without additional isolation.

## Product concepts

### Project chat

A long-lived conversation associated with exactly one Skippy project. A project may have several chats:

```text
Skippy
  General
  Task: Add agent workbench
  Task: Fix ingestion timeout

Portfolio
  General
  Redesign homepage
```

A chat holds conversational history and the mapping to a harness thread. It may have no active code workspace. A code-changing chat may own one worktree and branch at a time.

### Turn

One user message and the assistant activity that follows. A conversational turn may answer without starting a code execution run.

### Run

A durable execution attempt performed by a host. A run belongs to a project chat and may optionally belong to a Skippy task. Retries and resumes should be distinguishable from the original attempt.

### Host

A registered execution machine. The first host is the always-on Mac mini. A future host may be a Vercel Sandbox, E2B sandbox, GitHub Codespace, or another isolated worker.

### Harness

The coding agent that executes a run: `codex` (Codex App Server) or `claude` (Claude Code via the Claude Agent SDK). Harness choice is a typed enum, not free text, and resolves in this order:

1. Explicit selection on the Execute action or chat composer.
2. The task's `requestedHarness`, when set to a valid harness value.
3. The project's `preferredHarness` from its execution config.
4. The brain-level default.

A chat is bound to one harness for its lifetime. Conversation context lives in the harness's own thread/session, so switching harness mid-chat would silently discard that context; to use the other harness, start a new chat (or a new task run, which creates its own chat). The runner only claims runs whose harness appears in its advertised capabilities.

### Approval

A durable request that pauses sensitive work until the user accepts, declines, or cancels it. Approval state must survive browser disconnects and runner restarts. Approval kinds are harness-neutral; each adapter maps its native mechanism (Codex command/file approvals, Claude `canUseTool` callbacks) into the same records.

## High-level architecture

```text
Skippy web app
  project switcher, chats, Kanban Execute, approvals
              |
              v
Convex control plane
  threads, messages, runs, events, approvals, host state
              ^
              | outbound subscription/polling
Mac mini runner
  host daemon, workspace manager, harness adapter, Git adapter
              |
              +--> dedicated project worktree and branch
              +--> selected harness: Codex App Server or Claude Code (Agent SDK)
              +--> tests and local preview
              +--> GitHub branch and pull request
              +--> Skippy MCP for second-brain/task context
```

### Web app responsibilities

- Authenticate the user with the existing Clerk and Convex integration.
- Select the active project and remember the most recent chat per project.
- Create, rename, archive, and switch chats.
- Save user messages and execution requests durably.
- Display reactive transcript and execution events.
- Render approvals as explicit, understandable actions.
- Display runner availability and the selected execution target.
- Link task cards to their execution chats and results.
- Never connect directly to a public Mac mini terminal or agent process.

### Convex responsibilities

- Act as the durable control plane and synchronization layer.
- Authorize every project, chat, run, event, and approval by brain ownership.
- Enforce run state transitions and atomic claiming.
- Store the durable chat transcript using the Convex Agent component rather than a custom message table.
- Store throttled streaming deltas and finalized assistant messages.
- Store structured execution events separately from conversational messages.
- Track runner heartbeat and capacity.
- Schedule or expose reconciliation for queued and interrupted runs.
- Connect completed runs to the existing task result lifecycle.

### Mac mini runner responsibilities

- Run continuously under `launchd` as a dedicated service.
- Use an outbound Convex connection or subscription; require no inbound public port.
- Advertise host capabilities and send a periodic heartbeat.
- Atomically claim compatible queued runs.
- Resolve a Skippy project to an allowlisted local repository path.
- Create and manage a dedicated Git worktree and branch for code-changing chats.
- Start or resume the configured coding harness.
- Translate harness events into the Skippy run protocol.
- Pause for approval without losing state.
- Run verification and report structured results.
- Push only an approved task branch and create or update a pull request.
- Reconcile incomplete runs after runner restart.

### Harness adapter responsibilities

Define a provider-neutral interface for:

- Start thread
- Resume thread
- Start turn
- Interrupt turn
- Stream assistant messages
- Stream plans and plan updates
- Stream command execution and results
- Stream file changes and aggregated diffs
- Request approval
- Answer harness questions
- Report usage and terminal status

Two adapters are planned from the start, and the interface above must be validated against both event models before either is built:

- **Codex adapter** — Codex App Server already exposes structured threads, turns, streamed events, command and file approvals, plans, diffs, and resumable conversations, so the mapping is close to 1:1.
- **Claude adapter** — built on the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), which packages the Claude Code harness as a library: `query(prompt, options)` drives the full agent loop with built-in file/bash/search tools, streamed structured messages, session resume by session ID, hooks, and a `canUseTool` permission callback that maps directly onto the Skippy approval flow.

Neither adapter's native event shape is the Skippy protocol. The run-event and approval contracts are defined provider-neutrally; each adapter translates into them. Known asymmetries to design around: Codex emits explicit plan objects while Claude Code exposes todo/plan state through tool events; approval granularity differs (Codex command/file approvals vs Claude's per-tool permission callback with allow/deny/always-allow scopes); and authentication differs (ChatGPT device-code or API key for Codex vs Claude subscription OAuth or `ANTHROPIC_API_KEY` for Claude).

**Claude approval-policy mapping.** The Claude Agent SDK's permission modes and `canUseTool` callback are the levers that implement Skippy's default approval policy: run sessions in `acceptEdits` mode scoped to the worktree (file edits, tests, builds inside the boundary proceed automatically), and use `canUseTool` to intercept everything else — out-of-boundary access, destructive commands, new network destinations, push/PR — converting each into a durable Skippy approval record and returning allow/deny once the user decides. `bypassPermissions` is never used; `plan` mode may back a future read-only analysis feature for General chats.

### Skippy MCP injection (daemon environment)

Every harness session (chat and run, every project) must have the Skippy MCP tools. The runner injects the remote Skippy MCP server **explicitly** from two required daemon environment variables — set them in the launchd environment for `com.skippy.runner`:

- `SKIPPY_MCP_URL` — the remote endpoint, e.g. `https://skippy.jeffschram.dev/api/mcp`
- `SKIPPY_MCP_TOKEN` — the bearer token (daemon environment only; never committed, never read from `.env.local` by runner code)

The Claude adapter passes these as an explicit `mcpServers` entry on every turn; the codex adapter passes `-c mcp_servers.skippy.url=… -c mcp_servers.skippy.bearer_token_env_var=SKIPPY_MCP_TOKEN` config overrides to `codex exec`. Missing either env var fails the daemon at startup, and a Claude session that still comes up without `mcp__skippy*` tools emits a visible `error` event in the feed.

This deliberately does **not** rely on host-level MCP registration (`claude mcp add -s user …` in `~/.claude.json`): that registration silently disappeared on the runner host on 2026-08-18, leaving sessions with no Skippy tools and no error. `claude mcp add -s user --transport http skippy <url> --header "Authorization: Bearer <token>"` remains the right way to equip **interactive local terminal sessions only**.

### Approval timeout

A run waits at most `SKIPPY_RUNNER_APPROVAL_TIMEOUT_MS` (default 24 hours; `0` = wait forever) for any single approval, including the publish gate. On expiry the pending approval document is settled `cancelled` with an explicit `reason`, and the run fails with `errorMessage: approval timed out: <command>`. This is the only approval timeout in the system — the Convex claim lease renews on heartbeat while a run waits, so nothing else expires a pending approval.

## User experience

### Project chat navigation

When the user switches projects, the website switches to that project's chat list and restores its last-opened chat. Messages created in that view are always associated with the selected project.

Recommended layout:

- Project selector
- Chat sidebar
  - General
  - Task chats
  - Other named chats
  - New chat
- Main transcript
- Context header
  - Project
  - Task, when applicable
  - Repository
  - Branch/worktree
  - Harness (Codex or Claude)
  - Execution host and status
- Composer
- Collapsible execution panel for plans, commands, diffs, tests, and approvals

### General chat behavior

- Every project receives or lazily creates a General chat.
- General chat may answer questions using Skippy and repository context.
- General chat does not edit the primary checkout by default.
- If a request requires code changes, the UI or harness proposes creating a working branch/worktree for that chat.
- Casual questions should not create branches or compute sessions unnecessarily.
- Read-only conversational turns do not go through the full run machinery. They use a lightweight conversational path — no run record, lease, or worktree — with the run/lease/worktree state machine reserved for code-changing work. A conversational chat is promoted to a run-backed chat only at the moment code changes are approved.

### Kanban Execute flow

The Execute button is enabled only when the task is:

- Accepted
- Agent-owned
- In the Ready execution state
- Not already claimed by an active run
- Attached to a code project with a configured repository and valid execution host mapping

The Execute button (or its dropdown) lets the user pick the harness for this run, defaulting per the harness-resolution order above. The picker only offers harnesses at least one online host advertises.

On **Execute**:

1. Create or reuse the task's dedicated project chat.
2. Create a queued run containing the task brief, acceptance criteria, project, base branch, resolved harness, and approval policy.
3. Link the run and chat to the task.
4. Show the task as Queued immediately.
5. The Mac mini runner claims the run.
6. Create or reuse the task worktree and branch.
7. Start the harness with the task brief and relevant Skippy MCP context.
8. Move the task to In Progress once meaningful work begins.
9. Stream progress and approvals into the task chat.
10. Run relevant verification.
11. With approval, push the branch and create or update a pull request.
12. Record the result through the existing Skippy task-result workflow.
13. Move the task to In Review, leaving final completion to the owner unless explicitly configured otherwise.

### Task action states

| Task/run state | Primary action |
| --- | --- |
| Proposed | Refine brief |
| Briefed | Mark ready |
| Ready | Execute |
| Queued | Cancel queue |
| In progress | Open live chat |
| Waiting for approval | Review request |
| Interrupted or failed | Resume |
| In review | Review PR |
| Done | View result |

### Execution chat contents

The task chat should show:

- User and assistant messages
- Current plan and completed steps
- Commands with working directory, duration, exit code, and summarized output
- File changes and a unified diff
- Test and typecheck results
- Approval cards
- Runner disconnection or recovery notices
- Branch, commit, PR, and preview links
- Final result summary

Full verbose logs may remain on the Mac with bounded retention. Convex should store summaries and the output necessary to understand or audit the run.

## Logical data model

Names are provisional and should be aligned with Convex component conventions during implementation.

### `agentHosts`

- `brainInstanceId`
- `hostKey`
- `displayName`
- `kind`: `mac` or future cloud provider
- `status`: `online`, `busy`, `draining`, `offline`
- `capabilities`: harnesses, operating system, architecture, maximum concurrency
- `lastHeartbeatAt`
- `lastClaimAt`
- `createdAt`
- `updatedAt`

Do not store a reusable plaintext host credential. Store a hash or identifier for a revocable credential.

### `projectExecutionConfigs`

- `brainInstanceId`
- `projectId`
- `hostId`
- `repoUrl`
- `localPath`
- `defaultBaseBranch`
- `allowedRoot`
- `preferredHarness`
- `approvalPolicy`
- `enabled`
- timestamps

The existing project fields may remain the canonical product configuration, with this table limited to host-specific mappings if needed.

Harness values (`preferredHarness`, `requestedHarness` on runs) should be a typed union — `"codex" | "claude"` — so hosts, pickers, and claim checks can validate them. Note the existing `tasks.requestedHarness` in `convex/schema.ts` is a free-text string that `requestAgentForTask` defaults to the assistant display name; it should either be migrated to the enum or kept as display metadata while the run table carries the typed field.

### Project chat mapping

Use a Convex Agent component thread for messages and add a Skippy-owned mapping containing:

- `brainInstanceId`
- `projectId`
- optional `taskId`
- Convex Agent `threadId`
- title
- kind: `general`, `task`, `working`
- harness provider
- optional external harness thread ID
- optional active worktree and branch metadata
- optional active run ID
- lifecycle state: `active`, `waiting`, `completed`, `archived`
- timestamps

### `agentRuns`

- `brainInstanceId`
- `projectId`
- `chatId`
- optional `taskId`
- `hostId`
- `attempt`
- `status`
- `requestedHarness`
- `baseBranch`
- optional `workingBranch`
- optional `worktreePath`
- approval policy snapshot
- claim token/version
- queued, claimed, started, heartbeat, completed timestamps
- error category and safe error message
- verification summary
- result summary and URLs

`agentRuns` is a separate table rather than an evolution of the task's agent-request fields. The existing `agentRequestStatus` union (`"requested" | "cancelled"`) cannot represent retries, attempts, or the run state machine, and a task may accumulate multiple run attempts over its life. The task keeps a pointer to its active run (and the request fields remain as the user-intent signal that queues the first run), while run history lives here.

### `agentRunEvents`

- `brainInstanceId`
- `runId`
- monotonically increasing sequence number
- event type
- safe structured payload
- timestamp

Events should be paginated by run and sequence. High-frequency text deltas should use the Agent component's streaming facilities or be coalesced before storage.

### `agentApprovals`

- `brainInstanceId`
- `runId`
- harness request ID
- kind: command, file change, network, secret, push, PR, deployment, user input
- user-facing title and explanation
- redacted structured details
- available decisions
- status: pending, accepted, declined, cancelled, expired
- decided by and timestamps
- optional scope: command, turn, session

## Run state machine

```text
queued
  -> claimed
  -> preparing
  -> running
  -> waiting_for_approval
  -> running
  -> verifying
  -> awaiting_publish_approval
  -> publishing
  -> in_review

Any active state may become:
  interrupted -> queued/resumable
  failed
  cancelled
```

Rules:

- Claiming must be atomic and lease-based.
- A host renews the lease with heartbeats while active.
- An expired lease does not automatically start a second harness against the same worktree. Reconciliation must inspect existing state first.
- Client retries must be idempotent.
- Only one active run may own a task chat/worktree unless explicit parallel execution is introduced later.
- Task status transitions should remain compatible with the existing Skippy lifecycle.

## Runner protocol

### Registration and heartbeat

The runner authenticates with a revocable host credential, registers its capabilities, and updates heartbeat state periodically. The UI derives Online, Busy, or Offline from recent heartbeat data rather than trusting a manually set flag.

### Work discovery

Use both:

- A reactive Convex subscription for low-latency work discovery.
- Periodic reconciliation polling to recover from dropped subscriptions, process restarts, or missed events.

### Claiming

The runner calls an atomic mutation that:

- Confirms the run is queued and compatible with the host, including that the run's harness is in the host's advertised harness capabilities.
- Confirms no conflicting active run owns the task or workspace.
- Records the host, lease, claim version, and claim timestamp.
- Returns only the authorized execution brief and project configuration.

### Event delivery

- Assign sequence numbers on the runner or atomically on ingestion.
- Batch high-frequency events.
- Make event ingestion idempotent by `(runId, sequence)` or an equivalent event key.
- Redact secrets before network transmission.
- Store finalized messages separately from ephemeral progress.

### Control delivery

Approvals, cancellation, interruption, and user follow-up messages are written to Convex. The runner subscribes to control state and forwards the decision to the harness. Control messages must include a stable request ID so retries cannot approve a different command accidentally.

## Workspace and Git behavior

### Repository mapping

- Each project maps to one explicitly allowlisted local repository.
- Validate the canonical resolved path before every run.
- Reject paths outside the runner's allowed project root.
- Project selection is an authorization boundary, not a UI hint.

### Worktrees

- Never let concurrent chats share a mutable checkout.
- Create one Git worktree per code-changing chat or task run.
- Use predictable but sanitized branch names, such as `agent/task-<taskId>-<slug>`.
- Record worktree and branch metadata durably before starting the harness.
- Reuse a worktree when resuming the same chat.
- Detect uncommitted or unpushed changes before cleanup.
- Prefer recoverable archival over automatic deletion.

### Worktree provisioning (2026-08-21)

- After creating a worktree, the runner runs `corepack pnpm install` (frozen lockfile when one exists) with the worktree as cwd before the harness session starts, emitting `provisioning` / `worktree_ready` status events. A provisioning failure degrades gracefully (the run continues against a bare worktree); it never fails the run.
- On startup the runner extends its own process PATH with node's bin directory and a corepack shim directory (`~/.skippy-runner/corepack-shims`, materialized via `corepack enable`), so plain `pnpm` resolves in harness sessions without plist edits or PATH improvisation.
- Task briefs can therefore just say `pnpm typecheck` / `pnpm --filter web test` — both allowlisted — instead of bootstrap incantations like `npx --yes pnpm@…` or `corepack pnpm …`.
- After merging runner changes, rebuild and restart: `pnpm --filter @skippy/runner build`, then `apps/runner/scripts/restart-runner.sh` (see "Restarting the runner" below). From a terminal `launchctl kickstart -k gui/$(id -u)/com.skippy.runner` is equivalent; from a chat turn or agent pass it is not.

### Publishing

- Do not push directly to the default branch.
- Use a short-lived GitHub App installation token when practical.
- Require explicit approval before the first push/PR in the initial release.
- Create or update a pull request and attach it to the Skippy task.
- Finish in In Review.

## Security model

### Mac account isolation

Run the service under a dedicated macOS account such as `skippy-runner`. That account should have access only to selected project roots and required development tools. It should not have access to the primary user's home directory, browser data, messages, photos, documents, or general Keychain items.

### Network model

- The runner initiates all normal connections outbound.
- Do not expose SSH, `tmux`, a web terminal, or the harness API to the public internet.
- Use Tailscale or another private administrative channel only for manual maintenance.
- Consider an egress allowlist for routine execution, with approval for new destinations.

### Credentials

- Never store plaintext runner, GitHub, MCP, or model credentials in Convex.
- Use revocable, scoped, short-lived credentials wherever possible.
- Extend MCP tokens with expiry and scopes before providing one to an execution environment.
- A run-scoped Skippy MCP token should allow only the context reads and task-result writes required by that run.
- Redact secrets from command arguments, environment displays, logs, errors, and chat messages.

### Default approval policy

Allow automatically:

- Read access inside the selected repository/worktree
- File edits inside the worktree
- Tests, typechecks, linting, and builds inside the worktree
- Known-safe package-manager commands when the project's policy permits them

Require approval:

- Access outside the selected project boundary
- Destructive filesystem or Git operations
- Reading secrets or unrelated environment variables
- New or unexpected network destinations
- Pushing commits or creating/updating a PR in the initial release
- Deployments, production mutations, and merges

Never allow in the initial release:

- Direct pushes to the default branch
- Automatic merge
- Automatic production deployment
- Reading the primary macOS user's private folders or credentials

## `tmux` role

`tmux` may wrap a harness process to aid continuity and manual debugging, but it is not the Skippy protocol or source of truth.

Appropriate uses:

- Give each run a predictable local session name.
- Permit private administrative attachment through Tailscale/SSH.
- Preserve a fallback terminal view during early development.

Do not:

- Parse terminal text as the primary structured event stream.
- Expose `tmux` directly to the web app.
- Depend on a session name as the durable run identifier.
- Treat a running terminal as proof that a Convex run is healthy.

## Failure and recovery

### Browser disconnect

No effect on execution. Convex remains the source of UI state, and the user can reopen the chat from another device.

### Runner restart

On startup, the runner lists its claimed, preparing, running, and waiting runs. It inspects the worktree and harness session, resumes when safe, or marks the run interrupted with a clear recovery action.

### Restarting the runner (2026-09-02)

Use `apps/runner/scripts/restart-runner.sh`. It is the only restart path safe to invoke from a chat turn or agent pass, because a harness session is a **child of the runner** — restarting naively kills the caller.

What went wrong three times in one hour on 2026-09-02: a chat turn deployed Convex, then ran `launchctl bootout … ; sleep 2 ; launchctl bootstrap …` to pick up the new build.

- `bootout` SIGTERMs the runner, which drains in-flight work before exiting — and the work it drains is the chat turn issuing the command. Neither side can finish.
- launchd tears down the job's whole process group, killing the harness mid-`Bash`. The turn never reports a result, so its lease is stranded (see the cron sweep in `convex/crons.ts`).
- `bootout` also *unloads* the job, and the `bootstrap` two seconds later fails against a still-draining process. `KeepAlive` cannot help an unloaded job — it stays dead until a human runs `launchctl bootstrap` from a terminal. One occurrence went unnoticed for 16 minutes.

Rules the script encodes:

- **Never `bootout`** to restart. `launchctl kickstart -k` keeps the job loaded and lets launchd own the relaunch. Reserve `bootout` for genuinely uninstalling.
- **Detach the restart** (`spawn(..., { detached: true })` → `setsid`) so it survives the caller's process group being torn down.
- **Return immediately.** The caller cannot wait for its own host to come back; blocking is what stranded the turns. Outcome is appended to `~/Library/Logs/skippy-runner-restart.log`.
- **Delay the kill** (default 15s, `--delay`) so the requesting turn finishes and releases its lease before SIGTERM lands.

`--wait` blocks until healthy, for terminal use only. From a terminal, plain `launchctl kickstart -k` remains fine.

### Mac offline

- Host status becomes Offline after heartbeat expiry.
- Queued runs remain queued.
- Active runs become disconnected/interrupted in the UI but are not immediately reassigned.
- The user may cancel, wait for reconnection, or later choose another execution target.

### Harness failure

Capture a safe error summary, preserve the worktree, and offer Resume. Do not discard uncommitted changes automatically.

### Convex/network interruption

Buffer a bounded number of events locally with stable sequence IDs. Retry idempotently. If the buffer limit is approached, pause execution rather than lose approval or audit events.

### Duplicate execution request

The server returns the existing active run and opens its chat rather than creating a competing run.

## Observability and retention

Track:

- Host heartbeat, version, capacity, and last error
- Queue wait time
- Run duration by phase
- Harness and model
- Command counts and exit status
- Approval wait time
- Verification outcomes
- Final branch and PR
- Failure category and retry count

Retention policy:

- Keep user and assistant messages durably.
- Keep important structured events and approval history durably.
- Coalesce or expire low-value streaming deltas.
- Retain full local logs for a bounded period with automatic cleanup.
- Never retain secrets in either location.

## Cloud execution compatibility

The execution contract must not assume that a host is a Mac. Host-specific behavior belongs behind workspace and harness adapters.

Future cloud execution can reuse the same:

- Project chats
- Run and approval state machines
- Event protocol
- Kanban Execute flow
- Harness adapter
- Result and PR lifecycle

The user can eventually choose:

```text
Execution target: Mac mini (Online) | Cloud sandbox
```

The Mac mini remains preferable for existing local projects, Xcode/iOS work, persistent caches, and personal single-user cost. Cloud sandboxes are preferable for untrusted code, clean reproducible environments, high concurrency, and temporary public previews.

## Delivery phases

### Phase 0: Protocol and safety spike

- Define run, event, control, approval, and host contracts.
- Validate the contracts against **both** harness event models (Codex App Server events and Claude Agent SDK messages/hooks) — at minimum a paper mapping — so the protocol doesn't end up Codex-shaped.
- Prove atomic run claiming and heartbeat expiry.
- Prove a dedicated macOS service account can access one test repository and nothing else sensitive.
- Prove structured Codex App Server events can be translated and redacted.
- Prove restart/reconciliation without losing a worktree.

### Phase 1: Single-host execution vertical slice

- Register one Mac mini runner.
- Support one configured code project.
- Execute one Ready task from its Kanban card with one harness (the project default).
- Create a task-specific chat.
- Create a dedicated worktree/branch.
- Stream assistant messages, plan, commands, and status.
- Pause for push approval.
- Create a PR and move the task to In Review.

### Phase 2: Complete project chat experience

- General and multiple named chats per project.
- Project switching and last-opened chat memory.
- Conversational versus code-changing chat behavior.
- Rich diff, verification, approvals, and resume UI.
- Chat rename/archive and task linking.
- Second harness adapter (whichever of Codex/Claude wasn't first) and the harness picker on Execute, project config, and new-chat creation.

### Phase 3: Reliability and operational hardening

- Runner upgrades and version compatibility.
- Local event buffering and idempotent replay.
- Resource and concurrency limits.
- Log retention and redaction tests.
- Host draining, maintenance, and recovery UX.
- Scoped, expiring MCP and GitHub credentials.

### Phase 4: Additional harnesses and cloud targets

- Further harness adapters beyond Codex and Claude, if wanted.
- Vercel Sandbox or E2B execution host.
- Target selection and policy routing.
- Cloud previews and parallel execution.

## Initial acceptance criteria

- A signed-in user can switch projects and see only that project's chats.
- Each project can have a persistent General chat and multiple additional chats.
- A Ready, accepted, agent-owned task has an Execute action.
- Clicking Execute creates exactly one queued run and opens a task-specific chat.
- An online Mac mini runner claims the run without an inbound public connection.
- The runner operates only inside the selected project's dedicated worktree.
- The web app receives durable assistant messages and structured run progress through Convex.
- The user can leave and reopen the app without losing the run or transcript.
- Sensitive operations pause and render an approval request in the web app.
- Runner restart does not silently duplicate work or delete uncommitted changes.
- Successful execution records verification, branch, PR URL, and summary on the task.
- The task ends In Review unless the owner explicitly chooses another completion policy.
- Switching projects never changes an active run's project, worktree, or authorization boundary.

## Open decisions

- Codex authentication: server-owned API key versus a user-completed ChatGPT device-code flow.
- Claude authentication: `ANTHROPIC_API_KEY` (metered) versus Claude subscription OAuth login on the runner account, and how each credential is stored/rotated on the Mac mini.
- Whether the existing free-text `tasks.requestedHarness` is migrated to the typed enum or kept as display metadata alongside a new typed field on runs.
- Whether General chats can start read-only repository analysis automatically.
- Whether the first push/PR always requires approval or can become a per-project policy.
- Whether one chat owns one permanent branch or may create multiple sequential branches.
- How much command output belongs in Convex versus local retained logs.
- Whether project previews should be tunneled from the Mac or deferred to cloud/Vercel preview deployments.
- Whether the first runner communicates with Convex using the JavaScript client, authenticated HTTP endpoints, or a combination.
- Worktree cleanup and archival duration after merge, cancellation, or abandonment.
- Initial concurrency limit for the Mac mini.

## Relevant existing Skippy surfaces

- `convex/schema.ts`: projects, tasks, execution state, agent-request state, branch and PR result fields.
- `convex/projects.ts`: Ready-task queries, request-agent behavior, execution transitions, and result recording.
- `apps/web/app/hubs/project-board.tsx`: Kanban board and current agent-request controls.
- `apps/web/app/api/mcp/route.ts`: remote Skippy MCP endpoint.
- `convex/mcpTokens.ts`: current bearer-token creation and authentication.
- `docs/codex-heartbeat.md`: existing requested-Ready task execution contract.

## External implementation references

- Codex App Server: <https://learn.chatgpt.com/docs/app-server>
- Codex SDK: <https://learn.chatgpt.com/docs/codex-sdk>
- Claude Agent SDK overview: <https://code.claude.com/docs/en/agent-sdk>
- Claude Agent SDK (TypeScript): <https://code.claude.com/docs/en/agent-sdk/typescript>
- Convex Agent overview: <https://docs.convex.dev/agents/overview>
- Convex Agent messages: <https://docs.convex.dev/agents/messages>
- Convex durable streaming: <https://docs.convex.dev/agents/streaming>
- Vercel Sandbox: <https://vercel.com/docs/sandbox>
- E2B persistence: <https://e2b.dev/docs/sandbox/persistence>
- GitHub Codespaces lifecycle: <https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle>

