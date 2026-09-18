# Knowledge objects consolidated into notes

The owner authorized this change on September 18, 2026. The configured Convex deployment is `beloved-curlew-997`.

## Result

The canonical Knowledge kinds are now `note`, `link`, and `memory`. All 17 former `knowledgeObject` records were converted in place to notes. Their document IDs, timestamps, lifecycle states, source pointers, extra properties, and descriptive `objectType` metadata were retained. Text previously nested in `properties.body` is now available in the ordinary note `body`, so Library and search can use it. Existing top-level text takes precedence over nested legacy text.

Relationship endpoint types now include `memory` directly. The migration updated 49 relationship documents (48 memory endpoints and one note endpoint), 21 source-association documents, and 18 activity-history documents. No documents were duplicated or deleted.

New MCP tool listings, capture choices, and Mind categories no longer offer Knowledge objects. Older direct-ingestion callers using `knowledgeObject` are translated to notes before normalization and storage. Older review candidates are likewise accepted as notes. The schema rejects `knowledgeObject` as a stored kind or relationship endpoint. Memories continue through their dedicated capture/review tools; generic ingestion rejects memory captures with instructions to use those tools.

Notes retain optional structured properties through ingestion and review editing. The Markdown and HTML data outlines now describe three Knowledge kinds.

## Verification

- Independent before/after export comparison passed: all 17 records and every affected reference match the expected conversion, with no remaining legacy classifications.
- Full `pnpm check` passed: workspace typechecking and 1,176 tests. Stale generated tests left under `packages/shared/dist` were removed before the final run; source tests remain intact.
- Deployed smoke tests passed for direct ingestion, review, updates, app-facing reads, source provenance, memory relationships, and interview memory pointers. The compatibility case explicitly verifies that an old knowledge-object request creates a note with its full body and properties.
- All 45 isolated smoke-test fixture records were cleaned up.
- Convex schema/functions were deployed successfully. Web and MCP source changes are on `fix/consolidate-knowledge-objects`; their release follows the repository's normal deployment workflow. Unrelated preexisting Mind/UI edits were preserved.

New migration code was reviewed for internal-only access, argument/return validation, bounded pagination, same-brain reference validation, and preservation of arbitrary source properties. Existing unrelated query/auth patterns were not refactored.

## Recovery and audit

Private database exports are outside Git at `/Users/skippy/.skippy/backups/knowledge-retirement-2026-09-15/`:

- `before-note-consolidation-sep18.zip`
- `after-note-consolidation-sep18.zip`

These contain database records, not binary file-storage contents. No storage objects were modified.

```sh
python3 scripts/audit-note-consolidation.py --before /path/to/before-note-consolidation-sep18.zip --after /path/to/after-note-consolidation-sep18.zip
```
