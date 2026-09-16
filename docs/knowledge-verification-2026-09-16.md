# Knowledge ingestion verification — September 16, 2026

## Result

The tested canonical write paths work, and Knowledge is receiving new data. This does **not** establish that every expected source item has been ingested. Legacy retirement remains blocked by historical migration and source-coverage verification. No legacy records were deleted or backfilled during this investigation.

## What the soak actually covered

Dual writing was introduced in PR 183 and removed in PR 185 on September 5. The subsequent soak retained the old tables for recovery; it did not continue writing every new record into both representations. The earlier backfill task reports implementation completion, not execution against the cloud database. This differs from the owner's intended verification period.

## Fresh database evidence

The configured development deployment is `beloved-curlew-997`. A new database export is stored privately at `/Users/skippy/.skippy/backups/knowledge-retirement-2026-09-15/verification-sep16.zip`; storage file contents are excluded. These findings do not certify any other deployment.

| Kind | Legacy records | Canonical records |
| --- | ---: | ---: |
| Note | 344 | 38 |
| Link | 32 | 2 |
| Knowledge object | 17 | 0 |
| Memory | 69 | 17 |

All 462 legacy records still lack a canonical `legacyId` mapping. The 57 canonical records reference no missing source-reference IDs. Growth since the September 15 snapshot demonstrates current writes, not complete migration or source coverage.

Using database `_creationTime` after September 5 at 22:09 UTC, there are 194 ingestion runs: 183 completed, 10 failed, and one running. Six report completion before their reported start. `recordIngestionRun` stores caller-supplied counts and timestamps without reconciling them against writes. A completed run is therefore not a completeness assertion.

For the selected write activity types (`object_ingested`, `triage_approved`, `memory_recorded_from_mcp`, `memory_captured_from_mcp`, and `memory_review_candidate_submitted`), 129 events fall in that same window. Seventeen lack an entity pointer; 54 point to IDs absent from the export; 38 point to existing canonical Knowledge. These events include other entity types. Missing targets can reflect later merges or deletions and are **not** proof of failed ingestion. The log cannot by itself resolve the discrepancy.

## Verification added and run

`convex/knowledgeVerification.test.ts` exercises the actual handlers with an isolated database double that rejects legacy table queries and inserts. Its eight tests cover:

- Direct note, link, and knowledge-object ingestion, including content and provenance.
- Review approval for all three kinds, canonical candidate pointers, and rejection of repeated approval.
- Link status updates.
- Memory capture, relationship creation, retrieval, and brain isolation.
- Interview answers creating canonical memory-review pointers.

The suite is included in the root `pnpm test` command. These are handler integration tests, not a deployed Convex database, schema-validator, UI, or source-extraction test.

Validation performed:

- 70 tests passed across the new suite, MCP tool routing, and calendar-mirror suites.
- `pnpm convex:typecheck` passed.
- Live `mcp:smoke:ingestion-triage` created and queried a temporary candidate, then rejected it for cleanup. This proves the deployed MCP-to-triage path, not approval into Knowledge or source completeness.

## Google authorization repaired

Gmail already had working credentials: refresh and a live profile read succeeded. Both Calendar connectors had reported authorization failures. The owner completed fresh consent for the existing read-only personal account and the calendar-write connector used by the mirror. Both refreshed credentials passed live read requests. No scopes were expanded.

A normal `runCalendarMirrorSyncOnce` pass completed against the runner's configured backend: one page, zero changed events, no error. This verifies Google-to-Convex mirror connectivity. Calendar events use `calendarEvents`; the mirror result does not prove semantic extraction into Knowledge. Other long-running connector clients may need to reconnect if they retain old credentials in memory.

## Remaining retirement gates

1. Reconcile a bounded source window against actual source IDs and resulting canonical IDs, triage candidates, or explicit skip decisions. Separate source-read failures from successful captures; cover Gmail, Calendar, and other configured ingesters. Existing aggregate counters cannot certify this retroactively.
2. Run deployed approval/update/read checks for canonical records and confirm their visibility in the app. The isolated handler tests do not replace this check.
3. Preserve missing history with a reviewed, idempotent backfill that protects newer canonical edits; verify content, metadata, relationships, and interview pointers. Reconcile intentional merges/deletions before restoring records.
4. Start a clearly defined observation window after those checks, retain recovery snapshots, and delete the legacy tables only after the gates pass.

Backfilling history and proving ongoing ingestion are separate requirements. Neither substitutes for the other.
