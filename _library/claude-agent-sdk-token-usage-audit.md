# Claude Agent SDK token-usage audit

Date: 2026-08-22  
Scope: Skippy chats and task runs executed by `apps/runner` through `@anthropic-ai/claude-agent-sdk`

## Bottom line

The worktrees themselves are not consuming tokens. The expensive part is that every task/worktree is paired with a separate, full Claude Code agent session. Skippy is currently configured to run **three task agents concurrently**, while conversational chat runs in a separate concurrency lane. In practice that permits **up to four simultaneous harness sessions** (three tasks plus one chat). When those are Claude sessions, they all draw from the same Claude subscription usage window.

That is the clearest explanation for reaching the limit after a couple hours. The runner log confirms that immediately after concurrency was raised from 1 to 3 on August 21, it launched three Claude runs within ten seconds and then launched a Claude chat while those runs were active. This is approximately four independent agents reading code, invoking tools, interpreting results, and generating answers at once—not one agent made faster by worktrees.

Anthropic also states that Claude app and Claude Code activity share the same plan limits, and that Opus reaches the limit about five times faster than Sonnet. Skippy does not currently select a model in the SDK options, so its effective model is whatever Claude Code/user configuration chooses by default. That makes consumption both uncontrolled and hard to predict.

## What is multiplying usage

### 1. Parallel agents multiply model turns

Live configuration:

- `SKIPPY_RUNNER_MAX_CONCURRENCY=3`
- Task scheduler: up to three simultaneous task runs
- Chat scheduler: one additional chat turn, deliberately independent of task concurrency
- Effective maximum: four harness sessions at once

Each agent has its own context and agent loop. If three agents independently inspect the same repository, each pays for its own file reads, search results, command output, reasoning, and responses. Git worktrees prevent conflicting edits, but they do not share Claude's understanding or token cache as a single conversation.

Log evidence from 2026-08-21:

```text
19:57:19 runner ready {"maxConcurrency":3}
19:57:45 claimed run ... "harness":"claude"
19:57:50 claimed run ... "harness":"claude"
19:57:55 claimed run ... "harness":"claude"
19:59:06 claimed chat turn ... "harness":"claude"
```

Before this change, the runner repeatedly started with `maxConcurrency:1`.

### 2. Every task starts a new Claude session

Task runs normally have no reusable `externalThreadId` on their first execution. Therefore every queued task gets a fresh Claude Code session and must rediscover the repository and relevant architecture. Eleven Git worktrees are currently registered, which is evidence of many isolated task attempts (not itself a token charge).

This setup is good for code isolation, but costly when tasks are small, overlapping, or touch the same subsystem. Three related tasks can cause three agents to read the same files and run the same tests.

### 3. Chats and tasks compete for the same Claude allowance

The chat path is intentionally outside `maxConcurrency`, so chatting while three Claude tasks run adds a fourth consumer. The runner log shows frequent Claude chats during long-running Claude tasks. Anthropic documents that Claude and Claude Code share plan usage; the Agent SDK is driving Claude Code under that same authentication.

### 4. The model and turn budget are unconstrained

The Claude adapter passes neither `model` nor `maxTurns`/a monetary or token budget to `query()`. As a result:

- Skippy cannot route routine chats or mechanical tasks to a cheaper model.
- An agent may continue its tool loop until it decides it is finished, is cancelled, or hits the account limit.
- A broad or ambiguous task can consume many model calls.
- If the inherited default is Opus, Anthropic says usage limits are reached about five times faster than with Sonnet.

This does not prove that every current session is using Opus—the runner fails to record the effective model—but it is a material uncontrolled variable.

### 5. Full Claude Code configuration is loaded into every session

The adapter explicitly uses:

```ts
settingSources: ["user", "project", "local"]
```

This loads user/project/local settings, `CLAUDE.md`, hooks, commands, and configured MCP servers into every SDK session. Anthropic changed the Agent SDK default to load no filesystem settings specifically for predictable deployed behavior; Skippy opts back into all sources.

In this checkout, the local Claude settings are mainly a large permission allowlist, so this is probably secondary to concurrency. However, user-level instructions, hooks, plugins, or extra MCP servers may add tool schemas, startup context, or extra tool activity to every agent. Skippy already injects its required MCP server explicitly, so loading every source is broader than necessary.

### 6. Tool output and repeated verification expand later turns

Claude Code's agent loop sends relevant prior tool results back to the model. Large `rg`, test, build, or diff output therefore increases context. Parallel agents often repeat those same operations. The runner additionally executes project verification after the agent finishes; that deterministic runner-side verification does not itself use Claude tokens, but agents are also told to verify their work and commonly run tests before the runner repeats them.

### 7. Usage telemetry is emitted but effectively discarded

