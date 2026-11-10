# Consolidated Home surface contract

Design note for the phase after Actionable Home & Item Details (Phase 16). Reconciled against checkout `8e6adf5`, November 8, 2026. This document specifies subsequent implementation; it does not claim the changes below have shipped. It supersedes the conflicting period, summary and approval-gate decisions in [home-item-contract.md](home-item-contract.md). Unchanged item lifecycle, ownership, chat and accessibility contracts remain in force.

## Shipped baseline and phase boundary

`convex/homeInventory.ts` now ships `page`, `seek`, and `getForViewer` for task/event/recurrence rows. `home-planning.tsx` ships Today, Monday-based This Week, collapsed All, bounded reactive pages, area/status filters, calendar horizon extension and hash selection. `item-details-modal.tsx` ships `ItemDetailsModal`, task/schedule editors and `ItemDetailsChat`; `home-item-actions.tsx` ships shared pending feedback and occurrence-version/request-ID actions. These are extension points, not gaps to implement again. Preserve code-project task exclusion, recurrence suppression, history, event overlap/all-day semantics, source links and the `mind-item:<id>` chat identity.

**Amended November 10, 2026.** The exclusion is scoped to projects with `kind:'code'`; it formerly dropped every project-linked task. `projects.kind` is `'code' | 'general'` and absent means general, matching `agentWorkbench.ts`. A general project — a trip, a move, a renovation — holds exactly the dated commitments Home exists to surface, and blanket exclusion hid them from every surface the owner looks at. Being wrong in the visible direction is recoverable; being wrong in the hidden direction is not, so an unresolvable or deleted parent project leaves the task visible. The shared rule is `convex/projectTaskScope.ts` (`isCodeProject`, `codeProjectTaskIds`); `homeInventory.page` resolves the parent per page with a cache rather than per task. Statements below reading "project tasks" or "personal project tasks" mean code-project tasks.

`convex/todayModel.ts` exists here: `buildTodaySummary` describes four-or-more timed events and overlaps. `Inventory` renders it inside Today from the first visible rows. Meanwhile `TodayContent` separately renders `AttentionFocus` and “Needs your review”; `MindAttention` independently merges focus, agenda and approval/triage/memory candidates. `LiveReviewQueueContent` combines Approvals, Finds and Revisit. Consolidation replaces these parallel queues with Summary → Today → Upcoming → All, retaining Quick capture and sync feedback. Mind remains an entity browser, not a second Home decision queue.

Inspected the requested Home, Mind, attention, todayModel, live-pages, calendar, waiting, knowledge and resurfacing implementations, plus schema, route redirects and MCP registrations. The input manifest is empty. `docs/home-today.md`, `home-period-card.*`, `home-period-helpers.*`, and an Activity page are absent; no behavior is inferred from them. The concrete periods helper is `home-planning-helpers.ts`.

## Four row kinds and canonical review identity

Extend the normalized union to `task | event | recurrence | review`. Review means attention on an already accepted entity, never an ingestion candidate, pending action or synthetic task. Use `{kind:'review', id, entityKind}` where `entityKind` is `goal | project | person | company | note | link | memory`. Map goals/projects/people/companies to their corresponding tables; knowledge uses its actual `kind`. Validate both table ID and knowledge subtype on the server. Tasks with attention remain `kind:'task'` with one task ID, not a second review row.

A review projection preserves the existing row envelope:

| Field | Contract |
| --- | --- |
| `title` | `record.title || record.name || 'Untitled'` (people and companies use name). |
| `status` | `record.status ?? 'active'` as a display fallback when absent; separate from resolved attention status and never written back as lifecycle state. |
| `at` | `record.attention?.reviewAt ?? record.attention?.scheduledAt ?? null`; do not use `result.at`, which is missing on manual overrides. |
| `attention`, `attentionResult` | Stored metadata plus `resolveAttention(entityKind, record, now)` for badge, reason and placement. |
| `area` | Stored area or null; apply existing Unsorted filtering. |
| Task/event/repeat fields | `isWant`, `isWaiting`, `isAllDay`, `fromRecurrence` false; `endAt`, waiting timestamps, recurrence ID/status/version, location null. |
| `href` | Canonical entity destination from `attentionHref`; source links load with details. |
| Identity/capabilities | Canonical key `review:<id>`; subtype carried to detail, attention mutation and chat resolver. No completion checkbox, task cancellation or recurrence controls. |

