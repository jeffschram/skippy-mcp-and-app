# Scheduled Codex ingestion: operational readiness

2026-11-13; checkout `4f464d09ac2c9723f2f7e6ffd68862d9dcbd6e07`; task `mn7fkm3shyz98hmyp5ma6amnyn8j3q7h`.

**Blocked; implementation and deployed acceptance are not complete.** No schedule, production configuration, credentials, runtime, or application code was changed. No scheduled source pass was executed. This is an operational handoff, not an executable deployment configuration.

## Canonical decision checked this run

Read Skippy `get_task_brief` for gate task `mn79qr2j7dxp1t11e0mbps4p858j3qzw` and `get_project_plan` for project `m973pm823t97ykxzbnx1s9gs2x884nnc`. The gate is administratively done, but its result explicitly says **NO-GO; implementation remains locked**. Its acceptance requires no unresolved source or unattended-recovery gaps. Tasks 5 and 6 delivered code; neither claims to close that gate. No later passing assessment appears in the phase results.

The selected conditional mechanism is the existing Skippy `agentConfigs` → runner claim → `executeAgentPass` → `CodexAdapter` path. Preserve the actual existing enabled/disabled state. Do not create a second ingestion scheduler or infer deployed cadence from seed data. Task 3's desktop-scheduler preference did not supersede the gate's ownership decision.

## Configuration to capture and qualify after gate closure

Record the actual Agenda config ID, host ID/account, enabled state, schedule/timezone/active window/next due UTC, `preferredHarness: codex`, explicit model or resolved harness default, and deployed skill versions for `harness-bootstrap` and `agenda-ingestion`. Capture the installed runner/MCP/backend revisions together. Task 6 changes require compatible runner and backend signatures.

Use the existing account's Codex login and connected Gmail, Google Calendar, Apple Messages, and Skippy MCP. Record plugin inventory and source account/scope identifiers in the private configuration record; publish sanitized identities only. Resolve the approved Gmail mailbox scope, Calendar IDs and Messages account context before qualifying coverage. Do not infer native connector availability from local connector slugs.

Record `SKIPPY_MCP_URL`, presence and nonsecret identity of `SKIPPY_MCP_AGENDA_TOKEN`, and successful scoped access to skills, source progress, ingestion writes and reports. Never export token values or replace a missing Agenda token with the default full-access token. No new credential store or source reader is needed.

Historical evidence used Apple Silicon macOS account `skippy` and Codex CLI 0.154.0. That is not a fresh runtime verification. The Mac must be available, logged into the intended GUI account, with the connector's required desktop session and Messages permissions established there. Verify Codex login and all four tools in the actual runner child process. An interactive setup read, tool inventory, broad-token PM diagnostic, or a model exit code alone cannot qualify Agenda.

Keep existing production cadence unchanged. A temporary, isolated, read-only qualification schedule may use two passes five minutes apart and a three-minute diagnostic deadline, then one controlled failure/recovery sequence. Disable only that diagnostic config afterwards. Production cadence and the single-owner handoff require the actual deployed config and task 8 validation.

## Controls inspected in this checkout

| Control | Present | Remaining work before activation |
| --- | --- | --- |
| Cadence | `packages/shared/src/agent-schedule.ts` computes future due slots; claim collapses missed slots | Capture actual deployed cadence and timezone; qualify downtime behavior |
| Trigger overlap | `convex/agentConfigs.ts` uses atomic claims and 150-second leases; runner heartbeats renew active passes | `main.ts` has no in-flight claim guard; delayed polling can dispatch different configs concurrently |
| Source overlap and replay | `convex/ingestionProgress.ts` has ten-minute fenced source leases, immutable retry windows, receipts and 15-minute overlap | Demonstrate actual concurrent/expired-worker rejection with final runtime |
| Retry | Failed windows survive in durable source progress | Trigger advances `nextDueAt` on claim; no durable 1/5/15-minute retry series. Add bounded retry state and fenced attempts after gate approval |
| Catch-up | Source claims process oldest-first chunks capped at 48 hours; first baseline is explicit | Prove long-outage recovery. First baseline does not claim earlier history; arbitrary older late arrivals remain unqualified |
| Run history | `ingestionRuns` preserves source manifests/outcomes; `activityEvents` records trigger completion/failure | Correlate every trigger attempt, including startup failure, with run ID, scheduled/start/end times, retry and source outcomes |
| Failure status | Durable aggregate rejects incomplete source coverage | `agentPassExecutor.ts` still reports trigger completed when harness completes; source failure can coexist with a green trigger. Gate trigger success on the authoritative aggregate |
| Scoped access | Runner config supports Agenda token | Executor still falls back to broad token; installer does not persist Agenda-token variable. Fail readiness closed and preserve existing role configuration during install |
| Completion fencing | Completion checks host/token | `completeAgentPass` does not reject solely expired leases despite its comment; require expiry check and recovery tests |

