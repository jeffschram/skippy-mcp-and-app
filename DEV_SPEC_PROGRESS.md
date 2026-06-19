# DEV_SPEC Progress

This file tracks implementation progress against `DEV_SPEC.md`.

## Current status

Development has moved from scaffold into a working foundation across Phases 1-8:

- TypeScript monorepo tooling is in place.
- `@skippy/shared` contains the core domain vocabulary and normalization helpers.
- Convex has a real schema, authenticated viewer bootstrap, viewer-scoped queries, legacy fallback review mutations, settings, token management, operating rules, and AI-run metadata.
- Convex has an auth config scaffold for Clerk JWTs.
- The MCP package has transport-independent handlers, stdio wiring, and a Streamable HTTP remote handler.
- The web package is a Next/PWA app shell that uses static preview data without env vars and switches to live Clerk/Convex queries when configured.
- `@skippy/ai` has provider abstractions, disabled fallback clients, OpenAI LLM/embedding adapters, Anthropic and OpenRouter LLM adapters, and a local OpenAI-compatible LLM adapter hook.

The system is still not production-ready. Convex deployment env is configured, `convex/_generated` bindings have been generated, and Clerk auth provider settings are wired for the dev deployment. Core OpenAI AI/embedding flows and additional LLM provider adapters are implemented, but production operations, broad authorization tests, notification delivery, and generated Convex API adoption still need work. Authorization is improved for viewer-scoped web flows, but older MCP-oriented functions still accept `brainInstanceId` and rely on token-to-brain routing.

Most recent development batch:

- Pivoted source ingestion from triage-first to rubric-first. Skippy now exposes an editable importance rubric in Settings, a `get_importance_rubric` MCP tool, and a primary `ingest_object` MCP tool that writes accepted source-backed objects directly when the harness can explain why they clear the rubric.
- Kept `submit_candidate_object` and the old review table/page as a legacy uncertainty fallback, but renamed the visible web surface to Review/unclear signals rather than Triage.
- Fixed triage approval schema mapping by normalizing harness-friendly candidate payloads before accepted Convex inserts.
- Improved MCP chat confirmations for candidate submission, direct project/task creation, and task completion.
- Created a repository Skill at `skills/skippy-harness` with harness ingestion judgment, tool choice, privacy/source-reference rules, confirmation language, and entity mapping reference.
- Replaced raw JSON-first triage correction with typed per-entity review fields for common Skippy entity types.
- Active project task queries now hide `done` and `cancelled` tasks.
- Added task in-progress tracking, pending-action approval/revision UX, OpenAI embeddings/semantic retrieval, OpenAI focus summaries, Anthropic/OpenRouter/local LLM provider adapters, triage merge-target suggestions, notification preferences, push subscription storage, notification dispatch, remote MCP authorization tests, an MCP ingestion-to-triage smoke test, and generated Convex API usage in the web app.
- Marked the corresponding tasks done in the live `Skippy MCP and APP` project.

## Completed work

### Repository/spec foundation

- Created `DEV_SPEC.md` from `PLAN.md`.
- Kept `PLAN.md` as planning source / decision log.

### Root monorepo tooling

Root scripts include:

- `pnpm build`
- `pnpm test`
- `pnpm typecheck`
- `pnpm convex:typecheck`
- `pnpm lint`
- `pnpm check`

Build strategy:

- Root `test` builds `@skippy/shared` first.
- Root `typecheck` builds `@skippy/shared` and `@skippy/mcp-server` first so package exports are available to downstream workspaces.
- Consumers resolve workspace packages through package exports rather than TypeScript path aliases.

### `packages/shared`

Implemented:

- Entity refs.
- Universal processing state.
- Domain statuses for goals, projects, tasks, links.
- Relationship vocabulary.
- Source reference vocabulary and types.
- Pending action statuses/types.
- LLM provider modes.
- JSON value helpers.
- Candidate input types for core entities and generic knowledge objects.
- Focus summary, relationship, priority, pending action, and processing metadata types.
- Normalization helpers for strings, confidence, entity payloads, and candidate objects.
- Accepted-entity payload normalization for messy harness candidates, including schema-safe mapping for tasks, projects, notes, people, companies, links, goals, and knowledge objects.

Tests cover entity refs, processing states, statuses, relationships, candidate normalization, and accepted-entity payload mapping.

### `packages/ai`

Implemented:

- `AiProviderConfig`
- `AiUsageRecord`
- `SynthesisRequest`
- `SynthesisResult`
- `FocusSummaryRequest`
- `EmbeddingRequest`
- `EmbeddingResult`
- `LlmClient`
- `EmbeddingClient`
- `createDisabledLlmClient`
- `createDisabledEmbeddingClient`
- `createLlmClient`
- `createEmbeddingClient`