Extend `row`, `rowValidator`, kind validator, `AgendaRowKind`, `AgendaRow`, `ActionRow`, `ItemSelection`, `adapt`, `parseHomeHash`, modal heading/detail resolution and chat adapters together. A `#review-<id>` selection must resolve subtype server-side rather than treating an arbitrary ID as a task. Detail resolution remains independent of list windows and returns unavailable for foreign/mismatched records. Project reviews are included even though code-project tasks remain excluded. “Done reviewing” does not complete a project, achieve a goal or archive knowledge.

## Placement and attention precedence

Resolve attention first using the shipped `resolveAttention` precedence: immediate override; arrived review date; other non-scheduled overrides; closed lifecycle; task deadline/blocked state; scheduled time; active project/task lifecycle; unassessed. Do not reinterpret a manual override as a date. An overdue review can override manual `ok`/`unassessed`; immediate can override an overdue review; `scheduledAt <= now` becomes stale. Closed goals/projects can still resolve actionable through earlier overrides/review dates. Archived/discarded records are nevertheless excluded by eligibility.

For eligible review projections use this exhaustive matrix. All contains every included review regardless of date; bounded placement is additional and mutually exclusive.

| Resolved state | Today | Upcoming | All only |
| --- | --- | --- | --- |
| `immediate` | Always, including undated overrides and future `at`. | Never. | Never solely All. |
| `stale`, `todo`, `in_progress`, `scheduled` | `at < tomorrow`, including old review dates. | `tomorrow <= at < weekEnd`. | `at == null` or `at >= weekEnd`. |
| `ok`, `unassessed` | Excluded. | Excluded. | Excluded from review inventory; still browsable/editable in entity surfaces. |

Thus undated manual `todo`, `in_progress`, and `stale` go to All; undated immediate goes to Today. A legacy scheduled override without either date can resolve to in_progress or unassessed, not necessarily scheduled. Use the resolved state, not the override string. Automatic in-progress projects without dates remain reachable in All. `reviewAt` takes precedence over `scheduledAt` even when both exist. Suppress `focusSnoozedUntil > now` consistently while legacy snoozes remain supported; Later uses attention metadata, not a new snooze system.

Ordinary task/event/recurrence rows retain Phase 16 inventory semantics. Attention on eligible personal tasks augments the same row: immediate attention can bring an undated task into Today; review/scheduled dates supply an attention placement when the normal deadline does not already place it. Deduplicate by task ID before counts and pagination; never add code-project tasks through attention sources. Wants retain `at:null` for their deadline semantics and never become overdue; any attention placement must use separate attention metadata. Task `ok`/`unassessed` does not remove an otherwise valid ordinary task from its normal inventory. The review exclusion is not a global filter on events/repeats/tasks. Today’s ordinary deadline lookback remains seven days; overdue review obligations do not silently expire after seven days. Label reviews as needing review rather than overdue task completion.

## Bounded backend inventory extension

Add six seek sources to `homeInventory.page`; the indexes already exist in `schema.ts`. These are new Home sources, not six new indexes:

| Source key | Table | Index | Equality prefix | Ordered range/seek columns | Projection |
| --- | --- | --- | --- | --- | --- |
| `review-goals` | goals | by_brain_review | brainInstanceId, processingState = accepted | attention.reviewAt, _creationTime, _id | review/goal |
| `review-projects` | projects | by_brain_review | same | same | review/project |
| `review-tasks` | tasks | by_brain_review | same | same | task |
| `review-people` | people | by_brain_review | same | same | review/person |
| `review-companies` | companies | by_brain_review | same | same | review/company |
| `review-knowledge` | knowledge | by_brain_review | same | same | review/actual kind |

