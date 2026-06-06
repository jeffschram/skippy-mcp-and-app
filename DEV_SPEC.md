# Skippy Development Specification

> **Status:** Living development specification derived from `PLAN.md`.
>
> **Purpose:** Describe the intended whole-product architecture and implementation direction for Skippy. This is not an MVP-only spec. Implementation can be phased, but the product vision should remain whole-system.

## 1. Product summary

Skippy is a general second-brain knowledge system for personal and work life. It is exposed to AI harnesses through an MCP server and stores its canonical knowledge graph in Convex.

AI harnesses such as ChatGPT, Claude, Hermes, Claude Code, and Codex use their connectors and skills to inspect sources such as email, iMessage, calendars, Apple Reminders, links, and conversations. They submit extracted objects and source references to Skippy through MCP tools.

Skippy organizes this information into connected objects:

- Goals
- Projects
- Tasks
- Notes / ideas
- Links / URLs
- People
- Companies
- Generic extension knowledge objects

A minimal mobile-friendly PWA displays the current state of the brain, especially what the user should focus on now. Normal capture and editing happen through AI/MCP conversations, not the web app, with intentional web-app exceptions for triage, task completion, pending external-action approvals, settings, and notifications.

## 2. Core product principles

1. **Whole-product vision, phased implementation.** Do not reduce the design to an MVP-only task app.
2. **Unified brain.** Personal and professional information live in one graph for a brain instance.
3. **Harnesses provide connector access.** Skippy does not need direct credentials for every external system.
4. **Skippy owns canonical consistency.** Validation, normalization, dedupe, relationships, triage policy, priority, and focus ranking should be consistent across harnesses.
5. **Processed knowledge, not raw mirroring.** Skippy stores AI-extracted/processed objects with lightweight source references, not complete mirrors of Gmail, iMessage, calendars, or reminders.
6. **Minimal web app.** The web app is a focused display/review/approval surface, not the primary interaction surface.
7. **Autonomy with guardrails.** Internal writes may become more autonomous over time. External side effects require approval except low-risk sync actions caused by explicit user actions.
8. **Multi-user-ready but separate.** Build with user/brain-instance scoping from the start, but brain instances remain fully separate.

## 3. Recommended technical stack

Use a TypeScript monorepo.

Recommended stack:

- TypeScript throughout
- Convex for database, backend functions, schema, mutations, queries, and real-time data
- React/Next.js web app
- Clerk for web authentication
- TypeScript MCP server
- Vercel for web hosting/deployment
- Provider-abstracted optional AI/LLM integration
- Optional provider-configurable embeddings layer

Suggested repo structure:

```text
apps/
  web/              # Next.js PWA deployed to Vercel
  mcp-server/       # TypeScript MCP server, remote + local transports
convex/             # Convex schema, functions, mutations, queries
packages/
  shared/           # Shared types, validation helpers, constants
  ai/               # Optional provider-abstracted LLM + embeddings clients/workflows
```

Shared TypeScript types should cover:

- Entity references
- Processing states
- Domain statuses
- Source references
- Relationship types
- MCP payloads
- Pending actions
- Focus summaries
- Activity events

## 4. User, brain instance, and workspace model

### 4.1 Unified workspace

Each brain instance is one unified graph. Personal/work separation should be represented by relationships, people, companies, goals, projects, source references, and optional controlled labels — not separate workspaces.

### 4.2 Multi-user-ready instance model

The first implementation can support one primary user, but the data model must include ownership/scoping from the start.

Recommended tables:

```ts
users {
  authProvider: "clerk",
  authUserId: string,
  email: string,
  displayName?: string,
  createdAt: number,
  updatedAt: number
}

brainInstances {
  ownerUserId: Id<"users">,
  displayName: string, // e.g. "Skippy" or "Es"
  createdAt: number,
  updatedAt: number
}
```

Rules:

- The assistant/brain display name is user-configured branding, not hardcoded product logic.
- Each core entity should include `brainInstanceId`.
- Brain instances remain fully separate.
- No shared family tasks, shared projects, or cross-brain collaboration for now.

## 5. Authentication and authorization

