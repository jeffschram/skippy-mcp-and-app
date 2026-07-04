import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createSkippyToolHandlers,
  type AnswerInterviewQuestionInput,
  type ArchiveInterviewInput,
  type CompleteInterviewInput,
  type CaptureThoughtInput,
  type ContextBundleInput,
  type GetInterviewInput,
  type InterviewKind,
  type LinkMemoryInput,
  type MemoryDetailInput,
  type MemoryKind,
  type MemoryListInput,
  type MemoryReviewBehavior,
  type MemoryReviewCandidateInput,
  type RecordFinancialBalancesInput,
  type RecordFinancialTransactionsInput,
  type RecordMemoryInput,
  type SkippyClient,
  type StartInterviewInput,
  type UpsertFinancialAccountInput,
} from "./tools.js";
import {
  BALANCE_SOURCES,
  FINANCIAL_ACCOUNT_TYPES,
  MONTH_KEY_PATTERN,
  TX_CATEGORIES,
  TX_SOURCES,
  TX_TYPES,
  TX_TYPE_CATEGORIES,
  type CandidateObjectInput,
  type EntityType,
  type FocusSummary,
  type RelationshipInput,
  type SourceRefInput,
} from "@skippy/shared";

const entityTypeValues = ["goal", "project", "task", "note", "person", "company", "link", "knowledgeObject"] as const;

const memoryKindValues = ["memory", "decision", "principle"] as const;

const interviewKindValues = ["project", "goal", "person", "decision", "weekly_review"] as const;

const interviewMemoryKindValues = ["thought", "memory", "decision", "principle", "question", "insight", "artifact"] as const;

const memoryReviewBehaviorValues = ["accept", "submit_for_review", "auto"] as const;

const relationshipTypeValues = [
  "belongs_to",
  "supports",
  "related_to",
  "mentions",
  "assigned_to",
  "works_at",
  "client_of",
  "depends_on",
  "blocked_by",
  "waiting_on",
  "unblocks",
  "follow_up_with",
  "spawned_from",
] as const;

const entityReviewTypeValues = [
  "general",
  "stale_check",
  "priority_update",
  "blocker_check",
  "follow_up",
  "status_check",
] as const;

const skippyInstructions = [
  "Skippy is a second-brain MCP for submitting useful structured knowledge into a Convex brain.",
  "When a user first connects or asks what Skippy can do, offer the skippy_intro prompt/message if the harness supports MCP prompts.",
  "When a user asks for slash commands or types slash-command shorthand, load skippy_slash_commands if the harness supports MCP prompts.",
  "Use the user's evolving importance rubric. Directly ingest source-backed objects when they are actionable, deadline-bearing, relationship-building, decision-relevant, financially/security relevant, or clearly useful later.",
  "For direct ingestion, call ingest_object and include a concise rubricDecision explaining why the item clears the importance bar.",
  "Use submit_candidate_object only as a legacy fallback when the harness cannot decide whether the item belongs in Skippy.",
  "Extract useful objects, not raw dumps. Prefer task, project, person, company, link, note, goal, or knowledgeObject records.",
  "Links are reference material, not a reading queue. Confident, rubric-clearing links: ingest directly (status defaults to 'saved'; no user interaction expected). Pass status 'unread' only when the user explicitly wants to read it later. Genuinely uncertain whether a link is valid or important: use submit_candidate_object so it lands in Review for a one-tap decision.",
  "Include lightweight sourceRefs whenever possible: sourceSystem, messageId/threadId/eventId, timestamp, participants, URL/deepLink, summary, and a short excerpt.",
  "Avoid storing full raw emails, full calendar descriptions, or unnecessary private text. Store concise summaries and fields needed for future retrieval/focus.",
  "For noisy sources, submit only items that are actionable, relationship-building, deadline-bearing, decision-relevant, or clearly useful later.",
  "Use pending actions only for external side effects that need separate approval/execution. Do not send email, edit calendars, or mark source systems changed through Skippy.",
  "Use capture_thought, record_memory, record_decision, and record_principle for durable second-brain memory. Include source refs, related entity refs, confidence, captureReason/rubricDecision, and reviewBehavior when available.",
  "Use submit_memory_review_candidate when a possible memory is useful but uncertain. Do not queue transient alerts (balance notifications, promo deadlines, ToS notices); skip them or record directly with expiry context. Use list_memory/get_context_bundle/get_memory_detail before adding likely duplicates or answering from memory, and link_memory to attach memories to accepted entities.",
  "Use list_interview_templates/start_interview/get_interview/answer_interview_question/complete_interview/archive_interview to run guided second-brain interviews inside the harness chat. Ask one question at a time in chat, using the assistantDisplayName returned by Skippy.",
  "Use ask/summarize_focus/list_pending_actions for retrieval. Internal AI synthesis may be disabled, so expect structured context rather than polished answers.",
  "Financial data from Plaid is ground truth: map it to the fixed Conscious Spending Plan taxonomy at ingest time and record it directly with upsert_financial_account/record_financial_transactions (never queue it for review). Transfers between the owner's own accounts are txType 'Transfer' ('Transfers In'/'Transfers Out'), never Income or an outgoing bucket; they are excluded from budget totals automatically. Amounts are integer cents; pass Plaid transaction_ids as externalIds for idempotency, and store only account last-4 masks, never full account numbers.",
].join("\n");

function getSkippyAppUrl() {
  return process.env.SKIPPY_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000";
}

function getAssistantDisplayName() {
  return process.env.SKIPPY_ASSISTANT_NAME ?? "Skippy";
}

function buildIntroMessage() {
  const assistantName = getAssistantDisplayName();
  const appUrl = getSkippyAppUrl();

  return [
    `Hi, I'm ${assistantName}. I'm connected to your Skippy second brain.`,
    "",
    "I can help by:",
    "- Reading connected sources through this harness, such as email, calendar, reminders, messages, links, or conversation context when you grant access.",
    "- Extracting useful tasks, projects, people, companies, links, notes, goals, and knowledge objects.",
    "- Applying your importance rubric and writing source-backed items directly into Skippy when they clear the bar.",
    "- Capturing durable memories, decisions, and operating principles with source links and review behavior.",
    "- Including provenance like message IDs, event IDs, timestamps, participants, links, summaries, and short excerpts.",
    "- Answering from existing Skippy context with `ask` and `summarize_focus`.",
    "- Tracking approved external actions separately from knowledge so side effects stay reviewable.",
    "",
    "Useful ways to ask me:",
    "- \"Check my recent email and calendar and submit anything important to Skippy.\"",
    "- \"Capture this thought in Skippy.\"",
    "- \"What should I focus on today?\"",
    "- \"Turn this thread into tasks and people/companies if it clears my Skippy rubric.\"",
    "",
    `You can review current focus, projects, tasks, actions, and settings in the Skippy app: ${appUrl}`,
  ].join("\n");
}

function buildSlashCommandsMessage() {
  return [
    "# Skippy Slash Commands",
    "",
    "Treat these as user-facing shorthand when a user types them in a harness chat. Parse the command, ask only for missing required fields, then call the mapped Skippy MCP tool. Do not expose raw JSON unless the user asks.",
    "",
    "| Slash command | Use | MCP mapping |",
    "| --- | --- | --- |",
    "| `/task ...` | Create an accepted task from an explicit user command. | `create_task` |",
    "| `/project ...` | Create an accepted project from an explicit user command. | `create_project` |",
    "| `/remember ...` | Store a durable memory or capture a thought. | `record_memory` or `capture_thought` |",
    "| `/decision ...` | Record a durable decision memory. | `record_decision` |",
    "| `/principle ...` | Record a durable operating principle. | `record_principle` |",
    "| `/ask ...` | Retrieve context or answer from Skippy. | `ask` or `get_context_bundle` |",
    "| `/focus` | Summarize or refresh current focus. | `summarize_focus` or `refresh_focus_summary` |",
    "| `/interview ...` | Start or continue a guided interview in the harness chat. | `list_interview_templates` plus `start_interview` |",
    "| `/inbox ...` | Send uncertain or review-needed memory/object candidates to Skippy Review. | `submit_memory_review_candidate` or `submit_candidate_object` |",
    "| `/link ...` | Link accepted entities or memories when IDs/context are known. | `link_entities` or `link_memory` |",
    "| `/plan ...` | Decompose a project into executable task briefs. | `plan_project` |",
    "| `/next` | Show the next ready-to-execute task(s). | `list_ready_tasks` |",
    "| `/brief ...` | Get a task's ready-to-hand-off execution brief. | `get_task_brief` |",
    "| `/result ...` | Report an executed task's outcome (PR/summary). | `record_task_result` |",
    "| `/done ...` | Mark an accepted Skippy task done. | `mark_task_done` |",
    "",
    "Command handling rules:",
    "- Prefer direct accepted writes only when the user is explicit or the item clearly clears the rubric.",
    "- Preserve the user's wording in titles/summaries, but keep descriptions concise.",
    "- For source-derived items, include source refs and a rubric/capture reason when available.",
    "- For ambiguous `/remember`, choose `capture_thought` for free-form user thoughts and `record_memory` when you can structure a durable memory.",
    "- For `/focus`, use `summarize_focus` when answering from current Skippy context; use `refresh_focus_summary` when the user asks to update the dashboard.",
    "- For `/done`, retrieve or ask for the target task if the command does not identify one clearly.",
  ].join("\n");
}

