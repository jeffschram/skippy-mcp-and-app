# Review retirement handoff

The worktree retires the knowledge review queue and external-action approval gate. `/review/history` is the read-only Activity log, reachable in navigation, with paginated activity and historical execution rows. Calendar actions start ready (`approved` is the existing compatibility state); leases, minted-ID retries, overlap warnings and duplicate sweeping remain. Waiting follow-ups are saved ready, but the UI explicitly reports that automatic message delivery is unavailable; this change does not add a message executor.

No push, merge, deployment, live migration or external action execution was performed in this task.

## Migration after runner deployment

Deploy the direct-accept writers and schema before draining candidates. For each brain, invoke the internal mutation:

```sh
pnpm exec convex run knowledge:acceptRetiredReviewQueue '{"brainInstanceId":"<brain id>"}'
```

Repeat until `done: true`. Select the intended deployment using the normal runner deployment configuration. Do not use `--push` as part of migration.

Every invocation first checks the global `pendingActions.by_status` index for `drafted` and `pending_approval`. If either exists it throws before any writes. The November 8 zero-count observation is not used as authorization to skip this check. Investigate a halt separately; do not auto-approve these actions to unblock migration.

The persisted `reviewQueueMigrations` row stores version `retire-review-v1`, the first-run cutoff, cursors, completion flags and cumulative counts. Each batch logs counts. It processes pending triage and the memory inbox/pending-review union, excluding archived/rejected/discarded memories; it never mutates pendingActions, quick captures, ordinary accepted attention records or unrelated brains. It preserves memory IDs, content, provenance and relationships, and uses the existing normalization and duplicate merge helpers for triage. Acceptance, source links, audit and cursor advancement commit atomically. A failed batch rolls back and can be retried after repairing the reported invalid data; do not advance its cursor manually. A completed rerun is a no-op.

The migration must run after publication because its function and indexes do not yet exist in the deployed backend. It was tested locally, not run against live data.

## Verification

- `pnpm typecheck`: passed across all workspaces and Convex.
- `pnpm test`: passed across the root backend tests and every workspace.
- Final focused run of `convex/knowledgeVerification.test.ts` and `convex/calendarOutbox.test.ts`: 20 tests passed, including Activity ownership/pagination, migration paging/cutoff/reruns, mid-run external-action guard, direct memory acceptance, calendar ready-action deduplication, live-lease sweep exclusion, stale claims and provider-ID conflict success.
- `git diff --check`: passed.
- Source audit found no remaining consumers of the retired queue APIs or producers of drafted/pending-approval actions and inbox/pending-review memories.

Browser smoke and deployed schema/runtime verification were not performed; this disposable worktree has no live application configuration and deployment is reserved for the runner.
