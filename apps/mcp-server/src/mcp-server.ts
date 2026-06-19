import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createSkippyToolHandlers, type SkippyClient } from "./tools.js";
import type { CandidateObjectInput, EntityType, FocusSummary, RelationshipInput, SourceRefInput } from "@skippy/shared";

const entityTypeValues = ["goal", "project", "task", "note", "person", "company", "link", "knowledgeObject"] as const;

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
  "Use the user's evolving importance rubric. Directly ingest source-backed objects when they are actionable, deadline-bearing, relationship-building, decision-relevant, financially/security relevant, or clearly useful later.",
  "For direct ingestion, call ingest_object and include a concise rubricDecision explaining why the item clears the importance bar.",
  "Use submit_candidate_object only as a legacy fallback when the harness cannot decide whether the item belongs in Skippy.",
  "Extract useful objects, not raw dumps. Prefer task, project, person, company, link, note, goal, or knowledgeObject records.",
  "Include lightweight sourceRefs whenever possible: sourceSystem, messageId/threadId/eventId, timestamp, participants, URL/deepLink, summary, and a short excerpt.",
  "Avoid storing full raw emails, full calendar descriptions, or unnecessary private text. Store concise summaries and fields needed for future retrieval/focus.",
  "For noisy sources, submit only items that are actionable, relationship-building, deadline-bearing, decision-relevant, or clearly useful later.",
  "Use pending actions only for external side effects that need separate approval/execution. Do not send email, edit calendars, or mark source systems changed through Skippy.",
  "Use ask/summarize_focus/list_pending_actions for retrieval. Internal AI synthesis may be disabled, so expect structured context rather than polished answers.",
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
    projectId: resultRecord.projectId,
    projectTitle: resultRecord.projectTitle,
    relationshipId: resultRecord.relationshipId,
    reviewUrl: reviewUrl("/projects"),
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
        "Generate and store a fresh Skippy focus summary from accepted entities using the configured internal AI provider and embedding ranking. Use when the user asks what to focus on now or wants the dashboard refreshed.",
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
        "Primary write tool for source-derived knowledge under the user's importance rubric. Use when the harness can explain why the item is worth storing. Creates an accepted Skippy object directly; does not create a fallback review item. Include sourceRefs and a concise rubricDecision.",
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
          .enum(["idea", "planned", "in_progress", "paused", "completed", "cancelled"])
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

  for (const entityType of entityTypeValues) {
    server.registerTool(
      `upsert_${entityType}`,
      {
        title: `Submit ${entityType}`,
        description: `Convenience ingestion tool for a single accepted ${entityType}. This writes directly to accepted knowledge, so use it only when the item clearly clears the user's importance rubric. Prefer ingest_object when you can include sourceRefs and a specific rubricDecision.`,
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
        "Store a synthesized focus summary for the user-facing dashboard. Use accepted entities and current context; do not invent tasks or entities here. If you discover new important items while summarizing, ingest them separately with sourceRefs and a rubricDecision.",
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        generatedAt: z.number().describe("Epoch milliseconds when this summary was generated."),
        validUntil: z.number().optional().describe("Optional epoch milliseconds after which this summary should be considered stale."),
        summaryText: z.string().describe("Concise human-facing focus summary."),
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