### 5.1 Web auth

Use Clerk from the start.

On first login:

1. Clerk authenticates the user.
2. Backend ensures a local `users` record exists.
3. Backend ensures a default `brainInstances` record exists.
4. User can configure assistant display name.

Authorization requirements:

- Convex functions must scope all queries/mutations to the authenticated user's brain instance.
- Never trust a client-provided `brainInstanceId` without verifying ownership.

### 5.2 MCP auth

MCP auth is separate from web auth.

Initial MCP auth model:

- Per-brain API tokens
- Token maps to exactly one `brainInstanceId`
- Tokens are created/managed from the settings UI
- Tokens can be labeled, rotated, and revoked
- Token value is shown/copyable only at creation time
- Store only secure hashes of token values

OAuth-based MCP auth may be explored later, but per-brain tokens are preferred initially.

## 6. Data model overview

Use a hybrid data model:

1. First-class typed tables for important core entities.
2. Generic `knowledgeObjects` table for extension concepts.
3. Universal `relationships` table connecting anything to anything.
4. Shared support tables for source references, activity, config, focus summaries, pending actions, MCP tokens, etc.

### 6.1 Universal processing state

Core objects and generic knowledge objects should support a universal `processingState`:

```ts
type ProcessingState = "suggested" | "accepted" | "rejected" | "archived";
```

Meanings:

- `suggested`: extracted/inferred but needs review.
- `accepted`: trusted knowledge graph object.
- `rejected`: reviewed and discarded/ignored.
- `archived`: preserved but no longer active/prominent.

This is separate from type-specific `status`.

Examples:

```ts
// Project
{ processingState: "accepted", status: "in_progress" }

// Task
{ processingState: "accepted", status: "done" }
```

Rejected objects:

- Retain by default for learning, provenance, auditability, and duplicate prevention.
- Hide from normal dashboards/lists/search.
- Include `rejectedAt`, optional `rejectionReason`, and `rejectedBy: "user" | "ai" | "system"`.
- Later compaction/pruning may keep only metadata and source refs.

### 6.2 Polymorphic entity references

Use polymorphic references for relationships, focus items, activity, pending actions, and source refs.

```ts
type EntityType =
  | "goal"
  | "project"
  | "task"
  | "note"
  | "person"
  | "company"
  | "link"
  | "knowledgeObject";

type EntityRef = {
  entityType: EntityType;
  entityId: string;
};
```

## 7. Core entity tables

All core tables should include at least:

- `brainInstanceId`
- `processingState`
- `title` or equivalent display field
- `summary` / notes fields where appropriate
- `createdAt`
- `updatedAt`
- source reference relationships where applicable
- computed priority metadata where applicable

### 7.1 Goals

Goals are flat, not hierarchical.

- There will likely be about five active goals at a time.
- Goals help Skippy understand importance and focus.
- Goals connect to projects/tasks/notes/links/people/companies through relationships like `supports` and `related_to`.
- Do not build life-goal/yearly-goal/project hierarchy.

Suggested fields:

```ts
goals {
  brainInstanceId: Id<"brainInstances">,
  title: string,
  description?: string,
  processingState: ProcessingState,
  status: "active" | "paused" | "achieved" | "abandoned",
  createdAt: number,
  updatedAt: number
}
```

### 7.2 Projects

Projects are first-class objects that organize tasks and related context.

Suggested fields:

```ts
projects {
  brainInstanceId: Id<"brainInstances">,
  title: string,
  summary?: string,
  processingState: ProcessingState,
  status: "idea" | "planned" | "in_progress" | "paused" | "completed" | "cancelled",
  createdAt: number,
  updatedAt: number,
  priorityScore?: number,
  priorityReason?: string,
  priorityComputedAt?: number,
  priorityPolicyVersion?: string
}
```

### 7.3 Tasks

Tasks are first-class objects, usually connected to projects, people, companies, goals, reminders, or source-derived commitments.

Rules:

- No native recurring task support.
- Recurrence remains in Apple Reminders/calendar.
- Task priorities are computed, not primarily manually assigned.
- Web app may mark accepted tasks as done.
- If task maps to an external reminder, completion may queue a low-risk external sync action for a harness.