Current behavior:

- `mode: "none"` returns disabled clients with explicit fallback behavior.
- `mode: "openai"` uses the OpenAI Responses API for synthesis/focus summaries.
- `mode: "anthropic"` uses the Anthropic Messages API for synthesis/focus summaries.
- `mode: "openrouter"` uses OpenRouter chat completions for synthesis/focus summaries.
- `mode: "local"` calls an OpenAI-compatible local chat completions endpoint when `SKIPPY_LOCAL_AI_BASE_URL` or `LOCAL_AI_BASE_URL` is configured.
- `embeddingProvider: "openai"` uses OpenAI embeddings with batch support.
- Unsupported providers still throw clear “adapter not installed yet” errors.

### `convex`

Implemented files:

- `convex/schema.ts`
- `convex/auth.ts`
- `convex/bootstrap.ts`
- `convex/knowledge.ts`
- `convex/settings.ts`
- `convex/mcpTokens.ts`
- `convex/tsconfig.json`

Schema includes the core entities plus:

- `brainConfigs`
- `relationships`
- `sourceRefs`
- `entitySourceRefs`
- `triageItems`
- `focusSummaries`
- `pendingActions`
- `ingestionRuns`
- `activityEvents`
- `operatingRules`
- `userProfileMemories`
- `mcpTokens`
- `entityEmbeddings`
- `aiProcessingRuns`

Auth/config functions:

- `auth.ensureViewer`
- `auth.viewer`
- shared `requireOwnedBrain` helper
- `settings.getSettings`
- `settings.updateConfig`
- `settings.recordAiProcessingRun`

Knowledge functions:

- Rubric-first direct ingestion, legacy fallback review submission, and source refs.
- Direct accepted project/task creation for explicit user commands.
- Relationship creation.
- Basic approve/reject.
- Unified legacy `reviewTriageItem` supporting approve, reject, correct, merge, and reclassify for unclear signals.
- Viewer-scoped dashboard, projects/tasks, contacts, fallback review, and pending-action queries.
- Viewer-scoped task completion.
- Focus summary upsert/read.
- Pending-action result recording.
- Ingestion run recording.

MCP token functions:

- `mcpTokens.list`
- `mcpTokens.create`
- `mcpTokens.revoke`
- `mcpTokens.authenticate`
- First-token creation has been verified through the live Settings UI.

Token behavior:

- Tokens are generated with a `skippy_` prefix.
- Only SHA-256 hashes are stored.
- Full token value is returned only at creation time.
- Revoked tokens are retained with `revokedAt`.

Codegen note:

- `.env.local` is configured for `dev:beloved-curlew-997`.
- `pnpm exec convex codegen --typecheck disable` completed successfully.
- Generated Convex APIs are present in `convex/_generated`.

### `apps/mcp-server`

Implemented:

- Transport-independent `SkippyClient`.
- MCP SDK tool registration.
- Top-level MCP server instructions for Skippy's rubric-first harness workflow.
- Rich tool descriptions, schema field descriptions, and read/write annotations for harness discovery.
- `skippy://guide/harness-usage` resource exposing the harness usage guide.
- `skippy_intro` prompt and `skippy://guide/intro` resource provide a user-facing intro/capabilities message for harnesses that support MCP prompts/resources.
- Stdio entrypoint.
- Convex HTTP client adapter.
- Remote Streamable HTTP request handler.
- Package exports for `@skippy/mcp-server` and `@skippy/mcp-server/remote`.

Tools include:

- `capture`
- `ask`
- `summarize_focus`
- `get_importance_rubric`
- `ingest_object`
- `submit_candidate_object`
- `create_project`
- `create_task`
- `upsert_*`
- `add_source_ref`
- `link_entities`
- `generate_focus_summary`
- `list_pending_actions`
- `mark_task_done`
- `record_pending_action_result`
- `record_ingestion_run`

Remote MCP:

- `handleRemoteMcpRequest` authenticates a bearer token through `mcpTokens.authenticate`.
- Token maps to one `brainInstanceId`.
- The same MCP server/tool logic is used after auth.
- `pnpm mcp:smoke` runs a local Streamable HTTP MCP smoke test when `SKIPPY_MCP_TOKEN` is set.
- Remote MCP smoke test has passed against `http://127.0.0.1:3000/api/mcp`, listing tools and calling `ask`.
- A live `capture` tool call has written a note through remote MCP. Capture now writes accepted notes directly.
- A live Gmail/Google Calendar pilot ingest submitted four candidates through remote MCP: Optimum bill, Claude trusted-device alert, Hotels.com review reminder, and Meg Birthday calendar event.
- Skippy MCP has been used to submit its own roadmap: project `Skippy MCP and APP` plus prioritized development tasks.
- Explicit direct-create MCP tools created 15 additional accepted backlog tasks from `DEV_SPEC.md` and assigned them to `Skippy MCP and APP`.
- MCP manifest tests verify that connected harnesses receive Skippy instructions, rubric-first tool descriptions, input schemas, and read-only annotations.
- Live remote MCP smoke test verifies `skippy_intro` prompt discovery and previews the intro message.

