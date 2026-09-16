# Deprecated Knowledge tables: pre-deletion audit

Owner authorized early retirement on September 15, 2026, ahead of the planned September 20 soak milestone. No tables or records were deleted. No backfill was run.

## Deployment and recovery snapshot

Audited the configured deployment `beloved-curlew-997` using a full database snapshot export. Backup: `/Users/skippy/.skippy/backups/knowledge-retirement-2026-09-15/before.zip`. This contains database records; file-storage contents were not included. The snapshot is private and outside the repository.

## Blocking finding

| Legacy table | Legacy records | Canonical records of that kind | Legacy ID mappings | Exact content matches |
| --- | ---: | ---: | ---: | ---: |
| notes | 344 | 19 | 0 | 0 |
| links | 32 | 2 | 0 | 2 |
| knowledgeObjects | 17 | 0 | 0 | 0 |
| memories | 69 | 13 | 0 | 0 |

Mappings were checked within the same brain. Content matching used the prior migration's kind-specific fields: note title/body; link URL/normalized URL; object type/title; memory type/title/body. Content matches do not establish complete migration or metadata preservation.

462 legacy records remain. At least 460 have no exact content counterpart under that check. Deletion is not safe to execute as a routine post-soak cleanup. The earlier backfill task's result explicitly reports code completion but no cloud backfill execution. These findings are consistent with an unexecuted backfill, though they do not rule out deliberate deletion of canonical history.

## Other checks

- No `memoryCandidateId` values were found in the exported documents.
- Active legacy database reads remain in the old verification/backfill functions in `convex/knowledge.ts`; these should be retired after migration validation.
- `convex/schema.ts` still declares the four tables and permits legacy memory IDs in the interview answer validator.
- A limited scan of exported run/event records did not establish a complete error-free soak. A successful migration and reference audit are still required; the smaller canonical table means elapsed soak time alone is insufficient.

## Next step

Resolve whether the legacy history should be imported or intentionally discarded. Recommended: preserve it in `knowledge`, adopting the two existing matching links without duplication; check metadata and canonical/legacy references; take another snapshot; then remove obsolete readers/schema references and delete the legacy tables. Do not overwrite canonical edits or restore intentionally removed content without resolving that intent.
