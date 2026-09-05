# Brain refactor migration step 4

- Added resumable, idempotent backfills for notes, links, knowledge objects, and memories.
- Cut all active writes over to the unified `knowledge` table and removed the dual-write helper.
- Moved active legacy-table reads to `knowledge` and retained legacy reads only for migration verification/backfill.
- Marked the four old schema tables deprecated without deleting them.
- Documented the operator commands and preserved the owner gate for deletion after the soak.

Verification: `pnpm check` passes (all workspace typechecks and 1,079 tests).
