# Skippy MCP and App

## Overall goal

'Skippy' is an MCP that can be used by AI harnesses like ChatGPT, Claude, HERMES, Claude Code, Codex etc. The idea is to use the connectors and skills of the harness to connect to things like gmail, imessages, calendars etc and then the MCP is the bridge that sends that information (and maybe even processed/triaged info) to a Convex database.

Skippy is a general second-brain knowledge system for personal and work life. It can take in conversations, incoming messages/emails, calendar events, reminders, links, ideas, and other context, then help organize it all into connected knowledge objects such as goals, projects, tasks, notes, people, companies, and links.

This is not intended to be an MVP-only project. The plan should describe the whole product vision and enough implementation detail to build toward the complete system in coherent phases.

The first major step of the project is to create the MCP, connect to a Convex DB, define the core data model, and expose tools that let AI harnesses ingest and organize information.

The second major step is to create a webapp that displays the Convex DB information in an easily digestible summary, including views for goals, projects, tasks, notes, people, companies, links, and incoming captured items.

The main rule is that the webapp is display only for normal knowledge capture and editing - all primary input is done via the AI harness with connectors/MCPs and/or conversations. Triage is an intentional exception: the web app may provide controls to approve, reject, merge, correct, or reclassify suggested objects before they become accepted knowledge. Task completion is also an intentional exception: the web app may allow the user to mark accepted tasks as done.

## Product scope

Skippy is primarily a general second-brain knowledge system where projects and tasks are one type of object, not the whole product.

### Ingested source types

Skippy should be able to ingest information from:

- Emails
- iMessages
- Calendar events
- Apple Reminders
- AI harness conversations
- Links / URLs
- Notes and ideas supplied conversationally

### Core object types to track

Skippy should keep track of:

- Goals, including life goals and professional goals
- Projects
- Tasks within projects
- Notes and ideas that may later become projects
- Links / URLs
- Companies, such as clients, vendors, employers, partners, or prospects
- People, both personal and professional

### Ingestion model

Skippy should not primarily store complete raw copies of every ingested source item. Instead, AI harnesses should extract and process useful structured objects from source material, then write those objects into Convex through the MCP.

Skippy should retain lightweight source references so processed objects can be traced back to where they came from without turning Convex into a complete mirror of email, iMessage, calendar, or reminder systems.

Examples of lightweight source references:

- Source system, such as `gmail`, `imessage`, `calendar`, `apple_reminders`, `hermes`, `claude`, `chatgpt`, or `manual_conversation`
- External source ID, thread ID, message ID, event ID, or reminder ID when available
- Source timestamp
- Source participants or sender/recipient names when useful
- Source URL or deep link when available
- Short excerpt or summary sufficient to understand provenance

Processed objects may have one or more source references. For example, a project might be created from a conversation, then later linked to several emails, calendar events, and reminders.

### Triage and autonomy model

Skippy should be designed to become as autonomous as possible over time, while still supporting human review and correction when confidence is low or the system is learning preferences.

Early versions should include a triage/review area for newly extracted or inferred objects before they are fully accepted into the user's knowledge graph. This allows the user to approve, reject, correct, merge, or reclassify suggested goals, projects, tasks, notes, links, people, and companies. Triage actions are allowed in the web app even though ordinary capture and editing should happen through AI harnesses and the MCP.

Over time, Skippy should learn enough from corrections and accepted patterns that many routine objects can be written directly into their final tables without explicit approval.

The system should support at least four universal processing states:

- `suggested`: Skippy or an AI harness has extracted or inferred the object, but it needs review.
- `accepted`: The object is part of the trusted knowledge graph.
- `rejected`: The object was reviewed and intentionally discarded or ignored.
- `archived`: The object is no longer active or prominent but should remain preserved for history, context, and retrieval.

The universal processing state should be separate from each object's type-specific domain status. For example, a project may have `processingState: "accepted"` and `status: "in_progress"`, while a task may have `processingState: "accepted"` and `status: "done"`.

Rejected objects should be retained by default for learning, provenance, auditability, and duplicate prevention, but excluded from normal dashboards, lists, and search results. Rejected records should include fields such as `rejectedAt`, optional `rejectionReason`, and `rejectedBy` (`user`, `ai`, or `system`). The system may later support pruning or compaction of old rejected records, such as keeping only minimal metadata and source references after a retention period.

The system may also support confidence scores and review reasons so the UI can explain why an item needs attention.

## Data model direction