function buildSkillsMessage() {
  const assistantName = getAssistantDisplayName();
  const appUrl = getSkippyAppUrl();

  return [
    `# Skippy Harness Skills`,
    "",
    `Use these instructions whenever a harness is connected to the ${assistantName} MCP. Treat ${assistantName} as the user's portable second-brain, project context, memory, and review layer.`,
    "",
    "## Core Behavior",
    "",
    "1. Retrieve before contextful work.",
    "   - Use `ask`, `summarize_focus`, `list_memory`, or `get_context_bundle` when the user mentions a known project, person, company, task, source, recurring area, prior decision, or asks what to focus on.",
    "   - Use retrieved context to avoid stale decisions and duplicate captures. Mention only the context that changes the work.",
    "",
    "2. Apply the importance rubric before writing.",
    "   - Use `get_importance_rubric` before nontrivial source ingestion.",
    "   - Store only items that are actionable, deadline-bearing, relationship-building, decision-relevant, financially/security relevant, tied to active focus, user-preference-like, or clearly useful later.",
    "   - Ignore routine notifications, marketing, newsletters, generic confirmations, stale noise, and raw source content with no future-use signal.",
    "",
    "3. Choose the narrowest tool.",
    "   - `ingest_object`: primary accepted write for source-backed tasks, projects, people, companies, links, notes, goals, or knowledge objects. Include `rubricDecision`.",
    "   - Link routing: links are reference material, not a reading queue. Confident, rubric-clearing links go straight through `ingest_object` (status defaults to `saved`; no user interaction expected). Pass `status: \"unread\"` only when the user explicitly wants to read it later. Genuinely uncertain whether a link is valid or important? Use `submit_candidate_object` so it lands in Review for a one-tap decision.",
    "   - `record_memory`, `record_decision`, `record_principle`: durable second-brain memory when the harness can explain why it belongs.",
    "   - `capture_thought`: explicit user thought or preference that should become memory or review.",
    "   - `submit_memory_review_candidate`: possible memory that seems useful but uncertain.",
    "   - `submit_candidate_object`: legacy review fallback for non-memory objects when classification or importance is uncertain.",
    "   - `create_project` / `create_task`: only for explicit user commands.",
    "   - `link_entities` / `link_memory`: only after accepted entity IDs or memory IDs are known.",
    "   - `list_pending_actions`: inspect external side effects awaiting approval. Do not send emails/messages or alter external systems through Skippy.",
    "",
    "## User Slash Commands",
    "",
    "When a user types a command-like message, treat it as shorthand for the matching MCP workflow:",
    "",
    "- `/task ...` -> `create_task`",
    "- `/project ...` -> `create_project`",
    "- `/remember ...` -> `record_memory` or `capture_thought`",
    "- `/decision ...` -> `record_decision`",
    "- `/principle ...` -> `record_principle`",
    "- `/ask ...` -> `ask` or `get_context_bundle`",
    "- `/focus` -> `summarize_focus` or `refresh_focus_summary`",
    "- `/interview ...` -> `list_interview_templates` plus `start_interview`",
    "- `/inbox ...` -> `submit_memory_review_candidate` or `submit_candidate_object`",
    "- `/link ...` -> `link_entities` or `link_memory`",
    "- `/plan ...` -> `plan_project`",
    "- `/next` -> `list_ready_tasks`",
    "- `/brief ...` -> `get_task_brief`",
    "- `/result ...` -> `record_task_result`",
    "- `/done ...` -> `mark_task_done`",
    "",
    "## Plan → Execute Loop (supervised project automation)",
    "",
    "Skippy plans; you (or a coding agent like Claude Code) execute. Skippy never writes code itself.",
    "",
    "1. `plan_project` decomposes an accepted project into ordered tasks, each with an execution brief, acceptance criteria, and dependency links. Requires an LLM provider configured for the brain.",
    "2. `brief_task` promotes a Proposed task to Briefed: list the proposed tasks, write an execution brief grounded in the actual repo (key files, approach, verification), and call it with the brief plus acceptance criteria.",
    "3. `list_ready_tasks` returns tasks whose dependencies are all done — the next work to pick up.",
    "4. `get_task_brief` returns one task's self-contained brief. Execute it (write code, open a PR) outside Skippy.",
    "5. `record_task_result` reports the outcome (summary + PR/commit URL). By default the task moves to `in_review` for the owner to approve; pass `markDone: true` to complete it, which unblocks dependent tasks.",
    "Keep the human in the loop: surface plans and results for review rather than silently completing work.",
    "",
    "Use the `skippy_slash_commands` prompt/resource when the harness wants the standalone command reference.",
    "",
    "4. Use the consent model.",
    "   - Direct capture: explicit user requests, low-risk source-backed commitments, deadlines, decisions, principles, project facts, and stable preferences.",
    "   - Ask first: sensitive personal context, health/legal/financial/family/relationship details, exact addresses, negative judgments about people, major inferred projects, priority changes, strategic commitments, or anything the user may not expect to be retained.",
    "   - Review candidate: useful but uncertain, potentially duplicate/conflicting, weakly inferred, or needs user classification.",
    "   - Never store secrets, auth codes, private keys, payment numbers, full raw emails/messages/calendar descriptions, or raw private dumps.",
    "",
    "5. Include lightweight provenance.",
    "   - Add `sourceRefs` for source-derived or inspected content.",
    "   - Good source refs include `sourceSystem`, upstream IDs, timestamp, participants, URL/deepLink, one-sentence summary, and a short excerpt.",
    "   - Keep excerpts short and do not copy full private source bodies.",
    "",
    "6. Run interviews in the harness chat.",
    "   - Use `list_interview_templates` to get `assistantDisplayName` and available templates.",
    "   - Offer interviews using the returned name, e.g. `Want to do a project interview for ${assistantName}?`.",
    "   - Use `start_interview`, then ask the returned current question in chat.",
    "   - For each user answer, call `answer_interview_question` and ask the returned next question.",
    "   - Leave `createMemoryCandidate` false unless the user explicitly wants that answer sent to Memory Inbox.",
    "   - At the end, ask whether to `complete_interview` and whether to submit a summary memory candidate. Use `archive_interview` for tests/cancellations.",
    "",
    "7. Close source-sync status when used.",
    "   - For batch/scheduled ingestion, call `update_source_sync_status` with `running` at start, heartbeat during long runs, and `completed` or `failed` before ending.",
    "   - Use `failed` only when the whole run cannot complete; otherwise include partial source errors and finish `completed`.",
    "",
    "8. Explain actions plainly.",
    "   - Tell the user what was stored, skipped, asked, sent to Review, retrieved, linked, or archived.",
    "   - Include entity type/title, consent path, rubric decision/capture reason, and the Skippy URL returned by the tool.",
    "",
    "## Example Confirmation Language",
    "",
    "- `Stored Pay Optimum bill as an accepted Skippy task because it has a financial deadline.`",
    "- `Sent Possible vendor renewal to Skippy Review because the email hints at a commitment, but owner/date are unclear.`",
    "- `I skipped the newsletter because it had no deadline, relationship signal, decision, or reusable project context.`",
    "- `I checked Skippy first and found the standing rule to keep source ingestion rubric-first.`",
    "",
    `Review and manage Skippy in the app: ${appUrl}`,
  ].join("\n");
}

function buildHarnessBootstrapMessage({
  harnessName,
  verbosity = "standard",
}: {
  harnessName?: string;
  verbosity?: "short" | "standard" | "detailed";
} = {}) {
  const assistantName = getAssistantDisplayName();
  const appUrl = getSkippyAppUrl();
  const target = harnessName?.trim() || "this harness";
  const details =
    verbosity === "short"
      ? []
      : [
          "",
          "## Canonical References",
          "",
          "- `README.md`: repo overview.",
          "- `docs/codex-heartbeat.md`: Ready task heartbeat contract.",
          "- `docs/onboarding-harness-verification.md`: onboarding and connection verification design.",
          "- `skills/skippy-harness/SKILL.md`: local Codex skill for Skippy harness behavior.",
          "- `apps/mcp-server/src/mcp-server.ts`: MCP prompts/resources/tools.",
          "- `apps/web/app/api/mcp/route.ts`: remote MCP endpoint.",
          "- `convex/mcpTokens.ts`: bearer-token auth.",
          "- `convex/projects.ts`: project/task planning and result state.",
        ];
  const detailed =
    verbosity === "detailed"
      ? [
          "",
          "## Consent And Capture Rules",
          "",
          "- Retrieve context before contextful work with `ask`, `summarize_focus`, `list_memory`, or `get_context_bundle`.",
          "- Use `get_importance_rubric` before nontrivial ingestion.",
          "- Store useful source-derived knowledge with `ingest_object` and a concise `rubricDecision`.",
          "- Use `record_memory`, `record_decision`, `record_principle`, or `capture_thought` for durable second-brain memory.",
          "- Send uncertain items to review rather than silently storing them.",
          "- Never store secrets, auth codes, full raw private messages, or raw source dumps.",
        ]
      : [];

  return [
    `# Skippy Harness Bootstrap`,
    "",
    `You are ${target}. You are connected to ${assistantName} through Skippy MCP.`,
    "",
    `${assistantName} is the user's portable second brain, project manager, and review layer. The harness supplies context and execution; Skippy stores accepted knowledge, tasks, project state, source references, and task results.`,
    "",
    "## Key URLs And Endpoints",
    "",
    `- App: ${appUrl}`,
    `- MCP endpoint: ${appUrl.replace(/\/$/, "")}/api/mcp`,
    "- Local development MCP endpoint: `http://localhost:3000/api/mcp`",
    "",
    "## Auth Expectations",
    "",
    "- Use a Skippy MCP bearer token generated by the signed-in user.",
    "- Never print, store in chat, commit, or log raw tokens.",
    "- A token maps to one Skippy brain through Convex `mcpTokens`.",
    "",
    "## First 5 Minutes",
    "",
    "1. Confirm Skippy MCP tools are available.",
    "2. Load `skippy_harness_bootstrap` and, for scheduler work, `skippy_task_heartbeat`.",
    "3. Call `get_current_context` if the user says this project, here, or current project.",
    "4. Use `list_ready_tasks` or `list_requested_ready_tasks` before executing agent work.",
    "5. Fetch details with `get_task_brief`, do the work, verify it, then call `record_task_result`.",
    "",
    "## Core Workflow",
    "",
    "- Proposed tasks stay Proposed until briefed: list them, ground an execution brief in the actual repo, then call `brief_task` to move them to Briefed.",
    "- Ready is the agent queue; requested Ready tasks are the safest automation queue.",
    "- Agent work should end in `in_review` unless the owner explicitly allows automatic completion.",
    "- Coding tasks should produce a branch, verification, and PR when the project has a GitHub repo.",
    "",
    "## Key Tools",
    "",
    "- `get_current_context`: resolve active app route/project.",
    "- `create_task` / `create_project`: explicit user-created items.",
    "- `plan_project`: decompose accepted projects.",
    "- `brief_task`: write a repo-grounded execution brief plus acceptance criteria for a proposed task and move it to Briefed.",
    "- `list_ready_tasks` / `list_requested_ready_tasks`: find executable work.",
    "- `get_task_brief`: get the handoff brief.",
    "- `record_task_result`: report PR/artifact/result for review.",
    "- `get_skill`: load canonical Skippy-hosted skills by slug.",
    "- `get_importance_rubric`, `ingest_object`, `record_memory`, `capture_thought`: capture useful second-brain context.",
    ...details,
    ...detailed,
  ].join("\n");
}