Use numeric `reviewAt >= 0` (the setter permits zero); Today scans `< tomorrow`, Upcoming `[tomorrow, weekEnd)`, All has no upper bound. Immediate exceptions require override sources independent of date windows. `seek` currently saves `record[field]`; it needs a nested accessor for `attention.reviewAt` and an explicit encoding for undefined cursor values. Existing review indexes do not order by title. Do not insert title into the seek tuple or assume index traversal is title-sorted. Merge with a compatible date/creation/ID order and canonical-key tie-break; preserve source heads and deduplication across pages. Version cursor scope when source/order semantics change.

Six review sources alone are insufficient. Add bounded `by_brain_scheduled` sources for scheduled-only rows (reviewAt absent); `by_brain_attention` sources for immediate and undated manual actionable overrides; and `projects.by_brain_status` for automatic undated in-progress projects. Apply resolver and eligibility after reads, deduplicate overlaps with review sources and existing task sources. Future review dates that mask scheduled dates still use reviewAt. Seek each necessary source without `.collect()`/slice; retain 20-row period and 50-row All batches, bounded scan budgets, short-page continuation and explicit overflow. The capped `focusForViewer` result is not a complete inventory or count source.

Extract/reuse `attention.ts`’s currently private `eligible()` rather than copy a weaker test. It enforces brain ownership, accepted processing state, and `isAttentionArchived` (status archived/discarded, processingState archived, reviewState archived); task eligibility also rejects archived parents and conservatively rejects more than 64 relationship links. Retain Home’s stronger code-project exclusion and recurrence association checks. Reviews belong only to the open status inventory; Completed/cancelled and Paused/retired remain task/repeat history filters.

## Upcoming: exact period change

Upcoming is the next seven local dates after Today: tomorrow inclusive through the start of day eight exclusive. In `homePeriods`, delete `untilMonday` and replace exactly `weekEnd: day(untilMonday)` with `weekEnd: day(8)`, and `utcWeekEnd: utc(untilMonday)` with `utcWeekEnd: utc(8)`. Keep `start:day(0)`, `tomorrow:day(1)`, `overdueStart:day(-7)` and `horizon:day(365)`. Keep the internal `period:'week'` API discriminator for compatibility; change its label and loading copy to Upcoming. Remove the Sunday-empty copy. Sunday now has seven upcoming dates just like Monday.

Use civil arithmetic through the existing `day` and `utc` helpers, never `now + 7*86400000`. Maintain the frozen paging scope and midnight/focus/timezone refresh. Timed events use local boundaries; all-day dates use UTC-encoded civil boundaries. Ongoing events remain Today-only. These decisions explicitly replace the old contract’s Monday–Sunday rule.

## Summary from the same rows

Replace the event-only `buildTodaySummary` contract with deterministic status clauses, lifted out of `Inventory` into a Summary region above the Today section. No AI call, stored focus summary, separate attention query or duplicated item titles. Count the deduplicated Today projection using the same clock, eligibility and filters as its card. Fixed clause order: “N need immediate attention”, “N need review” (stale), “N to do”, “N in progress”, “N scheduled”. Drop each clause independently at zero, join surviving clauses into brief prose, and hide Summary if all are zero. Pluralize deterministically.

Classify each entity at most once by resolved attention. Events count as scheduled; active standalone recurrence occurrences count as to do; task attention is resolved on the actual task record. Do not double-count recurrence-backed tasks or All/Upcoming copies. Do not classify task lifecycle `waiting` as a new attention status. An event being scheduled does not create editable attention metadata for it.

Lift Today’s row/page state to a shared owner or equivalent selector so Summary and rows cannot diverge. During loading do not display a false zero; with more results, label counts as “in shown items” rather than exact totals. Changing loaded rows or completing/reviewing an item updates both reactively. No unbounded backend count query is required by this contract. Remove the old four-event threshold and overlap-only summary from this surface; they are not the new status clauses.