Suggested fields:

```ts
tasks {
  brainInstanceId: Id<"brainInstances">,
  title: string,
  description?: string,
  processingState: ProcessingState,
  status: "todo" | "in_progress" | "waiting" | "done" | "cancelled",
  dueAt?: number,
  completedAt?: number,
  createdAt: number,
  updatedAt: number,
  priorityScore?: number,
  urgencyScore?: number,
  importanceScore?: number,
  priorityReason?: string,
  priorityComputedAt?: number,
  priorityPolicyVersion?: string
}
```

### 7.4 Notes

Notes are simple short captured thoughts, observations, or ideas.

Rules:

- No long-form rich note/document editing from the start.
- Longer documents can later become generic knowledge objects or a separate document type.

Suggested fields:

```ts
notes {
  brainInstanceId: Id<"brainInstances">,
  title?: string,
  body: string,
  processingState: ProcessingState,
  createdAt: number,
  updatedAt: number
}
```

### 7.5 Links

Links/URLs are first-class typed objects.

Rules:

- Prefer harness-provided metadata and summaries at first.
- Allow URL-only captures.
- Optional Skippy-side enrichment can be added later and must be configurable/bounded.
- Do not broad crawl.

Suggested fields:

```ts
links {
  brainInstanceId: Id<"brainInstances">,
  url: string,
  normalizedUrl?: string,
  title?: string,
  summary?: string,
  whyItMatters?: string,
  processingState: ProcessingState,
  status: "unread" | "read" | "saved" | "discarded",
  enrichmentStatus?: "none" | "queued" | "completed" | "failed",
  enrichedAt?: number,
  enrichmentMethod?: string,
  createdAt: number,
  updatedAt: number
}
```

### 7.6 People

People support full contact information plus relationship/context notes.

Suggested fields:

```ts
people {
  brainInstanceId: Id<"brainInstances">,
  name: string,
  emails?: string[],
  phoneNumbers?: string[],
  addresses?: string[],
  roleTitle?: string,
  relationshipContext?: string,
  notes?: string,
  processingState: ProcessingState,
  createdAt: number,
  updatedAt: number
}
```

Rules:

- Simple contact records, not CRM pipeline records.
- No syncing contacts back to Apple Contacts/Google Contacts for now.

### 7.7 Companies

Companies are simple organization/contact containers, not a full CRM.

Suggested fields:

```ts
companies {
  brainInstanceId: Id<"brainInstances">,
  name: string,
  website?: string,
  domain?: string,
  notes?: string,
  relationshipLabel?: "client" | "vendor" | "employer" | "partner" | "prospect" | "other",
  processingState: ProcessingState,
  createdAt: number,
  updatedAt: number
}
```

Rules:

- No pipelines, deals, stages, or sales workflows.

### 7.8 Generic knowledge objects

Generic extension table for useful concepts not yet part of the typed schema.

Examples:

- Decisions
- Meeting summaries
- Research topics
- Opportunities
- Places
- Books
- Assets

Suggested fields:

```ts
knowledgeObjects {
  brainInstanceId: Id<"brainInstances">,
  objectType: string, // controlled type, not arbitrary free-for-all
  title: string,
  summary?: string,
  properties?: Record<string, unknown>,
  processingState: ProcessingState,
  createdAt: number,
  updatedAt: number
}
```

The table must not become an unstructured dumping ground.

## 8. Relationships

Use a universal relationship graph.

Suggested table:

```ts
relationships {
  brainInstanceId: Id<"brainInstances">,
  from: EntityRef,
  to: EntityRef,
  type: RelationshipType,
  confidence?: number,
  reason?: string,
  createdBy: "user" | "harness" | "skippy_ai" | "system",
  createdAt: number,
  updatedAt: number
}
```

Recommended relationship types:

```ts
type RelationshipType =
  | "belongs_to"
  | "supports"
  | "related_to"
  | "mentions"
  | "assigned_to"
  | "works_at"
  | "client_of"
  | "depends_on"
  | "blocked_by"
  | "waiting_on"
  | "unblocks"
  | "follow_up_with"
  | "spawned_from";
```

