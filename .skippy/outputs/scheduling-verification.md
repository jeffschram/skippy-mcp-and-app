# Unattended scheduling verification — 2026-11-13

**Acceptance not met. Keep existing ingestion enabled.** This task obtained bounded responses from Gmail, Calendar, Messages and Skippy in the current harness session. A fresh noninteractive Codex process failed before model/tool execution, twice. There are **zero newly demonstrated consecutive scheduled passes and no demonstrated live recovery path**. Unit tests and earlier recorded success do not satisfy that gate.

## Evidence and scope

- Checkout: `3ead4682f4d3db58099fa1e0c68bdf5d889c44fc`; dedicated task worktree; empty input manifest.
- Host observed: Darwin arm64; `/opt/homebrew/bin/codex`, `codex-cli 0.154.0`; `codex login status` reports ChatGPT authentication. This establishes current login, not refresh-after-expiry behavior.
- Current task policy: workspace-write, restricted network, no permission escalation. No permissions, credentials, production schedules, source readers or ingestion settings changed. No push, merge or deployment.
- Native connected-tool baseline: Gmail `gmail_search_emails`, limit 1, `after:2026/11/12 before:2026/11/14`, returned one result; Calendar `google_calendar_search_events`, primary, limit 1, November 13 midnight–November 14 midnight America/New_York, returned an empty successful response; Messages `find_chats`, limit 1, November 12–14 midnight America/New_York, returned one chat; Skippy `get_current_context` returned structured context. These were discovery/context reads, not message-body verification or separate scheduled invocations. No private source content is included here.
- At `2026-11-13T15:36:01.489247Z`, a fresh no-TTY `codex exec --json --cd . --skip-git-repo-check --color never --sandbox read-only --ephemeral -` received a bounded four-source diagnostic prompt over stdin. It exited 1 in 0.05 seconds, stdout empty: `failed to initialize in-process app-server client: Operation not permitted (os error 1)`.
- At `2026-11-13T15:36:26.626247Z`, a readiness-only retry with `--sandbox workspace-write` exited 1 in 0.028 seconds with the same error. See `noninteractive-retry.json`. This isolates failure before connector calls; it does not establish an OAuth or Messages permission failure. No bypass was attempted.
- Earlier evidence in `docs/codex-connector-verification-2026-11-12.md` records one real Skippy-scheduled Messages pass at 15:06Z November 13. It used an isolated PM diagnostic config and default token, not the final Agenda configuration. Treat that as historical capability evidence, not today's consecutive-run result.

## Scheduling ownership

