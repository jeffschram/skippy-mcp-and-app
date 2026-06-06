# DEV_SPEC Progress

This file tracks implementation progress against `DEV_SPEC.md`.

## Current status

Development has moved from scaffold into a working foundation across Phases 1-8:

- TypeScript monorepo tooling is in place.
- `@skippy/shared` contains the core domain vocabulary and normalization helpers.
- Convex has a real schema, authenticated viewer bootstrap, viewer-scoped queries, triage review mutations, settings, token management, and AI-run metadata.
- Convex has an auth config scaffold for Clerk JWTs.
- The MCP package has transport-independent handlers, stdio wiring, and a Streamable HTTP remote handler.
- The web package is a Next/PWA app shell that uses static preview data without env vars and switches to live Clerk/Convex queries when configured.
- `@skippy/ai` has provider abstractions plus explicit disabled clients for LLM and embeddings.

The system is still not production-ready. Convex deployment env is configured, `convex/_generated` bindings have been generated, and Clerk auth provider settings are wired for the dev deployment. Full provider adapters for OpenAI/Anthropic/OpenRouter/local models are not implemented. Authorization is improved for viewer-scoped web flows, but older MCP-oriented functions still accept `brainInstanceId` and rely on token-to-brain routing.

Most recent development batch:

- Fixed triage approval schema mapping by normalizing harness-friendly candidate payloads before accepted Convex inserts.
- Improved MCP chat confirmations for candidate submission, direct project/task creation, and task completion.
- Created a repository Skill at `skills/skippy-harness` with harness ingestion judgment, tool choice, privacy/source-reference rules, confirmation language, and entity mapping reference.
- Replaced raw JSON-first triage correction with typed per-entity review fields for common Skippy entity types.
- Active project task queries now hide `done` and `cancelled` tasks.
- Marked the corresponding four tasks done in the live `Skippy MCP and APP` project.

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
- Non-`none` providers throw clear “adapter not installed yet” errors.
- Live OpenAI/Anthropic/OpenRouter/local adapters are not implemented yet.

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

- Candidate submission and source refs.
- Direct accepted project/task creation for explicit user commands.
- Relationship creation.
- Basic approve/reject.
- Unified `reviewTriageItem` supporting approve, reject, correct, merge, and reclassify.
- Viewer-scoped dashboard, projects/tasks, contacts, triage, and pending-action queries.
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
- Top-level MCP server instructions for Skippy's triage-first harness workflow.
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
- A live `capture` tool call has written a note candidate through remote MCP and it appears in the web triage queue.
- A live Gmail/Google Calendar pilot ingest submitted four candidates through remote MCP: Optimum bill, Claude trusted-device alert, Hotels.com review reminder, and Meg Birthday calendar event.
- Skippy MCP has been used to submit its own roadmap as triage candidates: project `Skippy MCP and APP` plus six prioritized development tasks.
- Explicit direct-create MCP tools created 15 additional accepted backlog tasks from `DEV_SPEC.md` and assigned them to `Skippy MCP and APP`.
- MCP manifest tests verify that connected harnesses receive Skippy instructions, triage-first tool descriptions, input schemas, and read-only annotations.
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
- Triage reads pending suggestions and supports approve, reject, correct, merge, and reclassify controls.
- Pending actions reads pending external actions.
- Settings reads/writes brain config and manages MCP tokens.
- Triage icon-only action buttons now have descriptive `title` and `aria-label` text.

Current UI limitations:

- Triage correction/reclassification uses JSON payload editing. It is functional but not yet a polished domain-specific editor.
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

### Triage schema mapping

Fixed for the current schema. `createAcceptedEntity` now normalizes candidate payloads through shared accepted-entity mapping before inserting into typed Convex tables, so fields like `dueDate`, `sourceSummary`, `personName`, `companyName`, and `email` are mapped or dropped safely. Follow-up: add browser/E2E coverage around approval of real Gmail/calendar candidates and continue expanding mappings as new source shapes appear.

### Direct create path

Dedicated `create_project` and `create_task` MCP tools now support direct accepted-object creation for explicit user commands. Autonomous or inferred source ingestion should remain triage-first. Direct create responses now return chat-friendly confirmations. Remaining work: harden policy/tests and consider direct-create support for other entity types only when clearly justified.

### Project/task assignment UX

Task-to-project assignment is relationship-backed and displays correctly when `task belongs_to project` relationships exist. Direct `create_task` creates the relationship automatically when a `projectId` is provided. Active project views now exclude completed/cancelled tasks. The next UX/API improvement is to expose an easy reassignment control in the app.

### MCP chat confirmations

Improved for the main write loop. `capture`, `submit_candidate_object`, `upsert_*`, `create_project`, `create_task`, and `mark_task_done` now return chat-friendly fields such as `status`, `entityType`, `title`, IDs, and `reviewUrl`. Follow-up: extend the same style to pending actions, source refs, relationships, ingestion runs, and future AI/embedding tools.

### Skippy harness skill

Created `skills/skippy-harness` with `SKILL.md`, `agents/openai.yaml`, and `references/entity-mapping.md`. It teaches ingestion judgment, direct-create vs triage policy, tool choice, source-ref/privacy rules, schema-friendly mappings, and chat confirmation language. Follow-up: install or package it for the target harnesses that support user skills/custom instructions.

### Triage review UX

Improved the live triage card from raw JSON editing to typed correction fields by entity type. Supported editors include task, project, goal, note, person, company, link, and knowledge object forms, while preserving approve, correct, reclassify, merge, and reject actions. Verified with a temporary task candidate and rejected the smoke-test candidate afterward. Follow-up: add stronger validation/errors, existing-entity merge lookup, source-ref display, and E2E tests.

### Pending actions

Pending-action result recording exists, but web approve/reject/revise flows still need real controls.

### AI provider adapters

Interfaces and disabled clients exist. Provider adapters for OpenAI, Anthropic, OpenRouter, and local runtimes remain future work.

### Embedding workflows

Embedding config/schema/interfaces exist. No embedding generation, canonical text hashing workflow, or semantic retrieval is implemented yet.

## Git status at time of progress note

The repository still contains broad uncommitted/untracked scaffold and implementation files. No commit has been created by this progress update.