### `apps/web`

Implemented:

- Next app router scaffold.
- PWA metadata, manifest route, and SVG icon route.
- Optional Clerk + Convex provider wiring.
- Auth status/bootstrap component using Convex auth state.
- Static preview fallback when live env vars are absent.
- Live data mode when both `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` are configured.
- Live queries skip until Clerk/Convex auth is ready, so signed-out users see the sign-in prompt without protected query errors.
- Remote MCP route at `/api/mcp`.
- Clerk sign-in, Convex JWT template auth, and viewer bootstrap have been verified in the live app.

Live routes:

- Home reads viewer dashboard/focus data.
- Projects reads accepted projects/tasks and can mark tasks done.
- Projects groups tasks under accepted projects using `belongs_to` relationships.
- Contacts reads accepted people/companies.
- Review reads legacy unclear signals and supports approve, reject, correct, merge, and reclassify controls.
- Pending actions reads pending external actions.
- Settings reads/writes brain config and manages MCP tokens.
- Review icon-only action buttons now have descriptive `title` and `aria-label` text.

Current UI limitations:

- Legacy review correction/reclassification uses typed payload fields for common entities.
- Pending action approve/reject/revise UI is display-only in this pass.

## Verification completed

Successful commands:

```bash
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm test
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm typecheck
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm build
```

Observed tests:

- `packages/shared`: 4 files, 12 tests passed.
- `packages/ai`: 1 file, 3 tests passed.
- `apps/mcp-server`: 2 files, 3 tests passed.
- `apps/web`: no tests yet, `--passWithNoTests`.

Observed build:

- `packages/shared` builds.
- `packages/ai` builds.
- `apps/mcp-server` builds.
- `apps/web` production build succeeds.
- Next routes include static pages and dynamic `/api/mcp`.

## Tooling/environment notes

The system default `node` is old:

```text
node v16.20.2
```

Use Homebrew Node/pnpm:

```bash
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm ...
```

## Known issues / follow-up

### Convex deployment/codegen

Configured for `https://beloved-curlew-997.convex.cloud`; codegen has run successfully.

Next steps:

1. Replace generic function refs with generated APIs where useful.
2. Keep generated bindings refreshed as Convex functions evolve.

`CLERK_JWT_ISSUER_DOMAIN` is now set in the `beloved-curlew-997` Convex dev deployment, and `pnpm exec convex codegen --typecheck disable` publishes the auth config successfully.

### Auth hardening

Viewer-scoped web functions use Convex auth and `requireOwnedBrain`. Older structured MCP functions still accept `brainInstanceId` and should stay protected by MCP token routing or be split into internal helpers.

### Legacy review schema mapping

Fixed for the current legacy review schema. `createAcceptedEntity` now normalizes fallback payloads through shared accepted-entity mapping before inserting into typed Convex tables, so fields like `dueDate`, `sourceSummary`, `personName`, `companyName`, and `email` are mapped or dropped safely. The primary path is now direct `ingest_object`; follow-up is to add dedupe/merge safety around direct ingestion.

### Direct create path

Dedicated `create_project` and `create_task` MCP tools support direct accepted-object creation for explicit user commands. Source ingestion now prefers `ingest_object` when the harness can explain why the item clears the importance rubric. `submit_candidate_object` remains only as a legacy uncertainty fallback.

### Project/task assignment UX

Task-to-project assignment is relationship-backed and displays correctly when `task belongs_to project` relationships exist. Direct `create_task` creates the relationship automatically when a `projectId` is provided. Active project views now exclude completed/cancelled tasks. The next UX/API improvement is to expose an easy reassignment control in the app.

### MCP chat confirmations

Improved for the main write loop. `capture`, `ingest_object`, `submit_candidate_object`, `upsert_*`, `create_project`, `create_task`, and `mark_task_done` now return chat-friendly fields such as `status`, `entityType`, `title`, IDs, `rubricDecision` where relevant, and `reviewUrl`. Follow-up: extend the same style to pending actions, source refs, relationships, ingestion runs, and future AI/embedding tools.

### Skippy harness skill

