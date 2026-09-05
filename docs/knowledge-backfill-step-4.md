# Knowledge migration step 4

The `knowledge` table is canonical. `notes`, `links`, `knowledgeObjects`, and
`memories` are deprecated, read-only soak tables. Do not delete them until the
owner approves removal after the multi-week soak.

After deploying this step, invoke each internal mutation once with a bounded
page size. Each mutation schedules its own continuation until its table is
complete:

```sh
npx convex run knowledge:backfillNotesToKnowledge '{"paginationOpts":{"cursor":null,"numItems":100}}'
npx convex run knowledge:backfillLinksToKnowledge '{"paginationOpts":{"cursor":null,"numItems":100}}'
npx convex run knowledge:backfillKnowledgeObjectsToKnowledge '{"paginationOpts":{"cursor":null,"numItems":100}}'
npx convex run knowledge:backfillMemoriesToKnowledge '{"paginationOpts":{"cursor":null,"numItems":100}}'
```

The jobs are rerunnable. `knowledge.legacyId` and
`by_brain_kind_legacy_id` prevent repeat inserts. Rows already mirrored by the
step 3 dual-write are adopted using their exact creation timestamp and canonical
content, then tagged with their legacy ID.

Use `knowledge:verifyKnowledgeDualWriteCounts` per brain, kind, and bounded time
window after the scheduled pages finish. A truncated result is not authoritative;
rerun it with narrower windows. Keep the legacy tables throughout the soak even
after every window matches.