Prefer a desktop-owned Codex scheduled task as the next candidate to qualify. Official documentation supports local background tasks and plugins, requires the computer on and desktop app running for local projects, and directs CLI users to web/desktop for schedule management. No general Codex scheduler-management tool is exposed in this task; Pages/Sites schedule tools belong to different products. A native desktop schedule was not created or exercised. [Scheduled tasks](https://learn.chatgpt.com/docs/automations?surface=app).

Retain the existing Skippy trigger until the candidate passes the live gate. Its current claim → `executeAgentPass` → `CodexAdapter` path already provides a minimal trigger without implementing source readers. If native scheduling cannot supply the four connectors together or adequate recovery evidence, use that existing path with native connector tools and an explicit read-only diagnostic skill. Do not build another scheduler or restore custom source-reading code to work around native connector failures.

Cloud-only scheduling is not established as a substitute for local Messages access. Official documentation describes Messages as an Apple Silicon desktop capability requiring requested macOS permissions, and says it is not directly available in CLI/web. Prior local CLI success shows this host can sometimes expose it; the desktop transport dependency remains unresolved. [Messages plugin](https://learn.chatgpt.com/docs/plugins#use-apple-messages-from-codex).

## Runtime requirements and cadence

| Requirement | Status |
|---|---|
| Mac architecture | Apple Silicon observed |
| Codex account login | ChatGPT login observed; refresh/expiry untested |
| Gmail/Calendar authorization | Current native searches succeeded; independent from legacy local Google credentials |
| Skippy authorization | Current task-scoped context read succeeded; final Agenda token must be tested separately |
| Desktop running / Mac powered on | Required for local scheduling by official docs; app-off and sleep behavior not exercised |
| Messages permission | Discovery succeeded now; precise TCC grant/permission owner and restart persistence not established |
| macOS login | Installer uses a user LaunchAgent with RunAtLoad/KeepAlive; logged-out and reboot-before-login behavior untested |
| Network | Required for model and remote connectors; this task's subprocess failed before connectivity could be assessed |

Recommended qualification cadence: two invocations five minutes apart, each limited to one search and at most one content read per source, one Skippy read, no writes, three-minute outer deadline, no automatic repeated reads. Stop the temporary test schedule after the recovery run. This cadence is proposed, not measured. Recommended production starting cadence is the repository's existing hourly 09:00–21:00 America/New_York budget, subject to reading the actual deployed config; the seed is not proof of current production settings. Preserve the existing ingestion owner throughout qualification.

## Failure and recovery matrix

The following Skippy behaviors were inspected in source; none constitutes a live chaos test.

| Case | Evidence / limit | Remaining demonstration |
|---|---|---|
| Two unattended passes | New subprocess attempts both failed at startup | Two scheduled run IDs, source outcomes, durations, no prompts |
| Desktop/daemon restart | LaunchAgent installer has RunAtLoad and KeepAlive | Restart an isolated diagnostic host, then repeat all four reads |
| Mac unavailable | Local Messages cannot be assumed reachable; no outage induced | Observe missed due slot during isolated outage, restore host, observe catch-up |
| Expired authorization | Not induced; live account grants were preserved | Use a separate test connection or injected auth failure; reconnect and replay identical window |
| Missed schedules | Claim advances nextDueAt from current time; missed slots collapse; 15 schedule tests passed | Actual scheduler catch-up after downtime |
| Overlap | 150-second lease; 30-second heartbeat; runner checks one active agent pass; 5-second polling | Concurrent claims and heartbeat-loss test with isolated config |
| Retry | Failed result clears claim but does not reset nextDueAt; no dedicated backoff/retry loop in inspected executor | Failed scheduled run followed by successful same-window run |
| Startup failure | Fresh launch and readiness retry both return EPERM | Run same bounded prompt from the intended supported desktop/runner context |
| Long downtime | Cursor caps at 48 hours; older gaps are not automatically recovered | Explicit bounded backfill plan and gap reporting after >48h outage |

Important code limits:

- `convex/agentConfigs.ts`: advancing due time on claim prevents immediate replay after a crash; lease expiry alone does not make a not-yet-due config eligible. `completeAgentPass` fences by token/host, not elapsed lease time alone, despite its comment about lapsed leases.
- `apps/runner/src/main.ts`: one-active-pass check has no in-flight claim flag. A slow claim request can overlap another poll; atomic per-config claiming limits duplicate claims but does not prove strict global serialization across configs. Network partitions can also leave an old worker running after lease expiry. No source write deduplication was tested here.
- `apps/runner/src/agentPassExecutor.ts`: 15-minute ceiling and unattended approval decline; reports harness failure. Harness completion alone does not prove every connector succeeded. Acceptance must inspect per-source outcomes.
- `apps/runner/src/ingestionCursor-helpers.ts`: last completed ingestion timestamp minus 15 minutes, bounded to 48 hours. A failed ingestion record should not advance this cursor. Partial-source failures must not be reported as full coverage. Prompt parameter names still reference legacy iMessage `since` and calendar `list_events`; native Messages uses `from`, and native Calendar uses `search_events`. Use explicit native tool arguments in the diagnostic prompt.
- Role token fallback can use the full default token if the Agenda-scoped token is absent. Qualify the actual scoped token; do not count a broad-token test as equivalent.

## Verification performed

Existing tests only; no production code changes:

```
pnpm exec vitest run apps/runner/src/agentPassExecutor.test.ts apps/runner/src/ingestionCursor-helpers.test.ts apps/runner/src/harness/codex.test.ts
# 3 files, 35 tests passed; 234 ms
pnpm exec vitest run packages/shared/src/agent-schedule.test.ts
# 1 file, 15 tests passed; 183 ms
```

Coverage includes failure/throw reporting, unattended approval decline, role token plumbing, cursor-fetch fallback, bounded cursor math, missed-slot calculation and time-zone scheduling. These use mocks/pure functions, not real connector expiry, restart or scheduler invocation. No claim is made that a live recovery was demonstrated.

## Exact continuation gate

Use `bounded-pass-prompt.md` in the supported desktop schedule context. Record the actual app version, runtime identity, selected model, final Agenda-scoped token identity (never its value), enabled plugin names, schedule timezone and next due timestamps. Establish the first content read interactively if macOS permission setup is required; that setup pass does not count.

Collect two consecutive scheduled passes, each with all four outcomes, run ID, due/start/end UTC timestamps and whether any interaction was requested. An empty Calendar search is a valid bounded response but does not prove event-body access; label it accordingly. Then induce one isolated connector/host failure, record failure without moving the coverage cursor, restore it and show a scheduled successful replay of the same window. Test remaining matrix rows without stopping production ingestion. A simulated error must remain labeled simulated and cannot establish real token renewal.

The current blocker is the execution boundary, not missing consent: this task cannot escalate beyond its sandbox. Re-run qualification through the existing host runner or desktop scheduler with its normal approved configuration. Keep this task's acceptance open until those run artifacts exist. The runner will upload this directory to canonical Convex projectFiles; these local paths are disposable.