const sourceRefSchema = z.object({
  sourceSystem: z
    .string()
    .describe("Origin system such as gmail, calendar, apple_reminders, imessage, chatgpt, claude, codex, hermes, or manual_conversation."),
  externalId: z.string().optional().describe("Stable upstream ID when available."),
  threadId: z.string().optional().describe("Conversation/thread ID for email or messaging sources."),
  messageId: z.string().optional().describe("Specific message ID when the candidate came from an email/message."),
  eventId: z.string().optional().describe("Specific calendar event ID when the candidate came from a calendar source."),
  reminderId: z.string().optional().describe("Specific reminder/task ID from an external reminder system."),
  sourceTimestamp: z.number().optional().describe("Source item timestamp in epoch milliseconds."),
  participants: z.array(z.string()).optional().describe("Relevant sender/recipient/attendee names or addresses."),
  url: z.string().optional().describe("Inspectable browser URL for the source item."),
  deepLink: z.string().optional().describe("Best direct link back to the source item."),
  excerpt: z.string().optional().describe("Short quoted excerpt only; do not include full raw emails or long private source text."),
  summary: z.string().optional().describe("Concise source summary that explains why this source supports the candidate."),
});

const entityRefSchema = z.object({
  entityType: z.enum(entityTypeValues).describe("Accepted Skippy entity type."),
  entityId: z.string().describe("Existing accepted entity ID, not a fallback review item ID."),
});

const memoryKindSchema = z
  .enum(memoryKindValues)
  .describe("Memory category. Use memory for general durable preferences/facts, decision for choices made, principle for durable operating rules.");

const interviewKindSchema = z
  .enum(interviewKindValues)
  .describe("Guided interview template to run inside the harness chat.");

const interviewMemoryKindSchema = z
  .enum(interviewMemoryKindValues)
  .describe("Memory category for optional interview memory candidates. Interview-created memories are submitted to review.");

const memoryReviewBehaviorSchema = z
  .enum(memoryReviewBehaviorValues)
  .describe("accept writes directly, submit_for_review queues for user review, auto lets Skippy apply backend policy.");

const memoryEvidenceSchema = {
  captureReason: z.string().optional().describe("Why this thought belongs in long-term memory."),
  rubricDecision: z.string().optional().describe("How this clears the user's memory/importance rubric."),
  confidence: z.number().min(0).max(1).optional().describe("Confidence from 0 to 1."),
  reviewBehavior: memoryReviewBehaviorSchema.optional(),
  sourceRefs: z.array(sourceRefSchema).optional().describe("Lightweight provenance records."),
  sourceRefIds: z.array(z.string()).optional().describe("Existing source reference IDs."),
  relatedEntityRefs: z.array(entityRefSchema).optional().describe("Accepted Skippy entities this memory should be associated with."),
  createdBy: z.string().optional().describe("Harness/user identifier for audit logging."),
  metadata: z.unknown().optional().describe("Small JSON metadata object. Avoid secrets and raw source dumps."),
};

const focusTopItemSchema = z.object({
  entityRef: entityRefSchema.describe("Accepted entity that belongs in the focus summary."),
  reason: z.string().describe("Human-readable reason this item matters now."),
  priorityScore: z.number().optional().describe("Optional priority score from 0 to 1."),
  urgencyScore: z.number().optional().describe("Optional urgency score from 0 to 1."),
  importanceScore: z.number().optional().describe("Optional importance score from 0 to 1."),
});

const jsonObjectSchema = z
  .record(z.string(), z.unknown())
  .describe("Plain JSON object. Prefer concise, typed fields such as title, summary, status, dueDate, url, companyName, personName, email, relationshipLabel, or sourceSummary.");

function toolResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function skillText(value: unknown, fallback: string) {
  const record = objectResult(value);
  return typeof record.body === "string" && record.body.trim() ? record.body : fallback;
}

function objectResult(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function payloadTitle(entityType: EntityType, payload: unknown): string | undefined {
  const record = objectResult(payload);
  const candidateValue =
    record.title ?? record.name ?? record.personName ?? record.companyName ?? record.summary ?? record.body ?? record.text;
  if (typeof candidateValue !== "string") {
    return undefined;
  }

  const normalizedValue = candidateValue.trim();
  if (!normalizedValue) {
    return undefined;
  }

  if (entityType === "note" && normalizedValue.length > 80) {
    return `${normalizedValue.slice(0, 77)}...`;
  }

  return normalizedValue;
}

function reviewUrl(path: string) {
  return `${getSkippyAppUrl()}${path}`;
}

function candidateConfirmation(input: CandidateObjectInput, result: unknown) {
  const resultRecord = objectResult(result);
  const duplicate = resultRecord.duplicate === true;
  return {
    status: resultRecord.status ?? (duplicate ? "duplicate_pending" : "submitted_for_review"),
    entityType: input.candidateEntityType,
    title: payloadTitle(input.candidateEntityType, input.candidatePayload),
    triageItemId: resultRecord.triageItemId,
    sourceRefIds: resultRecord.sourceRefIds,
    duplicate,
    candidateFingerprint: resultRecord.candidateFingerprint,
    reviewUrl: reviewUrl("/triage"),
    nextAction: duplicate
      ? "This candidate already has a pending review item in Skippy."
      : "Review, approve, correct, merge, reclassify, or reject this candidate in Skippy.",
  };
}

function ingestConfirmation(input: CandidateObjectInput & { rubricDecision: string }, result: unknown) {
  const resultRecord = objectResult(result);
  return {
    status: resultRecord.status ?? "accepted",
    entityType: resultRecord.entityType ?? input.candidateEntityType,
    title: resultRecord.title ?? payloadTitle(input.candidateEntityType, input.candidatePayload),
    entityId: resultRecord.entityId,
    duplicate: resultRecord.duplicate,
    sourceRefIds: resultRecord.sourceRefIds,
    rubricDecision: resultRecord.rubricDecision ?? input.rubricDecision,
    reviewUrl: reviewUrl("/projects"),
  };
}

function directCreateConfirmation(result: unknown, fallbackEntityType: "project" | "task") {
  const resultRecord = objectResult(result);
  const entityType = resultRecord.entityType ?? fallbackEntityType;
  return {
    status: resultRecord.status ?? "created",
    entityType,
    title: resultRecord.title,
    entityId: resultRecord.taskId ?? resultRecord.projectId,
    duplicate: resultRecord.duplicate,
    ownerType: resultRecord.ownerType,
    projectId: resultRecord.projectId,
    projectTitle: resultRecord.projectTitle,
    relationshipId: resultRecord.relationshipId,
    reviewUrl: reviewUrl("/projects"),
  };
}

function taskBriefedConfirmation(result: unknown) {
  const resultRecord = objectResult(result);
  return {
    status: "briefed",
    entityType: "task",
    taskId: resultRecord.taskId,
    executionState: resultRecord.executionState ?? "briefed",
    reviewUrl: reviewUrl("/projects"),
    nextAction:
      "The task now has an execution brief and shows as Briefed in Skippy. The owner promotes it to Ready when it should enter the agent queue.",
  };
}

function linkStatusUpdatedConfirmation(input: { status: string }, result: unknown) {
  const resultRecord = objectResult(result);
  return {
    status: resultRecord.status ?? input.status,
    entityType: "link",
    linkId: resultRecord.linkId,
    title: resultRecord.title,
    reviewUrl: reviewUrl("/brain"),
  };
}

function financialAccountConfirmation(result: unknown) {
  const resultRecord = objectResult(result);
  return {
    status: resultRecord.status ?? "upserted",
    entityType: "financial_account",
    accountId: resultRecord.accountId,
    title: resultRecord.name,
    accountType: resultRecord.accountType,
    mask: resultRecord.mask,
    reviewUrl: reviewUrl("/finances"),
  };
}

function financialTransactionsConfirmation(input: RecordFinancialTransactionsInput, result: unknown) {
  const resultRecord = objectResult(result);
  return {
    status: "recorded",
    entityType: "financial_transactions",
    accountId: resultRecord.accountId ?? input.accountId,
    title: resultRecord.accountName,
    source: resultRecord.source ?? input.source ?? "plaid",
    submitted: input.transactions.length,
    inserted: resultRecord.inserted,
    updated: resultRecord.updated,
    skipped: resultRecord.skipped,
    reviewUrl: reviewUrl("/finances"),
  };
}

function financialBalancesConfirmation(input: RecordFinancialBalancesInput, result: unknown) {
  const resultRecord = objectResult(result);
  return {
    status: "recorded",
    entityType: "financial_balances",
    accountId: resultRecord.accountId ?? input.accountId,
    title: resultRecord.accountName,
    source: resultRecord.source ?? input.source ?? "plaid_derived",
    submitted: input.balances.length,
    inserted: resultRecord.inserted,
    updated: resultRecord.updated,
    reviewUrl: reviewUrl("/finances"),
  };
}

function financialReportConfirmation(input: { accountId: string; monthKey: string }, result: unknown) {
  const resultRecord = objectResult(result);
  return {
    status: "report",
    entityType: "financial_report",
    accountId: input.accountId,
    monthKey: resultRecord.monthKey ?? input.monthKey,
    ...resultRecord,
    reviewUrl: reviewUrl("/finances"),
  };
}

function taskDoneConfirmation(result: unknown) {
  const resultRecord = objectResult(result);
  return {
    status: "done",
    entityType: "task",
    taskId: resultRecord.taskId,
    pendingActionId: resultRecord.pendingActionId,
    reviewUrl: reviewUrl("/projects"),
  };
}

function taskInProgressConfirmation(result: unknown) {
  const resultRecord = objectResult(result);
  return {
    status: "in_progress",
    entityType: "task",
    taskId: resultRecord.taskId,
    startedAt: resultRecord.startedAt,
    startedBy: resultRecord.startedBy,
    reviewUrl: reviewUrl("/projects"),
    nextAction: "Skippy now shows this task as in progress while the harness works on it.",
  };
}

function pendingActionsConfirmation(input: { status?: string }, result: unknown) {
  const pendingActions = Array.isArray(result) ? result : [];
  return {
    status: "listed",
    entityType: "pending_action",
    filterStatus: input.status,
    count: pendingActions.length,
    pendingActions,
    reviewUrl: reviewUrl("/actions"),
  };
}

function pendingActionResultConfirmation(
  input: {
    pendingActionId: string;
    status: "sent" | "failed" | "completed";
    executionProvider?: string;
    externalMessageId?: string;
    error?: string;
  },
  result: unknown,
) {
  const resultRecord = objectResult(result);
  return {
    status: input.status,
    entityType: "pending_action",
    pendingActionId: resultRecord.pendingActionId ?? input.pendingActionId,
    executionProvider: input.executionProvider,
    externalMessageId: input.externalMessageId,
    error: input.error,
    reviewUrl: reviewUrl("/actions"),
    nextAction:
      input.status === "failed"
        ? "Review the failure in Skippy before retrying or taking another external action."
        : "Execution result recorded in Skippy.",
  };
}

function memoryConfirmation(
  action: "captured" | "recorded" | "submitted_for_review" | "linked",
  input: {
    kind?: MemoryKind | undefined;
    content?: string | undefined;
    rubricDecision?: string | undefined;
    reviewBehavior?: MemoryReviewBehavior | undefined;
  },
  result: unknown,
) {
  const resultRecord = objectResult(result);
  const memoryId = resultRecord.memoryId ?? resultRecord._id ?? resultRecord.id;
  const reviewItemId = resultRecord.reviewItemId ?? resultRecord.triageItemId;
  const status = resultRecord.status ?? (reviewItemId ? "submitted_for_review" : action);
  const content = input.content?.trim();

  return {
    status,
    entityType: "memory",
    memoryId,
    reviewItemId,
    kind: resultRecord.kind ?? resultRecord.memoryKind ?? input.kind,
    title:
      resultRecord.title ??
      (content ? (content.length > 80 ? `${content.slice(0, 77)}...` : content) : undefined),
    sourceRefIds: resultRecord.sourceRefIds,
    relatedEntityRefs: resultRecord.relatedEntityRefs,
    confidence: resultRecord.confidence,
    rubricDecision: resultRecord.rubricDecision ?? input.rubricDecision,
    reviewBehavior: input.reviewBehavior,
    reviewUrl: reviewUrl("/memory"),
    nextAction:
      status === "submitted_for_review"
        ? "Review, accept, edit, or reject this memory candidate in Skippy."
        : "Memory updated in Skippy.",
  };
}

function withAbsoluteReviewUrl(value: unknown) {
  const record = objectResult(value);
  if (typeof record.reviewUrl !== "string") {
    return value;
  }

  if (record.reviewUrl.startsWith("http://") || record.reviewUrl.startsWith("https://")) {
    return value;
  }

  return {
    ...record,
    reviewUrl: reviewUrl(record.reviewUrl),
  };
}

function interviewStartConfirmation(input: StartInterviewInput, result: unknown) {
  const resultRecord = withAbsoluteReviewUrl(result) as Record<string, unknown>;
  const currentQuestion = objectResult(resultRecord.currentQuestion);
  const assistantDisplayName =
    typeof resultRecord.assistantDisplayName === "string" ? resultRecord.assistantDisplayName : getAssistantDisplayName();
  return {
    ...resultRecord,
    status: "active",
    kind: input.kind,
    assistantDisplayName,
    nextAction: currentQuestion.prompt
      ? `Ask this in the harness chat: ${currentQuestion.prompt}`
      : `Ask the next interview question in the harness chat for ${assistantDisplayName}.`,
  };
}

function interviewAnswerConfirmation(result: unknown) {
  const resultRecord = withAbsoluteReviewUrl(result) as Record<string, unknown>;
  const nextQuestion = objectResult(resultRecord.nextQuestion);
  return {
    ...resultRecord,
    status: resultRecord.isLastAnswer ? "ready_to_complete" : "answer_saved",
    nextAction: resultRecord.isLastAnswer
      ? "All interview questions have answers. Ask whether to complete the interview and whether to submit a summary memory candidate."
      : nextQuestion.prompt
        ? `Ask this next in the harness chat: ${nextQuestion.prompt}`
        : "Ask the next interview question in the harness chat.",
  };
}

function stripUndefined<T>(value: T): T {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, childValue] of Object.entries(value)) {
    if (childValue !== undefined) {
      result[key] = stripUndefined(childValue);
    }
  }

  return result as T;
}

