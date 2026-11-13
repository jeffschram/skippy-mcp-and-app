# Durable ingestion progress and replay

Implemented in this worktree. No push, merge, deployment, schedule change, or live source ingestion was performed.

## Changes

- Reuses `sourceSyncStatuses` for independent, account-qualified source checkpoints. Ten-minute fenced leases prevent competing passes; heartbeats renew them. Expired workers cannot write accepted objects or advance coverage.
- First source claim explicitly establishes a 48-hour baseline. Later catch-up proceeds oldest-first in at most 48-hour windows with a 15-minute overlap. Failed/interrupted windows retain their exact bounds. Coverage advances to the frozen read-window end, never the wall-clock completion time.
- `ingestionReceipts` stores the accepted result in the same Convex transaction as the object, provenance and counters. `ingest_object` and `record_memory` accept a source claim plus stable object key. Response-loss retries reuse the original entity, preserving edits and terminal states. A deleted receipt target causes reconciliation failure instead of recreation.
- `ingestionRuns` now supports immutable expected-source manifests and idempotent run records. An aggregate cannot complete with a missing, failed, busy, stale-run or incompletely caught-up source, nor can its terminal report omit a source declared at start. Failed aggregate runs retain source snapshots.
- Source reports expose baseline, frozen window, covered-through time, last success, last failure/errors, classified counts, write/replay counts and catch-up state. Reports are available through the existing status tool's `inspect` operation and the dashboard's source status data. Expired durable leases remain visible as failure rather than disappearing from dashboard data.
- Agenda runner prompts and the built-in ingestion skill use source claims instead of the legacy role-completion cursor. Other roles retain their existing cursor behavior.
- Calendar mirror passes have their own durable fenced claims and frozen full-sync anchor. Pagination caps and unnormalizable events fail coverage; failures preserve the last successful token. Mirror reports retain counts and last success. Event lookup now includes calendar ID. Edits reuse provider event IDs; recurring instances stay distinct, and cancellation tombstones retain original recurrence identity and content.

## Existing MCP protocol

1. Register `record_ingestion_run` with `status: running`, all expected account-qualified source keys in `sourceSystemsChecked`, and `metadata: {role: "agenda", ingestion: {runId}}`. Reuse runId when retrying an unknown response.
2. Claim each source with `update_source_sync_status`, `status: running`, and `metadata: {role: "agenda", ingestion: {operation: "claim", source, runId}}`. Use the returned token and windowStart/windowEnd exactly. A busy source does not block independent sources.
3. Pass `ingestion: {source, token, objectKey}` on each `ingest_object` or `record_memory` write. Use immutable provider item identity plus a stable semantic output discriminator; one message may yield multiple objects. Never derive keys from generated titles, time, or run IDs.
4. Heartbeat with operation `heartbeat` at least every five minutes. Finish with operation `finish`, token, runId, `paginationComplete`, `persistenceComplete`, and `counts: {read, ignored, accepted}`. Here read is classified outputs, including ignored items; it equals ignored + accepted. Count only successfully persisted/replayed accepted outputs. All required links and acknowledgements must succeed before setting persistenceComplete.
5. A successful bounded chunk may return `caughtUp: false`. Claim another chunk within the run budget or record aggregate failed. Finish independent sources regardless of failures elsewhere.
6. Record terminal aggregate using the same complete source manifest and runId. Completed is server-checked against all source reports. For a read-only report, call the status tool with `status: idle`, `metadata.ingestion: {operation: "inspect", source}` and the normal harness/sourceSystemsChecked fields; this does not change the checkpoint.

## Verification and limits

Tests exercise actual mutation handlers with an in-memory transactional fixture, including rollback on injected persistence failure. Convex's production indexed-read OCC provides the concurrent commit exclusion; no live Convex race test or deployment was performed.

Coverage tests include unknown-response replay, accepted memory replay, multiple semantic outputs from one item, receipt failure rollback, competing claims, expired-worker rejection, partial pagination, independent source success, omitted-source rejection, bounded outage catch-up, calendar lease takeover, calendar token preservation, edits, recurring instances, cancellation replay, calendar scoping and skipped-event failure.

The protocol relies on connectors/harnesses truthfully reporting complete pagination and classification. A first baseline makes no claim about earlier history; the 15-minute overlap does not discover arbitrary older late arrivals. Legacy writes without the ingestion fields do not gain receipts retroactively; existing ambiguous legacy entities still require reconciliation. This change does not qualify the separate connector migration gate.

Deploy the runner, MCP server and Convex changes together through the normal approval/publishing runner: the host mirror write methods now require the claim token. Do not mix an old runner with the new host mutation signatures.

## Verification result

- `pnpm check`: passed (all workspace and Convex typechecks; 1,283 tests).
- Final `pnpm convex:typecheck`: passed after the dashboard expiry-report adjustment.
- `git diff --check`: passed.
- Logs: `durable-ingestion-verification.txt` and `durable-ingestion-convex-typecheck.txt` in this output directory.