## Review actions and editor homes

Use `attention.setForViewer({kind:entityKind,id,attention})`. It replaces, rather than merges, attention metadata and stamps `assessedAt`; omission clears a field. It validates nonnegative finite dates and requires a future scheduledAt for `override:'scheduled'`.

* **Done reviewing:** write `{override:'ok', reason?}` using the latest reason if retained; omit both reviewAt and scheduledAt. Clearing only reviewAt leaves stale/scheduled/immediate overrides active. Do not send `{}` and expect an in-progress project to disappear. This acknowledges attention only; it never mutates entity lifecycle or executes an external action.
* **Later:** choose an explicit future review time, write `{override:'ok', reviewAt:chosenTime, reason?}`, and omit scheduledAt. Until the date arrives the row is excluded; when it arrives the resolver returns stale before the ok override. Preserve neither immediate nor stale overrides, which would defeat postponement. No implicit calendar event or arbitrary default date is required.

Guard duplicate clicks, retain errors and refresh the owned record before replacement; concurrent editor changes need an expected-version/updatedAt guard or a semantic server transition to avoid lost metadata. The current setter has neither. Selecting Cancel in the date picker does not mutate anything.

| Entity | AttentionEditor destination |
| --- | --- |
| Personal task | Full editor in `ItemDetailsModal`; keep task completion wired to existing shared lifecycle. |
| Project task | Existing `task-detail.tsx` editor stays available; Home deep link still offers project destination. |
| Project | Existing `project-board.tsx` editor stays; review modal may embed the same editor and link to project. |
| Goal | Goal detail/expanded `GoalRow` and review modal. No new goal route is assumed. |
| Person/company | Contact detail/expanded `ContactRow` and review modal, with actual subtype. |
| Note/link/memory | Canonical knowledge detail and review modal; memory uses `LiveMemoryDetailContent`, note/link access stays through existing Library/Mind detail. No nonexistent note-detail route is specified. |
| Event/recurrence | No AttentionEditor: neither belongs to `AttentionKind`. Preserve event links and schedule editor. |

Mind’s task-only `actionsOnly` editor is not the full editor today. Keep entity detail actions or route them into shared details, and make full attention editing reachable for every supported entity after `/attention` retires. Preserve `AttentionBadge`, `AttentionForm`, `AttentionEditor`, `AttentionEditorContent`, `AttentionBoundary`, `useAttentionClock`, and `useAttentionRefresh` as needed; removing a queue must not remove its reusable editing components.

## Gate retirement inventory

Retire the ingestion/approval queue, not ownership, authentication, chat tool permissions or execution correctness. This inventory names implementation work, not changes made by this documentation task.

