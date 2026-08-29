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
  type ListProjectFilesInput,
  type ListQuickCapturesInput,
  type MarkQuickCaptureHandledInput,
  type MemoryDetailInput,
  type MemoryKind,
  type MemoryListInput,
  type MemoryReviewBehavior,
  type MemoryReviewCandidateInput,
  type RecordFinancialBalancesInput,
  type RecordFinancialTransactionsInput,
  type RecordMemoryInput,
  type RegisterProjectFileInput,
  type SkippyClient,
  type StartInterviewInput,
  type TasksByStateInput,
  type UpsertFinancialAccountInput,
  type UpsertRecurrenceInput,
} from "./tools.js";
import { resolveAllowedTools } from "./role-policy.js";
import {
  BALANCE_SOURCES,
  CONTRIBUTION_SOURCES,
  FINANCIAL_ACCOUNT_TYPES,
  MONTH_KEY_PATTERN,
  PROJECT_FILE_MAX_BYTES,
  TX_CATEGORIES,
  TX_SOURCES,
  TX_TYPES,
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
  "On a project page, use get_project_plan to understand phases and ordered tasks. Use update_project for the Overview description and links, and update_phase for a phase title or Markdown description when the user asks chat to change them.",
  "Each project also has a freeform plain-text Notes pad (the Notes tab) where the owner dumps unstructured thoughts. When the owner asks to review their notes, call get_project_notes, help fold actionable ideas into the Plan, then — only with the owner's explicit OK — call snapshot_project_notes to preserve the pad and update_project_notes to prune the processed text. Never edit the pad outside an owner-requested review.",
  "Use submit_memory_review_candidate when a possible memory is useful but uncertain. Do not queue transient alerts (balance notifications, promo deadlines, ToS notices); skip them or record directly with expiry context. Use list_memory/get_context_bundle/get_memory_detail before adding likely duplicates or answering from memory, and link_memory to attach memories to accepted entities.",
  "Use list_interview_templates/start_interview/get_interview/answer_interview_question/complete_interview/archive_interview to run guided second-brain interviews inside the harness chat. Ask one question at a time in chat, using the assistantDisplayName returned by Skippy.",
  "During scheduled or batch source-ingestion runs, also drain the Home quick-capture inbox in addition to external sources: call list_quick_captures for pending captures the owner dropped on the home page, turn useful ones into Skippy objects with the ingestion tools (ingest_object etc.), then call mark_quick_capture_handled with 'processed' or 'discarded' for each. Hold-intent captures are private device-to-device transfers: they are never returned by list_quick_captures and must never be ingested.",
  "The life layer covers everything that is not project work. A one-off errand or obligation is a task with no project: set `area` and leave `commitment` as 'must'. Something the owner would simply enjoy — a restaurant to try, a book to read — is a task with `commitment: \"want\"`, not a link and not a note; wants never carry due dates and never go overdue.",
  "Anything that comes around again belongs in upsert_recurrence, not a dated task: completing a task destroys the record of when it was last done, which is usually the fact worth keeping. Use anchor 'completion' when the cadence restarts from when the work is finished (change the furnace filter every 3 months) and anchor 'schedule' for fixed calendar dates that ignore completion (rent on the 1st).",
  "Something with a specific time and place is a calendar event, not a task; a deadline with no appointment is a task with a dueAt. Use list_agenda to see calendar events, due tasks, and firing recurrences merged into one timeline before proposing times or answering what a day looks like. Read the life layer with list_life_tasks and list_recurrences.",
  "When the owner is blocked on a person, set the task to status 'waiting' with waitingOn pointing at them. It clears itself when a reply arrives, so never ask the owner to groom that list.",
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
    "| `/repeat ...` | Record something that comes around again. | `upsert_recurrence` |",
    "| `/agenda` | What is happening and what is due. | `list_agenda` |",
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
    "   - `create_project` / `create_task`: only for explicit user commands. For a task with no project, set `area` and `commitment` (`want` for things the owner would enjoy, so they never nag).",
    "   - `upsert_recurrence`: anything that comes around again. Prefer it over a dated task whenever the thing repeats — completing a task destroys the record of when it was last done.",
    "   - `list_agenda`: what is happening and what is due over a range; use before proposing times.",
    "   - `link_entities` / `link_memory`: only after accepted entity IDs or memory IDs are known.",
    "   - `list_pending_actions`: inspect external side effects awaiting approval. Do not send emails/messages or alter external systems through Skippy.",
    "",
    "## User Slash Commands",
    "",
    "When a user types a command-like message, treat it as shorthand for the matching MCP workflow:",
    "",
    "- `/task ...` -> `create_task`",
    "- `/repeat ...` -> `upsert_recurrence`",
    "- `/agenda` -> `list_agenda`",
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
    "   - During every source-ingestion run, also check the Home quick-capture inbox in addition to external sources: `list_quick_captures` returns pending text/URL/file captures the owner dropped on the home page. Turn useful ones into Skippy objects with `ingest_object` (or the other ingestion tools), then `mark_quick_capture_handled` each as `processed` or `discarded` so the inbox drains itself. Captures the owner flagged as 'hold' are private device-to-device transfers — they are never returned and must never be ingested.",
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
    "## Project Folders",
    "",
    "- Convex projectFiles records are canonical. Runner-provided input/output paths are isolated temporary copies for one run, never durable product locations.",
    "- Read exact selected manifest paths and write deliverables only to the runner-designated output directory; report durable artifact file IDs.",
    "- The project library is cloud-canonical: stable projectFiles records and Convex blobs are authoritative; local copies are disposable.",
    "- Capable runners freeze and hash-verify task inputs before launch. Otherwise use exact project file manifests and verify SHA-256; download URLs are ephemeral.",
    "- Files found only locally are NOT durable: use `begin_project_file_upload` + HTTP POST + `finalize_project_file_upload`; the generate/register pair is legacy compatibility.",
    "- Never write deliverables into the project's code repo unless they ARE the product.",
    "",
    "## Key Tools",
    "",
    "- `get_current_context`: resolve active app route/project.",
    "- `create_task` / `create_project`: explicit user-created items.",
    "- `list_life_tasks` / `list_recurrences` / `list_agenda`: the life layer — project-less tasks, repeating obligations, and the merged timeline.",
    "- `upsert_recurrence` / `complete_recurrence`: manage and log repeating obligations.",
    "- `plan_project`: decompose accepted projects.",
    "- `brief_task`: write a repo-grounded execution brief plus acceptance criteria for a proposed task and move it to Briefed.",
    "- `list_ready_tasks` / `list_requested_ready_tasks`: find executable work.",
    "- `list_tasks_by_state`: see tasks in any one execution state (in_progress, in_review, blocked, briefed, ...).",
    "- `get_task_brief`: get the handoff brief.",
    "- `record_task_result`: report PR/artifact/result for review.",
    "- `get_skill`: load canonical Skippy-hosted skills by slug.",
    "- `get_importance_rubric`, `ingest_object`, `record_memory`, `capture_thought`: capture useful second-brain context.",
    ...details,
    ...detailed,
  ].join("\n");
}

