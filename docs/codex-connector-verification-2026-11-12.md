# Codex connector access verification — November 12, 2026

Task: `mn76vjrwqrbws7nrq52s2tg6jh8j2gz1`, Phase 19 task 1.

## Outcome

Gmail, Google Calendar, and Skippy MCP passed real reads in a fresh, noninteractive Codex session matching the task runner's CLI invocation and launchd account/environment. **On November 13, an actual Skippy-scheduled Codex agent pass also found a Messages chat and read one message with text, without human intervention.** Basic connector-access verification has a positive result. Earlier chat permission denial and standalone launchd discovery failure remain historical observations, not proof that scheduled reads are impossible. Repeated unattended reliability, source coverage and recovery remain Phase 19 tasks 2–4; do not retire connectors or pass the migration feasibility gate on one successful scheduled pass.

No email, calendar event, or message was modified. No source credentials or permissions were changed. This report stores counts and capability evidence, not source content or third-party identifiers.

## Runtime evidence

- Host account: `skippy`; home: `/Users/skippy`; executable: `/opt/homebrew/bin/codex`; version: `codex-cli 0.154.0`.
- Worktree: `/Users/skippy/src/.skippy-worktrees/agent-task-jh8j2gz1-skippy-mcp-and-app`.
- Fresh probe thread: `01a1d1af-766d-7de2-946c-9648acd940db`; process exited 0 with a `turn.completed` event.
- Invocation matched `apps/runner/src/harness/codex.ts`: `exec --json --cd <worktree> --skip-git-repo-check --color never`, Skippy URL and bearer-token environment-variable config overrides, `--sandbox workspace-write`, prompt on stdin, no TTY, no resumed thread.
- Environment was constructed from the installed runner LaunchAgent, with the same PATH, macOS account/home, and task-scoped Skippy token. Secrets were supplied only through environment variables. No sandbox bypass was used for the probe.
- This verifies the task adapter's subprocess path, not a newly claimed production agent run or an unattended scheduled ingestion cycle. Task 3 must verify the actual scheduler, supervision, recovery, and operating conditions.

| Source | Existing Codex connector tools used | Observed result |
| --- | --- | --- |
| Gmail | `mcp__codex_apps__gmail_get_profile`, `gmail_search_email_ids`, `gmail_read_email` | Authenticated owner account matches the primary Calendar account. One bounded email read; message body present. Fresh-session pass. |
| Calendar | `mcp__codex_apps__google_calendar_list_calendars`, `google_calendar_search_events` | Eight accessible calendars, primary calendar owned by the same account, one event with description returned. Fresh-session pass. |
| Messages | `mcp__messages__find_chats`, `read_messages` in the parent chat | One recent iMessage chat returned. Content-read response: “Read access was not approved. No content was returned.” Content access remains blocked. |
| Messages, fresh subprocess | `count_message_activity`, `find_chats`, `read_image`, `read_messages`, `search_messages`, `send_message` exposed under `mcp__messages__` | Inventory only. No Messages calls made because the parent content read had been denied. No fallback to the Messages database or computer use. |
| Skippy | `mcp__skippy__get_task_brief` | Successfully read this exact task using the runner's task-scoped token. No ingestion write was attempted. |

Gmail used November 11–13 as its bounded search window, capped at one message. The primary Calendar search for November 12–19 returned no events; the explicit October 1–December 1 window returned one event, capped at one. These samples establish content access, not complete coverage or incremental correctness. Task 2 owns pagination, late arrivals, stable identifiers, edits and cancellations.

## Initial Messages denial