| Surface/symbol/API | Required disposition |
| --- | --- |
| `TodayContent`, legacy `LiveHomeContent` | Remove `AttentionFocus`, “Needs your review”, unclear/pending counts and review links; retain Quick capture/sync. |
| `AttentionFocus`, `AttentionFocusContent`, `AttentionContent`, `AttentionPageContent` | Retire standalone queue UI; remove shell Attention navigation. `attention.focusForViewer` and `browseForViewer` retire as queue reads after consumers move; keep `getForViewer`, `setForViewer`, `resolveAttention`, `ATTENTION`, `eligible`. |
| `MindAttention`, `MindAttentionCard`, `FeedItem`, `mindAttentionRows`, `FocusItem`, `ReviewItem`, `FeedRow`, `todayRange` | Retire parallel attention/review feed and its model; change `MindList` and `MindContent` imports, selection state and event-detail adapter to shared item details before deleting event controls/chat access. |
| `ReviewContent`, `ReviewHistoryContent`, `LiveReviewQueueContent`, `MindReviewDetail`, `ReviewQueueFilter`, `isReviewQueueFilter`, `ReviewSectionHeader` | Retire gate components/filter chips. `LiveApprovalHistoryContent` becomes Activity history presentation rather than approved/rejected queue history. |
| `TriageItem`, `CardActions`, `PayloadEditor`, `MemoryReviewActions`, `memoryIsPendingReview`, inbox variant of `MemoryRow` | Retire acceptance/rejection/merge gate UI and queue-driven auto-expiry; retain ordinary entity editing and source display helpers still used elsewhere. |
| `PendingActionItem`, `editablePendingAction`, `badgeForPendingAction`, `statusDescription` | Replace approve/reject/revise presentation with outbox/activity status and supported error recovery. Recipient helpers may remain for real editing consumers. |
| `/review`, `/review?filter=all|approvals|finds|revisit`, `/attention` | Redirect to Home; remove shell entries and review badge (`reviewCountsForViewer` subscription). |
| `/review/history` | Redirect to proposed `/activity`; Activity is new implementation, not an existing page. |
| `/triage`, `/pending-actions`, `/resurfacing`, `/memory-inbox`, `/brain/inbox` | Replace existing review redirects with Home or Activity (pending-actions → Activity). Preserve unrelated Brain sections. |
| `knowledge.reviewCountsForViewer`, `triageForViewer`, `listPendingTriage`, `listMemoryInboxForViewer`, `listMemoryReviewItemsForViewer` | Retire gate reads after migration/compatibility period. `acceptedEntityOptionsForViewer` remains where task/project/waiting pickers need it. |
| `knowledge.dashboardForViewer` | Stop returning/using gate arrays as Home decisions; preserve captures and sync data. |
| `knowledge.submitCandidateObject`, `ingestObject` | Route ordinary validated ingestion directly to accepted records with duplicate/source-link handling; compatibility candidate calls must no longer create pending triage. |
| `approveTriageItem`, `reviewTriageItem`, `rejectTriageItem` | Retire gate mutations after migration; retain internal acceptance helpers for migration, never a silent public approval bypass. |
| `captureThoughtForViewer/ForBrain`, `recordDurableMemoryForViewer`, `recordMemoryForBrain`, `submitMemoryReviewCandidateForViewer/ForBrain` | Change inbox/review outputs to direct acceptance; retain provenance, validation, linking and dedupe. |
| `acceptMemoryForViewer`, `rejectMemoryForViewer`, `bulkResolveMemoryCandidatesForViewer`, `expireStaleMemoryCandidatesForViewer`, `pendingReviewMemoriesForBrain`, `MEMORY_REVIEW_EXPIRY_MS` | Retire gate/expiry use; migration uses bounded equivalents. `archiveMemoryForViewer` remains explicit lifecycle editing. |
| `resurfacing.reviewSuggestionsForViewer`, `SuggestionGroup` | Retire Revisit as a second Home queue. Current keyword/age heuristics over sampled memories/projects/tasks/people are not attention metadata; do not pretend they already populate Home. Any future conversion to persisted attention requires explicit bounded/idempotent writes. |
| `knowledge.pendingActionsForViewer`, `listPendingActions`, `reviewPendingActionForViewer`, `recordPendingActionResult` | Change reads to outbox/history semantics; retire approve/reject gate, introduce explicit supported retry/cancel semantics, retain execution results with authorization/idempotency hardening. |
| MCP `ingest_object`, `submit_candidate_object`, `submit_memory_review_candidate` | Keep ingest_object as direct acceptance; deprecate gate names or keep compatibility adapters to direct acceptance, returning canonical IDs and truthful accepted results. |
| MCP `capture_thought`, `record_memory`, `record_decision`, `record_principle` | Remove submit-for-review behavior/confirmation text; retain schemas/provenance. |
| MCP `propose_calendar_event` | Queue validated work for execution; change `autoApprove`, `approvalForced`, role-policy branch and “awaiting /review” responses consistently. Preserve role authorization; removal of a UI gate alone grants no new tool scope. |
| MCP `list_pending_actions`, `record_pending_action_result` | Keep as outbox inspection/result reporting with corresponding backend semantics. |
| MCP `summarize_focus`, `refresh_focus_summary`, `generate_focus_summary`; `getLatestFocusSummary`, `upsertFocusSummary` | Not Summary dependencies; remove Home callers/claims, retain only independently used capabilities. |
| MCP `record_entity_review`; `knowledge.recordEntityReview` | Keep audit/review recording, not acceptance. If meant to acknowledge Home review, explicitly add the same attention transition; current audit alone is not Done reviewing. |