The Claude adapter receives the SDK result's `message.usage` and emits a `usage` event. But:

- Chat execution filters live events to a set that excludes `usage`, so chat usage never reaches the control plane.
- Task usage events may be transient event rows, but there is no durable per-run aggregation, dashboard, alert, or model record.
- The daemon log records claims and completions, not token totals or the effective model.

Consequently, Skippy cannot presently answer “which agent spent the tokens?” from its own data. This is a measurement defect, and it is why this audit can identify strong multipliers but cannot calculate an exact token total per run.

## Recommended changes, in order

### Immediate operational changes

1. **Reduce Claude task concurrency from 3 to 1.** This is the fastest and highest-confidence fix. If parallelism is important, start with 2 only after usage tracking exists.
2. **Make chat share the global harness limit**, or reserve capacity explicitly (for example, maximum two total Claude sessions: one task and one chat). Do not treat chat as free concurrency.
3. **Use Sonnet by default for chats and ordinary tasks.** Allow Opus only as an explicit per-task choice for genuinely difficult work.
4. **Bundle related small tasks into one run** when they touch the same files or require the same repository discovery. Keep separate worktrees for genuinely independent changes.
5. **Stop or cancel agents that are waiting, looping, or no longer useful.** An approval wait itself should not call the model, but a denied tool followed by repeated improvisation can create additional turns.

### Product/code changes

1. Persist a usage record for every completed or failed SDK turn, including:
   - run/chat ID
   - session ID
   - harness and effective model
   - input, output, cache-creation, and cache-read tokens when provided
   - duration and number of agent/model turns
2. Add daily and rolling five-hour usage views grouped by chat, task, project, and model.
3. Add configurable limits:
   - global Claude session concurrency
   - separate task/chat quotas whose sum cannot exceed the global limit
   - default model by workload type
   - `maxTurns` per chat turn and task run
   - optional per-run cost/token ceiling if supported by the chosen SDK/auth path
4. Change `settingSources` to the minimum needed. A reasonable first experiment is `['project']`, or no setting sources plus the explicitly injected Skippy MCP and a deliberate system prompt. Audit user-level hooks/MCP configuration before retaining `user` and `local`.
5. Add prompt guidance that bounds exploration: identify likely files first, avoid repository-wide reads unless needed, cap command output, and run the narrowest relevant tests.
6. Avoid duplicate verification where practical. Let the agent run targeted checks; keep the runner's deterministic configured verification as the final gate.
7. Surface the estimated usage impact before launching a batch of parallel tasks: “3 Claude agents plus chat may run concurrently.”

## Suggested safe default

```text
Global Claude concurrency: 2
Task concurrency: 1
Chat concurrency: 1 (counts against global limit)
Default chat model: Sonnet
Default routine task model: Sonnet
Opus: explicit opt-in
Task max turns: 20–30 initially, then tune from telemetry
Chat-turn max turns: 8–12 initially, then tune from telemetry
```

If the primary goal is maximizing uninterrupted subscription time, use a global Claude concurrency of **1** and queue chats behind active task runs (or route chats/tasks to Codex when appropriate). If responsiveness matters more, use the two-slot default above.

## What is not the cause

- The Git worktree filesystem copies do not consume model tokens by existing.
- Polling Convex every few seconds does not consume Claude tokens.
- Heartbeats and live UI event flushing do not consume Claude tokens.
- Runner-side dependency provisioning and post-agent verification consume CPU/time, not model tokens, unless their output is subsequently given to an agent.

## Evidence inspected

- `apps/runner/src/config.ts`: default concurrency and runner configuration
- `apps/runner/src/main.ts`: independent task and chat schedulers
- `apps/runner/src/harness/claude.ts`: SDK query options, configuration sources, session resume, and usage event emission
- `apps/runner/src/chatExecutor.ts`: fresh-thread history behavior and dropped usage events
- `apps/runner/src/runExecutor.ts`: fresh task prompt, worktree lifecycle, and repeated verification
- `convex/chats.ts`: 20-message bootstrap history and session reset/resume behavior
- Live launchd configuration and `~/Library/Logs/skippy-runner.log`
- Anthropic documentation:
  - [Using Claude Code with a Pro or Max plan](https://support.anthropic.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)
  - [Claude Agent SDK migration guide (setting sources)](https://platform.claude.com/docs/es/agent-sdk/migration-guide)

## Conclusion

The account is not mysteriously losing tokens. Skippy changed from one Claude worker to a small parallel agent fleet, while leaving chat outside the task limit and leaving model/turn budgets unspecified. The decisive first move is to lower concurrency and count chats against a global Claude cap. The decisive engineering follow-up is durable per-session usage telemetry; without it, future tuning will remain anecdotal.