Dependencies/blockers:

- Support lightweight `depends_on`, `blocked_by`, `waiting_on`, `unblocks`, and `follow_up_with` relationships.
- Use them for prioritization, focus summaries, and context display.
- Do not implement complex dependency engines, Gantt charts, auto-scheduling, or critical-path analysis.

## 9. Source references and external systems

Emails, iMessages, calendar events, and Apple Reminders are external source systems, not first-class Skippy tables.

Skippy stores lightweight source refs and derives processed objects from them.

Suggested table:

```ts
sourceRefs {
  brainInstanceId: Id<"brainInstances">,
  sourceSystem: "gmail" | "imessage" | "calendar" | "apple_reminders" | "hermes" | "claude" | "chatgpt" | "manual_conversation" | string,
  externalId?: string,
  threadId?: string,
  messageId?: string,
  eventId?: string,
  reminderId?: string,
  sourceTimestamp?: number,
  participants?: string[],
  url?: string,
  deepLink?: string,
  excerpt?: string,
  summary?: string,
  createdAt: number,
  updatedAt: number
}
```

Objects can have one or more source refs. Use a linking table if needed:

```ts
entitySourceRefs {
  brainInstanceId: Id<"brainInstances">,
  entityRef: EntityRef,
  sourceRefId: Id<"sourceRefs">,
  relationship?: "created_from" | "updated_from" | "mentioned_in" | "evidence_for",
  createdAt: number
}
```

## 10. Triage and autonomy

Skippy should become more autonomous over time while preserving review/correction when confidence is low.

Early behavior:

- Newly extracted/inferred objects can enter `suggested` state.
- User reviews suggestions on the triage page.
- User can approve, reject, correct, merge, or reclassify suggestions.

Future behavior:

- Skippy learns enough from corrections and accepted patterns to auto-accept routine items.
- Autonomy thresholds are configurable per brain instance.

Suggested triage metadata:

```ts
triageItems {
  brainInstanceId: Id<"brainInstances">,
  candidateEntityType: EntityType,
  candidateEntityId?: string,
  candidatePayload: unknown,
  status: "pending" | "approved" | "rejected" | "merged" | "corrected",
  confidence?: number,
  reviewReason?: string,
  sourceRefIds?: Id<"sourceRefs">[],
  reviewedBy?: Id<"users">,
  reviewedAt?: number,
  createdAt: number,
  updatedAt: number
}
```

## 11. Priority and focus summaries

### 11.1 Computed priority

Skippy computes priority rather than relying on manual labels.

Signals:

- Due dates/time sensitivity
- Calendar context
- Recent emails/messages/reminders
- Project importance
- Goal relevance
- Waiting/blocker relationships
- People/companies involved
- Recency/momentum
- Neglected items
- User corrections and triage history

Store metadata:

- `priorityScore`
- `urgencyScore`
- `importanceScore`
- `priorityReason`
- `priorityComputedAt`
- `priorityPolicyVersion`

UI should show human explanations, not raw scores by default.

### 11.2 Focus summaries

The home page should show a stored generated focus summary, not trigger a live LLM call on page load.

Suggested table:

```ts
focusSummaries {
  brainInstanceId: Id<"brainInstances">,
  generatedAt: number,
  validUntil?: number,
  summaryText: string,
  topItems: Array<{
    entityRef: EntityRef,
    reason: string,
    priorityScore?: number,
    urgencyScore?: number,
    importanceScore?: number
  }>,
  sourceRunId?: Id<"ingestionRuns">,
  policyVersion?: string,
  createdAt: number
}
```

Top focus items may include:

- High-priority tasks
- Upcoming/important calendar-derived commitments
- Important email/message follow-ups
- Time-sensitive reminders
- Projects needing attention
- People/companies requiring follow-up
- Important pending approvals/actions

Pending approvals/actions may appear when important or time-sensitive and should be visually distinct.

## 12. Intelligence, LLMs, and embeddings

### 12.1 Hybrid intelligence model

External harnesses provide:

- Source access
- Conversation context
- Initial extraction/interpretation

