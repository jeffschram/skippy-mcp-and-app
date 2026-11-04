# Home and trusted ingestion

Owner decision, 2026-11-04: keep Home, Quick Capture, and the weekly agenda. Replace Now and Needs attention with a short briefing and one system-selected Today list. Do not show per-item justifications. Retire routine Review; corrections happen through chat.

Home places the briefing first, Today and This Week side by side on wide screens, and Quick Capture below them. On smaller screens, Today and This Week stack in that order.

## Daily behavior

`convex/today.ts` gathers owned, accepted records. `todayModel.ts` selects the day and builds a two-sentence briefing from exactly the same selection. No independent prose checklist or task copies are created. Changes to tasks update the list and briefing reactively; the clock advances each minute and day boundaries use the viewer's local timezone, including daylight-saving days.

Include personal tasks, owner project tasks, project work awaiting review or a blocking decision, due recurring obligations, explicit reference reminders, and external-action decisions. Exclude closed or archived work, tasks in closed projects, waiting tasks, snoozes, unresolved dependencies, and ordinary agent execution. Project task links open the task panel. Spawned recurring tasks appear once and completion uses the recurrence completion path, preserving history and advancing the cadence.

Today puts obligations and decisions first, then personal actions, with at most one manageable project step if capacity remains. It does not fill a quota. Future-dated tasks stay out unless explicitly scheduled for today or marked urgent; recurring obligations retain their configured lead time. Personal obligations due today remain visible even if their wording does not match the concrete-action rules. Optional capacity is at most three actions, reducing to two/one with two/four hours of remaining timed calendar commitments, and capped by hours remaining before local midnight. Mandatory commitments stay visible even when capacity is exhausted. Calendar overlaps count once; all-day events do not consume a fabricated 24-hour work budget.

The first version uses conservative rules rather than an AI duration estimate. A concrete action starts with a bounded owner verb such as call, pay, choose, book, or approve; compound actions and broad initiative wording are excluded. Project linkage, phase membership, and coding/design/research/planning kinds identify project work. Broad initiatives remain in Projects. For a project task, the first unfinished Markdown checklist entry in its description may supply the next action, but only if it passes the same concrete-action rules. It never invents steps or skips an earlier unfinished step. If there is no clear step, none is recommended. A project deadline or explicit urgent reminder becomes a decision about the next action, not a whole-initiative completion checkbox.

Completing a checklist step changes only that checkbox in the source description and records an activity event. It preserves the parent task status, completion date, and dependencies. The server checks ownership and the exact current step, rejects stale edits, and makes retries safe. Completing a concrete standalone task still completes that task. The two-sentence briefing uses the selected actions.

Candidate reads are bounded and indexed, with separate deadline reads so older obligations are not displaced by recent tasks. Home is a recommendation, not an exhaustive inventory. Agenda and Projects retain the full records. Events/recurrences/tasks keep their distinct semantics. The weekly agenda remains date-grouped and rolls over at local midnight.

## Retired surfaces and compatibility

Review, Attention, triage, resurfacing, and pending-actions routes redirect to Home. Their records and internal compatibility APIs remain; nothing is deleted. The legacy focus summary is still available to older MCP clients, but does not control Home. Home uses a lightweight query for Quick Capture and sync state rather than loading the old focus/review dashboard.

The legacy submit-candidate and memory-candidate tools now save directly with source evidence and confidence. Agents should retain ambiguous action intent as reference notes, never invent obligations from announcements, and skip noise. Stored ingestion skill versions receive a current-policy addendum so old prompts cannot revive the queue. Quick Capture's private Hold mode is unchanged.

A five-minute Convex cron drains old pending triage rows in batches of 20, each in a separate transaction. The usual ingestion path preserves deduplication and provenance. Invalid legacy classifications are retained as notes; their original candidate payload remains in the audit row. Memory review batches become accepted records, while archived/rejected records remain archived/rejected. The process is idempotent and does not touch pending external actions.

External side effects still need permission. Today opens Home chat for these decisions, where existing detailed approve/revise/reject controls are available. Retiring routine classification review never approves an email or calendar write automatically.

## Verification and rollout

Run `pnpm check`. The added tests exercise ranking, calendar overlaps/capacity, owner isolation, archived parents, dependencies, project links, recurrence identity, explicit reminders, migration idempotency and external-action separation.

Deploy both Convex and web through the normal reviewed PR workflow; new Home queries and the migration cron require the backend change. Reconnect MCP clients/restart the runner to load updated instructions. No manual data deletion or schema removal is required. After deployment, verify Home on desktop/mobile, a completed recurring task advancing its date, project-panel links, an external approval in chat, and the existing Review backlog draining. Test screenshots against a deployed preview once the matching backend is available.

Rollback can restore the previous UI without losing records, but accepted backlog items remain accepted; original candidate rows and activity events are preserved for tracing and chat corrections. Do not reverse trusted ingestion by recreating duplicate pending items.