Skippy should use a hybrid data model: first-class typed tables for the core known entities, plus a generic object/relationship layer for extensibility.

### Core typed tables

The following concepts are important enough to be first-class typed tables with explicit schemas, validation, and indexes:

- `goals`
- `projects`
- `tasks`
- `notes`
- `people`
- `companies`
- `links`

Notes should be simple short captured thoughts, observations, or ideas. Skippy does not need long-form rich note/document editing from the start. If longer documents become necessary later, they can be represented as generic knowledge objects or introduced as a separate document type.

These tables should use strong fields for important app behavior. For example, tasks should have status, priority, due dates, and project relationships; links should have URLs; people should have contact fields; companies should have relationship/customer/client metadata.

### Generic extension objects

Skippy should also include a generic `knowledgeObjects` table for useful concepts that are not yet part of the core typed schema. Examples might include decisions, meeting summaries, research topics, opportunities, places, books, assets, or other categories discovered later.

Generic knowledge objects should still have controlled types, titles, summaries, processing state, source references, and metadata. The generic table should not become an unstructured dumping ground.

### Universal relationships

Skippy should include a universal `relationships` table that can connect any typed entity or generic knowledge object to any other entity.

Relationships should use polymorphic entity references such as:

```ts
{
  entityType: "project" | "task" | "note" | "person" | "company" | "link" | "goal" | "knowledgeObject",
  entityId: string
}
```

Example relationship types:

- `belongs_to`
- `supports`
- `related_to`
- `mentions`
- `assigned_to`
- `works_at`
- `client_of`
- `depends_on`
- `blocked_by`
- `spawned_from`

This allows Skippy to behave like a second-brain graph while keeping the most important object types easy to query, validate, and display.

## Intelligence model

Skippy should use a hybrid intelligence model.

External AI harnesses such as ChatGPT, Claude, Hermes, Claude Code, and Codex provide source access, conversation context, and initial interpretation. These harnesses may use their own connectors and skills to inspect email, iMessage, calendars, reminders, links, and conversations, then call Skippy's MCP tools with extracted candidate objects and source references.

Skippy should own the canonical processing rules that need to remain consistent across harnesses:

- Schema validation
- Field normalization
- Status normalization
- Deduplication
- Relationship inference
- Triage policy
- Confidence scoring
- Review reasons
- Accepted/rejected/archive behavior
- Prompt and policy versioning for Skippy-owned AI workflows

Skippy may include its own internal AI/LLM layer for tasks where deterministic logic is not enough, such as summarization, semantic deduplication, relationship inference, prioritization, and higher-level synthesis. This internal AI layer should be designed from the start as configurable and provider-abstracted.

The system should support running with no internal LLM at first, while allowing an LLM provider to be enabled later or immediately via configuration.

Internal Skippy configuration should live in Convex records scoped to each brain instance where practical, rather than only in environment variables or code. This prepares the architecture for future multiple users/brain instances with different assistant names, LLM provider preferences, autonomy settings, and feature toggles.

Secrets such as API keys should still be handled securely and should not be exposed to the client. If a setting requires a secret, the Convex/user-facing config should store only safe metadata or references, while the actual secret is stored through an appropriate secure mechanism.

Potential per-brain configuration fields:

- Assistant display name
- LLM provider mode
- Preferred model for cheap/routine summaries
- Preferred model for stronger synthesis if enabled
- Autonomy thresholds
- Triage behavior
- Link enrichment enabled/disabled
- Feature toggles
- Focus-summary preferences

Potential provider modes:

- `none`: no internal Skippy LLM; external harnesses do all LLM reasoning.
- `openai`: use an OpenAI API key and OpenAI API billing.
- `anthropic`: use an Anthropic API key and Anthropic API billing.
- `openrouter`: use an OpenRouter key to access multiple models.
- `local`: use a local model/runtime if available.

Skippy should assume that ChatGPT subscription plans such as Plus/Pro/Max are separate from OpenAI API billing. Internal backend LLM calls should be designed around API keys or local/provider-specific runtimes, not around using a ChatGPT consumer subscription as an API quota.

Skippy should also support an optional provider-configurable embeddings layer for semantic retrieval, deduplication, and relationship suggestions. The core system should work without embeddings, using structured queries and explicit relationships, but embeddings should be designed into the architecture so they can be enabled when useful.

Embeddings can help with:

- MCP `ask(query)` retrieval
- Semantic deduplication
- Suggesting related objects
- Finding related notes, links, projects, tasks, people, and companies
- Focus summary context gathering
- Avoiding duplicate tasks from similar source material