// Field names are the documentation here: every .describe() below is serialized
// into the tools/list payload of dozens of tools, so keep only non-obvious
// semantics (docs/token-efficiency.md, Stage 2).
const sourceRefSchema = z.object({
  sourceSystem: z.string().describe("Origin system, e.g. gmail, calendar, imessage, manual_conversation."),
  externalId: z.string().optional(),
  threadId: z.string().optional(),
  messageId: z.string().optional(),
  eventId: z.string().optional(),
  reminderId: z.string().optional(),
  sourceTimestamp: z.number().optional().describe("Epoch ms."),
  participants: z.array(z.string()).optional(),
  url: z.string().optional(),
  deepLink: z.string().optional(),
  excerpt: z.string().optional().describe("Short excerpt only; never full raw source text."),
  summary: z.string().optional(),
});

const entityRefSchema = z.object({
  entityType: z.enum(entityTypeValues),
  entityId: z.string().describe("Accepted entity ID, not a review item ID."),
});

const memoryKindSchema = z
  .enum(memoryKindValues)
  .describe("memory = durable fact/preference, decision = choice made, principle = operating rule.");

const interviewKindSchema = z.enum(interviewKindValues);

const interviewMemoryKindSchema = z
  .enum(interviewMemoryKindValues)
  .describe("Interview-created memories always go to review.");

const memoryReviewBehaviorSchema = z
  .enum(memoryReviewBehaviorValues)
  .describe("accept = direct write, submit_for_review = queue for user review, auto = backend policy.");

const memoryEvidenceSchema = {
  captureReason: z.string().optional(),
  rubricDecision: z.string().optional().describe("How this clears the memory rubric (see memory-rubric skill)."),
  confidence: z.number().min(0).max(1).optional(),
  reviewBehavior: memoryReviewBehaviorSchema.optional(),
  sourceRefs: z.array(sourceRefSchema).optional(),
  sourceRefIds: z.array(z.string()).optional(),
  relatedEntityRefs: z.array(entityRefSchema).optional(),
  createdBy: z.string().optional(),
  metadata: z.unknown().optional().describe("Small JSON object; no secrets or raw dumps."),
};

const focusTopItemSchema = z.object({
  entityRef: entityRefSchema,
  reason: z.string().describe("Why this item matters now."),
  priorityScore: z.number().optional(),
  urgencyScore: z.number().optional(),
  importanceScore: z.number().optional(),
});

const jsonObjectSchema = z
  .record(z.string(), z.unknown())
  .describe("Plain JSON object with concise typed fields, e.g. title, summary, status, dueDate, url, email.");

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
    phaseId: resultRecord.phaseId,
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