export function createMcpServer(client: SkippyClient, brainInstanceId: string) {
  const server = new McpServer(
    {
      name: "skippy",
      version: "0.1.0",
    },
    {
      instructions: skippyInstructions,
    },
  );
  const tools = createSkippyToolHandlers(client, brainInstanceId);

  server.registerResource(
    "skippy_harness_guide",
    "skippy://guide/harness-usage",
    {
      title: "Skippy harness usage guide",
      description: "Operating rules for AI harnesses that ingest sources into Skippy.",
      mimeType: "text/plain",
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: skippyInstructions,
        },
      ],
    }),
  );

  server.registerResource(
    "skippy_task_heartbeat",
    "skippy://skills/task-heartbeat",
    {
      title: "Skippy task heartbeat skill",
      description: "Portable heartbeat instructions for harnesses that execute requested Ready agent tasks.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: skillText(await tools.getSkill({ slug: "task-heartbeat" }), buildSkillsMessage()),
        },
      ],
    }),
  );

  server.registerResource(
    "skippy_harness_bootstrap",
    "skippy://skills/harness-bootstrap",
    {
      title: "Skippy harness bootstrap skill",
      description: "Portable context pack for newly connected AI harnesses.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: skillText(await tools.getSkill({ slug: "harness-bootstrap" }), buildHarnessBootstrapMessage()),
        },
      ],
    }),
  );

  server.registerResource(
    "skippy_skills",
    "skippy://guide/skills",
    {
      title: "Skippy portable harness skills",
      description: "Portable instructions that teach any MCP-capable harness how to use Skippy as a second brain.",
      mimeType: "text/markdown",
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: buildSkillsMessage(),
        },
      ],
    }),
  );

  server.registerResource(
    "skippy_slash_commands",
    "skippy://guide/slash-commands",
    {
      title: "Skippy slash commands",
      description: "User-facing slash command shortcuts and their Skippy MCP tool mappings.",
      mimeType: "text/markdown",
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: buildSlashCommandsMessage(),
        },
      ],
    }),
  );

  server.registerResource(
    "skippy_intro",
    "skippy://guide/intro",
    {
      title: "Skippy intro message",
      description: "User-facing introduction that harnesses may show when Skippy MCP connects.",
      mimeType: "text/plain",
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: buildIntroMessage(),
        },
      ],
    }),
  );

  server.registerPrompt(
    "skippy_task_heartbeat",
    {
      title: "Load Skippy Task Heartbeat",
      description:
        "Portable heartbeat instructions for harnesses that execute requested Ready agent tasks and report results back to Skippy.",
    },
    async () => ({
      description: "Teach the connected harness how to run Skippy requested Ready agent tasks.",
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: skillText(await tools.getSkill({ slug: "task-heartbeat" }), buildSkillsMessage()),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "skippy_harness_bootstrap",
    {
      title: "Load Skippy Harness Bootstrap",
      description:
        "Bootstrap a newly connected harness with Skippy context, endpoint/auth expectations, core workflows, and tool references.",
      argsSchema: {
        harnessName: z.string().optional().describe("Optional harness name, such as Codex, Claude Code, or Hermes."),
        verbosity: z.enum(["short", "standard", "detailed"]).optional().describe("How much context to include."),
      },
    },
    async (args) => ({
      description: "Teach a newly connected harness how to operate with Skippy.",
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: buildHarnessBootstrapMessage(
              stripUndefined({
                harnessName: args.harnessName,
                verbosity: args.verbosity ?? "standard",
              }) as {
                harnessName?: string;
                verbosity?: "short" | "standard" | "detailed";
              },
            ),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "skippy_skills",
    {
      title: "Load Skippy Skills",
      description:
        "Portable harness instructions for using Skippy MCP as a second brain: retrieval, capture, rubric decisions, source refs, review, memory, interviews, and user-facing confirmations.",
    },
    () => ({
      description: "Teach the connected harness how to use Skippy well.",
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: buildSkillsMessage(),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "skippy_intro",
    {
      title: "Introduce Skippy",
      description:
        "A user-facing introduction for connected harnesses to show when Skippy MCP is first connected or when the user asks what Skippy can do.",
    },
    () => ({
      description: "Introduce Skippy's capabilities and point the user to the review app.",
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: buildIntroMessage(),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "skippy_slash_commands",
    {
      title: "Load Skippy Slash Commands",
      description: "Portable user-facing slash command shortcuts for mapping chat commands to Skippy MCP tools.",
    },
    () => ({
      description: "Teach the connected harness the Skippy slash command shorthand.",
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: buildSlashCommandsMessage(),
          },
        },
      ],
    }),
  );

  server.registerTool(
    "get_skill",
    {
      title: "Get Skippy-hosted skill",
      description:
        "Read a portable Skippy-hosted harness skill by slug, such as task-heartbeat. Use this to load the latest canonical instructions instead of relying on copied prompt text.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        slug: z.string().describe("Skill slug, for example task-heartbeat."),
      }),
    },
    async (args) => toolResult(await tools.getSkill(stripUndefined(args) as { slug: string })),
  );

  server.registerTool(
    "capture",
    {
      title: "Capture free-form knowledge",
      description:
        "Use for explicit user capture or quick free-form knowledge. Creates an accepted note directly with source provenance when available. Prefer ingest_object when you can extract a typed task, project, person, company, link, goal, or knowledge object.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        text: z
          .string()
          .describe("Concise captured thought or source summary. Avoid dumping full raw email/calendar/message bodies."),
        sourceRef: sourceRefSchema.optional().describe("Lightweight provenance for where this capture came from."),
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as { text: string; sourceRef?: SourceRefInput };
      const result = await tools.capture(input);
      const candidate: CandidateObjectInput<"note"> & { rubricDecision: string } = {
        candidateEntityType: "note",
        candidatePayload: { body: input.text.trim() },
        rubricDecision: "Explicit user capture request.",
      };
      if (input.sourceRef) {
        candidate.sourceRefs = [input.sourceRef];
      }

      return toolResult(
        ingestConfirmation(candidate, result),
      );
    },
  );

  server.registerTool(
    "capture_thought",
    {
      title: "Capture thought",
      description:
        "Capture an explicit user thought as second-brain memory. Use for durable preferences, reflections, decisions-in-progress, or context the user wants remembered. Include provenance and let reviewBehavior choose direct write versus review.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        text: z.string().describe("Concise thought to remember. Avoid dumping full raw private source text."),
        content: z.string().optional().describe("Optional normalized memory content when different from text."),
        proposedKind: memoryKindSchema.optional(),
        ...memoryEvidenceSchema,
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as CaptureThoughtInput;
      const result = await tools.captureThought(input);
      return toolResult(
        memoryConfirmation(
          "captured",
          {
            kind: input.proposedKind,
            content: input.content ?? input.text,
            rubricDecision: input.rubricDecision,
            reviewBehavior: input.reviewBehavior,
          },
          result,
        ),
      );
    },
  );

  server.registerTool(
    "record_memory",
    {
      title: "Record memory",
      description:
        "Write a durable second-brain memory when the harness can explain why it belongs. Use for stable user preferences, personal facts, recurring context, and durable working notes. Use record_decision or record_principle for those specific kinds.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        content: z.string().describe("Concise durable memory content."),
        kind: memoryKindSchema.optional(),
        title: z.string().optional().describe("Optional short display title."),
        summary: z.string().optional().describe("Optional one-sentence summary."),
        ...memoryEvidenceSchema,
        rubricDecision: z
          .string()
          .describe("Why this clears the user's memory/importance rubric. Required for direct memory writes."),
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as RecordMemoryInput;
      return toolResult(
        memoryConfirmation("recorded", input, await tools.recordMemory(input)),
      );
    },
  );

  server.registerTool(
    "record_decision",
    {
      title: "Record decision",
      description:
        "Write a durable decision memory. Use when the user or a source clearly establishes a choice, direction, commitment, or tradeoff that should be remembered later.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        content: z.string().describe("The decision, phrased concisely."),
        title: z.string().optional().describe("Optional short display title."),
        summary: z.string().optional().describe("Optional context summary."),
        ...memoryEvidenceSchema,
        rubricDecision: z.string().describe("Why this decision is durable enough to store."),
      }),
    },
    async (args) => {
      const input = { ...(stripUndefined(args) as Omit<RecordMemoryInput, "kind">), kind: "decision" as const };
      return toolResult(
        memoryConfirmation("recorded", input, await tools.recordMemory(input)),
      );
    },
  );

  server.registerTool(
    "record_principle",
    {
      title: "Record principle",
      description:
        "Write a durable operating principle or preference. Use for stable guidance about how Skippy or harnesses should behave, not one-off observations.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        content: z.string().describe("The principle or durable preference."),
        title: z.string().optional().describe("Optional short display title."),
        summary: z.string().optional().describe("Optional context summary."),
        ...memoryEvidenceSchema,
        rubricDecision: z.string().describe("Why this principle should persist."),
      }),
    },
    async (args) => {
      const input = { ...(stripUndefined(args) as Omit<RecordMemoryInput, "kind">), kind: "principle" as const };
      return toolResult(
        memoryConfirmation("recorded", input, await tools.recordMemory(input)),
      );
    },
  );

  server.registerTool(
    "submit_memory_review_candidate",
    {
      title: "Submit memory review candidate",
      description:
        "Queue a possible memory for user review when the harness is unsure it should be stored directly. Prefer record_memory, record_decision, or record_principle when the item clearly clears the rubric. Do NOT queue transient alerts (balance notifications, promo deadlines, ToS/policy notices, expiring offers): skip them, or if genuinely useful, record them directly with expiry context in the body. Unreviewed candidates auto-archive after 14 days, so only queue items worth a durable memory.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        content: z.string().describe("Concise proposed memory content."),
        proposedKind: memoryKindSchema.optional(),
        ...memoryEvidenceSchema,
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as MemoryReviewCandidateInput;
      return toolResult(
        memoryConfirmation(
          "submitted_for_review",
          {
            kind: input.proposedKind,
            content: input.content,
            rubricDecision: input.rubricDecision,
            reviewBehavior: input.reviewBehavior,
          },
          await tools.submitMemoryReviewCandidate(input),
        ),
      );
    },
  );

  server.registerTool(
    "list_memory",
    {
      title: "List memory",
      description:
        "Read-only memory search/list tool. Use to retrieve durable second-brain memories by query, kind, related entity, or archive state before answering or adding duplicates.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        query: z.string().optional().describe("Search text for memory content/title/summary."),
        memoryType: memoryKindSchema.optional().describe("Single memory kind filter. Use kinds for multiple values."),
        kinds: z.array(memoryKindSchema).optional().describe("Optional memory kind filters."),
        relatedEntityRefs: z.array(entityRefSchema).optional().describe("Only memories related to these accepted entities."),
        includeArchived: z.boolean().optional().describe("Include archived/disabled memories. Defaults to false."),
        limit: z.number().min(1).max(50).optional().describe("Maximum memories to return. Defaults to 20."),
      }),
    },
    async (args) => toolResult(await tools.listMemory(stripUndefined(args) as MemoryListInput)),
  );

  server.registerTool(
    "get_memory_detail",
    {
      title: "Get memory detail",
      description:
        "Read-only memory detail. Use when a list/search result needs provenance, related entities, or full stored detail before acting.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        memoryId: z.string().describe("Memory ID returned by list_memory, capture_thought, or record_memory."),
        includeSourceRefs: z.boolean().optional().describe("Include source refs/provenance if backend supports it."),
        includeRelatedEntities: z.boolean().optional().describe("Include related accepted Skippy entities if backend supports it."),
      }),
    },
    async (args) => toolResult(await tools.getMemoryDetail(stripUndefined(args) as MemoryDetailInput)),
  );

  server.registerTool(
    "get_context_bundle",
    {
      title: "Get context bundle",
      description:
        "Read-only semantic-ish context bundle. Use to gather scored memories, source refs, and related project/task/person/company/note/link context for a query and/or accepted entity refs.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        query: z.string().optional().describe("Search text for memory and related entity context."),
        memoryType: memoryKindSchema.optional().describe("Single memory kind filter. Use kinds for multiple values."),
        kinds: z.array(memoryKindSchema).optional().describe("Optional memory kind filters."),
        relatedEntityRefs: z.array(entityRefSchema).optional().describe("Accepted entities to anchor the bundle."),
        includeArchived: z.boolean().optional().describe("Include archived/rejected memories. Defaults to false."),
        memoryLimit: z.number().min(1).max(25).optional().describe("Maximum scored memories. Defaults to 8."),
        entityLimit: z.number().min(1).max(40).optional().describe("Maximum related/matched entities. Defaults to 12."),
        sourceLimit: z.number().min(1).max(40).optional().describe("Maximum provenance source refs. Defaults to 12."),
      }),
    },
    async (args) => toolResult(await tools.getContextBundle(stripUndefined(args) as ContextBundleInput)),
  );

  server.registerTool(
    "link_memory",
    {
      title: "Link memory",
      description:
        "Attach an existing memory to an accepted Skippy entity with a confidence-rated relationship. Use after you know both the memory ID and accepted entity ref.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        memoryId: z.string().describe("Existing memory ID."),
        entityRef: entityRefSchema.describe("Accepted Skippy entity to relate to this memory."),
        relationshipType: z.string().optional().describe("Relationship label. Defaults to related_to."),
        reason: z.string().optional().describe("Short explanation for this link."),
        confidence: z.number().min(0).max(1).optional().describe("Confidence from 0 to 1 for inferred relationships."),
        sourceRefs: z.array(sourceRefSchema).optional().describe("Evidence source refs for the link."),
        sourceRefIds: z.array(z.string()).optional().describe("Existing source ref IDs for the link."),
        createdBy: z.string().optional().describe("Harness/user identifier for audit logging."),
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as LinkMemoryInput;
      return toolResult(
        memoryConfirmation("linked", {}, await tools.linkMemory(input)),
      );
    },
  );

  server.registerTool(
    "list_interview_templates",
    {
      title: "List interview templates",
      description:
        "Read the guided interview templates and assistantDisplayName. Use this before offering an interview in chat so the harness can say, for example, `Want to do a project interview for [assistantDisplayName]?`.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => toolResult(withAbsoluteReviewUrl(await tools.listInterviewTemplates())),
  );

  server.registerTool(
    "list_interviews",
    {
      title: "List interviews",
      description:
        "Read active and recent guided interviews for the current Skippy brain. Use to resume an existing chat interview before starting a duplicate.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        recentLimit: z.number().min(1).max(50).optional().describe("How many recent interviews to return. Defaults to 12."),
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as { recentLimit?: number };
      return toolResult(withAbsoluteReviewUrl(await tools.listInterviews(input)));
    },
  );

  server.registerTool(
    "start_interview",
    {
      title: "Start interview",
      description:
        "Start a guided second-brain interview that the harness should conduct one question at a time in chat. Use assistantDisplayName/suggestedPrompt from list_interview_templates or this result when offering the interview to the user.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        kind: interviewKindSchema,
        title: z.string().optional().describe("Optional custom interview title."),
        subjectLabel: z.string().optional().describe("Optional project, goal, person, or decision label for the interview subject."),
        subjectEntityRef: entityRefSchema.optional().describe("Optional accepted Skippy entity this interview is about."),
        startedBy: z.string().optional().describe("Harness/user identifier for audit logging."),
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as StartInterviewInput;
      return toolResult(interviewStartConfirmation(input, await tools.startInterview(input)));
    },
  );

  server.registerTool(
    "get_interview",
    {
      title: "Get interview",
      description:
        "Read an interview's current question, prior responses, progress, assistantDisplayName, and review URL. Use this to resume a chat interview.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        interviewId: z.string().describe("Interview ID returned by start_interview or list_interviews."),
      }),
    },
    async (args) => toolResult(withAbsoluteReviewUrl(await tools.getInterview(stripUndefined(args) as GetInterviewInput))),
  );

  server.registerTool(
    "answer_interview_question",
    {
      title: "Answer interview question",
      description:
        "Save the user's answer to the current interview question and return the next question for the harness to ask in chat. Only set createMemoryCandidate when the user explicitly wants this answer sent to Memory Inbox.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        interviewId: z.string().describe("Active interview ID."),
        answerText: z.string().describe("The user's answer to the current question."),
        answerValue: z.unknown().optional().describe("Optional structured representation of the answer."),
        createMemoryCandidate: z
          .boolean()
          .optional()
          .describe("When true, submit this answer to Memory Inbox if the template marks the question as memorable."),
        memoryType: interviewMemoryKindSchema.optional(),
        answeredBy: z.string().optional().describe("Harness/user identifier for audit logging."),
      }),
    },
    async (args) =>
      toolResult(interviewAnswerConfirmation(await tools.answerInterviewQuestion(stripUndefined(args) as AnswerInterviewQuestionInput))),
  );

  server.registerTool(
    "complete_interview",
    {
      title: "Complete interview",
      description:
        "Complete a guided interview after the chat questions are answered. Optionally submit a summary memory candidate to Memory Inbox when the user explicitly wants Skippy to retain the distilled interview.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        interviewId: z.string().describe("Interview ID to complete."),
        summary: z.string().optional().describe("Optional concise interview summary."),
        createSummaryMemoryCandidate: z
          .boolean()
          .optional()
          .describe("When true, submit a distilled interview summary to Memory Inbox."),
        memoryType: interviewMemoryKindSchema.optional(),
        completedBy: z.string().optional().describe("Harness/user identifier for audit logging."),
      }),
    },
    async (args) =>
      toolResult(withAbsoluteReviewUrl(await tools.completeInterview(stripUndefined(args) as CompleteInterviewInput))),
  );

  server.registerTool(
    "archive_interview",
    {
      title: "Archive interview",
      description:
        "Archive a guided interview when the user cancels, abandons a test interview, or does not want to keep it active.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        interviewId: z.string().describe("Interview ID to archive."),
        archiveReason: z.string().optional().describe("Short reason for archiving."),
        archivedBy: z.string().optional().describe("Harness/user identifier for audit logging."),
      }),
    },
    async (args) =>
      toolResult(withAbsoluteReviewUrl(await tools.archiveInterview(stripUndefined(args) as ArchiveInterviewInput))),
  );

  server.registerTool(
    "ask",
    {
      title: "Ask Skippy",
      description:
        "Read-only retrieval helper. Ask for structured context already stored in Skippy. Internal synthesis may be disabled, so expect available focus/context rather than a complete natural-language answer.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        query: z.string().describe("Natural-language question or context request, e.g. 'what should Jeff focus on today?'"),
      }),
    },
    async (args) => toolResult(await tools.ask(args)),
  );

  server.registerTool(
    "summarize_focus",
    {
      title: "Summarize focus",
      description:
        "Read-only retrieval of the latest stored focus summary, if any. Use before generating a new focus summary or answering focus-related questions.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => toolResult(await tools.summarizeFocus()),
  );

  server.registerTool(
    "get_importance_rubric",
    {
      title: "Get importance rubric",
      description:
        "Read the user's current effective Skippy importance rubric: their manual policy text plus live context (active goals, in-progress projects, and favorited contacts whose email/calendar/messages should be treated as high-signal). Use this before source ingestion when deciding what belongs in Skippy and what should be ignored. Read renderedText for the full composed guidance.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => toolResult(await tools.getImportanceRubric()),
  );

  server.registerTool(
    "refresh_focus_summary",
    {
      title: "Refresh focus summary",
      description:
        "Generate and store a fresh Skippy focus summary from accepted entities using the configured internal AI provider and embedding ranking. Use when the user asks what to focus on now or wants the dashboard refreshed. The user-facing Now list is for actionable next moves only; standing context, user identity, relationships, and assumptions should remain in memory/context rather than appearing as task-like bullets.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        generatedAt: z.number().optional().describe("Epoch milliseconds to record as the generation time. Defaults to now."),
        validUntil: z.number().optional().describe("Optional epoch milliseconds after which this summary should be considered stale."),
        policyVersion: z.string().optional().describe("Optional policy/ranking version. Defaults to skippy-focus-summary-v1."),
      }),
    },
    async (args) =>
      toolResult(
        await tools.refreshFocusSummary(
          stripUndefined(args) as Parameters<typeof tools.refreshFocusSummary>[0],
        ),
      ),
  );

  server.registerTool(
    "ingest_object",
    {
      title: "Ingest accepted object",
      description:
        "Primary write tool for source-derived knowledge under the user's importance rubric. Use when the harness can explain why the item is worth storing. Creates an accepted Skippy object directly; does not create a fallback review item. Include sourceRefs and a concise rubricDecision. Links ingested without an explicit status default to 'saved' (passive reference; no user interaction expected) — pass status 'unread' only for explicit read-later intent, and use submit_candidate_object when genuinely uncertain a link is valid or important.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        candidateEntityType: z
          .enum(entityTypeValues)
          .describe("The entity type to store directly in accepted Skippy knowledge."),
        candidatePayload: jsonObjectSchema.describe(
          "Structured fields. Examples: task {title,status,dueDate,sourceSummary,priorityReason}; person {name,email,relationshipLabel}; link {title,url,summary}; note {title,body}.",
        ),
        rubricDecision: z
          .string()
          .describe("Why this clears the user's importance rubric. Mention the signal: deadline, money, relationship, commitment, focus relevance, security, etc."),
        confidence: z.number().min(0).max(1).optional().describe("Confidence from 0 to 1."),
        reviewReason: z.string().optional().describe("Optional human-readable reasoning or caveat."),
        sourceRefs: z.array(sourceRefSchema).optional().describe("Lightweight provenance records."),
        sourceRefIds: z.array(z.string()).optional().describe("Existing source reference IDs."),
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as CandidateObjectInput & { rubricDecision: string };
      return toolResult(ingestConfirmation(input, await tools.ingestObject(input)));
    },
  );

  server.registerTool(
    "submit_candidate_object",
    {
      title: "Submit candidate object",
      description:
        "Legacy fallback for source-derived knowledge when the harness cannot decide whether it clears the user's importance rubric. Prefer ingest_object for important source-backed objects.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        candidateEntityType: z
          .enum(entityTypeValues)
          .describe("The entity type this candidate may become if later accepted."),
        candidatePayload: jsonObjectSchema.describe(
          "Structured candidate fields. Examples: task {title,status,dueDate,sourceSummary}; person {name,email,relationshipLabel}; link {title,url,summary}; note {body}.",
        ),
        confidence: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Confidence from 0 to 1."),
        reviewReason: z
          .string()
          .optional()
          .describe("Short reason the user should review this candidate, including uncertainty or why it matters."),
        sourceRefs: z
          .array(sourceRefSchema)
          .optional()
          .describe("Inline lightweight provenance records. Prefer including at least one when candidate came from a source."),
        sourceRefIds: z
          .array(z.string())
          .optional()
          .describe("Existing source reference IDs, when source refs were already stored separately."),
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as CandidateObjectInput;
      return toolResult(candidateConfirmation(input, await tools.submitCandidateObject(input)));
    },
  );

  server.registerTool(
    "create_project",
    {
      title: "Create accepted project",
      description:
        "Directly create an accepted project when the user explicitly asks to create/add a project. For source-derived project knowledge, prefer ingest_object with a rubricDecision and sourceRefs.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        title: z.string().describe("Project title from the user's explicit instruction."),
        summary: z.string().optional().describe("Short project summary."),
        status: z
          .enum(["idea", "planned", "in_progress", "paused", "completed", "cancelled", "archived"])
          .optional()
          .describe("Project status. Defaults to planned."),
        priorityReason: z.string().optional().describe("Why this project matters or belongs in the current roadmap."),
        createdBy: z.string().optional().describe("Harness/user identifier for audit logging."),
      }),
    },
    async (args) =>
      toolResult(
        directCreateConfirmation(
          await tools.createProjectDirect(
            stripUndefined(args) as Parameters<typeof tools.createProjectDirect>[0],
          ),
          "project",
        ),
      ),
  );

  server.registerTool(
    "create_task",
    {
      title: "Create accepted task",
      description:
        "Directly create an accepted task when the user explicitly asks to create/add a task. Optionally assign it to an accepted project by projectId. For source-derived tasks, prefer ingest_object with a rubricDecision and sourceRefs.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        title: z.string().describe("Task title from the user's explicit instruction."),
        description: z.string().optional().describe("Task description or acceptance detail."),
        status: z
          .enum(["todo", "in_progress", "waiting", "done", "cancelled"])
          .optional()
          .describe("Task status. Defaults to todo."),
        ownerType: z
          .enum(["owner", "agent"])
          .optional()
          .describe("Who should do the task: owner means user-owned work; agent means the connected assistant/harness should work it."),
        kind: z
          .enum(["coding", "review", "research", "design", "manual", "planning"])
          .optional()
          .describe("Task kind. Use review for one agent reviewing another agent's work."),
        dueAt: z.number().optional().describe("Optional due date/time in epoch milliseconds."),
        priorityReason: z.string().optional().describe("Why this task matters or its intended priority."),
        projectId: z.string().optional().describe("Accepted project ID to assign the task to."),
        createdBy: z.string().optional().describe("Harness/user identifier for audit logging."),
      }),
    },
    async (args) =>
      toolResult(
        directCreateConfirmation(
          await tools.createTaskDirect(stripUndefined(args) as Parameters<typeof tools.createTaskDirect>[0]),
          "task",
        ),
      ),
  );

  server.registerTool(
    "get_current_context",
    {
      title: "Get the user's current app context",
      description:
        "Read-only. Returns what the user currently has open in the Skippy web app — notably the active project (id + title) and route. Use this to resolve references like 'this project' or 'add a task here' when the user does not name the project explicitly. Returns null if nothing is open.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({}),
    },
    async () => toolResult(await tools.getCurrentContext()),
  );

  server.registerTool(
    "plan_project",
    {
      title: "Plan a project into tasks",
      description:
        "Use Skippy's AI planner to decompose an accepted project into an ordered set of executable tasks, each with an execution brief, acceptance criteria, and dependency links. Skippy plans; a human or coding agent executes. Requires an LLM provider configured for the brain. Re-running adds a fresh plan version.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        projectId: z.string().describe("Accepted project ID to plan."),
        maxTasks: z.number().int().min(1).max(12).optional().describe("Maximum number of tasks to produce (default 10)."),
      }),
    },
    async (args) => toolResult(await tools.planProject(stripUndefined(args) as { projectId: string; maxTasks?: number })),
  );

  server.registerTool(
    "list_ready_tasks",
    {
      title: "List ready-to-execute tasks",
      description:
        "Read-only, dependency-aware queue of agent-owned tasks whose dependencies are all complete (execution state 'ready'). This is what a coding agent should pick up next. Each item includes the execution brief and acceptance criteria.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional().describe("Maximum tasks to return (default 12)."),
      }),
    },
    async (args) => toolResult(await tools.listReadyTasks(stripUndefined(args) as { limit?: number })),
  );

  server.registerTool(
    "list_requested_ready_tasks",
    {
      title: "List requested ready agent tasks",
      description:
        "Read-only queue of Ready, agent-owned tasks that the user explicitly requested an agent/harness to execute. This is the safest queue for Codex heartbeat runs to poll.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional().describe("Maximum tasks to return (default 12)."),
      }),
    },
    async (args) => toolResult(await tools.listRequestedReadyTasks(stripUndefined(args) as { limit?: number })),
  );

  server.registerTool(
    "get_task_brief",
    {
      title: "Get a task's execution brief",
      description:
        "Read-only. Fetch the ready-to-hand-off brief for a single task: description, execution brief, acceptance criteria, owning project, and dependency status. Hand this to a coding agent to execute.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        taskId: z.string().describe("Task ID to fetch the brief for."),
      }),
    },
    async (args) => toolResult(await tools.getTaskBrief(stripUndefined(args) as { taskId: string })),
  );

  server.registerTool(
    "brief_task",
    {
      title: "Brief a proposed task",
      description:
        "Write an execution brief for a proposed task and move it to 'briefed'. Ground the brief in the actual repo: name concrete files, existing patterns, and verification steps a coding agent can follow. Optionally sharpen the title, description, and kind. Briefed tasks wait for the owner to promote them to Ready.",
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        taskId: z.string().describe("Proposed task ID to brief."),
        executionBrief: z
          .string()
          .describe("Self-contained execution brief: approach, key files, steps, and how to verify the change."),
        acceptanceCriteria: z
          .array(z.string())
          .describe("Concrete, verifiable acceptance criteria for the task."),
        title: z.string().optional().describe("Optional sharper task title."),
        description: z.string().optional().describe("Optional refreshed task description."),
        kind: z
          .enum(["coding", "review", "research", "design", "manual", "planning"])
          .optional()
          .describe("Optional task kind. Use coding for repo work."),
      }),
    },
    async (args) =>
      toolResult(
        taskBriefedConfirmation(
          await tools.briefTask(stripUndefined(args) as Parameters<typeof tools.briefTask>[0]),
        ),
      ),
  );

  server.registerTool(
    "record_task_result",
    {
      title: "Record a task result",
      description:
        "Report the outcome of an executed task back to Skippy for supervision. Provide a result summary and/or a PR/commit URL. By default the task moves to 'in_review' for the owner to approve; set markDone to complete it, which also unblocks dependent tasks.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        taskId: z.string().describe("Task ID that was executed."),
        resultSummary: z.string().optional().describe("Short summary of what was done."),
        resultUrl: z.string().optional().describe("PR, commit, or artifact URL."),
        gitBranchName: z.string().optional().describe("Git branch used for this task, such as agent/task-abc-title."),
        prUrl: z.string().optional().describe("GitHub pull request URL for reviewing this task."),
        prNumber: z.number().optional().describe("GitHub pull request number."),
        prStatus: z.enum(["open", "merged", "closed"]).optional().describe("Current pull request status."),
        markDone: z
          .boolean()
          .optional()
          .describe("If true, mark the task done immediately instead of leaving it for owner review."),
      }),
    },
    async (args) =>
      toolResult(
        await tools.recordTaskResult(
          stripUndefined(args) as {
            taskId: string;
            resultSummary?: string;
            resultUrl?: string;
            gitBranchName?: string;
            prUrl?: string;
            prNumber?: number;
            prStatus?: "open" | "merged" | "closed";
            markDone?: boolean;
          },
        ),
      ),
  );

  const upsertDescriptionNotes: Partial<Record<(typeof entityTypeValues)[number], string>> = {
    link: " Links are reference material: status defaults to 'saved' (no user interaction expected). Pass status 'unread' only when the user explicitly wants to read it later; if genuinely uncertain the link is valid or important, use submit_candidate_object so it lands in Review for a one-tap decision.",
  };

  for (const entityType of entityTypeValues) {
    server.registerTool(
      `upsert_${entityType}`,
      {
        title: `Submit ${entityType}`,
        description: `Convenience ingestion tool for a single accepted ${entityType}. This writes directly to accepted knowledge, so use it only when the item clearly clears the user's importance rubric. Prefer ingest_object when you can include sourceRefs and a specific rubricDecision.${upsertDescriptionNotes[entityType] ?? ""}`,
        annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
        inputSchema: jsonObjectSchema,
      },
      async (args) => {
        const candidatePayload = stripUndefined(args) as CandidateObjectInput<typeof entityType>["candidatePayload"];
        const input = {
          candidateEntityType: entityType,
          candidatePayload,
          rubricDecision: `Structured ${entityType} submitted through an MCP convenience tool; harness judged it worth storing under the importance rubric.`,
        } as CandidateObjectInput & { rubricDecision: string };
        return toolResult(
          ingestConfirmation(input, await tools.upsertEntity(entityType, candidatePayload)),
        );
      },
    );
  }

  server.registerTool(
    "update_link_status",
    {
      title: "Update link status",
      description:
        "Update a stored link's lifecycle status. Use only for genuine lifecycle changes: mark 'read' after the harness has actually ingested or read the link's content (for example during a sync), 'saved' when reclassifying it as reference material, or 'discarded' when cleaning up dead or irrelevant links. Never use it to fake user engagement or clear the user's reading queue without cause.",
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        linkId: z.string().describe("Accepted link entity ID to update."),
        status: z
          .enum(["unread", "read", "saved", "discarded"])
          .describe("New lifecycle status for the link."),
        reason: z.string().optional().describe("Short reason recorded in the link's activity history."),
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as {
        linkId: string;
        status: "unread" | "read" | "saved" | "discarded";
        reason?: string;
      };
      return toolResult(linkStatusUpdatedConfirmation(input, await tools.updateLinkStatus(input)));
    },
  );

  const taxonomySummary = TX_TYPES.map((type) => `${type}: ${TX_TYPE_CATEGORIES[type].join(" | ")}`).join("; ");

  server.registerTool(
    "upsert_financial_account",
    {
      title: "Upsert financial account",
      description:
        "Create or update a tracked financial account (accountType 'Jeff Personal' or 'Family Shared'). Idempotent: pass the Plaid account_id as plaidAccountId so re-syncs update the same account instead of duplicating it. mask is the LAST 4 characters of the account number ONLY — never send full account numbers.",
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        name: z.string().describe("Human-friendly account name, e.g. 'Chase Checking'."),
        accountType: z.enum(FINANCIAL_ACCOUNT_TYPES).describe("Fixed account type."),
        mask: z.string().max(4).describe("Last 4 characters of the account number ONLY. Never full account numbers."),
        institution: z.string().optional().describe("Bank/institution name, e.g. 'Chase'."),
        plaidAccountId: z.string().optional().describe("Plaid account_id for idempotent mapping across syncs."),
      }),
    },
    async (args) =>
      toolResult(
        financialAccountConfirmation(
          await tools.upsertFinancialAccount(stripUndefined(args) as UpsertFinancialAccountInput),
        ),
      ),
  );

  server.registerTool(
    "record_financial_transactions",
    {
      title: "Record financial transactions (bulk)",
      description:
        `Bulk-ingest financial transactions for a tracked account. Financial data from Plaid is ground truth — ingest it directly, never queue it for review. The harness maps Plaid data to the FIXED Conscious Spending Plan taxonomy at ingest time using its judgment (${taxonomySummary}); the type-category pairing is enforced and invalid pairs are rejected. Transfers between the owner's own accounts (tracked or untracked, e.g. business checking or a partner's external account) are txType 'Transfer' with category 'Transfers In' or 'Transfers Out' — never Income or an outgoing bucket — and are automatically excluded from budget totals. Pass Plaid transaction_ids as externalIds for idempotency: an existing externalId updates the stored transaction instead of duplicating it. All amounts are INTEGER CENTS (positive magnitudes; txType determines direction — for Transfer the direction is the category). Returns {inserted, updated, skipped} counts.`,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        accountId: z.string().describe("Financial account ID from upsert_financial_account."),
        source: z
          .enum(TX_SOURCES)
          .optional()
          .describe("Where the transactions came from. Defaults to plaid."),
        transactions: z
          .array(
            z.object({
              date: z.number().describe("Transaction date in epoch milliseconds."),
              amountCents: z
                .number()
                .int()
                .describe("Integer cents (e.g. $12.34 -> 1234). Direction is determined by txType."),
              description: z.string().describe("Merchant/transaction description."),
              txType: z.enum(TX_TYPES).describe("Fixed transaction type."),
              category: z
                .enum(TX_CATEGORIES)
                .describe("Category — must be valid for the txType under the fixed taxonomy."),
              externalId: z
                .string()
                .optional()
                .describe("Plaid transaction_id, used for idempotent dedupe across syncs."),
              monthKey: z
                .string()
                .regex(MONTH_KEY_PATTERN)
                .optional()
                .describe("'YYYY-MM' month bucket. Derived from date (UTC) when omitted."),
            }),
          )
          .min(1)
          .describe("Transactions to ingest."),
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as RecordFinancialTransactionsInput;
      return toolResult(
        financialTransactionsConfirmation(input, await tools.recordFinancialTransactions(input)),
      );
    },
  );

  server.registerTool(
    "record_financial_balances",
    {
      title: "Record daily account balances (bulk)",
      description:
        "Bulk-record end-of-day account balance snapshots, one per day. The harness computes these from the FULL raw Plaid transaction feed walked backward from the /accounts/balance/get current balance — including any feed rows not recorded as budget transactions — so NEVER derive balances by summing recorded budget transactions. Balances are INTEGER CENTS and may be negative. Idempotent upsert: one snapshot per account+day; re-sending a day updates the stored snapshot instead of duplicating it. Returns {inserted, updated} counts.",
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        accountId: z.string().describe("Financial account ID from upsert_financial_account."),
        source: z
          .enum(BALANCE_SOURCES)
          .optional()
          .describe("Where the snapshots came from. Defaults to plaid_derived."),
        balances: z
          .array(
            z.object({
              date: z
                .number()
                .describe("Snapshot day in epoch milliseconds (normalized to UTC midnight server-side)."),
              endOfDayBalanceCents: z
                .number()
                .int()
                .describe("End-of-day balance in integer cents (e.g. $1,234.56 -> 123456). May be negative."),
            }),
          )
          .min(1)
          .describe("End-of-day balance snapshots to record."),
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as RecordFinancialBalancesInput;
      return toolResult(
        financialBalancesConfirmation(input, await tools.recordFinancialBalances(input)),
      );
    },
  );

  server.registerTool(
    "get_financial_report",
    {
      title: "Get monthly financial report",
      description:
        "Read-only monthly report for one account, computed at read time from stored transactions: totals per category and type, outgoing (Fixed Costs+Investments+Savings+Guilt-Free), incoming (Income), net, percentages of outgoing, previous-month deltas, and the applicable budget (month-specific if present, else the default) with per-target deltas. Also includes stored daily balance snapshots plus the month's starting and ending balances (null when no snapshots exist). All amounts are integer cents.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        accountId: z.string().describe("Financial account ID."),
        monthKey: z.string().regex(MONTH_KEY_PATTERN).describe("Month to report on, 'YYYY-MM'."),
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as { accountId: string; monthKey: string };
      return toolResult(financialReportConfirmation(input, await tools.getFinancialReport(input)));
    },
  );

  server.registerTool(
    "add_source_ref",
    {
      title: "Add source reference",
      description:
        "Store reusable lightweight provenance without creating an accepted object. Prefer inline sourceRefs on ingest_object when storing a single source-backed object. Do not store full raw source bodies.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: sourceRefSchema,
    },
    async (args) => toolResult(await tools.addSourceRef(stripUndefined(args) as SourceRefInput)),
  );

  server.registerTool(
    "link_entities",
    {
      title: "Link entities",
      description:
        "Create a relationship between accepted Skippy entities only. Use after entities are accepted and you know their entity IDs; do not link fallback review item IDs. Relationships should be meaningful, sourced where possible, and confidence-rated when inferred.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        from: entityRefSchema.describe("Source accepted entity."),
        to: entityRefSchema.describe("Target accepted entity."),
        type: z.enum(relationshipTypeValues).describe("Relationship type."),
        confidence: z.number().min(0).max(1).optional().describe("Confidence from 0 to 1 for inferred relationships."),
        reason: z.string().optional().describe("Short explanation or source-derived rationale."),
        createdBy: z
          .enum(["user", "harness", "skippy_ai", "system"])
          .describe("Who/what created this relationship. External MCP callers usually use 'harness'."),
      }),
    },
    async (args) => toolResult(await tools.linkEntities(stripUndefined(args) as RelationshipInput)),
  );

  server.registerTool(
    "generate_focus_summary",
    {
      title: "Generate focus summary",
      description:
        "Store a synthesized focus summary for the user-facing dashboard. Use accepted entities and current context; do not invent tasks or entities here. Summary bullets should be actionable next moves only, not standing context, identity facts, relationship assumptions, or permission requests. The user's recently dismissed focus items (returned as recentlyDismissedItems by refresh_focus_summary context) are durable signal: do not generate bullets about those topics unless something materially new happened since the dismissal. When a bullet references an email, include a markdown link to it, e.g. [subject or sender](gmail-url), using the stored sourceRef deepLink or a Gmail link built from its messageId (https://mail.google.com/mail/u/0/#all/{messageId}); never invent URLs. If you discover new important items while summarizing, ingest them separately with sourceRefs and a rubricDecision.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        generatedAt: z.number().describe("Epoch milliseconds when this summary was generated."),
        validUntil: z.number().optional().describe("Optional epoch milliseconds after which this summary should be considered stale."),
        summaryText: z.string().describe("Concise human-facing focus summary containing actionable Now bullets only."),
        topItems: z.array(focusTopItemSchema).describe("Accepted entities that explain the focus summary."),
        sourceRunId: z.string().optional().describe("Optional ingestion/processing run ID that produced the summary."),
        policyVersion: z.string().optional().describe("Optional policy/ranking version used by the harness."),
      }),
    },
    async (args) => toolResult(await tools.generateFocusSummary(stripUndefined(args) as FocusSummary)),
  );

  server.registerTool(
    "list_pending_actions",
    {
      title: "List pending actions",
      description:
        "Read-only list of external actions waiting for approval or execution tracking. Pending actions represent side effects such as sending a message or completing an external reminder; they are separate from accepted knowledge.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        status: z.string().optional().describe("Optional status filter such as pending, approved, rejected, sent, failed, or completed."),
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as { status?: string };
      return toolResult(pendingActionsConfirmation(input, await tools.listPendingActions(input)));
    },
  );

  server.registerTool(
    "record_entity_review",
    {
      title: "Record accepted entity review",
      description:
        "Record a review of an accepted Skippy entity during an existing-knowledge review run. Use for stale checks, changed priority, blockers, follow-ups, or status review. This updates safe fields such as task/project priority and valid status values, attaches source refs as evidence, and records an audit activity.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        entityRef: entityRefSchema.describe("Accepted Skippy entity to review."),
        reviewType: z.enum(entityReviewTypeValues).describe("Kind of review performed."),
        reviewSummary: z.string().describe("Concise audit summary of what changed or what was checked."),
        reviewedBy: z.string().optional().describe("Harness/user identifier for audit logging."),
        status: z.string().optional().describe("Optional new status. Applied only when valid for this entity type."),
        confidence: z.number().min(0).max(1).optional().describe("Optional confidence for this reviewed entity."),
        priorityScore: z.number().min(0).max(1).optional().describe("Optional task/project priority score."),
        urgencyScore: z.number().min(0).max(1).optional().describe("Optional task/project urgency score."),
        importanceScore: z.number().min(0).max(1).optional().describe("Optional task/project importance score."),
        priorityReason: z.string().optional().describe("Short reason for priority/urgency changes."),
        priorityComputedAt: z.number().optional().describe("Epoch milliseconds when priority was computed."),
        priorityPolicyVersion: z.string().optional().describe("Optional review/ranking policy version."),
        sourceRefs: z.array(sourceRefSchema).optional().describe("Evidence source refs discovered during the review."),
        sourceRefIds: z.array(z.string()).optional().describe("Existing source ref IDs to attach as evidence."),
      }),
    },
    async (args) =>
      toolResult(
        await tools.recordEntityReview(
          stripUndefined(args) as Parameters<typeof tools.recordEntityReview>[0],
        ),
      ),
  );

  server.registerTool(
    "mark_task_in_progress",
    {
      title: "Mark task in progress",
      description:
        "Mark an accepted Skippy task as in progress when a harness starts working on it. Use this before doing meaningful work on a task so the project board reflects active work.",
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        taskId: z.string().describe("Accepted task entity ID."),
        startedBy: z.string().optional().describe("Harness/user identifier that started work."),
      }),
    },
    async (args) =>
      toolResult(
        taskInProgressConfirmation(
          await tools.markTaskInProgress(
            stripUndefined(args) as {
              taskId: string;
              startedBy?: string;
            },
          ),
        ),
      ),
  );

  server.registerTool(
    "mark_task_done",
    {
      title: "Mark task done",
      description:
        "Mark an accepted Skippy task as done. Use only when the user explicitly completed the task or instructed the harness to mark it done. If an external reminder must also be completed, include its source ref ID so execution can be tracked separately.",
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        taskId: z.string().describe("Accepted task entity ID."),
        completedBy: z
          .string()
          .optional()
          .describe("Optional harness/user label for chat context. This is not persisted as a Convex user ID."),
        completedByUserId: z.string().optional().describe("Optional Convex user ID to store as the completion actor."),
        externalReminderSourceRefId: z
          .string()
          .optional()
          .describe("Source ref ID for an external reminder/task that should be synced after approval/execution."),
      }),
    },
    async (args) =>
      toolResult(
        taskDoneConfirmation(
          await tools.markTaskDone(
            stripUndefined(args) as {
              taskId: string;
              completedBy?: string;
              completedByUserId?: string;
              externalReminderSourceRefId?: string;
            },
          ),
        ),
      ),
  );

  server.registerTool(
    "record_pending_action_result",
    {
      title: "Record pending action result",
      description:
        "Record the result after an already-approved external action was executed elsewhere. Do not use this to request approval or to perform the external side effect itself.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        pendingActionId: z.string().describe("Pending action ID from list_pending_actions."),
        status: z.enum(["sent", "failed", "completed"]).describe("Execution outcome."),
        executionProvider: z.string().optional().describe("Provider/system that performed the external action."),
        externalMessageId: z.string().optional().describe("External ID returned by the provider, e.g. sent email/message ID."),
        error: z.string().optional().describe("Failure summary when status is failed."),
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as {
        pendingActionId: string;
        status: "sent" | "failed" | "completed";
        executionProvider?: string;
        externalMessageId?: string;
        error?: string;
      };
      return toolResult(pendingActionResultConfirmation(input, await tools.recordPendingActionResult(input)));
    },
  );

  server.registerTool(
    "update_source_sync_status",
    {
      title: "Update source sync status",
      description:
        "Update the live source-ingestion status shown on the Skippy Home NOW area. Call with status=running before reading sources, heartbeat while long work continues, and completed or failed before ending the run.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        statusKey: z.string().optional().describe("Stable key for this status row, e.g. google-and-imessage. Defaults to source-sync."),
        harness: z.string().describe("Harness or automation name, e.g. codex_automation, chatgpt, claude, hermes."),
        status: z.enum(["idle", "running", "completed", "failed"]).describe("Current lifecycle state."),
        message: z.string().optional().describe("Short human-facing status message for the Home NOW area."),
        sourceSystemsChecked: z.array(z.string()).describe("Sources in scope, e.g. gmail, calendar, imessage."),
        startedAt: z.number().optional().describe("Epoch milliseconds when this run started."),
        completedAt: z.number().optional().describe("Epoch milliseconds when this run completed or failed."),
        lastHeartbeatAt: z.number().optional().describe("Epoch milliseconds for long-running heartbeat updates."),
        errors: z.array(z.string()).optional().describe("Short error summaries; avoid secrets or raw source payloads."),
        metadata: z.unknown().optional().describe("Small JSON metadata object for audit/debugging. Avoid secrets and raw source dumps."),
      }),
    },
    async (args) =>
      toolResult(
        await tools.updateSourceSyncStatus(
          stripUndefined(args) as {
            statusKey?: string;
            harness: string;
            status: "idle" | "running" | "completed" | "failed";
            message?: string;
            sourceSystemsChecked: string[];
            startedAt?: number;
            completedAt?: number;
            lastHeartbeatAt?: number;
            errors?: string[];
            metadata?: unknown;
          },
        ),
      ),
  );

  server.registerTool(
    "record_ingestion_run",
    {
      title: "Record ingestion run",
      description:
        "Record metadata about a harness ingestion/review run. Use this around scheduled or batch reads of email, calendar, reminders, messages, or links so the user can audit source coverage and errors.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        harness: z.string().describe("Harness name, e.g. codex, chatgpt, claude, hermes, or scheduled_worker."),
        status: z.enum(["running", "completed", "failed"]).describe("Run lifecycle status."),
        sourceSystemsChecked: z.array(z.string()).describe("Sources checked, e.g. gmail, calendar, apple_reminders."),
        startedAt: z.number().optional().describe("Epoch milliseconds when the run started."),
        completedAt: z.number().optional().describe("Epoch milliseconds when the run completed."),
        candidatesSubmitted: z.number().optional().describe("Legacy count of fallback review items submitted."),
        objectsCreated: z.number().optional().describe("Number of accepted objects created, if known."),
        objectsUpdated: z.number().optional().describe("Number of accepted objects updated, if known."),
        errors: z.array(z.string()).optional().describe("Short error summaries; avoid secrets or raw source payloads."),
        metadata: z.unknown().optional().describe("Small JSON metadata object for audit/debugging. Avoid secrets and raw source dumps."),
      }),
    },
    async (args) =>
      toolResult(
        await tools.recordIngestionRun(
          stripUndefined(args) as {
            harness: string;
            status: "running" | "completed" | "failed";
            sourceSystemsChecked: string[];
            startedAt?: number;
            completedAt?: number;
            candidatesSubmitted?: number;
            objectsCreated?: number;
            objectsUpdated?: number;
            errors?: string[];
            metadata?: unknown;
          },
        ),
      ),
  );

  server.registerTool(
    "dispatch_notifications",
    {
      title: "Dispatch notifications",
      description:
        "Build and send approval-gated browser push notifications for urgent tasks and pending actions. Use dryRun first to preview candidates without sending.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        dryRun: z.boolean().optional().describe("When true, return notification candidates without sending web push messages."),
        limit: z.number().min(1).max(25).optional().describe("Maximum notification candidates to consider."),
      }),
    },
    async (args) =>
      toolResult(
        await tools.dispatchNotifications(
          stripUndefined(args) as {
            dryRun?: boolean;
            limit?: number;
          },
        ),
      ),
  );

  return server;
}