Potential embedding provider modes may include OpenAI, local models, or other provider-backed embedding APIs. Embedding configuration should be scoped per brain instance where practical.

Recommended embedding metadata:

- `brainInstanceId`
- Entity reference
- Text hash for the embedded canonical text
- Embedding provider
- Embedding model
- Embedding version or policy version
- Created timestamp

The embedded text should be a compact canonical representation of the object rather than arbitrary raw source data.

Cost control should be part of the design:

- Prefer deterministic rules for validation, basic normalization, and exact duplicate checks.
- Use cheaper/smaller models for routine summaries and simple classification.
- Reserve stronger models for complex synthesis or ambiguous triage.
- Store model provider, model name, prompt/policy version, timestamps, and summary of why AI processing was used.
- Make AI processing observable enough to debug behavior and estimate cost.

## Web app direction

The web app should be simple, minimal, and mobile-friendly. It is primarily a display and review surface, not the main input mechanism.

The web app should be built as a Progressive Web App (PWA) from the start so it can be installed on phones/desktops where supported and can support web push notifications more naturally.

The PWA can be online-only. Offline mode is not required because Convex, MCP access, harness processing, authentication, and push-related behavior all depend on network access.

## User preferences and operating rules

Skippy should maintain per-brain user preferences and operating rules so it can learn from corrections and behave more consistently over time.

These preferences should live in Convex records scoped to the brain instance. They should guide Skippy-owned processing such as triage, auto-accept decisions, task phrasing, priority computation, focus summaries, relationship inference, and when to request approval.

Examples of preferences/operating rules:

- How tasks should be phrased
- Which kinds of extracted items can be auto-accepted
- Which kinds of extracted items should always require triage
- How aggressive focus prioritization should be
- What kinds of messages/emails should become tasks
- What kinds of people/companies should be tracked
- Preferred tone/style for drafted outbound messages
- Rules learned from rejected or corrected suggestions
- Rules for when to generate pending actions

Skippy should track enough history and correction metadata to improve these rules over time. The system should be able to distinguish explicit user-configured rules from inferred/learned preferences.

Suggested fields/concepts:

- `brainInstanceId`
- `ruleType`
- `scope`, such as `triage`, `focus`, `task_creation`, `drafting`, `relationships`, or `contacts`
- `source`, such as `explicit_user_setting`, `learned_from_corrections`, or `system_default`
- `ruleText` or structured rule metadata
- `enabled`
- `confidence` for learned rules
- `createdAt`
- `updatedAt`

The settings UI may expose safe, high-level preferences, while more detailed learned rules can remain internal or appear in an advanced/debug view later.

## User profile memory

Skippy should maintain an explicit per-brain user profile memory separate from operating rules.

Operating rules describe how Skippy should behave. User profile memory describes stable context about the user and their life/work that helps Skippy interpret information and prioritize appropriately.

Examples of user profile memory:

- User's roles and responsibilities
- Family context when relevant
- Professional context
- Important recurring responsibilities
- Important long-running commitments
- Important people and organizations
- Communication preferences and tone context
- Areas of focus or concern that are not necessarily formal goals

User profile memory should be scoped to the brain instance and should be editable or correctable over time. Skippy should treat this memory as useful context, not as immutable truth.

Suggested fields/concepts:

- `brainInstanceId`
- `memoryType`, such as `role`, `family_context`, `professional_context`, `responsibility`, `preference_context`, or `important_context`
- `content`
- `source`, such as `explicit_user_statement`, `learned_from_activity`, or `system_default`
- `confidence` for learned profile items
- `enabled` or `active`
- `createdAt`
- `updatedAt`
- Optional source references or activity IDs that explain where the memory came from

The system should avoid storing noisy, stale, or overly temporary facts as durable user profile memory. Temporary task progress, one-off session outcomes, and short-lived status updates should remain in normal objects/activity history instead.

User profile memory should primarily be managed through AI/MCP conversations rather than direct settings-page editing. A user should be able to tell Skippy or a connected harness to remember, correct, or remove stable context. The harness/MCP flow should then update the appropriate profile memory records. A future review/debug view may expose profile memory for inspection, but direct settings UI editing is not required initially.

### Home page: focus summary

The home page should answer: "What do I need to focus on right now?"

It should show a concise summary and a small prioritized list, such as the top 5 most important items at the moment. These items may come from different source/object types, including:

- High-priority tasks
- Upcoming or important calendar events
- Important emails or message-derived follow-ups
- Time-sensitive reminders
- Projects needing attention
- People or companies requiring follow-up
- Important pending approvals or outbound actions

The home page should avoid becoming a large dashboard. It should be intentionally minimal and optimized for quick mobile use.

Pending approvals/actions may appear in the top-focus list when they are important or time-sensitive, but they should be visually clear because approving them may cause external side effects.

### Project/task workspace

The project/task workspace should provide a focused place to inspect goals, projects, and tasks.

It should support views such as:

- Active projects
- Tasks grouped by project
- High-priority or due-soon tasks
- Project detail pages with related tasks, notes, links, people, companies, and source references

The project/task workspace may allow the user to mark accepted tasks as done. Other direct editing of accepted projects/tasks should remain limited; ordinary object edits should generally happen through AI/MCP conversations.

If a completed Skippy task has a source reference to an external task/reminder system such as Apple Reminders, Skippy may create a low-risk external sync action for a harness to complete the corresponding external reminder. The Skippy task should update immediately, while the external sync action can be executed later by a harness with the relevant connector access.

### Contacts page

The contacts page should show people and companies, including personal and professional contacts.

It should support views such as:

- People
- Companies
- Relationship between people and companies
- Recent or important related notes, projects, tasks, links, and source references

The web app does not need a global search page at this stage. Navigation should remain minimal and focused on the home page, project/task workspace, contacts, triage, and pending actions.

The web app should not include an ask/chat interface initially. Natural-language "ask my brain" interactions should happen through connected AI harnesses via the MCP. This keeps the web app minimal and reinforces that conversation/input belongs in the harness layer.

### Triage page

Because triage is an intentional exception to the display-only rule, the web app should include a triage/review page for suggested objects.

The triage page should allow the user to approve, reject, correct, merge, or reclassify suggested objects, especially while Skippy is learning preferences and before autonomy is reliable.

### Pending actions page

Because outbound external actions require explicit approval, the web app should include a pending actions page.

The pending actions page should show drafted or proposed external actions such as outbound emails or messages. It should let the user review, approve, reject, or revise the proposed action before a harness executes it.

Pending actions should be clearly separated from ordinary focus items and triage items because approving them may cause external side effects.

### Settings page

The web app should include a minimal settings page for safe per-brain configuration.

Settings may include:

- Assistant/brain display name, such as `Skippy` or `Es`
- LLM provider mode, such as `none`, `openai`, `anthropic`, `openrouter`, or `local`
- Preferred model names when applicable
- Autonomy/triage thresholds if exposed safely
- Link enrichment enabled/disabled
- Other feature toggles or focus-summary preferences

The settings UI should not expose raw secrets to the client. API keys and other sensitive credentials should be handled through an appropriate secure mechanism.

The settings page should also support MCP token management for the current brain instance. Users should be able to create, view/copy at creation time, label, rotate, and revoke per-brain MCP tokens. Tokens should authorize access to exactly one brain instance. Token values should be stored securely, preferably hashed, so they cannot be recovered after creation.

The settings page should include notification preferences, including the ability to turn notifications/push alerts on or off.

## Scheduled harness workflow

Skippy should support scheduled AI harness jobs as a primary ingestion and review mechanism.

A harness such as Hermes can be configured to run roughly hourly during waking hours. The scheduled job can use the harness's own connectors and skills to read the latest emails, iMessages, calendar events, reminders, links, and relevant conversation context, then submit extracted information to Skippy through the MCP.

Waking-hours scheduling, timezone behavior, and cron cadence should live in the external harness configuration rather than inside Skippy. Skippy should record when ingestion/review runs occur, but it does not need to manage the schedule itself.

The scheduled workflow should conceptually have several phases, even if implemented as one scheduled job:

1. Pull recent source data from connected systems.
2. Extract candidate objects and updates, such as tasks, project updates, notes, links, people, companies, and follow-ups.
3. Submit candidate objects and lightweight source references to Skippy through MCP tools.
4. Let Skippy validate, normalize, deduplicate, link, and decide whether each object should be suggested, accepted, rejected, or archived.
5. Review existing accepted objects for changes in importance, urgency, blocked status, overdue state, or needed follow-up.
6. Generate or refresh the current focus summary for the web app home page.

The scheduled job may perform both ingestion triage and existing-knowledge review:

- Ingestion triage handles newly extracted objects and source-derived updates.
- Existing-knowledge review looks at active projects, tasks, reminders, calendar context, people, and companies to decide what needs attention now.

