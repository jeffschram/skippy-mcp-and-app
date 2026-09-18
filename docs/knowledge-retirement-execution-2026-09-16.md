# Knowledge migration and retirement execution

The owner authorized migration, verification, and retirement on September 16, 2026. Work was executed against the configured deployment `beloved-curlew-997`; no other deployment was modified.

## Migration result

- All **462** legacy records have canonical ID mappings.
- The **60** existing Knowledge records were preserved; the resulting table contains **519** records.
- Duplicate links share canonical records: 462 old IDs map to 460 distinct Knowledge records, including one already-existing canonical record. The transfer inserted 459 records.
- Existing canonical edits take precedence. When only duplicate legacy links existed, the most recently updated legacy record supplied the state and content.
- All fields of newly copied records were independently compared against the original export, including review/rejection state, attention metadata, snoozes, provenance, timestamps, and structured properties.
- Old memory relationships were converted to canonical edges and verified. All exact old-ID references outside migration provenance were rewritten. This includes source associations, graph edges, review candidates, calendar references, embeddings, focus summaries, and activity history.
- A second migration run skipped all 462 records and inserted nothing.

Reference rewrite counts (documents changed, not individual references): calendarEvents 3; triageItems 7; relationships 79; entitySourceRefs 480; ingestionRuns 1; focusSummaries 313; entityEmbeddings 37; activityEvents 565. No interview pointer changes were needed.

## Verification and retirement

The independent export audit passed before and after retirement with no failures. It checks mapping completeness, preservation of existing canonical values, legacy field parity, memory edges, and absence of old-ID references.

Deployed smoke tests used an isolated temporary identity and brain, with notifications and external enrichment disabled. They exercised direct ingestion and review approval for notes, links, and knowledge objects; app-facing list queries; link updates; memory capture, review, content editing, source provenance and relationship retrieval; and interview-to-memory pointers. The tests passed before and after removing the legacy schema. All temporary fixture records were removed. The first cleanup attempt exposed a test-runner issue: internal admin cleanup cannot use an impersonated viewer identity. The script now uses admin credentials for cleanup and viewer identity only for normal application functions.

`pnpm check` passed: full workspace typechecking and **1,505 tests**. The eight canonical handler regression tests explicitly reject legacy-table queries/inserts, and are included in the standard test command.

After the pre-deletion checks passed, guarded admin mutations removed 344 notes, 32 links, 17 knowledge objects, and 69 memories. Each deletion required exactly one same-brain, same-kind canonical mapping and matching content/identity. The old schema declarations, indexes, dual-write count query, backfill entry points, and legacy interview ID validator have been removed and the backend deployed. The data outline reflects the unified model.

**Table cleanup complete:** all four empty table catalog entries were deleted through the same authenticated `POST /api/delete_tables` endpoint used by the Convex dashboard, using existing CLI credentials. A fresh `convex data` listing confirms that the entries are absent. No dashboard sign-in was necessary. Removing schema declarations alone does not delete table entries; the separate API operation completes that step. Endpoint implementation: [official Convex dashboard source](https://github.com/get-convex/convex-backend/blob/main/npm-packages/dashboard-common/src/features/data/lib/api.ts).

## Current ingestion evidence and its limits

Before the migration, current canonical records already carried Gmail, iMessage, Calendar, and manual-conversation source references. Both Google Calendar authorizations were refreshed earlier today and passed live reads; the calendar mirror's latest status is completed. Gmail refresh and read checks had also passed.

The deployed tests verify current storage, review, updates, retrieval, and source-pointer preservation. They do **not** establish that every useful message in the previous ten days was extracted. The old aggregate ingestion logs cannot prove that, and some status rows are stale or contain source failures despite a completed status. This remains an ingestion-observability limitation; it is not evidence that a transferred legacy record was lost. Restoring dual writes is unnecessary to preserve this migrated history.

## Recovery and reproducibility

Private database snapshots, outside Git, are under `/Users/skippy/.skippy/backups/knowledge-retirement-2026-09-15/`:

- `before-backfill-sep16.zip`: original legacy and canonical records before transfer.
- `after-backfill-sep16.zip`: canonical transfer and reference rewrites, with legacy rows retained.
- `after-retirement-sep16.zip`: post-retirement snapshot.

The snapshots contain database records; binary file-storage contents are not included. The migration did not alter file-storage objects. The pre-retirement implementation and schema are preserved in local commit `57a229f` for recovery/review.

Run the independent audit with:

```sh
python3 scripts/audit-knowledge-migration.py --before /path/to/before-backfill-sep16.zip --after /path/to/after-retirement-sep16.zip
```

Run the deployed smoke check (requires Convex CLI admin access, creates and cleans isolated test data) with:

```sh
python3 scripts/smoke-knowledge-deployed.py
```
