# Brain refactor migration step 5

- Added an idempotent, resumable backfill from `knowledge.relatedEntityRefs` to
  `relationships` rows of type `mentions`.
- Removed `relatedEntityRefs` from the canonical `knowledge` schema.
- Changed all active viewer and harness memory writes to create graph edges
  instead of growing the embedded field.
- Changed memory search, detail, context-map, and resurfacing reads to hydrate
  connections from `relationships`.
- Preserved the existing MCP input/output shape as a compatibility boundary;
  those refs now map to edges internally.

Verification: `pnpm convex:typecheck` and `pnpm test` pass (1,080 tests).