Update MCP registrations in `mcp-server.ts`, adapters in `tools.ts`, OAuth/role policy entries and descriptions together. There are no registered approve/reject-triage MCP tools in this checkout; do not invent removals. Harness/chat `approval-card.tsx` and tool permission approvals are separate from this ingestion/outbox gate and remain outside scope.

## pendingActions becomes an execution outbox

Keep the table and durable IDs. For supported, authorized actions, enqueue into the existing executable `approved` state (compatibility name meaning ready) instead of `pending_approval`; do not mark sent/completed before provider success or forge `approvedBy`. `calendar.draftCalendarEvent` currently supports this only through `requireApproval:false`, while MCP defaults/role policy force the gate. Change both ends and their documentation together. Existing pending_approval/drafted calendar backlog needs a separate audited readiness transition, after duplicate cleanup and validation; it is not canonical-entity bulk acceptance.

Preserve `claimNextCalendarAction`: host brain/draining checks, oldest-ready selection, 150,000 ms lease, host/claimToken/claimedAt/leaseExpiresAt, malformed payload failure, minted external ID, retry after lease expiry. Preserve `recordCalendarActionResult` stale-claim rejection and atomic action/mirror settlement, with created or provider-ID conflict treated as success. A Google 409 for the same minted ID is not a scheduling-overlap override. Keep `recordCalendarEventRemoteResult` compatible with the same mirror identity.

Retain `findMirrorConflicts`, mirror freshness warnings, `findDuplicatePendingProposal`, `loadPendingCalendarProposals`, `PENDING_PROPOSAL_STATUSES`, `groupDuplicatePendingCalendarActions` and `hostSweepDuplicatePendingActions`. Today pending proposal detection/sweep only considers pending_approval/drafted and deliberately excludes approved. After auto-readiness, extend duplicate detection to ready/unclaimed work; never sweep a live lease or completed/sent action. Preserve deterministic keeper selection, system audit and cancellation of swept mirror rows. Validate sweep/claim races transactionally. Conflict warnings must remain in outbox/Activity and tool results; do not report “no conflicts” from a missing/stale mirror.

`waiting.nudgeWaitingTask` currently records lastNudgedAt and optionally creates a `drafted` waiting_nudge with messageBody/relatedEntities. It has no demonstrated delivery worker, resolved recipient/provider or lease protocol. “Nudge drafted — review it in Pending actions” must change, but relabeling drafted as approved is insufficient. Add validated payload/recipient resolution and an authorized idempotent executor before claiming automatic delivery. Until then display the actual draft/unavailable execution state. No calendar reschedule/cancel capability is added by this phase.

## Activity scope

Provide a read-only, brain-scoped, paginated Activity surface from `activityEvents` and outbox outcomes: ingestion/merge provenance, migration, attention acknowledgement/defer, task/repeat lifecycle, external queued/executed/failed outcomes with timestamps, actor, entity/source links and error detail where available. It replaces settled approval history and “Actions taken” as the durable place to inspect what happened; Quick capture may retain a compact recent preview linking there. Activity is neither another decision queue nor an AI summary. Preserve historical approved/rejected events as history without inventing user approvals for automatic work. Supported retries/cancellations are explicit outbox controls, not a generic Activity approve button. Do not promise complete historical coverage: attention.setForViewer and calendar claim/result paths currently lack consistent activity writes, and no unified Activity query/page ships here.

## One-time acceptance migration