Created `skills/skippy-harness` with `SKILL.md`, `agents/openai.yaml`, and `references/entity-mapping.md`. It now teaches importance-rubric judgment, `ingest_object` first, legacy fallback review only for uncertainty, source-ref/privacy rules, schema-friendly mappings, and chat confirmation language. Follow-up: install or package it for the target harnesses that support user skills/custom instructions.

### Legacy review UX

Improved the legacy review card from raw JSON editing to typed correction fields by entity type. Supported editors include task, project, goal, note, person, company, link, and knowledge object forms, while preserving approve, correct, reclassify, merge, and reject actions. Verified with a temporary task candidate and rejected the smoke-test candidate afterward. Follow-up: add stronger validation/errors, existing-entity merge lookup, source-ref display, and E2E tests.

### Entity matching and merge assistance

Added a viewer-scoped accepted-entity options query and fallback-item text-overlap scoring in the review UI. Merge review now uses a target picker grouped into suggested matches and other accepted records for the selected entity type, instead of requiring raw ID entry. Verified with a temporary project candidate that suggested the existing `Skippy MCP and APP` project, then rejected the smoke-test candidate.

### Pending actions

Pending-action result recording exists and the web Actions page now supports approve, reject, and revise controls for drafted/pending/failed external actions. Approved/sent/completed/rejected actions render status-specific read-only copy.

### AI provider adapters

Implemented OpenAI synthesis/focus adapters, OpenAI embeddings, Anthropic synthesis/focus adapters, OpenRouter synthesis/focus adapters, and a local OpenAI-compatible synthesis/focus adapter hook. Tests cover the provider request shapes and disabled behavior.

### Embedding workflows

Embedding config/schema/interfaces exist. The MCP `ask` and `refresh_focus_summary` paths now canonicalize accepted entities, hash canonical text, generate/store missing OpenAI embeddings, reuse cached embeddings, and rank context semantically before synthesis.

### Task progress tracking

Accepted tasks can now be marked `in_progress` by harnesses through `mark_task_in_progress`, preserving `startedAt` and `startedBy`. The Projects page displays an in-progress indicator and actor label.

### Live source sync status

Added a `sourceSyncStatuses` Convex table and `update_source_sync_status` MCP tool for automation/harness runs. The Home NOW card now shows an `Updating` pill and short status message while a source ingestion run is active. The Skippy harness Skill and the Codex source-ingestion automation now instruct scheduled runs to set status to `running` at start, heartbeat during long runs, and close with `completed` or `failed`.

### Notifications

Settings now stores notification preferences on the brain config and active browser push subscriptions in Convex. The web Settings page can request browser permission, register `/sw.js`, save subscriptions when a public VAPID key is configured, and disable stored subscriptions. The MCP server exposes `dispatch_notifications`, which builds urgent-task and pending-action candidates, dedupes recent deliveries, sends through Web Push when VAPID secrets are configured, and records delivery attempts. Verified with a dry-run MCP smoke call against the local endpoint.

### Authorization and MCP token tests

Added MCP remote transport tests that mock Convex and the streamable HTTP transport. Coverage verifies that remote requests authenticate the bearer token before constructing a brain-scoped server, pass Convex auth through when configured, and stop before server creation when token authentication fails.

### Ingestion and triage E2E smoke

Added `pnpm mcp:smoke:ingestion-triage`, which connects to the remote MCP endpoint, submits a temporary note candidate through `submit_candidate_object`, verifies it appears in pending triage via Convex, and rejects the temporary item for cleanup. Verified locally against `http://127.0.0.1:3000/api/mcp`.

### Generated Convex APIs

The web app now imports `api` from `convex/_generated/api` instead of rebuilding function references with `makeFunctionReference`. This surfaced and fixed several loose mutation call boundaries in live UI components. The MCP package still uses explicit function references because its current TypeScript `rootDir` and package boundary intentionally do not include the Convex app; moving that layer should be done through a shared generated-api package or a deliberate package boundary change.

### Production environment

Added `pnpm prod:check` and `DEPLOYMENT.md`. The checker validates required environment values and can smoke-test the deployed MCP endpoint when `SKIPPY_MCP_URL` and `SKIPPY_MCP_TOKEN` are set. Local required env checks pass. The deployed endpoint at `https://skippy.jeffschram.dev/api/mcp` is reachable, but its tool list is older than the current local code and does not yet include newer tools such as `mark_task_in_progress` or `dispatch_notifications`; redeploy current code to Vercel before considering production fully current. VAPID keys remain optional but missing, so browser push dispatch is configured in code but not fully send-capable in the current environment.

## Git status at time of progress note

The repository still contains broad uncommitted/untracked scaffold and implementation files. No commit has been created by this progress update.