Skippy should record scheduled processing activity in an `ingestionRuns` or similar table, including timestamps, source systems checked, counts of candidates submitted, errors, and any generated focus summary.

### Focus summaries

The home page focus summary should be a stored generated artifact rather than a live LLM call every time the web app opens.

A focus summary should include:

- `generatedAt`
- Optional `validUntil`
- A short natural-language summary
- A small list of top focus items, such as the top 5 things that need attention
- Entity references for each focus item
- A short reason each item is included
- Source run or processing metadata

Storing focus summaries makes the mobile web app faster, cheaper, and more predictable. It also makes it easier to debug why Skippy prioritized something.

## Workspace model

Skippy should use one unified brain rather than separate personal/work workspaces.

Personal and professional information should live in the same knowledge graph so Skippy can reason across the user's whole life and avoid artificial boundaries. Personal vs work context should be represented through tags, relationships, companies, people, goals, projects, source references, and optional fields rather than separate databases or workspaces.

This allows the focus summary to prioritize across all relevant obligations, such as a personal appointment, an urgent client email, an overdue project task, and a reminder in the same view.

## User and instance model

Skippy should be built initially for one primary user, but the architecture should leave room for multi-user support later.

Each user should be able to have their own personal assistant/brain instance with a user-specified display name. For example, the user's instance may be called `Skippy`, while another user's instance might be called `Es`.

The user-specified assistant name should be treated as configuration/branding for that user's brain, not as a hardcoded product name in the data model or MCP logic.

The data model should include user ownership fields from the start, even if the first implementation only has one user. This avoids painful migrations later when adding another person's separate brain.

Recommended concepts:

- `users`: people who own or access a brain instance.
- `brainInstances` or `assistantInstances`: a user's configured second-brain instance, including display name such as `Skippy` or `Es`.
- Core entities should be associated with a `brainInstanceId` or equivalent owner/scope field.

Each brain instance should have its own knowledge graph, focus summaries, triage queue, source references, scheduled ingestion runs, and configuration. Multi-user support should not imply that different users' private knowledge graphs are automatically merged.

To keep the architecture simple, brain instances should remain fully separate. The system does not need shared family tasks, shared projects, or cross-brain collaboration features at this stage.

## Authentication and authorization

Skippy should use real authentication from the start because the architecture is intended to support multiple users and separate brain instances later.

The recommended web app authentication provider is Clerk. Clerk is a good fit because it is straightforward for modern React/Next.js-style apps, supports hosted login flows, and is appropriate for personal/prosumer software without requiring enterprise identity features upfront.

WorkOS is a possible future alternative if Skippy becomes an enterprise/team product requiring SSO, SCIM, directory sync, or organization management, but it is likely overkill for the initial product direction.

Recommended user records:

```ts
users {
  authProvider: "clerk",
  authUserId: string,
  email: string,
  displayName?: string,
  createdAt: number,
  updatedAt: number
}
```

Recommended brain instance records:

```ts
brainInstances {
  ownerUserId: Id<"users">,
  displayName: string, // e.g. "Skippy" or "Es"
  createdAt: number,
  updatedAt: number
}
```

On first login, the app/backend should ensure that a local `users` record exists and that the user has a default `brainInstances` record. The user should be able to configure the assistant display name.

Convex functions must scope all queries and mutations to the authenticated user's authorized brain instance. The system should never trust a client-provided `brainInstanceId` without verifying ownership.

### MCP access tokens

MCP authentication should be separate from web app authentication.

The initial recommended MCP auth model is a per-brain API token. A user can create/copy a token for their brain instance and configure it in AI harnesses such as Hermes, Claude, ChatGPT, Claude Code, or Codex. The token maps to exactly one authorized `brainInstanceId`.

This keeps harness integration simple while preserving separation between brain instances.

Later, Skippy may explore OAuth-based MCP authentication if needed, but per-brain tokens are the preferred starting point.

## Technical stack

Skippy should use a TypeScript monorepo.

Recommended stack:

- TypeScript throughout the project
- Convex for the database, backend functions, schema, and real-time data layer
- React/Next.js for the mobile-friendly web app
- Clerk for web authentication
- A TypeScript MCP server for AI harness integration
- Vercel for hosting/deploying the web app
- Provider-abstracted LLM integration for optional internal Skippy AI workflows

The monorepo should keep the MCP server, Convex backend, and web app close enough to share types and schema definitions where practical.

Potential structure:

