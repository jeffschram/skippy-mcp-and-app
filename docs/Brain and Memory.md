# Brain and memory data structure

This is a conceptual overview of the current local schema and application code, checked September 17, 2026. The groupings below are not a literal database nesting hierarchy or an exhaustive inventory of infrastructure tables. They do not verify the deployed database or the contents of individual records.

Sources: [schema](../convex/schema.ts), [knowledge read/write paths](../convex/knowledge.ts), and [attention rules](../convex/attentionModel.ts).

## Ownership and shared states

`users` identifies the owner. `brainInstances` links a brain to its owner through `ownerUserId`. Most user-data records belong to a brain through `brainInstanceId`; configuration is stored separately in `brainConfigs`.

Goals, projects, tasks, people, companies, and knowledge records carry shared processing metadata and optional attention metadata. Their states serve different purposes:

| State | What it describes |
| --- | --- |
| Processing state | Whether a record is `suggested`, `accepted`, `rejected`, or `archived`. |
| Lifecycle status | The state of the particular kind of record: for example, a project can be `in_progress`, a task `waiting`, or a saved link `read`. There is no single universal lifecycle enum. |
| Attention | Needs immediate attention, To do, In Progress, Scheduled, Everything OK, Needs review, or Not assessed. The resolver derives this from record data and optional manual overrides, review dates, and scheduled times. |
| Task execution state | A separate workflow for task planning and execution: `proposed`, `unplanned`, `briefed`, `ready`, `in_progress`, `in_review`, `blocked`, `done`, or `cancelled`. |
| Memory review state | Additional review metadata on knowledge memories, including unreviewed, pending review, accepted, rejected, and archived. |

These states are not interchangeable. Acceptance does not mean completion, and a lifecycle status can differ from the attention assessment. Which records appear in a particular list or map is determined by that view's filtering code.

## Main records

- **Goals** — `goals`
  - Outcomes you want to achieve.
  - Lifecycle: active, paused, achieved, or abandoned.

- **Projects** — `projects`
  - Work organized around a specific objective; projects may be code or general projects.
  - Lifecycle: idea, planned, in progress, paused, completed, cancelled, or archived.
  - **Phases** — `phases`: ordered stages linked to a project by `projectId`.
  - **Plans** — `projectPlans`: records of planning runs and their generated task IDs, separate from the phase/task structure.
  - **Notes pad** — `projects.notesPad`: a freeform text field, with saved versions in `projectNoteSnapshots`. These are separate from Knowledge notes.
  - **Files and deliverables** — `projectFiles`: project attachments and generated artifacts, optionally associated with a task, chat, or agent run. File metadata references Convex storage through `storageId`.

- **Tasks** — `tasks`
  - Project and standalone tasks share the same table.
  - A project task links to its project through a `belongs_to` relationship; an optional `phaseId` places it in a phase. Tasks do not store a direct `projectId` field.
  - A standalone task has no project relationship.
  - Lifecycle: to do, in progress, waiting, done, or cancelled.
  - Additional fields distinguish life area, obligation versus desire (`must` / `want`), owner versus agent work, due dates, and who the task is waiting on.

- **Knowledge** — one shared `knowledge` table
  - `kind` distinguishes three kinds of records; these are not separate tables:
    - **Notes** — `kind: note`: written information, including structured references with optional `properties` and descriptive `objectType` metadata.
    - **Links** — `kind: link`: saved URLs with context or summaries and a link lifecycle such as saved, unread, read, or discarded.
    - **Memories** — `kind: memory`: remembered content classified by `memoryType`:
      - Thought
      - Memory
      - Decision
      - Principle
      - Question
      - Insight
      - Artifact
  - These seven memory types are field values, not additional tables.
  - An artifact memory is a knowledge record; it is distinct from an actual uploaded or generated file in `projectFiles`.
  - Personal facts and preferences written through the active durable-memory path are stored here.

- **People** — `people`
  - Contacts, names, contact details, roles, and relationship context.

- **Companies** — `companies`
  - Organizations, websites, domains, and relationship details.