Source progress improvements in task 6 supersede task 3's older Agenda cursor limitation. They do not implement trigger backoff or establish connector completeness. Calendar mirror and approved Calendar write execution retain their existing owners.

## Restart and reconnect procedure

These are operator steps for the qualified host, not commands executed by this task.

1. Record current config, failed run IDs, immutable source windows and last covered-through timestamps. Preserve coverage on failure. Pause only the replacement/diagnostic config if it is repeatedly failing; preserve unrelated consumers and the established ingestion owner.
2. Classify the failure before changing anything. Startup `Operation not permitted` precedes connector execution; it is not proof of expired Google OAuth or denied Messages access. Repeat from the intended supported runner context without expanding sandbox permissions.
3. For an explicit connector authorization failure, reconnect that existing connector in the same Codex account/session. For Messages denial, establish the required permission interactively in that account, then repeat unattended. For Skippy denial, verify the existing scoped token's role/allowlist and endpoint through the existing credential mechanism. Never log credentials, copy Google tokens into a new store, or fall back to a custom reader.
4. If a runner restart is needed after normal publication, use the existing `apps/runner/scripts/restart-runner.sh` from the installed checkout. It detaches and delays restart; do not run `bootout` from a runner-owned child or use `--wait` there. From an independent operator terminal, `--wait` is available. Check the restart log for a new PID and a fresh `runner ready` line; a successful script launch is not proof of health. Logs are `~/Library/Logs/skippy-runner-restart.log` and `~/Library/Logs/skippy-runner.log` on that host.
5. Do not reinstall the LaunchAgent blindly: the current installer omits Agenda's scoped token. Verify its existing environment privately and preserve role credentials through the normal host configuration mechanism. Never dump the full plist/environment into artifacts.
6. Allow a new fenced attempt to claim the failed source's exact window. Do not reset its checkpoint or mark it completed manually. Independent sources may progress; missing or catching-up sources keep the aggregate incomplete. Under current trigger code the next cadence, not a promised backoff timer, drives automatic retry.
7. Verify successful same-window replay, unchanged identity/receipt behavior, authoritative per-source coverage and aggregate status. Resume only the intended schedule. Capture the new next-due timestamp and ensure no duplicate ingestion owner exists.

## Actionable failure report and acceptance evidence

For each attempt retain config/run/attempt identity, due/start/end UTC, runtime/config/skill identity, failure stage/category, affected source, retryability, next retry or next cadence time, frozen window, last covered-through, and a concrete recovery action. Use existing Convex history and source status inspection; do not introduce messaging integrations. Startup failure must report every expected source as not attempted, not empty/successful. Keep raw source content and credentials out of diagnostics.

Each scheduled report must distinguish Gmail, Messages, Calendar semantic reads, Calendar mirror (retained owner; not performed by this workflow), pending Home captures, and Skippy access. Include counts, pagination/persistence completion, baseline/gaps and caught-up status. A successful empty search is valid only for its confirmed scope/window; it does not prove content-read capability. Use the immutable expected-source manifest for aggregate validation.

Acceptance remains open until there is a passing gate; actual deployed config matching the qualified runtime; two consecutive scheduled all-source passes with final Agenda credentials/skill; and an isolated failure followed by scheduled same-window recovery without premature coverage advancement. Record restart, missed-slot, overlap and >48-hour outage evidence. Synthetic tests must remain labeled synthetic.

No live per-source results were produced by this task. Existing historical diagnostics must not be relabeled as this task's scheduled acceptance pass.

## Verification performed

`pnpm test` passed all 1,283 tests, including runner, scheduling and durable source-progress tests; output is in `scheduled-ingestion-tests.txt`. An initial focused invocation passed 31 tests but could not load the ingestion suite because `@skippy/shared` had not been built. The standard command built prerequisites and resolved that setup failure. These are existing synthetic tests, not scheduled-runtime evidence. `git diff --check` passed; only this task's output artifacts were added. No implementation changes or production mutations were made.
