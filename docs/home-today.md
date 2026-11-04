# Home and trusted ingestion

Owner decision, 2026-11-04: keep Home, Quick Capture, and the weekly agenda. Replace Now and Needs attention with a short briefing and one system-selected Today list. Do not show per-item justifications. Retire routine Review; corrections happen through chat.

## Daily behavior

`convex/today.ts` gathers owned, accepted records. `todayModel.ts` selects the day and builds a two-sentence briefing from exactly the same selection. No independent prose checklist or task copies are created. Changes to tasks update the list and briefing reactively; the clock advances each minute and day boundaries use the viewer's local timezone, including daylight-saving days.

Include personal tasks, owner project tasks, project work awaiting review or a blocking decision, due recurring obligations, explicit reference reminders, and external-action decisions. Exclude closed or archived work, tasks in closed projects, waiting tasks, snoozes, unresolved dependencies, and ordinary agent execution. Project task links open the task panel. Spawned recurring tasks appear once and completion uses the recurrence completion path, preserving history and advancing the cadence.

Rank genuine due-today/overdue obligations and explicit decisions first, then saved importance, priority, in-progress work and project order. Optional wants never become overdue. The first version deliberately uses existing saved scores and deterministic selection: it does not introduce a new model provider or pretend to know task durations. With two/four hours of remaining timed calendar commitments, discretionary selection shrinks from five to three/two items. Overlapping appointments count once; all-day events remain appointments but do not consume a fabricated 24-hour work budget. The remaining hours before local midnight further reduce the discretionary count late in the day. Mandatory commitments are not silently hidden when the day is overloaded; the briefing says so.

Candidate reads are bounded and indexed, with separate deadline reads so older obligations are not displaced by recent tasks. The UI reports when those bounds are reached. Home is a recommendation, not an exhaustive inventory. Agenda and Projects retain the full records. Events/recurrences/tasks keep their distinct semantics. The weekly agenda remains date-grouped and rolls over at local midnight.

## Retired surfaces and compatibility

Review, Attention, triage, resurfacing, and pending-actions routes redirect to Home. Their records and internal compatibility APIs remain; nothing is deleted. The legacy focus summary is still available to older MCP clients, but does not control Home. Home uses a lightweight query for Quick Capture and sync state rather than loading the old focus/review dashboard.

The legacy submit-candidate and memory-candidate tools now save directly with source evidence and confidence. Agents should retain ambiguous action intent as reference notes, never invent obligations from announcements, and skip noise. Stored ingestion skill versions receive a current-policy addendum so old prompts cannot revive the queue. Quick Capture's private Hold mode is unchanged.

A five-minute Convex cron drains old pending triage rows in batches of 20, each in a separate transaction. The usual ingestion path preserves deduplication and provenance. Invalid legacy classifications are retained as notes; their original candidate payload remains in the audit row. Memory review batches become accepted records, while archived/rejected records remain archived/rejected. The process is idempotent and does not touch pending external actions.

External side effects still need permission. Today opens Home chat for these decisions, where existing detailed approve/revise/reject controls are available. Retiring routine classification review never approves an email or calendar write automatically.

## Verification and rollout

Run `pnpm check`. The added tests exercise ranking, calendar overlaps/capacity, owner isolation, archived parents, dependencies, project links, recurrence identity, explicit reminders, migration idempotency and external-action separation.

Deploy both Convex and web through the normal reviewed PR workflow; new Home queries and the migration cron require the backend change. Reconnect MCP clients/restart the runner to load updated instructions. No manual data deletion or schema removal is required. After deployment, verify Home on desktop/mobile, a completed recurring task advancing its date, project-panel links, an external approval in chat, and the existing Review backlog draining. Test screenshots against a deployed preview once the matching backend is available.

Rollback can restore the previous UI without losing records, but accepted backlog items remain accepted; original candidate rows and activity events are preserved for tracing and chat corrections. Do not reverse trusted ingestion by recreating duplicate pending items.