- **Calendar events** — `calendarEvents`
  - Scheduled events and appointments, including times, attendees, calendar/source identifiers, and sync state.
  - Optional `relatedEntityRefs` associate an event with core brain entities.
  - Calendar recurrence data is separate from the repeating-obligation records below.

- **Recurrences** — `recurrences`
  - Repeating obligations with a rule, time zone, next due date, and a capped completion history.
  - Timing is anchored to either completion or a fixed schedule.
  - Can spawn a task or appear only on the agenda; `currentTaskId` tracks the current spawned task.
  - Optional `relatedEntityRefs` associate the obligation with core entities.

- **Quick captures** — `quickCaptures`
  - Incoming text, URLs, or files, with pending, processed, or discarded status.
  - `intent: remember` feeds ingestion; processed captures can reference the entities created or updated from them.
  - `intent: hold` is a private device-to-device transfer, excluded from ingestion and subject to seven-day expiry. An absent intent defaults to remember.

- **Financial records**
  - Accounts — `financialAccounts`
  - Transactions — `financialTransactions`
  - Daily balances — `financialDailyBalances`
  - Budgets — `financialBudgets`
  - Debts — `financialDebts`

## Connections, provenance, and supporting information

- **Relationships** — `relationships`
  - Directed connections with `from`, `to`, a relationship type, and optional reason/confidence.
  - Endpoint types are goal, project, task, note, person, company, link, and memory. This does not cover every database table: calendar events, recurrences, financial records, and project files are not ordinary relationship endpoints.
  - Memory relationships use `memory` as their endpoint type. Former knowledge objects are notes; their IDs and extra properties are preserved.
  - Explicit memory-to-entity associations are stored as `mentions` relationships. Readers reconstruct `relatedEntityRefs` from these edges rather than storing that array on the knowledge record.
  - Supported relationship types include `belongs_to`, `supports`, `related_to`, `mentions`, `assigned_to`, `works_at`, `client_of`, `depends_on`, `blocked_by`, `waiting_on`, `unblocks`, `follow_up_with`, and `spawned_from`.
  - Specific family roles such as spouse or brother are currently described in relationship reasons or person context, rather than dedicated relationship types.

- **Source references** — `sourceRefs` and `entitySourceRefs`
  - Source references preserve origin identifiers, timestamps, links, summaries, and short excerpts.
  - `entitySourceRefs` connects core entities to those sources. Knowledge records can also carry `sourceRefIds`.

- **Conversations** — `projectChats` and `chatMessages`
  - Chat sessions can belong to a project or an app page, despite the `projectChats` name.
  - `chatTurns` and `chatTurnEvents` track execution of conversational turns.
  - A transcript is separate from the durable knowledge extracted from it.

- **Interviews and responses** — `interviews` and `interviewResponses`
  - Structured question-and-answer sessions. Responses can reference a knowledge memory candidate.

- **User profile memories** — `userProfileMemories`
  - This table is declared in the schema, but no application reads or writes referencing it were found outside that declaration in the checked code.
  - It should not be treated as a second active durable-memory system. Current personal facts and preferences use Knowledge memories.

- **Operating rules** — `operatingRules`
  - Enabled rules with scope, source, text, and optional metadata governing Skippy behavior.
  - These are distinct from principle memories in Knowledge and from harness skill definitions in `harnessSkills`.

- **Review, activity, and retrieval support**
  - Review queue — `triageItems`
  - Activity history — `activityEvents`
  - Stored focus summaries and focus actions — `focusSummaries`, `focusItemActions`
  - Embeddings for retrieval — `entityEmbeddings`
  - Current viewer/page context — `viewerContext`

## Operational records

Supporting tables manage agents, execution, approvals, integrations, and delivery rather than introducing additional kinds of personal knowledge:

- Agent configuration, hosts, project execution configuration, runs, and events.
- Agent approvals and pending external actions.
- Connector configuration and MCP access tokens.
- Push subscriptions and notification deliveries.
- Ingestion runs and source-sync status.
- Maintenance jobs and AI processing runs.