```text
apps/
  web/              # Next.js web app deployed to Vercel
  mcp-server/       # TypeScript MCP server
convex/             # Convex schema, functions, mutations, queries
packages/
  shared/           # Shared types, validation helpers, constants
  ai/               # Optional provider-abstracted LLM client/workflows
```

The architecture should prioritize shared TypeScript types for entity references, processing states, domain statuses, source references, and MCP payloads so external harness calls and Convex mutations stay consistent.

## MCP transport model

Skippy should be designed with transport-independent MCP tool logic.

The production target should be a remotely hosted MCP endpoint so the user's brain can be reached from different computers, devices, and cloud/browser-based AI harnesses when those harnesses support remote MCP or connector-style integrations.

Recommended transport priorities:

1. Remote hosted HTTP/SSE-style MCP endpoint for production use.
2. Local stdio MCP transport for development, testing, and local harnesses such as Hermes or Claude Code.

The same core MCP tools and business logic should be shared by both transports. Transport-specific code should only handle request/response wiring, authentication, and protocol details.

Remote MCP access should use the per-brain API token model described in the authentication section. A token should authorize access to exactly one brain instance.

Local stdio MCP may be useful for development and local workflows, but should not be the only supported transport because it does not work well for phone use, random computers, or cloud-hosted/browser-based AI harnesses.

## MCP tool design

Skippy should support both natural-language convenience tools and structured canonical tools.

Natural-language tools are useful for quick capture, ad hoc conversations, and broad querying. Structured tools are useful for reliable scheduled ingestion, validation, testing, and deterministic writes.

All writes, whether they begin as natural language or structured payloads, should ultimately flow through the same internal pipeline:

```text
input
  -> extraction / normalization
  -> schema validation
  -> deduplication
  -> relationship inference
  -> triage/autonomy decision
  -> Convex write
```

### Natural-language convenience tools

Potential tools:

- `capture(text, sourceRef?)`: capture a free-form thought, instruction, note, task, project idea, message summary, or other item.
- `ask(query)`: ask Skippy a natural-language question about the user's brain. Skippy should internally synthesize an answer when its internal AI layer is configured, using relevant records, relationships, source references, user profile memory, operating rules, and activity history. The response should include enough cited/referenced context for the harness/user to understand what the answer is based on. If no internal LLM is configured, `ask` may return structured relevant context or a clear message that synthesis is unavailable.
- `summarize_focus()`: retrieve or regenerate the current focus summary.

Natural-language tools may require Skippy's internal AI layer when deterministic parsing is insufficient.

### Structured canonical tools

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

Scheduled harness jobs should generally prefer structured tools because the harness can extract candidate objects before calling Skippy. Ad hoc human conversations may use natural-language capture for convenience.

## External source object handling

Emails, iMessages, calendar events, and Apple Reminders should generally be treated as external source systems rather than first-class Skippy object tables.

Skippy should store lightweight source references to these external items and create/update processed Skippy objects derived from them, such as tasks, projects, notes, people, companies, links, or generic knowledge objects.

For example:

- An Apple Reminder may become a Skippy task with a source reference back to the reminder.
- A calendar event may influence the focus summary or relate to a project/person/company without becoming a full calendar-event record in Skippy.
- An email thread may generate a task, note, project update, or contact interaction with source references to the email/thread.
- An iMessage conversation may generate a follow-up task or note with a source reference to the message/thread.

Skippy should avoid becoming a full mirror of Gmail, iMessage, calendar, or Apple Reminders. The purpose is to maintain the processed second-brain knowledge graph, not duplicate every external system.

## Link handling

Skippy should support links/URLs as first-class typed objects, but should prefer harness-provided metadata and summaries at first.

When a harness submits a link, it should provide as much useful metadata as it can, such as:

- URL
- Normalized URL
- Title
- Short summary
- Why the link matters
- Related project/task/person/company/goal if known
- Source reference showing where the link came from

This keeps Skippy simpler and avoids making the backend responsible for web scraping or crawling in the initial architecture.

Skippy should still allow URL-only captures. If only a URL is provided, Skippy should store it as an unsummarized or unenriched link and optionally queue it for later enrichment.

Optional Skippy-side link enrichment may be added later. If implemented, it should be configurable and bounded:

- Enable/disable via configuration
- Fetch only the submitted URL, not broad crawling
- Respect timeouts and failures
- Store enrichment timestamp and method/version
- Use deterministic metadata extraction where possible
- Use a cheap LLM only when summarization/classification is useful

The `links` table should support fields such as `url`, `normalizedUrl`, `title`, `summary`, `whyItMatters`, `status`, source references, and related entity references.