function taskCancelledConfirmation(input: { taskId: string }, result: unknown) {
  const resultRecord = objectResult(result);
  return {
    status: "cancelled",
    entityType: "task",
    taskId: resultRecord.taskId ?? input.taskId,
    title: resultRecord.title,
    executionState: resultRecord.executionState ?? "cancelled",
    reviewUrl: reviewUrl("/projects"),
    nextAction:
      "The task is abandoned: it leaves the board columns and no longer counts toward project progress. The owner can restore it from the Abandoned section in Skippy.",
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

function projectFileUploadUrlConfirmation(result: unknown) {
  return {
    status: "upload_url_generated",
    entityType: "project_file",
    uploadUrl: typeof result === "string" ? result : undefined,
    nextAction:
      "HTTP POST the raw file bytes to uploadUrl with the file's Content-Type header. The response JSON contains {storageId}; pass it to register_project_file. The URL is short-lived and single-use.",
  };
}

function projectFileRegisteredConfirmation(input: RegisterProjectFileInput, result: unknown) {
  const resultRecord = objectResult(result);
  return {
    status: "registered",
    entityType: "project_file",
    fileId: resultRecord.fileId,
    projectId: resultRecord.projectId ?? input.projectId,
    taskId: resultRecord.taskId ?? input.taskId,
    fileName: resultRecord.fileName ?? input.fileName,
    mimeType: resultRecord.mimeType ?? input.mimeType,
    sizeBytes: resultRecord.sizeBytes ?? input.sizeBytes,
    uploadedBy: resultRecord.uploadedBy ?? "harness",
    reviewUrl: reviewUrl("/projects"),
  };
}

function projectFilesListConfirmation(input: ListProjectFilesInput, result: unknown) {
  const rows = Array.isArray(result) ? result : [];
  const files = rows.map((row) => {
    const record = objectResult(row);
    return {
      fileId: record._id,
      fileName: record.fileName,
      sizeBytes: record.sizeBytes,
      mimeType: record.mimeType,
      taskId: record.taskId,
      note: record.note,
      uploadedBy: record.uploadedBy,
      downloadUrl: record.url,
    };
  });
  return {
    status: "listed",
    entityType: "project_file",
    projectId: input.projectId,
    taskId: input.taskId,
    count: files.length,
    files,
    nextAction:
      "Download URLs are ephemeral — download promptly. Materialize the files you need into the project's effectiveAssetsPath (_library) before working, skipping files already present with a matching size.",
  };
}

function quickCapturesListConfirmation(input: ListQuickCapturesInput, result: unknown) {
  const rows = Array.isArray(result) ? result : [];
  const captures = rows.map((row) => {
    const record = objectResult(row);
    return {
      captureId: record._id,
      text: record.text,
      url: record.url,
      fileName: record.fileName,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      status: record.status,
      capturedBy: record.capturedBy,
      createdAt: record.createdAt,
      processingNote: record.processingNote,
      fileUrl: record.fileUrl,
    };
  });
  return {
    status: "listed",
    entityType: "quick_capture",
    requestedStatus: input.status ?? "pending",
    count: captures.length,
    captures,
    nextAction:
      "For each pending capture, apply the importance rubric: create Skippy objects with ingest_object (or record_memory etc.), then call mark_quick_capture_handled with 'processed' — or 'discarded' when nothing is worth storing. File download URLs are ephemeral — fetch promptly.",
  };
}

function quickCaptureHandledConfirmation(input: MarkQuickCaptureHandledInput, result: unknown) {
  const resultRecord = objectResult(result);
  return {
    status: resultRecord.status ?? input.outcome,
    entityType: "quick_capture",
    captureId: resultRecord.captureId ?? input.captureId,
    outcome: input.outcome,
    processingNote: input.processingNote,
    reviewUrl: reviewUrl("/"),
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

export type CreateMcpServerOptions = {
  /**
   * Agent-role scope from the authenticated token (docs/agents.md). When set,
   * only the role's allowlisted tools are registered on this connection;
   * everything else is invisible and uncallable. Undefined = full access.
   */
  role?: string;
};

export function createMcpServer(
  client: SkippyClient,
  brainInstanceId: string,
  options?: CreateMcpServerOptions,
) {
  const server = new McpServer(
    {
      name: "skippy",
      version: "0.1.0",
    },
    {
      instructions: skippyInstructions,
    },
  );

  const allowedTools = resolveAllowedTools(options?.role);
  if (allowedTools) {
    const registerToolUnrestricted = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
    (server as unknown as { registerTool: (name: string, ...rest: unknown[]) => unknown }).registerTool = (
      name: string,
      ...rest: unknown[]
    ) => {
      if (!allowedTools.has(name)) {
        return undefined;
      }
      return registerToolUnrestricted(name, ...rest);
    };
  }

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
    "skippy_agenda_ingestion",
    "skippy://skills/agenda-ingestion",
    {
      title: "Skippy agenda ingestion skill",
      description: "The Agenda Agent's role skill: rubric-driven source ingestion with provenance and focus refresh.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: skillText(await tools.getSkill({ slug: "agenda-ingestion" }), buildSkillsMessage()),
        },
      ],
    }),
  );

  server.registerResource(
    "skippy_project_manager",
    "skippy://skills/project-manager",
    {
      title: "Skippy project manager skill",
      description:
        "The Project Manager Agent's role skill: per-project result reviews, grounded briefs, flags, and digests.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: skillText(await tools.getSkill({ slug: "project-manager" }), buildSkillsMessage()),
        },
      ],
    }),
  );

  server.registerResource(
    "skippy_finance_sync",
    "skippy://skills/finance-sync",
    {
      title: "Skippy finance sync skill",
      description: "The Financial Agent's role skill: Plaid sync into Skippy under the fixed CSP taxonomy.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: skillText(await tools.getSkill({ slug: "finance-sync" }), buildSkillsMessage()),
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
    "skippy_agenda_ingestion",
    {
      title: "Load Skippy Agenda Ingestion",
      description:
        "The Agenda Agent's role skill for scheduled ingestion runs: read sources and quick captures under the importance rubric, ingest with provenance, and refresh the focus summary.",
    },
    async () => ({
      description: "Teach the connected harness how to run a Skippy Agenda Agent ingestion pass.",
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: skillText(await tools.getSkill({ slug: "agenda-ingestion" }), buildSkillsMessage()),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "skippy_project_manager",
    {
      title: "Load Skippy Project Manager",
      description:
        "The Project Manager Agent's role skill, parameterized by projectId: review task results, brief proposed tasks against the repo, flag blocked/stale work, and record an owner-facing digest.",
      argsSchema: {
        projectId: z.string().optional().describe("Accepted project ID this PM pass should operate on."),
      },
    },
    async (args) => ({
      description: "Teach the connected harness how to run a Skippy Project Manager Agent pass.",
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: [
              skillText(await tools.getSkill({ slug: "project-manager" }), buildSkillsMessage()),
              ...(args.projectId ? [``, `Run this PM pass for projectId: ${args.projectId}`] : []),
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "skippy_finance_sync",
    {
      title: "Load Skippy Finance Sync",
      description:
        "The Financial Agent's role skill for scheduled Plaid sync runs: idempotent account upserts, CSP taxonomy mapping with transfer and off-ledger 401k rules, and end-of-day balance snapshots.",
    },
    async () => ({
      description: "Teach the connected harness how to run a Skippy Financial Agent sync pass.",
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: skillText(await tools.getSkill({ slug: "finance-sync" }), buildSkillsMessage()),
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
        "Read a Skippy-hosted harness skill by slug for canonical long-form guidance, e.g. task-heartbeat, memory-rubric, finance-taxonomy, file-upload, recurrence-semantics.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        slug: z.string(),
      }),
    },
    async (args) => toolResult(await tools.getSkill(stripUndefined(args) as { slug: string })),
  );

  server.registerTool(
    "capture",
    {
      title: "Capture free-form knowledge",
      description:
        "Quick free-form capture: creates an accepted note directly. Prefer ingest_object when you can extract a typed object.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        text: z.string().describe("Concise capture; never full raw source bodies."),
        sourceRef: sourceRefSchema.optional(),
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
        "Capture an explicit user thought as second-brain memory (durable preferences, reflections, decisions-in-progress). reviewBehavior chooses direct write versus review; see the memory-rubric skill.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        text: z.string().describe("Concise thought; never full raw source text."),
        content: z.string().optional().describe("Normalized memory content when different from text."),
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
        "Write a durable second-brain memory (stable preferences, personal facts, recurring context) when you can explain why it belongs — see the memory-rubric skill. Use record_decision/record_principle for those kinds.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        content: z.string(),
        kind: memoryKindSchema.optional(),
        title: z.string().optional(),
        summary: z.string().optional(),
        ...memoryEvidenceSchema,
        rubricDecision: z.string().describe("Why this clears the memory rubric; required for direct writes."),
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
        "Write a durable decision memory when the user or a source clearly establishes a choice, commitment, or tradeoff worth remembering.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        content: z.string().describe("The decision, phrased concisely."),
        title: z.string().optional(),
        summary: z.string().optional(),
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
        "Write a durable operating principle or preference — stable guidance for how Skippy or harnesses should behave, not one-off observations.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        content: z.string().describe("The principle or durable preference."),
        title: z.string().optional(),
        summary: z.string().optional(),
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
        "Queue a possible memory for user review when unsure it should be stored directly; prefer record_memory/record_decision/record_principle when it clearly clears the rubric. Never queue transient alerts — see the memory-rubric skill.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        content: z.string(),
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
        "Read-only memory search/list. Check for existing memories before answering from memory or adding duplicates.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        query: z.string().optional(),
        memoryType: memoryKindSchema.optional(),
        kinds: z.array(memoryKindSchema).optional(),
        relatedEntityRefs: z.array(entityRefSchema).optional(),
        includeArchived: z.boolean().optional(),
        limit: z.number().min(1).max(50).optional().describe("Default 20."),
      }),
    },
    async (args) => toolResult(await tools.listMemory(stripUndefined(args) as MemoryListInput)),
  );

  server.registerTool(
    "get_memory_detail",
    {
      title: "Get memory detail",
      description:
        "Read-only memory detail: provenance, related entities, and full stored content for one memory.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        memoryId: z.string(),
        includeSourceRefs: z.boolean().optional(),
        includeRelatedEntities: z.boolean().optional(),
      }),
    },
    async (args) => toolResult(await tools.getMemoryDetail(stripUndefined(args) as MemoryDetailInput)),
  );

  server.registerTool(
    "get_context_bundle",
    {
      title: "Get context bundle",
      description:
        "Read-only context bundle: scored memories, source refs, and related entity context for a query and/or entity refs.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        query: z.string().optional(),
        memoryType: memoryKindSchema.optional(),
        kinds: z.array(memoryKindSchema).optional(),
        relatedEntityRefs: z.array(entityRefSchema).optional(),
        includeArchived: z.boolean().optional(),
        memoryLimit: z.number().min(1).max(25).optional().describe("Default 8."),
        entityLimit: z.number().min(1).max(40).optional().describe("Default 12."),
        sourceLimit: z.number().min(1).max(40).optional().describe("Default 12."),
      }),
    },
    async (args) => toolResult(await tools.getContextBundle(stripUndefined(args) as ContextBundleInput)),
  );

  server.registerTool(
    "link_memory",
    {
      title: "Link memory",
      description:
        "Attach an existing memory to an accepted Skippy entity. Requires a known memory ID and accepted entity ref.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        memoryId: z.string(),
        entityRef: entityRefSchema,
        relationshipType: z.string().optional().describe("Defaults to related_to."),
        reason: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
        sourceRefs: z.array(sourceRefSchema).optional(),
        sourceRefIds: z.array(z.string()).optional(),
        createdBy: z.string().optional(),
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
        "Read the guided interview templates and assistantDisplayName. Call before offering an interview in chat.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => toolResult(withAbsoluteReviewUrl(await tools.listInterviewTemplates())),
  );

  server.registerTool(
    "list_interviews",
    {
      title: "List interviews",
      description:
        "Read active and recent guided interviews. Resume an existing interview before starting a duplicate.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        recentLimit: z.number().min(1).max(50).optional().describe("Default 12."),
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
        "Start a guided second-brain interview, conducted one question at a time in the harness chat.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        kind: interviewKindSchema,
        title: z.string().optional(),
        subjectLabel: z.string().optional().describe("Project, goal, person, or decision label the interview is about."),
        subjectEntityRef: entityRefSchema.optional(),
        startedBy: z.string().optional(),
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
        "Read an interview's current question, prior responses, and progress. Use to resume a chat interview.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        interviewId: z.string(),
      }),
    },
    async (args) => toolResult(withAbsoluteReviewUrl(await tools.getInterview(stripUndefined(args) as GetInterviewInput))),
  );

  server.registerTool(
    "answer_interview_question",
    {
      title: "Answer interview question",
      description:
        "Save the user's answer to the current interview question and return the next question to ask in chat. Set createMemoryCandidate only when the user explicitly wants the answer sent to Memory Inbox.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        interviewId: z.string(),
        answerText: z.string(),
        answerValue: z.unknown().optional().describe("Optional structured representation of the answer."),
        createMemoryCandidate: z.boolean().optional(),
        memoryType: interviewMemoryKindSchema.optional(),
        answeredBy: z.string().optional(),
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
        "Complete a guided interview after its questions are answered. Optionally submit a summary memory candidate when the user explicitly wants the distilled interview retained.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        interviewId: z.string(),
        summary: z.string().optional(),
        createSummaryMemoryCandidate: z.boolean().optional(),
        memoryType: interviewMemoryKindSchema.optional(),
        completedBy: z.string().optional(),
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
        "Archive a guided interview the user cancels, abandons, or no longer wants active.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        interviewId: z.string(),
        archiveReason: z.string().optional(),
        archivedBy: z.string().optional(),
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
        "Read-only retrieval of structured context already stored in Skippy. Internal synthesis may be disabled, so expect structured context rather than a polished answer.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        query: z.string().describe("Natural-language question or context request."),
      }),
    },
    async (args) => toolResult(await tools.ask(args)),
  );

  server.registerTool(
    "summarize_focus",
    {
      title: "Summarize focus",
      description:
        "Read-only latest stored focus summary. Check before generating a new one or answering focus questions.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => toolResult(await tools.summarizeFocus()),
  );

  server.registerTool(
    "get_importance_rubric",
    {
      title: "Get importance rubric",
      description:
        "Read the user's effective importance rubric (policy text plus live goals/projects/favorited contacts). Use before source ingestion; read renderedText for the full guidance.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => toolResult(await tools.getImportanceRubric()),
  );

  server.registerTool(
    "refresh_focus_summary",
    {
      title: "Refresh focus summary",
      description:
        "Generate and store a fresh focus summary from accepted entities using the internal AI provider. The Now list holds actionable next moves only — standing context stays in memory.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        generatedAt: z.number().optional().describe("Epoch ms; defaults to now."),
        validUntil: z.number().optional().describe("Epoch ms after which the summary is stale."),
        policyVersion: z.string().optional(),
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
        "Primary write for source-derived knowledge that clears the importance rubric: creates an accepted Skippy object directly, with sourceRefs and a concise rubricDecision. Links default to status 'saved'; pass 'unread' only for explicit read-later intent, and use submit_candidate_object when genuinely uncertain.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        candidateEntityType: z.enum(entityTypeValues),
        candidatePayload: jsonObjectSchema.describe(
          "Structured fields, e.g. task {title,status,dueDate}; person {name,email}; link {title,url,summary}; note {title,body}.",
        ),
        rubricDecision: z
          .string()
          .describe("Why this clears the importance rubric: deadline, money, relationship, commitment, focus, security, etc."),
        confidence: z.number().min(0).max(1).optional(),
        reviewReason: z.string().optional(),
        sourceRefs: z.array(sourceRefSchema).optional(),
        sourceRefIds: z.array(z.string()).optional(),
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
        "Review-queue fallback for source-derived knowledge when unsure it clears the importance rubric. Prefer ingest_object for clearly important items.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        candidateEntityType: z.enum(entityTypeValues),
        candidatePayload: jsonObjectSchema,
        confidence: z.number().min(0).max(1).optional(),
        reviewReason: z.string().optional().describe("Why the user should review this candidate."),
        sourceRefs: z.array(sourceRefSchema).optional(),
        sourceRefIds: z.array(z.string()).optional(),
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
        "Create an accepted project when the user explicitly asks for one. For source-derived project knowledge, prefer ingest_object.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        title: z.string(),
        summary: z.string().optional(),
        status: z
          .enum(["idea", "planned", "in_progress", "paused", "completed", "cancelled", "archived"])
          .optional()
          .describe("Defaults to planned."),
        priorityReason: z.string().optional(),
        createdBy: z.string().optional(),
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
        "Create an accepted task when the user explicitly asks for one; optionally place it in a project Plan phase via projectId/phaseId (omit phaseId to default into the last phase). For source-derived tasks, prefer ingest_object.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        title: z.string(),
        description: z.string().optional(),
        status: z
          .enum(["todo", "in_progress", "waiting", "done", "cancelled"])
          .optional()
          .describe("Defaults to todo."),
        ownerType: z
          .enum(["owner", "agent"])
          .optional()
          .describe("owner = user-owned work; agent = the harness should work it."),
        kind: z
          .enum(["coding", "review", "research", "design", "manual", "planning"])
          .optional(),
        dueAt: z.number().optional().describe("Epoch ms."),
        priorityReason: z.string().optional(),
        projectId: z.string().optional(),
        phaseId: z.string().optional().describe("Phase ID from get_project_plan; requires projectId."),
        createdBy: z.string().optional(),
        area: z
          .enum(["work", "personal", "household", "health", "finance", "social", "errand"])
          .optional()
          .describe("Which part of life this belongs to (kind is how it gets executed)."),
        commitment: z
          .enum(["must", "want"])
          .optional()
          .describe("must (default) = obligation that can nag; want = enjoyable, browsable, never overdue."),
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

  /* ---------------- Life layer ---------------- */

  server.registerTool(
    "upsert_recurrence",
    {
      title: "Create or update a repeating obligation",
      description:
        "Record something that comes around again (furnace filter, rent, renewals) instead of a dated task — completing a task destroys the record of when it was last done. Anchor 'completion' counts from when the work is finished; 'schedule' is a fixed calendar date. See the recurrence-semantics skill for anchor and RRULE details.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        recurrenceId: z.string().optional().describe("Existing recurrence ID to update."),
        title: z.string(),
        description: z.string().optional(),
        area: z
          .enum(["work", "personal", "household", "health", "finance", "social", "errand"])
          .optional(),
        rule: z
          .union([
            z.object({ kind: z.literal("interval"), everyDays: z.number().int().min(1) }),
            z.object({ kind: z.literal("calendar"), rrule: z.string() }),
          ])
          .describe("Every-N-days interval or an RRULE calendar rule (supported subset; see recurrence-semantics skill)."),
        anchor: z
          .enum(["completion", "schedule"])
          .describe("completion = counted from when finished; schedule = fixed date regardless of completion."),
        startAt: z.number().optional().describe("First due date, epoch ms."),
        leadTimeDays: z.number().optional().describe("Surface this many days early."),
        spawnTask: z
          .boolean()
          .optional()
          .describe("true (default) materializes a task when due; false keeps it agenda-only (e.g. trash night)."),
        timeZone: z.string().optional().describe("IANA zone."),
      }),
    },
    async (args) => toolResult(await tools.upsertRecurrence(stripUndefined(args) as UpsertRecurrenceInput)),
  );

  server.registerTool(
    "complete_recurrence",
    {
      title: "Log a completion of a repeating obligation",
      description:
        "Record that a recurring obligation was done, advancing its schedule. Pass completedAt to backdate — for completion-anchored recurrences it determines the next due date.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        recurrenceId: z.string(),
        completedAt: z.number().optional().describe("Epoch ms; defaults to now, earlier to backdate."),
        note: z.string().optional(),
      }),
    },
    async (args) => toolResult(await tools.completeRecurrence(stripUndefined(args) as any)),
  );

  server.registerTool(
    "list_recurrences",
    {
      title: "List repeating obligations",
      description:
        "Read-only. Active/paused recurrences with cadence, last-done, and next-due. dueOnly returns just what has surfaced.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({ dueOnly: z.boolean().optional() }),
    },
    async (args) => toolResult(await tools.listRecurrences(stripUndefined(args) as any)),
  );

  server.registerTool(
    "list_agenda",
    {
      title: "List what is happening and what is due",
      description:
        "Read-only. Calendar events, due tasks, and firing recurrences merged chronologically over a range — how to answer 'what does my day look like'. A recurrence that already spawned a task appears once, as the task.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        from: z.number().describe("Range start, epoch ms."),
        to: z.number().describe("Range end, epoch ms."),
        includeProjectTasks: z.boolean().optional().describe("Off by default: the agenda is about the day, not the roadmap."),
      }),
    },
    async (args) => toolResult(await tools.listAgenda(stripUndefined(args) as any)),
  );

  server.registerTool(
    "list_life_tasks",
    {
      title: "List tasks that belong to no project",
      description:
        "Read-only. Open life tasks — errands, obligations, and wants — optionally filtered by commitment or area.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        commitment: z.enum(["must", "want"]).optional(),
        area: z
          .enum(["work", "personal", "household", "health", "finance", "social", "errand"])
          .optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    },
    async (args) => toolResult(await tools.listLifeTasks(stripUndefined(args) as any)),
  );

  server.registerTool(
    "get_current_context",
    {
      title: "Get the user's current app context",
      description:
        "Read-only. Returns the page currently open in the Skippy web app (activeRoute, plus activeProject with paths on /projects/<id> pages). Use to resolve 'this project' / 'this page'; null if nothing has been opened.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({}),
    },
    async () => toolResult(await tools.getCurrentContext()),
  );

  server.registerTool(
    "get_project_plan",
    {
      title: "Get a project's overview and ordered plan",
      description:
        "Read-only. Project Overview, ordered phases and tasks, progress, and featured next-task ordering. Call get_current_context first when the user says 'this project'.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({ projectId: z.string() }),
    },
    async (args) => toolResult(await tools.getProjectPlan({ projectId: args.projectId })),
  );

  server.registerTool(
    "update_project",
    {
      title: "Update a project's Overview",
      description:
        "Update a project's Overview name, description, or links. Omit fields to keep them; empty string clears an optional field.",
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        projectId: z.string(),
        title: z.string().optional(),
        summary: z.string().optional(),
        repoUrl: z.string().optional(),
        vercelUrl: z.string().optional(),
        liveUrl: z.string().optional(),
      }),
    },
    async (args) =>
      toolResult(
        await tools.updateProject(
          stripUndefined(args) as Parameters<typeof tools.updateProject>[0],
        ),
      ),
  );

  server.registerTool(
    "update_phase",
    {
      title: "Update a project phase",
      description:
        "Update a phase title or Markdown description (get phase IDs from get_project_plan). Omit fields to keep them.",
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        phaseId: z.string(),
        title: z.string().optional(),
        descriptionMd: z.string().optional(),
      }),
    },
    async (args) =>
      toolResult(
        await tools.updatePhase(
          stripUndefined(args) as Parameters<typeof tools.updatePhase>[0],
        ),
      ),
  );

  server.registerTool(
    "get_project_notes",
    {
      title: "Read a project's Notes pad",
      description:
        "Read-only. The project's freeform plain-text Notes pad. Use when the owner asks to review notes: read the pad, then fold actionable ideas into the Plan together in chat.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({ projectId: z.string() }),
    },
    async (args) => toolResult(await tools.getProjectNotes(stripUndefined(args) as { projectId: string })),
  );

  server.registerTool(
    "update_project_notes",
    {
      title: "Overwrite a project's Notes pad",
      description:
        "Replace the project's Notes pad with new FULL plain text (last-write-wins; empty string clears it). Only edit at the close of an owner-requested notes review, after snapshot_project_notes has preserved the current pad.",
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        projectId: z.string(),
        notesPad: z.string().describe("Full replacement pad text."),
      }),
    },
    async (args) =>
      toolResult(
        await tools.updateProjectNotes(
          stripUndefined(args) as Parameters<typeof tools.updateProjectNotes>[0],
        ),
      ),
  );

  server.registerTool(
    "snapshot_project_notes",
    {
      title: "Snapshot a project's Notes pad",
      description:
        "Preserve the currently stored Notes pad as a timestamped snapshot. Use with the owner's OK at the close of a notes review: snapshot first, then update_project_notes to prune the live pad.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        projectId: z.string(),
        summary: z.string().optional().describe("One-line review summary."),
      }),
    },
    async (args) =>
      toolResult(
        await tools.snapshotProjectNotes(
          stripUndefined(args) as Parameters<typeof tools.snapshotProjectNotes>[0],
        ),
      ),
  );

  server.registerTool(
    "create_phase",
    {
      title: "Create a project Plan phase",
      description:
        "Add a new phase to a project's Plan, appended after existing phases. Follow with create_task using the returned phaseId to place tasks in it.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        projectId: z.string(),
        title: z.string(),
        descriptionMd: z.string().optional(),
      }),
    },
    async (args) =>
      toolResult(
        await tools.createPhase(
          stripUndefined(args) as Parameters<typeof tools.createPhase>[0],
        ),
      ),
  );

  server.registerTool(
    "set_task_phase",
    {
      title: "Place a task in a Plan phase",
      description:
        "Assign or move a project task into a Plan phase, appended after the phase's current tasks. Get phase IDs from get_project_plan; the phase must belong to the task's project.",
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        taskId: z.string(),
        phaseId: z.string(),
      }),
    },
    async (args) =>
      toolResult(
        await tools.setTaskPhase(
          stripUndefined(args) as Parameters<typeof tools.setTaskPhase>[0],
        ),
      ),
  );

  server.registerTool(
    "plan_project",
    {
      title: "Plan a project into tasks",
      description:
        "Use Skippy's AI planner to decompose a project into ordered executable tasks with briefs, acceptance criteria, and dependencies. Re-running adds a fresh plan version.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        projectId: z.string(),
        maxTasks: z.number().int().min(1).max(12).optional().describe("Default 10."),
      }),
    },
    async (args) => toolResult(await tools.planProject(stripUndefined(args) as { projectId: string; maxTasks?: number })),
  );

  server.registerTool(
    "list_ready_tasks",
    {
      title: "List ready-to-execute tasks",
      description:
        "Read-only, dependency-aware queue of agent-owned tasks whose dependencies are all complete — what a coding agent should pick up next, with briefs and acceptance criteria.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional().describe("Default 12."),
      }),
    },
    async (args) => toolResult(await tools.listReadyTasks(stripUndefined(args) as { limit?: number })),
  );

  server.registerTool(
    "list_requested_ready_tasks",
    {
      title: "List requested ready agent tasks",
      description:
        "Read-only queue of Ready, agent-owned tasks the user explicitly requested an agent to execute — the safest queue for heartbeat runs to poll.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional().describe("Default 12."),
      }),
    },
    async (args) => toolResult(await tools.listRequestedReadyTasks(stripUndefined(args) as { limit?: number })),
  );

  server.registerTool(
    "list_tasks_by_state",
    {
      title: "List tasks in a given execution state",
      description:
        "Read-only. Tasks sitting in one stored execution state, optionally narrowed by project, owner type, or agent-request status. Reports stored state without re-checking dependencies — use list_ready_tasks when picking up new work.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        executionState: z.enum([
          "proposed",
          "unplanned",
          "briefed",
          "ready",
          "in_progress",
          "in_review",
          "blocked",
          "done",
          "cancelled",
        ]),
        ownerType: z.enum(["owner", "agent"]).optional(),
        projectId: z.string().optional(),
        agentRequestStatus: z.enum(["requested", "cancelled"]).optional(),
        limit: z.number().int().min(1).max(200).optional().describe("Default 25."),
      }),
    },
    async (args) => toolResult(await tools.listTasksByState(stripUndefined(args) as TasksByStateInput)),
  );

  server.registerTool(
    "get_task_brief",
    {
      title: "Get a task's execution brief",
      description:
        "Read-only. The hand-off brief for one task: description, execution brief, acceptance criteria, owning project (with effectiveAssetsPath for inputs and effectiveOutputPath for deliverables), and dependency status. Never write deliverables into the code repo unless they ARE the product.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        taskId: z.string(),
      }),
    },
    async (args) => toolResult(await tools.getTaskBrief(stripUndefined(args) as { taskId: string })),
  );

  server.registerTool(
    "brief_task",
    {
      title: "Brief a proposed task",
      description:
        "Write an execution brief for a proposed task and move it to 'briefed'. Ground the brief in the actual repo (concrete files, patterns, verification steps); briefed tasks wait for the owner to promote them to Ready.",
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        taskId: z.string(),
        executionBrief: z
          .string()
          .describe("Self-contained: approach, key files, steps, verification."),
        acceptanceCriteria: z.array(z.string()),
        title: z.string().optional(),
        description: z.string().optional(),
        kind: z.enum(["coding", "review", "research", "design", "manual", "planning"]).optional(),
        phaseId: z.string().optional().describe("Plan phase to place the task in; must belong to the task's project."),
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
        "Report an executed task's outcome (summary and/or PR/commit URL). By default the task moves to 'in_review' for owner approval; markDone completes it and unblocks dependents.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        taskId: z.string(),
        resultSummary: z.string().optional(),
        resultUrl: z.string().optional().describe("PR, commit, or artifact URL."),
        gitBranchName: z.string().optional(),
        prUrl: z.string().optional(),
        prNumber: z.number().optional(),
        prStatus: z.enum(["open", "merged", "closed"]).optional(),
        markDone: z.boolean().optional().describe("Mark done immediately instead of leaving for owner review."),
        artifactFileIds: z.array(z.string()).optional().describe("Ready generated-artifact projectFiles IDs."),
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
            artifactFileIds?: string[];
          },
        ),
      ),
  );

  server.registerTool(
    "cancel_task",
    {
      title: "Abandon a task",
      description:
        "Abandon a not-yet-executed task, ONLY when the owner explicitly asks. Executed states (in_progress/in_review/done) are rejected server-side — record their result instead; restoring is owner-only in the app.",
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        taskId: z.string(),
        reason: z.string().optional(),
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as { taskId: string; reason?: string };
      return toolResult(taskCancelledConfirmation(input, await tools.cancelTask(input)));
    },
  );

  server.registerTool(
    "list_project_files",
    {
      title: "List project library files",
      description:
        "Read-only. Cloud-canonical project library files (optionally scoped to one task) with metadata and ephemeral downloadUrls — download promptly. See the file-upload skill for the materialize/register workflow.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        projectId: z.string(),
        taskId: z.string().optional(),
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as ListProjectFilesInput;
      return toolResult(projectFilesListConfirmation(input, await tools.listProjectFiles(input)));
    },
  );

  server.registerTool("get_project_file_manifest", {
    title: "Get exact project file manifest", description: "Return exact ready projectFiles records with fresh ephemeral URLs, hashes, sizes, MIME types, and required semantics. Convex records are canonical; any local paths are temporary runner copies.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: z.object({ projectId: z.string(), taskId: z.string().optional() }),
  }, async (args) => toolResult(await tools.listProjectFiles(stripUndefined(args) as ListProjectFilesInput)));

  server.registerTool("get_project_file", {
    title: "Get an exact project file", description: "Resolve one stable projectFiles ID to its immutable metadata and a fresh ephemeral download URL.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, inputSchema: z.object({ fileId: z.string() }),
  }, async (args) => toolResult(await tools.getProjectFile(args as { fileId: string })));

  server.registerTool("begin_project_file_upload", {
    title: "Begin a project file upload", description: "Create a pending canonical file record and return its stable fileId plus a short-lived upload URL. Reuse uploadKey when retrying the same logical upload.",
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: z.object({ projectId: z.string(), taskId: z.string().optional(), runId: z.string().optional(), kind: z.enum(["library_input", "generated_artifact"]), fileName: z.string(), mimeType: z.string(), sizeBytes: z.number().int().positive().max(PROJECT_FILE_MAX_BYTES), required: z.boolean().optional(), note: z.string().optional(), uploadKey: z.string().optional() }),
  }, async (args) => toolResult(await tools.beginProjectFileUpload(stripUndefined(args) as any)));

  server.registerTool("finalize_project_file_upload", {
    title: "Finalize a project file upload", description: "Validate authoritative blob metadata and atomically make a pending file durable and visible. Replay with the same storageId and SHA-256 is idempotent.",
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false }, inputSchema: z.object({ fileId: z.string(), storageId: z.string(), sha256: z.string().regex(/^[a-fA-F0-9]{64}$/) }),
  }, async (args) => toolResult(await tools.finalizeProjectFileUpload(args as any)));

  server.registerTool("abort_project_file_upload", {
    title: "Abort a project file upload", description: "Mark an incomplete upload failed and remove the supplied orphan blob when present.",
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false }, inputSchema: z.object({ fileId: z.string(), storageId: z.string().optional(), reason: z.string().optional() }),
  }, async (args) => toolResult(await tools.abortProjectFileUpload(stripUndefined(args) as any)));

  server.registerTool("list_task_artifacts", {
    title: "List task artifacts", description: "List durable generated artifacts attached to a task. Returned file IDs are stable; URLs are ephemeral.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: z.object({ projectId: z.string(), taskId: z.string() }),
  }, async (args) => { const result: any = await tools.listProjectFiles(args as ListProjectFilesInput); const rows = Array.isArray(result) ? result.filter((f: any) => f.kind === "generated_artifact") : result; return toolResult(rows); });

  server.registerTool(
    "generate_project_file_upload_url",
    {
      title: "Generate a project file upload URL",
      description:
        "Step 1 of the 2-step library upload: returns a short-lived, single-use Convex storage POST URL. POST the raw bytes, then call register_project_file with the returned {storageId}. See the file-upload skill.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        projectId: z.string().optional().describe("Chat context only; the URL is not project-scoped."),
      }),
    },
    async (args) =>
      toolResult(
        projectFileUploadUrlConfirmation(
          await tools.generateProjectFileUploadUrl(stripUndefined(args) as { projectId?: string }),
        ),
      ),
  );

  server.registerTool(
    "register_project_file",
    {
      title: "Register an uploaded project file",
      description:
        "Step 2 of the 2-step library upload: registers bytes already POSTed to the upload URL, using the returned {storageId}. Max 25 MB; executables and arbitrary binaries are rejected. See the file-upload skill for the full flow and allowed types.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        projectId: z.string(),
        taskId: z.string().optional(),
        fileName: z.string(),
        mimeType: z.string(),
        sizeBytes: z.number().int().min(0).describe(`Max ${PROJECT_FILE_MAX_BYTES} (25 MB).`),
        storageId: z.string().describe("Convex storageId from the upload URL response."),
        note: z.string().optional(),
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as RegisterProjectFileInput;
      return toolResult(projectFileRegisteredConfirmation(input, await tools.registerProjectFile(input)));
    },
  );

  server.registerTool(
    "list_quick_captures",
    {
      title: "List quick captures",
      description:
        "Read-only. The owner's Home quick-capture inbox (default status 'pending'). Inspect pending captures during every source-ingestion run, create Skippy objects under the rubric, then call mark_quick_capture_handled. File fileUrls are ephemeral — fetch promptly, never persist.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        status: z.enum(["pending", "processed", "discarded"]).optional().describe("Defaults to pending."),
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as ListQuickCapturesInput;
      return toolResult(quickCapturesListConfirmation(input, await tools.listQuickCaptures(input)));
    },
  );

  server.registerTool(
    "mark_quick_capture_handled",
    {
      title: "Mark a quick capture handled",
      description:
        "Record that a pending quick capture was handled: 'processed' when useful objects were created, 'discarded' when nothing cleared the rubric. Pass relatedEntityRefs for the entities created so the Home digest can deep-link to them; already-handled captures are rejected.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        captureId: z.string(),
        outcome: z.enum(["processed", "discarded"]),
        processingNote: z.string().optional().describe("What was created, or why discarded."),
        relatedEntityRefs: z.array(entityRefSchema).optional().describe("Entities created or updated from this capture."),
        sourceRunId: z.string().optional().describe("Run ID from record_ingestion_run."),
      }),
    },
    async (args) => {
      const input = stripUndefined(args) as MarkQuickCaptureHandledInput;
      return toolResult(quickCaptureHandledConfirmation(input, await tools.markQuickCaptureHandled(input)));
    },
  );

  const upsertDescriptionNotes: Partial<Record<(typeof entityTypeValues)[number], string>> = {
    link: " Link status defaults to 'saved'; pass 'unread' only for explicit read-later intent.",
    task: " Always creates a NEW standalone task — use create_task for project tasks, brief_task/set_task_phase to update existing ones.",
  };

  for (const entityType of entityTypeValues) {
    server.registerTool(
      `upsert_${entityType}`,
      {
        title: `Submit ${entityType}`,
        description: `Convenience direct-write ingestion for a single accepted ${entityType} that clearly clears the importance rubric. Prefer ingest_object when you can include sourceRefs and a rubricDecision.${upsertDescriptionNotes[entityType] ?? ""}`,
        annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
        inputSchema: jsonObjectSchema,
      },
      async (args) => {
        const candidatePayload = stripUndefined(args) as CandidateObjectInput<typeof entityType>["candidatePayload"];
        // upsert_* is ingestion, not mutation: a payload that references an
        // existing record would silently create an unlinked duplicate (this
        // happened with upsert_task + taskId). Fail loudly and point at the
        // update tools instead.
        const updateKeys = ["taskId", "phaseId", "_id", "entityId"].filter(
          (key) => key in (candidatePayload as Record<string, unknown>),
        );
        if (updateKeys.length) {
          throw new Error(
            `upsert_${entityType} creates a new ${entityType} and cannot update an existing record (got ${updateKeys.join(", ")}). ` +
              (entityType === "task"
                ? "Use create_task for new project tasks, brief_task to update a brief, or set_task_phase to place a task in a Plan phase."
                : "Use the matching update tool or ingest_object instead."),
          );
        }
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
        "Update a stored link's lifecycle status ('read' only after actually ingesting its content, 'saved' for reference material, 'discarded' for dead links). Never fake user engagement or clear the reading queue without cause.",
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        linkId: z.string(),
        status: z.enum(["unread", "read", "saved", "discarded"]),
        reason: z.string().optional(),
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

  server.registerTool(
    "upsert_financial_account",
    {
      title: "Upsert financial account",
      description:
        "Create or update a tracked financial account. Pass the Plaid account_id as plaidAccountId so re-syncs update instead of duplicating; mask is the LAST 4 characters only — never full account numbers.",
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        name: z.string().describe("e.g. 'Chase Checking'."),
        accountType: z.enum(FINANCIAL_ACCOUNT_TYPES),
        mask: z.string().max(4).describe("Last 4 characters ONLY."),
        institution: z.string().optional(),
        plaidAccountId: z.string().optional().describe("Plaid account_id for idempotent mapping."),
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
        "Bulk-ingest transactions for a tracked account. Plaid data is ground truth — ingest directly, never queue for review; map to the fixed CSP taxonomy per the finance-taxonomy skill (type-category pairing is enforced; transfers and off-ledger 401k have special rules there). Amounts are INTEGER CENTS; pass Plaid transaction_ids as externalIds for idempotent dedupe.",
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        accountId: z.string().describe("From upsert_financial_account."),
        source: z.enum(TX_SOURCES).optional().describe("Defaults to plaid."),
        transactions: z
          .array(
            z.object({
              date: z.number().describe("Epoch ms."),
              amountCents: z.number().int().describe("Integer cents, positive magnitude; txType determines direction."),
              description: z.string(),
              txType: z.enum(TX_TYPES),
              category: z.enum(TX_CATEGORIES).describe("Must be valid for the txType (finance-taxonomy skill)."),
              externalId: z.string().optional().describe("Plaid transaction_id for idempotent dedupe."),
              monthKey: z.string().regex(MONTH_KEY_PATTERN).optional().describe("'YYYY-MM'; derived from date when omitted."),
              offLedger: z
                .boolean()
                .optional()
                .describe("Payroll-deducted contributions that never touched the account; txType 'Investments' only, requires contributionSource."),
              contributionSource: z
                .enum(CONTRIBUTION_SOURCES)
                .optional()
                .describe("Required when offLedger; 'employee' grosses up the CSP income denominator, 'employer' never does."),
            }),
          )
          .min(1),
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
        "Bulk-record end-of-day balance snapshots (integer cents, may be negative; idempotent per account+day). Compute them from the FULL raw Plaid feed walked backward from the current balance — NEVER by summing recorded budget transactions (finance-taxonomy skill).",
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        accountId: z.string().describe("From upsert_financial_account."),
        source: z.enum(BALANCE_SOURCES).optional().describe("Defaults to plaid_derived."),
        balances: z
          .array(
            z.object({
              date: z.number().describe("Epoch ms; normalized to UTC midnight."),
              endOfDayBalanceCents: z.number().int(),
            }),
          )
          .min(1),
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
        "Read-only monthly report for one account: totals per category/type, outgoing/incoming/net, previous-month deltas, applicable budget with per-target deltas, and daily balance snapshots. All amounts integer cents.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        accountId: z.string(),
        monthKey: z.string().regex(MONTH_KEY_PATTERN).describe("'YYYY-MM'."),
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
        "Store reusable provenance without creating an accepted object. Prefer inline sourceRefs on ingest_object for a single source-backed object; never store full raw source bodies.",
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
        "Create a relationship between accepted Skippy entities (never fallback review item IDs). Relationships should be meaningful and confidence-rated when inferred.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        from: entityRefSchema,
        to: entityRefSchema,
        type: z.enum(relationshipTypeValues),
        confidence: z.number().min(0).max(1).optional(),
        reason: z.string().optional(),
        createdBy: z.enum(["user", "harness", "skippy_ai", "system"]).describe("External MCP callers usually use 'harness'."),
      }),
    },
    async (args) => toolResult(await tools.linkEntities(stripUndefined(args) as RelationshipInput)),
  );

  server.registerTool(
    "generate_focus_summary",
    {
      title: "Generate focus summary",
      description:
        "Store a synthesized dashboard focus summary from accepted entities — actionable Now bullets only, never invented tasks, standing context, or topics the user recently dismissed. Link referenced emails via stored sourceRef deepLinks or Gmail messageId URLs; never invent URLs.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        generatedAt: z.number().describe("Epoch ms."),
        validUntil: z.number().optional().describe("Epoch ms after which this summary is stale."),
        summaryText: z.string().describe("Actionable Now bullets only."),
        topItems: z.array(focusTopItemSchema),
        sourceRunId: z.string().optional(),
        policyVersion: z.string().optional(),
      }),
    },
    async (args) => toolResult(await tools.generateFocusSummary(stripUndefined(args) as FocusSummary)),
  );

  server.registerTool(
    "list_pending_actions",
    {
      title: "List pending actions",
      description:
        "Read-only list of external side-effect actions (send message, complete external reminder) waiting for approval or execution tracking; separate from accepted knowledge.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        status: z.string().optional().describe("e.g. pending, approved, rejected, sent, failed, completed."),
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
        "Record a review of an accepted entity (stale check, priority change, blocker, follow-up, status). Updates safe fields only, attaches evidence source refs, and records an audit activity.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        entityRef: entityRefSchema,
        reviewType: z.enum(entityReviewTypeValues),
        reviewSummary: z.string().describe("Concise audit summary of what changed or was checked."),
        reviewedBy: z.string().optional(),
        status: z.string().optional().describe("Applied only when valid for this entity type."),
        confidence: z.number().min(0).max(1).optional(),
        priorityScore: z.number().min(0).max(1).optional(),
        urgencyScore: z.number().min(0).max(1).optional(),
        importanceScore: z.number().min(0).max(1).optional(),
        priorityReason: z.string().optional(),
        priorityComputedAt: z.number().optional().describe("Epoch ms."),
        priorityPolicyVersion: z.string().optional(),
        sourceRefs: z.array(sourceRefSchema).optional(),
        sourceRefIds: z.array(z.string()).optional(),
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
        "Mark a task in progress before doing meaningful work on it, so the project board reflects active work.",
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        taskId: z.string(),
        startedBy: z.string().optional(),
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
        "Mark a task done, ONLY when the user explicitly completed it or instructed the harness to. Include externalReminderSourceRefId when an external reminder must also be completed.",
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        taskId: z.string(),
        completedBy: z.string().optional().describe("Chat-context label; not persisted as a Convex user ID."),
        completedByUserId: z.string().optional().describe("Convex user ID to store as completion actor."),
        externalReminderSourceRefId: z.string().optional().describe("External reminder to sync after approval/execution."),
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
        "Record the result after an already-approved external action was executed elsewhere. Never use this to request approval or perform the side effect itself.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        pendingActionId: z.string().describe("From list_pending_actions."),
        status: z.enum(["sent", "failed", "completed"]),
        executionProvider: z.string().optional(),
        externalMessageId: z.string().optional().describe("Provider-returned ID, e.g. sent message ID."),
        error: z.string().optional(),
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
        "Update the live source-ingestion status on the Skippy Home NOW area: status=running before reading sources, heartbeat during long work, completed or failed before ending the run.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        statusKey: z.string().optional().describe("Stable status-row key. Defaults to source-sync."),
        harness: z.string().describe("e.g. codex_automation, chatgpt, claude, hermes."),
        status: z.enum(["idle", "running", "completed", "failed"]),
        message: z.string().optional().describe("Short human-facing status message."),
        sourceSystemsChecked: z.array(z.string()).describe("e.g. gmail, calendar, imessage."),
        startedAt: z.number().optional().describe("Epoch ms."),
        completedAt: z.number().optional().describe("Epoch ms."),
        lastHeartbeatAt: z.number().optional().describe("Epoch ms."),
        errors: z.array(z.string()).optional().describe("Short summaries; no secrets or raw payloads."),
        metadata: z.unknown().optional().describe("Small JSON object; include role (e.g. \"agenda\") to attribute an agent role."),
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
        "Record metadata about a harness ingestion/review run (scheduled or batch source reads) so the user can audit coverage and errors. Attribute named agent roles with metadata.role, e.g. { role: \"agenda\" }.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        harness: z.string().describe("e.g. codex, chatgpt, claude, hermes, scheduled_worker."),
        status: z.enum(["running", "completed", "failed"]),
        sourceSystemsChecked: z.array(z.string()).describe("e.g. gmail, calendar, apple_reminders."),
        startedAt: z.number().optional().describe("Epoch ms."),
        completedAt: z.number().optional().describe("Epoch ms."),
        candidatesSubmitted: z.number().optional().describe("Legacy fallback review item count."),
        objectsCreated: z.number().optional(),
        objectsUpdated: z.number().optional(),
        errors: z.array(z.string()).optional().describe("Short summaries; no secrets or raw payloads."),
        metadata: z.unknown().optional().describe("Small JSON object; include role (e.g. \"agenda\") to attribute an agent role."),
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
        dryRun: z.boolean().optional().describe("Return candidates without sending."),
        limit: z.number().min(1).max(25).optional(),
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
