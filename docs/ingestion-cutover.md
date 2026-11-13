# Ingestion cutover and retirement

As of 2026-11-13, cutover is **blocked by replacement validation**. This document records a future operational procedure, not a completed migration or a tested rollback. Preserve the actual enabled/disabled state until qualification passes.

## Evidence and release boundary

Task 8 (`mn78t56tqhs5mhkas2p5kyb2qs8j3zjm`) explicitly reports **ACCEPTANCE NOT MET** despite its administrative done state and merged PR #222. Its two scheduler-claimed diagnostics used a temporary read-only skill. Google tools were unavailable in the first; all sources were readable in the second. Reads were sampled, Messages lacked stable provider message IDs, and neither pass performed ingestion writes. Persistence, exhaustive coverage, replay, recovery, and cutover/rollback were not qualified. Task 8 reports restoring Agenda to disabled/Claude with original settings; this is historical evidence, not a fresh deployed configuration read.

Task 4 (`mn79qr2j7dxp1t11e0mbps4p858j3qzw`) recorded NO-GO. Task 7 (`mn7fkm3shyz98hmyp5ma6amnyn8j3q7h`) recorded unfinished scheduler controls. Before proceeding, obtain a superseding passing assessment and task 8 per-source evidence from canonical Convex projectFiles/task records. The local `.skippy/outputs` copies are disposable handoffs. Do not treat green harness completion as successful source coverage.

The target is native Gmail/Calendar/Messages reads through the final Agenda Codex runtime, one Skippy scheduling owner, and durable Convex source windows/receipts. The Calendar mirror is a separate structured-data consumer; semantic extraction does not replace it. Shared runner execution continues to serve chat, project work, and finance.

## Retention boundaries

| Surface | Conditional retirement | Must survive |
| --- | --- | --- |
| `apps/imessage-mcp/` | Remove package, tests and lockfile references after identity/coverage/recovery and observation pass | Messages source IDs, receipts and historical objects |
| `scripts/connectors.json` | Remove only `gmail`, `gcal`, `imessage` registrations after all harness/role consumers are audited | `gcal-write` and shared setup/helpers/tests still used by it |
| External Gmail/Calendar clones | Host-only cleanup after rollback window; outside this worktree | Any unrelated consumer discovered during audit |
| `apps/runner/src/calendarMirrorSync.ts`, helpers/tests and mirror timer in `main.ts` | Remove only after complete mirror parity, including recurrence, revisions and cancellation/deletion | `calendarActionExecutor.ts`, action timer, token source and outbox |
| `apps/gcal-write-mcp/` | Read helpers only if no remaining mirror caller | Auth/config/insert/server, runner dependency, `google_write`, write credentials |
| Runner/Convex/web connector inventory and status UI | Remove obsolete read requirements after consumer audit; distinguish native availability from local registration | Shared inventory, other roles and actionable source failure status |
| Schema and ingestion APIs | No historical data cleanup as part of retirement | Brain data, source refs/IDs, run history, checkpoints, receipts, calendar storage/outbox, Home captures |
| Runner daemon and harnesses | No daemon retirement | Chat, project execution, closeout, maintenance, finance/Plaid |

The manifest names Gmail credentials under `~/.gmail-mcp/` and read-only Calendar configuration under `~/.config/gcal-readonly-mcp/`. These are candidates, not proven exclusive credentials. Before removal record each credential's nonsecret identity, all consumers, grants and rollback dependency. A filename or separate directory does not prove exclusive use. Keep `~/.config/gcal-write-mcp/` credentials and shared Skippy/host/role credentials. Messages has no credential file in the manifest; its shared Node Full Disk Access grant requires a separate consumer audit. Never copy secrets into evidence, logs or projectFiles. Historical `docs/connectors.md`, `docs/google-source.md`, and `docs/imessage-source.md` are absent here; recover their audit provenance before deleting their references.

## Staged execution after validation passes

1. Record passing assessment/artifact IDs and validated revisions. Qualify final scoped Agenda credentials, skill, runtime and reliable connector availability, exhaustive all-source persistence and recovery. Resolve stable Messages identity and Calendar mirror parity. Close the scheduler control gaps documented by task 7; synthetic checks alone cannot close source qualification.
2. Privately snapshot exact deployed configuration IDs, enabled state, cadence/timezone, due times, runtime/skill revisions, source account/scope, checkpoints, counts/IDs, mirror state and pending outbox. Record a rollback revision and credential references without values. Inventory every legacy/diagnostic ingestion schedule and process on the actual host, including other harness automations; repo search cannot prove host absence.
3. Pause and fence old ingestion writers; wait for claims and source leases to drain. Keep credentials/packages available for rollback. Verify old workers can no longer commit. Enable exactly one qualified ingestion schedule for the recorded scopes. Do not disable the shared daemon or Calendar action execution. A legacy mirror retained for continuity means full retirement remains incomplete.
4. Capture two consecutive unattended production passes using final settings, then a controlled failed window and successful scheduled same-window recovery. For Gmail, Messages and Calendar record scheduled/run/attempt IDs, frozen windows, account/scope, pages, required content reads, receipts, persisted IDs/source refs, completion and gap state. Read sources and write to Skippy; this does not authorize sending messages or changing source content. Compare bounded source truth against persisted results, including empty/no-extraction receipts, new messages in existing chats, calendar updates/cancellations, duplicate replay and Home captures. Verify Home calendar/conflicts/outbox functionality and existing IDs/history remain intact.
5. Observe at least a full day of configured production slots with no gaps, omissions, duplicates or unexplained revisions. Rehearse rollback without concurrent writers. Verify deployed schedule inventory, process inventory and absence of legacy ingestion writes throughout the observation interval. A green run count or absence of one PID is insufficient.
6. Only after those checks, remove the eligible repository surfaces above; regenerate lockfile and run `pnpm check`. Inspect remaining references and preserve tests for retained functionality. Publish through the runner review flow. Separately retire proven-exclusive host registrations/clones/credentials after the rollback retention window closes. Record evidence of no remaining legacy reader and successful scheduled reads/writes after the cleanup release.

Stop or roll back on missing IDs, incomplete pages, uncertain source availability, stale mirror, duplicate writes, failing source aggregate or unexpected user intervention. Disable/fence the replacement owner and drain it before restoring the captured configuration/skill and old mirror owner. Restore the saved enabled state, including disabled where applicable. Replay only from the last mutually verified boundary with overlap and identity checks. Preserve newly committed data/receipts and user changes; never restore a database snapshot over them. Reconcile provider IDs and pending outbox actions before retries. If safe replay is unproven, leave ingestion paused and qualify bounded backfill before declaring recovery.

## Current acceptance

No cutover, credential removal, host process inspection or post-cutover scheduled reads/writes occurred in task 9. Replacement acceptance remains unmet. Documentation publication does not complete task 9 or authorize cleanup. Resume from qualification with the evidence above, then execute the staged handoff on the qualified deployment.