Implement a resumable, per-brain, versioned migration with a fixed cutoff and bounded cursors. Exact target set is the union of (1) `triageItems` with `status:'pending'` at the cutoff, and (2) `knowledge` with `kind:'memory'` and either `status:'inbox'` or `reviewState:'pending_review'`, excluding any rejected/archived/discarded lifecycle, processing or review state. Include inbox `reviewState:'unreviewed'` thoughts; the existing bulk helper only selects pending_review and would miss them. Process the union once by ID. Ordinary accepted entities with attention.reviewAt are not acceptance candidates. Do not mass-change goal/project/task lifecycle states, revive rejected/archived items, accept quick captures, or execute pendingActions in this migration.

For triage, reuse normalized accepted-entity creation/duplicate merging and source links; set candidateEntityId and terminal triage status approved with a system migration audit, not a fictitious human reviewer. For memories, preserve ID/body/type/provenance/relationships and set status, processingState and reviewState to accepted, acceptedAt only if missing. Validate malformed legacy candidates and record a retryable migration error rather than silently dropping them. Existing accepted duplicate targets are merged, not duplicated.

Persist migration version/cutoff/progress and per-target completion in the same transaction as each acceptance/audit. Re-read current state; skip already resolved targets. Replays after interruption produce no duplicate entity, source relationship, audit event or timestamp churn. Mark the run complete only when all eligible targets are processed or explicitly reported as failures requiring repair. Deploy direct-accept writers and stop queue expiry before draining the backlog so no new gate items or expiry race can invalidate the cutoff. Do not run the existing unbounded bulk memory helper as if it covered this set. This documentation task does not execute migration or external effects.

## Actionable backend gaps and verification handoff

1. **Inventory coverage and identity:** fourth-kind validators/projection/owned subtype detail; all six review seeks plus scheduled/manual/automatic-project coverage; shared eligibility extraction; nested seek values, cursor versioning, stable merge and cross-source/page dedupe; task attention placement without bypassing project/want/recurrence rules.
2. **Attention transitions:** replacement-safe Done reviewing/Later semantics, concurrency protection, audit writes and compatibility for legacy snoozes. Retain setter ownership/date validation. Add owned review detail/source/chat context for every subtype; do not route review IDs into recurrence fallback.
3. **Shared clock and Summary:** pass resolved metadata from backend to shared row state, rolling boundaries, deterministic partial-count presentation; no AI/count scan. Verify the same scope drives rows and clauses.
4. **Direct acceptance:** change every candidate/inbox writer and MCP adapter, preserving validation/dedupe/source relationships; retire reads/mutations only after consumers and redirects migrate. Do not delete acceptedEntityOptionsForViewer used by other controls.
5. **Outbox safety:** auto-readiness producers, bounded outbox reads, ready-work duplicate sweep, claim/sweep concurrency, explicit failure recovery, activity outcomes, and a real waiting-nudge executor. Generic recordPendingActionResult currently lacks calendar claim fencing; prevent it bypassing the calendar worker’s token checks.
6. **Migration:** implement the exact bounded union, resumable/idempotent state and system audit; separate external-action backlog handling. No existing migration endpoint in this checkout satisfies it.
7. **Activity:** add indexed owned pagination/query and page; fill missing audit events prospectively, preserve historical evidence and distinguish ready/running/failed/settled work.

Implementation tests must cover every resolver state/override and null date, epoch-zero review dates, both attention dates, closed versus archived entities, older reviews, task/project exclusion, same-ID source overlaps, nested seek ties and page transitions; Sunday/DST/day-eight cutoffs and all-day overlap; zero/nonzero/partial Summary clauses; replacement semantics and concurrent edits; replayed migration including unreviewed inbox thoughts; lease expiry/stale claims, duplicate sweeps and provider-ID retry conflicts. Exercise keyboard/modal/chat access and all retired route redirects. For this documentation-only change, verification is source/symbol inspection, Markdown links and diff hygiene, not runtime assertions for the proposed implementation.