## Task recurrence

Skippy should not support native recurring tasks.

Recurring behavior should remain in external systems such as Apple Reminders or calendar. Skippy may create or update derived task/focus objects based on those external recurring items, but recurrence rules themselves should not be modeled or managed inside Skippy.

This keeps Skippy's task model simpler and avoids duplicating reminder/calendar functionality.

## Dependencies and blockers

Skippy should support lightweight dependencies and blockers through the universal relationship graph.

This is useful for focus summaries and project/task views because Skippy should understand when something important is blocked, waiting on someone, or dependent on another task.

Recommended relationship types:

- `depends_on`
- `blocked_by`
- `waiting_on`
- `unblocks`
- `follow_up_with`

Examples:

- A task may `depends_on` another task.
- A project may be `blocked_by` a person, company, task, note, or source-derived situation.
- A task may represent a `follow_up_with` relationship to a person or company.

Skippy should not implement a complex dependency engine, auto-scheduling system, Gantt chart, or critical-path analysis at this stage. Dependencies and blockers should mainly inform prioritization, focus summaries, and context display.

## Priority model

Skippy should compute priority rather than relying primarily on manually assigned priority labels.

Harnesses may provide urgency or importance hints from source context, but Skippy should treat those as signals rather than authoritative fixed priorities.

Computed priority should consider factors such as:

- Due dates or time sensitivity
- Calendar context
- Recent emails/messages/reminders
- Project importance
- Goal relevance
- Waiting/blocker relationships
- People or companies involved
- Recency and momentum
- Whether an item has been neglected
- User corrections and triage history

Skippy may store computed priority metadata for debugging and display, such as:

- `priorityScore`
- `urgencyScore`
- `importanceScore`
- `priorityReason`
- `priorityComputedAt`
- `priorityPolicyVersion`

The web app should show human-friendly explanations such as "due tomorrow," "waiting on client response," or "important project with no recent progress" rather than exposing raw scores by default.

## Goals model

Goals should be flat rather than hierarchical.

At any given time there will likely be only a small number of active goals, approximately five. Skippy does not need life-goal/yearly-goal/project hierarchy modeling.

Projects, tasks, notes, links, people, companies, and generic knowledge objects may be connected to goals through the universal relationship graph, especially with relationships such as `supports` or `related_to`.

Goals should mainly help Skippy understand importance and focus, not become a complex goal-management system.

## Companies model

Companies should be simple organization/contact containers rather than a full CRM system.

A company record should capture basic identifying and contextual information, such as name, website/domain, short notes, related people, related projects/tasks/links, and source references.

Skippy may optionally store lightweight relationship labels such as client, vendor, employer, partner, or prospect if they are useful, but the product should not become a full CRM with pipelines, deals, stages, or sales workflows.

## People model

People should support full contact information as well as relationship/context notes.

A person record should be able to store fields such as:

- Name
- Email addresses
- Phone numbers
- Mailing address or physical address if useful
- Company relationships
- Role/title if known
- Personal/professional relationship context
- Short notes
- Related projects/tasks/links/goals/companies
- Source references and source-derived identifiers

People records should still remain simple contact records, not a full CRM pipeline. The main purpose is to help Skippy understand who people are, how to contact them, what they are connected to, and why they matter.

Skippy does not need to sync contacts back to Apple Contacts, Google Contacts, or other contact systems at this stage. It may ingest or use contact data from external systems when available, but writing contact changes back to those systems is out of scope for now.

## External actions and approvals

Skippy should eventually support outbound actions such as sending emails or messages, but only after explicit user approval.

The system should distinguish between low-risk internal writes and higher-risk external side effects:

- Internal writes to Convex, such as creating tasks, notes, relationships, or focus summaries, may become increasingly autonomous over time.
- External actions, such as sending an email, sending an iMessage/SMS, modifying a calendar event, or changing an external reminder/contact system, require an approval workflow.

Completing an external reminder/task that directly corresponds to a Skippy task the user just marked done is considered a low-risk sync action. It may be queued for harness execution without a second approval, because the user's task-completion click is the approval signal. High-risk external actions, especially sending messages or emails, still require explicit review and approval.

For outbound email/message workflows, Skippy or an AI harness may draft a proposed message and create a pending action. The user can review, approve, reject, or revise it before it is sent.

Recommended pending action fields:

- `brainInstanceId`
- `actionType`, such as `send_email` or `send_message`
- `status`, such as `drafted`, `pending_approval`, `approved`, `rejected`, `sent`, or `failed`
- Recipient information
- Draft subject/body or message body
- Related entity references
- Source references that explain why the action was proposed
- Approval metadata, such as `approvedBy`, `approvedAt`, and `approvalNotes`
- Execution metadata, such as provider/system used, sent timestamp, external message ID, and error details

The web app may include approval controls for pending external actions, similar to triage. This is another intentional exception to the mostly display-only web app rule.

Skippy should not autonomously send outbound messages or emails without approval.

Approved outbound actions should be executed by the external AI harness that has the relevant connector access, not directly by Skippy's backend at first. For example, a Hermes scheduled job or user-invoked harness session may look for approved pending actions, send the email or iMessage using its existing connectors/skills, then report the execution result back to Skippy.

This keeps Skippy from needing direct credentials for every external communication system and preserves the model where harnesses provide connector access while Skippy stores intent, approval state, and execution metadata.

## Activity and history

Skippy should track activity/history for important object and system events rather than only storing current state.

Activity history is useful for provenance, debugging, auditability, user trust, and understanding how Skippy's knowledge graph changed over time.

Recommended activity examples:

- Object created from source reference
- Object updated by harness
- Object suggested by Skippy AI
- Object accepted/rejected/archived by user or system
- Task marked done in the web app
- External reminder completion queued
- Harness executed external sync action
- Pending email/message drafted
- Pending action approved/rejected/revised
- Outbound action sent or failed
- Relationship created/removed
- Focus summary generated
- Priority recomputed

Recommended activity fields:

- `brainInstanceId`
- `entityRef` when applicable
- `activityType`
- `actorType`, such as `user`, `harness`, `skippy_ai`, or `system`
- `actorId` or harness/provider identifier when available
- `timestamp`
- Short human-readable summary
- Structured metadata for debugging
- Related source refs, ingestion run IDs, pending action IDs, or focus summary IDs when applicable

The web app does not need to expose a full activity feed initially, but object detail pages may show recent relevant activity if useful. The activity log should exist from the start so behavior can be debugged and audited.

## Files and document attachments

File/document attachment storage is out of scope for Skippy at this stage.

Skippy should not try to become a file manager or document storage system. Files and documents should remain stored locally in folders on the user's computer or in external systems.

Skippy may store lightweight references to files/documents when useful, such as:

- Local file path
- External URL
- File name/title
- Short description or summary supplied by a harness
- Related project/task/person/company
- Source reference explaining where the file was mentioned or discovered

The system should not upload, sync, or manage file contents directly for now.

## Tags and labels

Skippy should not implement a general free-form tagging system initially.

Instead, it should prefer typed fields, goals, projects, people, companies, source references, computed priority, and explicit relationships. These are more meaningful for second-brain reasoning and focus summaries than arbitrary tags.

For example, instead of relying on tags like `client`, `acme`, `proposal`, and `urgent`, Skippy should model relationships such as:

- Task `belongs_to` Project
- Project `related_to` Company
- Task `follow_up_with` Person
- Project `supports` Goal

Lightweight controlled labels may be used where they provide clear value, such as:

- Personal/professional/mixed context
- Company relationship labels like client, vendor, employer, partner, or prospect
- Type-specific statuses
- Source system labels

Free-form AI-generated tags should be avoided at first to reduce clutter, duplication, and inconsistency.

## Notifications

Skippy should support notifications/push alerts, but they must be configurable and possible to turn off from the settings UI.

Notifications should be used sparingly for genuinely important or time-sensitive items, such as:

- High-priority focus items
- Time-sensitive pending approvals
- Important outbound actions awaiting approval
- Urgent follow-ups
- Important scheduled-run findings

Notification settings should be scoped per brain instance and should include at least an enabled/disabled toggle. Additional preferences, such as quiet hours or notification categories, may be added later if needed.

Notification delivery should primarily use the web app/PWA push notification system rather than relying on external harness notification channels. This keeps notifications tied to the Skippy web app experience and makes them available on supported mobile/desktop browsers.

The notification system should account for browser/PWA permission requirements and should degrade gracefully when push notifications are unavailable or not authorized.

## Import/export and backup

A formal custom import/export/backup system is not required at this stage.

Convex and Vercel deployment/infrastructure are sufficient for the initial architecture. Skippy should not spend early complexity on custom backup workflows, bulk export tools, or migration tooling beyond normal development practices.

Future versions may add export/backup features if the product becomes more broadly used or if data portability becomes a priority.