Skippy owns canonical:

- Schema validation
- Field/status normalization
- Deduplication
- Relationship inference
- Triage policy
- Confidence scoring
- Review reasons
- Processing state behavior
- Prompt/policy versioning

### 12.2 Internal LLM layer

Internal Skippy AI/LLM layer is optional but designed from the start.

Provider modes:

- `none`
- `openai`
- `anthropic`
- `openrouter`
- `local`

Assume ChatGPT Plus/Pro/Max subscriptions are separate from OpenAI API billing. Backend LLM calls should use API keys or local/provider-specific runtimes, not consumer ChatGPT quota.

Use deterministic logic where possible and cheaper/smaller models for routine summaries/classification.

Track AI processing metadata:

- Provider
- Model
- Prompt/policy version
- Timestamp
- Why AI processing was used
- Cost estimate if available

### 12.3 Embeddings

Embeddings are optional/provider-configurable.

Core system must work without embeddings, using structured queries and explicit relationships.

Use embeddings for:

- `ask(query)` retrieval
- Semantic deduplication
- Relationship suggestions
- Related object discovery
- Focus context gathering
- Duplicate avoidance

Suggested table:

```ts
entityEmbeddings {
  brainInstanceId: Id<"brainInstances">,
  entityRef: EntityRef,
  textHash: string,
  embeddingProvider: string,
  embeddingModel: string,
  embeddingVersion?: string,
  createdAt: number
}
```

Embedded text should be compact canonical object text, not arbitrary raw source data.

## 13. Configuration, operating rules, and user profile memory

### 13.1 Per-brain configuration

Internal config should live in Convex records scoped to each brain instance where practical.

Potential config fields:

- Assistant display name
- LLM provider mode
- Preferred model for cheap/routine summaries
- Preferred model for stronger synthesis
- Autonomy thresholds
- Triage behavior
- Link enrichment toggle
- Feature toggles
- Focus-summary preferences
- Notification preferences

Secrets should not be exposed to the client. Store only safe metadata/references in Convex client-readable config. Handle actual secrets through appropriate secure mechanisms.

### 13.2 Operating rules

Operating rules describe how Skippy should behave.

Examples:

- How tasks should be phrased
- Which items can auto-accept
- Which items always require triage
- How aggressive focus prioritization should be
- Which messages/emails should become tasks
- What people/companies should be tracked
- Preferred tone for drafted outbound messages
- Rules learned from rejections/corrections

Suggested table:

```ts
operatingRules {
  brainInstanceId: Id<"brainInstances">,
  ruleType: string,
  scope: "triage" | "focus" | "task_creation" | "drafting" | "relationships" | "contacts" | string,
  source: "explicit_user_setting" | "learned_from_corrections" | "system_default",
  ruleText?: string,
  ruleMetadata?: unknown,
  enabled: boolean,
  confidence?: number,
  createdAt: number,
  updatedAt: number
}
```

Settings UI may expose safe high-level preferences. Detailed learned rules can remain internal or appear in a future advanced/debug view.

### 13.3 User profile memory

User profile memory describes stable context about the user and their life/work. It is separate from operating rules.

Examples:

- Roles and responsibilities
- Family context
- Professional context
- Important recurring responsibilities
- Important long-running commitments
- Important people/organizations
- Communication preferences and tone context
- Areas of focus/concern that are not formal goals

Suggested table:

```ts
userProfileMemories {
  brainInstanceId: Id<"brainInstances">,
  memoryType: "role" | "family_context" | "professional_context" | "responsibility" | "preference_context" | "important_context" | string,
  content: string,
  source: "explicit_user_statement" | "learned_from_activity" | "system_default",
  confidence?: number,
  enabled: boolean,
  createdAt: number,
  updatedAt: number,
  sourceRefIds?: Id<"sourceRefs">[],
  activityIds?: Id<"activityEvents">[]
}
```

Management:

- Primarily through AI/MCP conversations.
- User can tell Skippy/harness to remember, correct, or remove context.
- No direct settings UI editing initially.
- Future review/debug view may expose memory.
- Avoid noisy, stale, temporary facts.

