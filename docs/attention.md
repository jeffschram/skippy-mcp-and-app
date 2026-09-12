# Shared attention

Attention is separate from task/project lifecycle and acceptance/archive states. Optional `attention` metadata on canonical records stores a manual override, reason, scheduled time, review time, and assessment timestamp. Existing records require no backfill: attention is derived at read time, including for newly created records.

The shared resolver in `convex/attentionModel.ts` supplies status, explanation, and manual/automatic provenance. Mind uses the same palette as the Attention page and Home's live Needs attention queue. Task and project details and Mind inspectors expose the same editor. Every canonical category can be reviewed in the paginated Attention page.

## Rules

- Immediate attention: explicitly marked urgent, an overdue task obligation, or a blocked task. Optional `want` tasks do not become overdue.
- To do: an open, in-progress, or waiting task, or a manual assessment.
- Scheduled: an explicit future attention time. A deadline alone is not a schedule. This field does not create or synchronize calendar events.
- Everything OK: closed work, or a manual assessment.
- Needs review: an explicit review date has arrived, or a scheduled time passed without a recorded outcome. Old reference material is never marked stale solely because of age.
- Not assessed: insufficient evidence. Acceptance is not evidence of health or urgency.

Manual decisions take precedence until their explicit review date; urgent manual flags stay urgent. Returning to Automatic removes the override. Clear or move an overdue review date when reviewing an item. An overdue obligation still outranks a future schedule. Automatic statuses refresh approximately once a minute while the UI is open; no per-minute database writes are needed.

## Scope and access

All reads and writes require the signed-in owner's brain. IDs are normalized against the requested table; knowledge kinds are checked. The shared editor handles every canonical category without changing their existing lifecycle status. Private assessments are not automatically authored by ingestion or AI scoring.

Focus uses bounded indexed candidate queries independently of Mind's 70-per-type sample, sorts by attention severity and relevant date, and returns up to 30 items. It is a priority queue, not an exhaustive count. The Attention page exposes paginated category browsing for the rest. Archived records and tasks of archived projects are excluded. A task with more than 64 outgoing links is conservatively omitted from this queue/browse while its parent eligibility is uncertain. Focus snoozes are respected. Schema additions are optional and add indexes; no migration or deletion runs.

This implementation does not change the stored AI-generated focus summary, send notifications, create calendar events, infer contact health from correspondence, or replace connection count with importance scoring. The live attention queue appears alongside the existing summary.

## Validation and rollout

`node node_modules/typescript/bin/tsc -p convex/tsconfig.json --noEmit`

`node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit --incremental false`

`node node_modules/vitest/vitest.mjs run convex/attentionModel.test.ts convex/attention.test.ts`

The 20 attention tests cover rule precedence, deadlines, optional tasks, review/schedule boundaries, persisted overrides, authentication, ownership, canonical kinds, and archived-project exclusions. Mind's 14 regression tests also pass with the new palette.

Local source changes require `npx convex dev --once` to sync the development backend. Browser verification reached the missing-query error before that sync; the attention boundary isolates failures from the rest of the app. No production deployment was performed.

## Action versus informational event ingestion

Task normalization rejects explicit `itemIntent: event/reference/informational` and `actionRequired: false`, with guidance to save a note/reference or appropriate calendar event. `start` and `eventAt` are context dates; they no longer become `dueAt`. `dateKind: event` removes deadline semantics and preserves the date in the description. Explicit action deadlines remain supported. This uses declared intent rather than guessing obligations from title keywords. Harness instructions and the ingestion tool schema describe the routing rule, including book releases and birthdays. Existing records are not bulk reclassified. The shared package must be rebuilt and the Convex/MCP processes updated to use new validation; restart/reconnect harnesses to load the new instructions.

Task attention panels now show saved source email/web links and a Done action in Attention, Mind, and task details. Source lookups use an owner/entity index and validate ownership of each source. Only HTTP(S) links without embedded credentials are rendered; recognized Gmail identifiers can supply an email fallback. Missing provenance is labeled explicitly. Done uses the existing task completion/dependency flow and clears manual urgency and pending review/schedule dates. This does not accept invitations or execute the external task for the user.