[OpenAI's Messages documentation](https://learn.chatgpt.com/docs/plugins#use-apple-messages-from-codex) describes an Apple Silicon macOS desktop integration and says it is not directly available in CLI. Actual runtime evidence here shows Messages tools exposed to a fresh `codex exec` process, and discovery working in the Codex chat. Tool exposure does not prove content permission, and the underlying desktop transport has not been established.

The parent task disables interactive approval prompts. The Messages tool explicitly reported that these settings may prevent its read confirmation and suggested **Ask for approval** or **Approve for me**. This was a hypothesis, not a confirmed cause or a required configuration change. The later owner-authorized test below used the existing agent settings without changing permissions and succeeded once. Apple ID identity is not exposed by the tested chat-discovery tool; only the local Messages store/account context is established.

## Follow-up: actual read and scheduled repetition (11:02–11:04 p.m. EST)

The owner explicitly requested the proposed unattended test. Both probes used macOS account `skippy`, working directory `/Users/skippy/src`, the installed runner LaunchAgent environment, the Agenda-scoped Skippy token, no model override, and a fresh Codex session. They reproduced the current agent-pass adapter settings, including the already-enabled host bypass setting. No configuration or permissions were changed. Each prompt requested one recent chat and at most one message in a two-day window, with metadata-only reporting and no alternative access paths.

| Probe | Launch and evidence | Result |
| --- | --- | --- |
| A | Manually launched noninteractive subprocess; thread `01a1d312-6c4a-7e11-b867-7615cedf4af4`, started `2026-11-13T04:02:41Z` | `messages.find_chats` and `messages.read_messages` both completed; final diagnostic reported one message, body present, no approval required. Process exited 0. |
| B | Temporary launchd scheduled job; parent PID 1; thread `01a1d313-d46e-7e10-94e1-8184cc4f4c47`, started `2026-11-13T04:04:13Z` | `messages.find_chats` failed with the diagnostic reporting `tool_error`. No content read was attempted. Model/process exited normally, which does not make the connector test a pass. |

The temporary launchd job used a one-shot guard, was unloaded after the result, and its removal was verified. Production Agenda schedules were untouched. Probe B used the macOS scheduler, **not Skippy's control-plane claim/heartbeat path**; successful Skippy scheduled ingestion still needs its own test. No source content was exported into this report or the diagnostic artifacts; Codex's own session logging remains governed by the harness.

These runs showed differing outcomes, not a proven causal dependency on launch method. The initial chat denial, successful manual unattended read, and scheduled discovery failure are three distinct observations. The scheduled diagnostic exposed only a generic error; it does not identify a permission, transport, or desktop-bridge root cause. The actual Skippy-scheduled test below did not reproduce it. Changing approval settings is not justified as the fix.

## November 13: actual Skippy scheduler passed

PR #216 remained unmerged. No application code, deployment, runner restart or permission change was needed.

An isolated config (`s579n8nhpsc3hz8d5362sjqcwx8j511g`, display name `Temporary Messages scheduler diagnostic`) used the previously unused generic `pm` role slot, explicitly selected Codex, and referenced only the private stored skill `messages-scheduler-diagnostic-20261113`. The existing scheduler accepts a fixed set of role names; this diagnostic did not run project-manager behavior or modify project-specific PM configs. Its daily schedule became due at `2026-11-13T15:06:00Z`.

The running daemon's normal `claimNextAgentPass` poll claimed the config at `15:06:03.695Z`, dispatched `executeAgentPass`, loaded the diagnostic skill through Skippy MCP, and launched a fresh Codex session (`01a1d571-c2d6-7382-89ea-1a1a0974e7c8`). The diagnostic called native `mcp__messages__find_chats` and `mcp__messages__read_messages`, reporting:

| Check | Result |
| --- | --- |
| Chat discovery | Success |
| Message-content read | Success; one message, nonempty body |
| Error details/category | None |
| Human intervention | None during the run |
| Connector's approval-required field | Unknown (`null`); do not infer a universal permission rule |
| Runner completion | Agent pass finished at `15:06:53.785Z` |

The diagnostic emitted only sanitized JSON at `/Users/skippy/src/.skippy-diagnostics/messages-scheduler-20261113.json`. Its lower date bound followed the runner's injected 48-hour lookback (`2026-11-11T15:06:03.696Z`); the upper bound was `2026-11-14T00:00:00-05:00`. Source contents and chat identifiers were not exported into the report.

The diagnostic configuration was disabled and its schedule cleared immediately after its single claim, preventing another scheduled execution. It is retained disabled as run evidence, with the private diagnostic skill. The existing Agenda configuration was already disabled at the start of this test and was left unchanged, as were Finance, task-executor and project-specific PM configurations.

**Scope limit:** this run exercised the real Skippy scheduler, daemon and Codex agent-pass adapter, but its isolated generic PM role used the runner's existing default Skippy MCP token because no PM-scoped token was configured. It did not use the Agenda-scoped Skippy token or full ingestion skill. Native Messages access worked on this path; Phase 19 task 3 should test the final Agenda configuration/token/skill, consecutive scheduled runs, desktop/runtime prerequisites and recovery. The earlier generic launchd failure's cause remains unknown because it did not recur. The successful pass establishes capability, not reliability across restarts or all operating conditions.

## Why the earlier run used Claude

The earlier run `qx77xg5daskzddzx6nes0gbm3h8j3h60` was queued at 11:59:13 a.m. EST with `harness: claude`. It started at 11:59:17 and failed at 2:27:18 p.m. with category `stalled`, after 15 minutes without progress during `session_started`. Its worktree contained probe scripts/prompts but no saved probe results.

The current project execution configuration is enabled and prefers `codex`; its last update was 12:02:24 p.m., after that run was queued. The failed task has no `requestedHarness` override. Harness selection is explicit request → task override → project preference → Claude fallback (`convex/agentWorkbench.ts`). The board explicitly submits its selected harness. Queued runs persist their chosen harness; a later project preference update does not switch an existing run. The exact UI value and project preference at queue time cannot be reconstructed from the current config alone, so this is not proof of a selection bug.

## Existing ingestion inventory and boundaries

- `scripts/connectors.json` pins local Gmail and read-only Calendar MCP servers and registers custom `apps/imessage-mcp` and `apps/gcal-write-mcp`. Their local credential setup is separate from Codex's connected Google tools.
- The installed runner advertises `google,imessage,google_write`. The Agenda configuration is enabled, still prefers **Claude**, uses `harness-bootstrap` and `agenda-ingestion`, and runs every 60 minutes within 07:00–22:00 America/New_York. Its latest recorded run status at inspection was failed.
- `agentPassExecutor.ts` loads skills, supplies source scope and ingestion lookback, uses role-scoped tokens, and caps a pass at 15 minutes. It follows the host's chat bypass setting, unlike task runs; this host currently has that setting enabled. The fresh task probe must not be represented as proof of identical scheduled-pass behavior.
- `calendarMirrorSync.ts` and `calendarActionExecutor.ts` are separate runner responsibilities. The mirror currently reports local Google token-refresh failures, although Codex's Google connectors passed. Replacing semantic extraction alone will not replace the mirror or calendar action execution.
- `main.ts` also serves chat turns, task runs and closeout work. Preserve these shared consumers; Phase 19 retirement concerns ingestion-specific responsibilities. Plaid is outside scope.

## Repeatable verification

1. Read the project execution preference, task override and queued run's harness separately. Record account, Codex version and worktree without dumping environment secrets.
2. Launch a **fresh** Codex process with the adapter arguments above and the installed runner environment/task token. Use a bounded read-only prompt and an outer timeout. Do not expand permissions or substitute local source readers.
3. Ask for exact connector tool names; Gmail profile + one bounded search + one full read; Calendar list + one bounded event search; and this Skippy task brief. Store only success/error, counts, owner account match and content-present booleans. Confirm actual tool-completed events and process exit, not merely the model's claim.
4. For Messages, test the intended launch path using existing authorized settings and read at most one message in a resolved chat and bounded date window. Stop on denial; do not use alternative readers. Do not treat listing chats as a content-read pass, or a successful manually launched process as proof of scheduler reliability.
5. Keep raw transient tool traces private; publish only this sanitized evidence. Continue to Phase 19 coverage and unattended-operation tasks only with the remaining limitation explicit.

The probe observed completed Gmail, Calendar and Skippy tool calls, a final metadata-only JSON report, and a successful process exit. An unrelated Notion authentication startup error did not prevent these checks. No application code changed, so repository tests were not required; the document diff was checked for whitespace errors.