## 14. MCP server

### 14.1 Transport model

Core MCP tool logic should be transport-independent.

Production target:

- Remote hosted HTTP/SSE-style MCP endpoint.

Development/local target:

- Local stdio transport for local Hermes/Claude Code/dev workflows.

Both transports share the same business logic. Transport-specific code handles protocol wiring and auth.

Remote MCP uses per-brain API tokens.

### 14.2 Tool categories

Support both natural-language convenience tools and structured canonical tools. All writes flow through the same pipeline:

```text
input
  -> extraction / normalization
  -> schema validation
  -> deduplication
  -> relationship inference
  -> triage/autonomy decision
  -> Convex write
```

### 14.3 Natural-language tools

Potential tools:

```ts
capture(text: string, sourceRef?: SourceRefInput)
```

Captures free-form thought, instruction, note, task, project idea, message summary, or other item.

```ts
ask(query: string)
```

Skippy internally synthesizes an answer when its internal AI layer is configured, using records, relationships, source refs, user profile memory, operating rules, and activity history. Response should include cited/referenced context. If no internal LLM is configured, return structured relevant context or say synthesis is unavailable.

```ts
summarize_focus()
```

Retrieve or regenerate current focus summary depending on tool options and config.

### 14.4 Structured tools

Potential tools:

- `submit_candidate_object`
- `upsert_goal`
- `upsert_project`
- `upsert_task`
- `upsert_note`
- `upsert_person`
- `upsert_company`
- `upsert_link`
- `upsert_knowledge_object`
- `link_entities`
- `add_source_ref`
- `generate_focus_summary`
- `record_ingestion_run`
- `list_pending_actions`
- `record_pending_action_result`
- `update_user_profile_memory`
- `update_operating_rule`

Scheduled harness jobs should prefer structured tools.

## 15. Scheduled harness workflow

Skippy supports scheduled AI harness jobs as a primary ingestion/review mechanism.

Scheduling itself lives in the external harness, not Skippy.

Typical hourly waking-hours job:

1. Pull recent source data from connected systems.
2. Extract candidate objects/updates.
3. Submit candidate objects and source refs to Skippy MCP.
4. Skippy validates, normalizes, dedupes, links, and triages.
5. Review existing accepted objects for urgency, blockers, overdue status, or follow-up.
6. Generate or refresh current focus summary.
7. Optionally execute approved pending actions or low-risk sync actions.
8. Report execution results back to Skippy.

Suggested table:

```ts
ingestionRuns {
  brainInstanceId: Id<"brainInstances">,
  harness: string,
  startedAt: number,
  completedAt?: number,
  status: "running" | "completed" | "failed",
  sourceSystemsChecked: string[],
  candidatesSubmitted?: number,
  objectsCreated?: number,
  objectsUpdated?: number,
  focusSummaryId?: Id<"focusSummaries">,
  errors?: string[],
  metadata?: unknown
}
```

## 16. Web app / PWA

### 16.1 General requirements

- Minimal
- Mobile-friendly
- PWA from the start
- Online-only is acceptable
- Primarily display/review/approval, not main input
- No ask/chat interface initially
- No global search page initially

Navigation:

- Home
- Projects/tasks
- Contacts
- Triage
- Pending actions
- Settings

### 16.2 Home page

Purpose: answer “What do I need to focus on right now?”

Display:

- Short natural-language summary
- Top ~5 focus items
- Reason for each item
- Visual distinction for pending approvals/actions

### 16.3 Project/task workspace

Views:

- Active projects
- Tasks grouped by project
- High-priority/due-soon tasks
- Project detail with related tasks, notes, links, people, companies, source refs

Allowed direct action:

- Mark accepted tasks as done

Not allowed initially:

- General direct editing of accepted projects/tasks

### 16.4 Contacts page

Views:

- People
- Companies
- Relationships between people and companies
- Related notes/projects/tasks/links/source refs

### 16.5 Triage page

Allows:

- Approve
- Reject
- Correct
- Merge
- Reclassify

Triage is an exception to the normal read-only web app rule.

### 16.6 Pending actions page

Shows drafted/proposed external actions such as outbound emails/messages.

