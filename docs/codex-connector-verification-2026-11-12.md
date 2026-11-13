# Codex connector access verification — November 12, 2026

Task: `mn76vjrwqrbws7nrq52s2tg6jh8j2gz1`, Phase 19 task 1.

## Outcome

Gmail, Google Calendar, and Skippy MCP passed real reads in a fresh, noninteractive Codex session matching the task runner's CLI invocation and launchd account/environment. The initial Skippy chat Messages content read was denied. A later owner-authorized probe using the existing **scheduled-agent settings** successfully called Messages discovery and reading, reporting one message with text and no approval required. However, a fresh **launchd-triggered** repetition failed during chat discovery. **Messages content access is possible in one tested session, but reliable scheduled access remains unverified. Do not pass the migration feasibility gate or retire connectors based on this report.**

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

This establishes a launch-path-dependent discrepancy, not its cause. The initial chat denial, successful manual unattended read, and scheduled discovery failure are three distinct observations. The scheduled diagnostic exposed only a generic error; it does not identify a permission, transport, or desktop-bridge root cause. Next verification should capture a sanitized underlying discovery error in the actual Skippy-scheduled Codex path and resolve it before testing unattended content reads again. Changing approval settings is not yet justified as the fix.

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