Allows:

- Review
- Approve
- Reject
- Revise

Pending actions are visually separated because they can cause external side effects.

### 16.7 Settings page

Minimal safe per-brain settings:

- Assistant/brain display name
- LLM provider mode
- Preferred models
- Autonomy/triage thresholds if safe
- Link enrichment toggle
- Feature/focus-summary preferences
- Notification preferences
- MCP token management

Do not expose raw secrets to the client.

## 17. External actions and approvals

Skippy may support outbound actions such as sending emails/messages, but only after explicit user approval.

High-risk external actions:

- Sending email
- Sending iMessage/SMS
- Modifying calendar events
- Changing external reminders/contacts beyond low-risk completion sync

Pending actions table:

```ts
pendingActions {
  brainInstanceId: Id<"brainInstances">,
  actionType: "send_email" | "send_message" | "complete_external_reminder" | string,
  status: "drafted" | "pending_approval" | "approved" | "rejected" | "sent" | "failed" | "completed",
  recipients?: unknown,
  subject?: string,
  body?: string,
  messageBody?: string,
  relatedEntities?: EntityRef[],
  sourceRefIds?: Id<"sourceRefs">[],
  approvedBy?: Id<"users">,
  approvedAt?: number,
  approvalNotes?: string,
  executionProvider?: string,
  externalMessageId?: string,
  executedAt?: number,
  error?: string,
  createdAt: number,
  updatedAt: number
}
```

Execution model:

- Skippy stores intent, approval state, and metadata.
- External harness with connector access executes approved actions.
- Harness reports result back to Skippy.
- Skippy does not directly send outbound email/messages initially.

Low-risk sync action:

- If user marks a Skippy task done and it maps to an Apple Reminder/external task, Skippy may queue `complete_external_reminder` without a second approval.
- The task-completion click is the approval signal.
- Harness executes later and reports result.

## 18. Activity/history

Track activity for important events from the start.

Suggested table:

```ts
activityEvents {
  brainInstanceId: Id<"brainInstances">,
  entityRef?: EntityRef,
  activityType: string,
  actorType: "user" | "harness" | "skippy_ai" | "system",
  actorId?: string,
  timestamp: number,
  summary: string,
  metadata?: unknown,
  sourceRefIds?: Id<"sourceRefs">[],
  ingestionRunId?: Id<"ingestionRuns">,
  pendingActionId?: Id<"pendingActions">,
  focusSummaryId?: Id<"focusSummaries">
}
```

Examples:

- Object created from source
- Object updated by harness
- Object suggested by Skippy AI
- Object accepted/rejected/archived
- Task marked done
- External reminder completion queued/executed
- Pending message drafted/approved/rejected/sent/failed
- Relationship created/removed
- Focus summary generated
- Priority recomputed

No full activity feed needed initially, but logs should exist for debugging/audit.

## 19. Notifications

Skippy should support web app/PWA push notifications.

Rules:

- Notifications can be turned off in settings.
- Settings are scoped per brain instance.
- Use sparingly.
- Degrade gracefully when push unavailable/not authorized.

Notify for genuinely important/time-sensitive items:

- High-priority focus items
- Time-sensitive pending approvals
- Important outbound actions awaiting approval
- Urgent follow-ups
- Important scheduled-run findings

## 20. Files, tags, search, backup exclusions

### 20.1 Files/documents

Out of scope for storage/sync.

Skippy may store lightweight file refs:

- Local file path
- External URL
- File name/title
- Short harness-provided summary
- Related entity refs
- Source refs

Do not upload/sync/manage file contents.

### 20.2 Tags

No general free-form tagging initially.

Prefer:

- Typed fields
- Goals/projects/people/companies
- Source refs
- Computed priority
- Explicit relationships
- Controlled labels where useful

Avoid free-form AI-generated tags.

### 20.3 Search/chat

- No web global search page initially.
- No web ask/chat interface initially.
- `ask my brain` happens via MCP.

### 20.4 Import/export/backup

No formal custom import/export/backup system initially. Convex/Vercel infrastructure is sufficient. Future versions may add data portability.

## 21. Implementation phases

These phases sequence development without reducing the whole-product vision.

### Phase 1: Project foundation

- Initialize TypeScript monorepo.
- Add apps/packages structure.
- Configure Convex.
- Configure Next.js PWA scaffold.
- Configure lint/test/typecheck tooling.
- Add shared type package.

### Phase 2: Auth, brain instances, and config

- Add Clerk auth to web app.
- Add `users` and `brainInstances` tables.
- Ensure first login creates user + default brain instance.
- Add per-brain config records.
- Add settings page for safe config.
- Add MCP token creation/revocation with hashed tokens.

### Phase 3: Core schema and relationships

- Add core typed tables.
- Add generic `knowledgeObjects`.
- Add `relationships`.
- Add `sourceRefs` and `entitySourceRefs`.
- Add processing states and type-specific statuses.
- Add activity logging helpers.

### Phase 4: MCP core server

- Build transport-independent MCP tool logic.
- Implement local stdio transport for development.
- Implement remote HTTP/SSE transport for production target.
- Add token auth.
- Add structured tools for submitting/upserting objects, relationships, source refs, ingestion runs.
- Add natural-language tool stubs/initial behavior.

### Phase 5: Triage/autonomy pipeline

- Implement candidate submission pipeline.
- Add validation/normalization/dedupe basics.
- Add triage records and processing states.
- Add triage page.
- Add accept/reject/correct/merge/reclassify actions.
- Log activities.

### Phase 6: Web app core views

- Home page reads latest focus summary.
- Project/task workspace.
- Contacts page.
- Task completion action.
- Low-risk external reminder completion queue.
- Pending actions page.

### Phase 7: Scheduled harness integration

- Add ingestion run recording.
- Define/document Hermes scheduled job prompt/tool usage.
- Implement focus summary generation endpoint/tool.
- Implement existing-knowledge review flow.
- Implement pending action result reporting.

### Phase 8: Internal AI + embeddings

- Add provider-abstracted LLM config.
- Add optional summarization/focus synthesis.
- Add `ask(query)` internal synthesis when configured.
- Add optional embedding provider/config.
- Add embedding metadata records.

### Phase 9: PWA notifications

- Add PWA manifest/service worker as needed.
- Add notification preferences.
- Add push subscription storage.
- Add notification dispatch for important/time-sensitive events.
- Degrade gracefully when permissions unsupported/denied.

### Phase 10: Hardening and deployment

- Add authorization tests.
- Add MCP token security tests.
- Add schema validation tests.
- Add end-to-end flows for ingestion, triage, focus summary, task completion, pending action approval.
- Deploy web app to Vercel.
- Deploy/configure remote MCP endpoint.
- Verify Convex production setup.

## 22. Open questions / future decisions

These are intentionally not fully specified yet:

- Exact Convex schema definitions and indexes.
- Exact MCP protocol implementation details for remote transport.
- Whether remote MCP is hosted as part of the Next.js app, a separate server, or another deployment target.
- Exact LLM/embedding provider choices.
- Exact secure secret storage mechanism for provider API keys.
- Exact PWA push provider/implementation.
- Exact triage merge/correction UX.
- Exact scheduled Hermes job prompt and cadence.

## 23. Acceptance criteria for the full system direction

The system is on track when:

1. A user can log in with Clerk and get a named brain instance.
2. A user can create/revoke a per-brain MCP token.
3. An MCP harness can submit source-derived candidate objects.
4. Skippy stores processed objects with source refs, not raw mirrored source data.
5. Suggested objects appear in triage and can be accepted/rejected/corrected.
6. Accepted projects/tasks/people/companies/links are visible in the web app.
7. The home page shows a stored focus summary with top focus items and reasons.
8. Task completion works in the web app.
9. External reminder completion can be queued for harness execution.
10. Pending outbound messages/emails require approval before harness execution.
11. Activity/history records explain major object and system changes.
12. The system is scoped by `brainInstanceId` and safe for future multiple users.
13. The web app remains minimal/mobile-friendly/PWA-oriented.
14. Internal AI and embeddings can be disabled or configured per brain instance.
