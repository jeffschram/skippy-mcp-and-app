import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "./mcp-server";
import type { SkippyClient } from "./tools";

function createFakeClient(overrides: Partial<SkippyClient> = {}): SkippyClient {
  const client: SkippyClient = {
    submitCandidateObject: async () => ({ triageItemId: "triage_123", sourceRefIds: ["source_123"] }),
    ingestObject: async (_brainInstanceId, input) => ({
      status: "accepted",
      entityType: input.candidateEntityType,
      entityId: "entity_123",
      title: "Accepted item",
      rubricDecision: input.rubricDecision,
    }),
    createProjectDirect: async (_brainInstanceId, input) => ({
      status: "created",
      entityType: "project",
      projectId: "project_123",
      title: input.title,
    }),
    createTaskDirect: async (_brainInstanceId, input) => ({
      status: "created",
      entityType: "task",
      taskId: "task_123",
      title: input.title,
      projectId: input.projectId,
    }),
    addSourceRef: async () => ({ ok: true }),
    linkEntities: async () => ({ ok: true }),
    getLatestFocusSummary: async () => null,
    getAiContext: async () => ({
      config: { llmProviderMode: "none" },
      focusSummary: null,
      projects: [],
      tasks: [],
      people: [],
      companies: [],
      links: [],
      notes: [],
      embeddings: [],
    }),
    upsertEntityEmbedding: async () => ({ ok: true }),
    upsertFocusSummary: async () => ({ ok: true }),
    listPendingActions: async () => [],
    markTaskInProgress: async (_brainInstanceId, taskId, startedBy) => ({
      taskId,
      status: "in_progress",
      startedAt: 1780850000000,
      startedBy,
    }),
    markTaskDone: async (_brainInstanceId, taskId) => ({ taskId }),
    recordPendingActionResult: async () => ({ ok: true }),
    recordEntityReview: async () => ({ ok: true }),
    getCurrentContext: async () => ({ activeRoute: "/projects/project_123", activeProject: { _id: "project_123", title: "Demo" } }),
    planProject: async (_brainInstanceId, input) => ({
      status: "planned",
      planId: "plan_123",
      projectId: input.projectId,
      taskCount: 3,
      summary: "Planned",
    }),
    listReadyTasks: async () => [],
    listRequestedReadyTasks: async () => [],
    getTaskBrief: async (_brainInstanceId, input) => ({ _id: input.taskId, title: "Task", executionBrief: "do it" }),
    briefTask: async (_brainInstanceId, input) => ({ taskId: input.taskId, executionState: "briefed" }),
    recordTaskResult: async (_brainInstanceId, input) => ({ taskId: input.taskId, executionState: "in_review" }),
    updateLinkStatus: async (_brainInstanceId, input) => ({
      linkId: input.linkId,
      title: "Stored link",
      status: input.status,
    }),
    captureThought: async (_brainInstanceId, input) => ({
      status: input.reviewBehavior === "submit_for_review" ? "submitted_for_review" : "captured",
      memoryId: "memory_123",
      kind: input.proposedKind ?? "memory",
      title: input.content ?? input.text,
      sourceRefIds: ["source_123"],
      confidence: input.confidence,
    }),
    recordMemory: async (_brainInstanceId, input) => ({
      status: "recorded",
      memoryId: "memory_123",
      kind: input.kind ?? "memory",
      title: input.title ?? input.content,
      rubricDecision: input.rubricDecision,
    }),
    submitMemoryReviewCandidate: async (_brainInstanceId, input) => ({
      status: "submitted_for_review",
      reviewItemId: "memory_review_123",
      kind: input.proposedKind ?? "memory",
      title: input.content,
    }),
    listMemory: async () => [],
    getContextBundle: async (_brainInstanceId, input) => ({
      query: input.query,
      memories: [],
      entities: [],
      sourceRefs: [],
    }),
    getMemoryDetail: async (_brainInstanceId, input) => ({ memoryId: input.memoryId }),
    linkMemory: async (_brainInstanceId, input) => ({
      status: "linked",
      memoryId: input.memoryId,
      relatedEntityRefs: [input.entityRef],
    }),
    listInterviewTemplates: async () => ({
      assistantDisplayName: "Skippy",
      templates: [
        {
          kind: "project",
          title: "Project check-in",
          description: "Clarify scope, momentum, blockers, and next action.",
          questionCount: 4,
          suggestedPrompt: "Want to do a project interview for Skippy?",
        },
      ],
    }),
    listInterviews: async () => ({
      assistantDisplayName: "Skippy",
      templates: [],
      active: [],
      recent: [],
    }),
    startInterview: async (_brainInstanceId, input) => ({
      status: "active",
      interviewId: "interview_123",
      assistantDisplayName: "Skippy",
      kind: input.kind,
      currentQuestion: {
        id: "project_current_state",
        prompt: "What is the current state of this project?",
      },
      progress: { answered: 0, total: 4 },
      suggestedPrompt: "Want to do a project interview for Skippy?",
      reviewUrl: "/interviews/interview_123",
    }),
    getInterview: async (_brainInstanceId, input) => ({
      assistantDisplayName: "Skippy",
      interview: { _id: input.interviewId, status: "active" },
      currentQuestion: { id: "project_current_state", prompt: "What is the current state of this project?" },
      responses: [],
      progress: { answered: 0, total: 4 },
      reviewUrl: `/interviews/${input.interviewId}`,
    }),
    answerInterviewQuestion: async (_brainInstanceId, input) => ({
      interviewId: input.interviewId,
      assistantDisplayName: "Skippy",
      nextQuestion: {
        id: "project_desired_outcome",
        prompt: "What outcome would make this project successful?",
      },
      progress: { answered: 1, total: 4 },
      isLastAnswer: false,
      reviewUrl: `/interviews/${input.interviewId}`,
    }),
    completeInterview: async (_brainInstanceId, input) => ({
      interviewId: input.interviewId,
      assistantDisplayName: "Skippy",
      reviewUrl: `/interviews/${input.interviewId}`,
    }),
    archiveInterview: async (_brainInstanceId, input) => ({
      interviewId: input.interviewId,
      assistantDisplayName: "Skippy",
      reviewUrl: "/interviews",
    }),
    recordIngestionRun: async () => ({ ok: true }),
    updateSourceSyncStatus: async () => ({ ok: true }),
    getOperatingRules: async () => [],
    getEffectiveRubric: async () => ({
      manualRubric: "",
      goals: [],
      activeProjects: [],
      favoriteContacts: [],
      renderedText: "",
    }),
    getNotificationDispatchContext: async () => ({
      config: { notificationsEnabled: false },
      pushSubscriptions: [],
      tasks: [],
      pendingActions: [],
      recentDeliveries: [],
    }),
    recordNotificationDelivery: async () => ({ ok: true }),
    getSkill: async (_brainInstanceId, input) =>
      input.slug === "harness-bootstrap"
        ? {
            slug: input.slug,
            title: "Harness bootstrap",
            description: "Portable bootstrap instructions.",
            body: "# Skippy Harness Bootstrap\n\nYou are an AI harness connected to Skippy MCP.",
            visibility: "public",
            version: 1,
            isDefault: true,
          }
        : {
            slug: input.slug,
            title: "Task heartbeat",
            description: "Portable heartbeat instructions.",
            body: "# Skippy Task Heartbeat\n\nCheck Skippy for requested Ready agent tasks.",
            visibility: "public",
            version: 1,
            isDefault: true,
          },
    upsertFinancialAccount: async (_brainInstanceId, input) => ({
      accountId: "financial_account_123",
      status: "created",
      name: input.name,
      accountType: input.accountType,
      mask: input.mask,
    }),
    recordFinancialTransactions: async (_brainInstanceId, input) => ({
      accountId: input.accountId,
      accountName: "Chase Checking",
      source: input.source ?? "plaid",
      inserted: input.transactions.length,
      updated: 0,
      skipped: 0,
    }),
    recordFinancialBalances: async (_brainInstanceId, input) => ({
      accountId: input.accountId,
      accountName: "Chase Checking",
      source: input.source ?? "plaid_derived",
      inserted: input.balances.length,
      updated: 0,
    }),
    getFinancialReport: async (_brainInstanceId, input) => ({
      monthKey: input.monthKey,
      previousMonthKey: "2026-05",
      account: { _id: input.accountId, name: "Chase Checking" },
      current: { totalOutgoingCents: 500000, totalIncomingCents: 800000, netCents: 300000 },
    }),
    generateProjectFileUploadUrl: async () => "https://upload.convex.cloud/api/storage/upload_123",
    registerProjectFile: async (_brainInstanceId, input) => ({
      fileId: "project_file_123",
      projectId: input.projectId,
      taskId: input.taskId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadedBy: "harness",
    }),
    listProjectFiles: async (_brainInstanceId, input) => [
      {
        _id: "project_file_123",
        projectId: input.projectId,
        taskId: input.taskId,
        fileName: "brand-guidelines.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        uploadedBy: "user",
        note: "Use for all deliverables.",
        createdAt: 1780850000000,
        url: "https://files.convex.cloud/project_file_123?token=ephemeral",
      },
    ],
  };

  return { ...client, ...overrides };
}

function textResult(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content.find((item) => item.type === "text");
  if (!text || text.type !== "text" || typeof text.text !== "string") {
    throw new Error("expected text result");
  }

  return JSON.parse(text.text) as Record<string, unknown>;
}

describe("Skippy MCP manifest", () => {
  it("teaches harnesses the Skippy rubric-first workflow", async () => {
    const server = createMcpServer(createFakeClient(), "brain_123");
    const client = new Client({ name: "manifest-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      expect(client.getInstructions()).toContain("importance rubric");
      expect(client.getInstructions()).toContain("status defaults to 'saved'");
      expect(client.getInstructions()).toContain("Links are reference material, not a reading queue.");

      const { tools } = await client.listTools();
      const ingestObject = tools.find((tool) => tool.name === "ingest_object");
      const submitCandidate = tools.find((tool) => tool.name === "submit_candidate_object");
      const createTask = tools.find((tool) => tool.name === "create_task");
      const capture = tools.find((tool) => tool.name === "capture");
      const ask = tools.find((tool) => tool.name === "ask");
      const refreshFocusSummary = tools.find((tool) => tool.name === "refresh_focus_summary");
      const recordEntityReview = tools.find((tool) => tool.name === "record_entity_review");
      const markTaskInProgress = tools.find((tool) => tool.name === "mark_task_in_progress");
      const dispatchNotifications = tools.find((tool) => tool.name === "dispatch_notifications");
      const captureThought = tools.find((tool) => tool.name === "capture_thought");
      const recordMemory = tools.find((tool) => tool.name === "record_memory");
      const recordDecision = tools.find((tool) => tool.name === "record_decision");
      const recordPrinciple = tools.find((tool) => tool.name === "record_principle");
      const submitMemoryReviewCandidate = tools.find(
        (tool) => tool.name === "submit_memory_review_candidate",
      );
      const listMemory = tools.find((tool) => tool.name === "list_memory");
      const getContextBundle = tools.find((tool) => tool.name === "get_context_bundle");
      const getMemoryDetail = tools.find((tool) => tool.name === "get_memory_detail");
      const linkMemory = tools.find((tool) => tool.name === "link_memory");
      const listRequestedReadyTasks = tools.find((tool) => tool.name === "list_requested_ready_tasks");
      const briefTask = tools.find((tool) => tool.name === "brief_task");
      const getTaskBriefTool = tools.find((tool) => tool.name === "get_task_brief");
      const getCurrentContextTool = tools.find((tool) => tool.name === "get_current_context");
      const listInterviewTemplates = tools.find((tool) => tool.name === "list_interview_templates");
      const startInterview = tools.find((tool) => tool.name === "start_interview");
      const answerInterviewQuestion = tools.find((tool) => tool.name === "answer_interview_question");
      const completeInterview = tools.find((tool) => tool.name === "complete_interview");
      const getSkill = tools.find((tool) => tool.name === "get_skill");
      const upsertLink = tools.find((tool) => tool.name === "upsert_link");
      const upsertNote = tools.find((tool) => tool.name === "upsert_note");
      const updateLinkStatus = tools.find((tool) => tool.name === "update_link_status");
      const upsertFinancialAccount = tools.find((tool) => tool.name === "upsert_financial_account");
      const recordFinancialTransactions = tools.find((tool) => tool.name === "record_financial_transactions");
      const recordFinancialBalances = tools.find((tool) => tool.name === "record_financial_balances");
      const getFinancialReport = tools.find((tool) => tool.name === "get_financial_report");
      const listProjectFiles = tools.find((tool) => tool.name === "list_project_files");
      const generateProjectFileUploadUrl = tools.find(
        (tool) => tool.name === "generate_project_file_upload_url",
      );
      const registerProjectFile = tools.find((tool) => tool.name === "register_project_file");

      expect(ingestObject?.description).toContain("importance rubric");
      expect(ingestObject?.description).toContain("default to 'saved'");
      expect(ingestObject?.description).toContain("pass status 'unread' only for explicit read-later intent");
      expect(upsertLink?.description).toContain("status defaults to 'saved'");
      expect(upsertLink?.description).toContain("use submit_candidate_object");
      expect(upsertNote?.description).not.toContain("status defaults to 'saved'");
      expect(ingestObject?.inputSchema.properties?.rubricDecision).toBeDefined();
      expect(submitCandidate?.description).toContain("Legacy fallback");
      expect(submitCandidate?.inputSchema.properties?.reviewReason).toBeDefined();
      expect(createTask?.description).toContain("when the user explicitly asks");
      expect(createTask?.inputSchema.properties?.ownerType).toBeDefined();
      expect(createTask?.inputSchema.properties?.kind).toBeDefined();
      expect(listRequestedReadyTasks?.description).toContain("explicitly requested");
      expect(briefTask?.description).toContain("Ground the brief in the actual repo");
      expect(getTaskBriefTool?.description).toContain("read user-provided inputs from effectiveAssetsPath");
      expect(getTaskBriefTool?.description).toContain(
        "write generated artifacts/deliverables to effectiveOutputPath",
      );
      expect(getTaskBriefTool?.description).toContain("mkdir -p");
      expect(getTaskBriefTool?.description).toContain(
        "never write deliverables into the project's code repo unless they ARE the product",
      );
      expect(getCurrentContextTool?.description).toContain("effectiveAssetsPath");
      expect(getCurrentContextTool?.description).toContain("effectiveOutputPath");
      expect(getCurrentContextTool?.description).toContain("localPath");
      expect(briefTask?.inputSchema.properties?.executionBrief).toBeDefined();
      expect(briefTask?.inputSchema.properties?.acceptanceCriteria).toBeDefined();
      expect(updateLinkStatus?.description).toContain("genuine lifecycle changes");
      expect(updateLinkStatus?.description).toContain("Never use it to fake user engagement");
      expect(updateLinkStatus?.inputSchema.properties?.linkId).toBeDefined();
      expect(updateLinkStatus?.inputSchema.properties?.status).toBeDefined();
      expect(updateLinkStatus?.inputSchema.properties?.reason).toBeDefined();
      expect(upsertFinancialAccount?.description).toContain("never send full account numbers");
      expect(upsertFinancialAccount?.description).toContain("plaidAccountId");
      expect(upsertFinancialAccount?.inputSchema.properties?.mask).toBeDefined();
      expect(recordFinancialTransactions?.description).toContain("ground truth");
      expect(recordFinancialTransactions?.description).toContain("never queue it for review");
      expect(recordFinancialTransactions?.description).toContain("INTEGER CENTS");
      expect(recordFinancialTransactions?.description).toContain("externalIds for idempotency");
      expect(recordFinancialTransactions?.description).toContain(
        "Fixed Costs: Mortgage, HOA, Mortgage Loan | Recurring Bills | Debt Payments | Groceries | Subscriptions",
      );
      expect(recordFinancialTransactions?.description).toContain("Investments: Retirement | Brokerage");
      expect(recordFinancialTransactions?.description).toContain("Savings: Emergency Fund | Goals");
      expect(recordFinancialTransactions?.description).toContain(
        "Guilt-Free: Restaurants | Gas, Amazon, Home Depot, Etc | Misc.",
      );
      expect(recordFinancialTransactions?.description).toContain("Transfer: Transfers In | Transfers Out");
      expect(recordFinancialTransactions?.description).toContain(
        "Transfers between the owner's own accounts (tracked or untracked, e.g. business checking or a partner's external account) are txType 'Transfer' with category 'Transfers In' or 'Transfers Out' — never Income or an outgoing bucket",
      );
      expect(recordFinancialTransactions?.description).toContain("automatically excluded from budget totals");
      expect(recordFinancialTransactions?.description).toContain("Payroll-deducted retirement contributions");
      expect(recordFinancialTransactions?.description).toContain("offLedger: true (txType 'Investments' only)");
      expect(recordFinancialTransactions?.description).toContain(
        "'employee' amounts are the owner's pre-tax pay, so they gross up the percent-of-income denominator",
      );
      expect(recordFinancialTransactions?.description).toContain(
        "'employer' match amounts count in Investments totals but are NOT income and never gross up the denominator",
      );
      expect(recordFinancialTransactions?.description).toContain(
        "Off-ledger rows are excluded from outgoing/net and from account balances",
      );
      expect(recordFinancialTransactions?.inputSchema.properties?.transactions).toBeDefined();
      expect(recordFinancialBalances?.description).toContain("FULL raw Plaid transaction feed");
      expect(recordFinancialBalances?.description).toContain("NEVER derive balances by summing recorded budget transactions");
      expect(recordFinancialBalances?.description).toContain("one snapshot per account+day");
      expect(recordFinancialBalances?.description).toContain("INTEGER CENTS");
      expect(recordFinancialBalances?.inputSchema.properties?.balances).toBeDefined();
      expect(getFinancialReport?.annotations?.readOnlyHint).toBe(true);
      expect(getFinancialReport?.description).toContain("previous-month deltas");
      expect(getFinancialReport?.inputSchema.properties?.monthKey).toBeDefined();
      expect(listProjectFiles?.annotations?.readOnlyHint).toBe(true);
      expect(listProjectFiles?.description).toContain("Download URLs are ephemeral");
      expect(listProjectFiles?.description).toContain("effectiveAssetsPath");
      expect(listProjectFiles?.description).toContain("_library");
      expect(listProjectFiles?.description).toContain("matching size");
      expect(listProjectFiles?.description).toContain("not in the library unless registered");
      expect(listProjectFiles?.inputSchema.properties?.projectId).toBeDefined();
      expect(listProjectFiles?.inputSchema.properties?.taskId).toBeDefined();
      expect(generateProjectFileUploadUrl?.description).toContain("short-lived");
      expect(generateProjectFileUploadUrl?.description).toContain("{storageId}");
      expect(generateProjectFileUploadUrl?.description).toContain("register_project_file");
      expect(generateProjectFileUploadUrl?.inputSchema.properties?.projectId).toBeDefined();
      expect(registerProjectFile?.description).toContain("generate_project_file_upload_url");
      expect(registerProjectFile?.description).toContain("HTTP POST the raw file bytes");
      expect(registerProjectFile?.description).toContain("{storageId}");
      expect(registerProjectFile?.description).toContain("25 MB");
      expect(registerProjectFile?.description).toContain("executables and arbitrary binaries are rejected");
      expect(registerProjectFile?.inputSchema.properties?.storageId).toBeDefined();
      expect(registerProjectFile?.inputSchema.properties?.fileName).toBeDefined();
      expect(registerProjectFile?.inputSchema.properties?.mimeType).toBeDefined();
      expect(registerProjectFile?.inputSchema.properties?.sizeBytes).toBeDefined();
      expect(capture?.description).toContain("accepted note directly");
      expect(ask?.annotations?.readOnlyHint).toBe(true);
      expect(refreshFocusSummary?.description).toContain("Generate and store");
      expect(recordEntityReview?.description).toContain("Record a review of an accepted Skippy entity");
      expect(markTaskInProgress?.description).toContain("when a harness starts working");
      expect(dispatchNotifications?.description).toContain("Use dryRun first");
      expect(captureThought?.description).toContain("second-brain memory");
      expect(captureThought?.inputSchema.properties?.sourceRefs).toBeDefined();
      expect(recordMemory?.inputSchema.properties?.rubricDecision).toBeDefined();
      expect(recordDecision?.description).toContain("durable decision memory");
      expect(recordPrinciple?.description).toContain("operating principle");
      expect(submitMemoryReviewCandidate?.description).toContain("Queue a possible memory");
      expect(submitMemoryReviewCandidate?.description).toContain("transient alerts");
      expect(listMemory?.annotations?.readOnlyHint).toBe(true);
      expect(getContextBundle?.description).toContain("context bundle");
      expect(getContextBundle?.inputSchema.properties?.relatedEntityRefs).toBeDefined();
      expect(getMemoryDetail?.description).toContain("memory detail");
      expect(linkMemory?.inputSchema.properties?.confidence).toBeDefined();
      expect(listInterviewTemplates?.description).toContain("assistantDisplayName");
      expect(startInterview?.description).toContain("one question at a time in chat");
      expect(answerInterviewQuestion?.description).toContain("current interview question");
      expect(completeInterview?.description).toContain("Complete a guided interview");
      expect(getSkill?.description).toContain("Skippy-hosted harness skill");

      const prompts = await client.listPrompts();
      expect(prompts.prompts.find((prompt) => prompt.name === "skippy_intro")?.description).toContain(
        "first connected",
      );
      expect(prompts.prompts.find((prompt) => prompt.name === "skippy_skills")?.description).toContain(
        "Portable harness instructions",
      );
      expect(prompts.prompts.find((prompt) => prompt.name === "skippy_task_heartbeat")?.description).toContain(
        "Ready agent tasks",
      );
      expect(prompts.prompts.find((prompt) => prompt.name === "skippy_harness_bootstrap")?.description).toContain(
        "newly connected harness",
      );
      expect(prompts.prompts.find((prompt) => prompt.name === "skippy_slash_commands")?.description).toContain(
        "slash command",
      );

      const intro = await client.getPrompt({ name: "skippy_intro" });
      expect(intro.messages[0]?.content.type).toBe("text");
      if (intro.messages[0]?.content.type === "text") {
        expect(intro.messages[0].content.text).toContain("Hi, I'm Skippy");
        expect(intro.messages[0].content.text).toContain("http://127.0.0.1:3000");
      }

      const skills = await client.getPrompt({ name: "skippy_skills" });
      expect(skills.messages[0]?.content.type).toBe("text");
      if (skills.messages[0]?.content.type === "text") {
        expect(skills.messages[0].content.text).toContain("Skippy Harness Skills");
        expect(skills.messages[0].content.text).toContain("Retrieve before contextful work");
        expect(skills.messages[0].content.text).toContain("Run interviews in the harness chat");
        expect(skills.messages[0].content.text).toContain("Use `get_importance_rubric`");
        expect(skills.messages[0].content.text).toContain("/task ...");
        expect(skills.messages[0].content.text).toContain("mark_task_done");
      }

      const taskHeartbeat = await client.getPrompt({ name: "skippy_task_heartbeat" });
      expect(taskHeartbeat.messages[0]?.content.type).toBe("text");
      if (taskHeartbeat.messages[0]?.content.type === "text") {
        expect(taskHeartbeat.messages[0].content.text).toContain("Skippy Task Heartbeat");
        expect(taskHeartbeat.messages[0].content.text).toContain("requested Ready agent tasks");
      }

      const harnessBootstrap = await client.getPrompt({
        name: "skippy_harness_bootstrap",
        arguments: { harnessName: "Claude Code", verbosity: "detailed" },
      });
      expect(harnessBootstrap.messages[0]?.content.type).toBe("text");
      if (harnessBootstrap.messages[0]?.content.type === "text") {
        expect(harnessBootstrap.messages[0].content.text).toContain("You are Claude Code");
        expect(harnessBootstrap.messages[0].content.text).toContain("First 5 Minutes");
        expect(harnessBootstrap.messages[0].content.text).toContain("`brief_task`");
        expect(harnessBootstrap.messages[0].content.text).toContain("Project Folders");
        expect(harnessBootstrap.messages[0].content.text).toContain(
          "Read user-provided inputs from `effectiveAssetsPath`; write generated artifacts and deliverables to `effectiveOutputPath`.",
        );
        expect(harnessBootstrap.messages[0].content.text).toContain("`mkdir -p` on first write");
        expect(harnessBootstrap.messages[0].content.text).toContain("cloud-canonical");
        expect(harnessBootstrap.messages[0].content.text).toContain("`list_project_files`");
        expect(harnessBootstrap.messages[0].content.text).toContain(
          "Files found only locally are NOT in the library unless registered",
        );
        expect(harnessBootstrap.messages[0].content.text).toContain(
          "Never write deliverables into the project's code repo unless they ARE the product.",
        );
        expect(harnessBootstrap.messages[0].content.text).toContain("Consent And Capture Rules");
        expect(harnessBootstrap.messages[0].content.text).toContain("docs/codex-heartbeat.md");
      }

      const slashCommands = await client.getPrompt({ name: "skippy_slash_commands" });
      expect(slashCommands.messages[0]?.content.type).toBe("text");
      if (slashCommands.messages[0]?.content.type === "text") {
        expect(slashCommands.messages[0].content.text).toContain("Skippy Slash Commands");
        expect(slashCommands.messages[0].content.text).toContain("| `/task ...`");
        expect(slashCommands.messages[0].content.text).toContain("`mark_task_done`");
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns chat-friendly confirmations for direct accepted ingestion", async () => {
    const server = createMcpServer(createFakeClient(), "brain_123");
    const client = new Client({ name: "confirmation-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: "ingest_object",
        arguments: {
          candidateEntityType: "task",
          candidatePayload: { title: "Fix schema mapping", dueDate: "2026-06-10" },
          rubricDecision: "Active project task with concrete implementation value.",
          confidence: 0.9,
        },
      });

      expect(textResult(result)).toMatchObject({
        status: "accepted",
        entityType: "task",
        title: "Accepted item",
        entityId: "entity_123",
        rubricDecision: "Active project task with concrete implementation value.",
        reviewUrl: "http://127.0.0.1:3000/projects",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns chat-friendly confirmations for memory captures", async () => {
    const captureCalls: Array<{ brainInstanceId: string; input: unknown }> = [];
    const server = createMcpServer(
      createFakeClient({
        captureThought: async (brainInstanceId, input) => {
          captureCalls.push({ brainInstanceId, input });
          return {
            status: "captured",
            memoryId: "memory_123",
            kind: input.proposedKind ?? "memory",
            title: input.content ?? input.text,
            sourceRefIds: ["source_123"],
            confidence: input.confidence,
          };
        },
      }),
      "brain_123",
    );
    const client = new Client({ name: "memory-capture-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: "capture_thought",
        arguments: {
          text: "I prefer terse status updates during rollouts.",
          proposedKind: "memory",
          captureReason: "Explicit preference stated by user.",
          confidence: 0.9,
          reviewBehavior: "auto",
          sourceRefs: [
            {
              sourceSystem: "codex",
              externalId: "thread_123",
              summary: "Preference from rollout thread.",
            },
          ],
        },
      });

      expect(captureCalls).toEqual([
        {
          brainInstanceId: "brain_123",
          input: {
            text: "I prefer terse status updates during rollouts.",
            content: "I prefer terse status updates during rollouts.",
            proposedKind: "memory",
            captureReason: "Explicit preference stated by user.",
            confidence: 0.9,
            reviewBehavior: "auto",
            createdBy: "skippy_mcp",
            sourceRefs: [
              {
                sourceSystem: "codex",
                externalId: "thread_123",
                summary: "Preference from rollout thread.",
              },
            ],
          },
        },
      ]);
      expect(textResult(result)).toMatchObject({
        status: "captured",
        entityType: "memory",
        memoryId: "memory_123",
        kind: "memory",
        title: "I prefer terse status updates during rollouts.",
        sourceRefIds: ["source_123"],
        confidence: 0.9,
        reviewBehavior: "auto",
        reviewUrl: "http://127.0.0.1:3000/memory",
        nextAction: "Memory updated in Skippy.",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns assistant-named chat interview prompts and next questions", async () => {
    const server = createMcpServer(
      createFakeClient({
        listInterviewTemplates: async () => ({
          assistantDisplayName: "Mabel",
          templates: [
            {
              kind: "project",
              title: "Project check-in",
              description: "Clarify scope, momentum, blockers, and next action.",
              questionCount: 4,
              suggestedPrompt: "Want to do a project interview for Mabel?",
            },
          ],
        }),
        startInterview: async () => ({
          interviewId: "interview_123",
          assistantDisplayName: "Mabel",
          currentQuestion: {
            id: "project_current_state",
            prompt: "What is the current state of this project?",
          },
          progress: { answered: 0, total: 4 },
          suggestedPrompt: "Want to do a project interview for Mabel?",
          reviewUrl: "/interviews/interview_123",
        }),
      }),
      "brain_123",
    );
    const client = new Client({ name: "interview-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const templates = textResult(await client.callTool({ name: "list_interview_templates", arguments: {} }));
      expect(templates).toMatchObject({
        assistantDisplayName: "Mabel",
        templates: [
          {
            suggestedPrompt: "Want to do a project interview for Mabel?",
          },
        ],
      });

      const started = textResult(
        await client.callTool({
          name: "start_interview",
          arguments: {
            kind: "project",
            subjectLabel: "Skippy MCP and APP",
            startedBy: "codex",
          },
        }),
      );
      expect(started).toMatchObject({
        status: "active",
        assistantDisplayName: "Mabel",
        suggestedPrompt: "Want to do a project interview for Mabel?",
        currentQuestion: {
          prompt: "What is the current state of this project?",
        },
        nextAction: "Ask this in the harness chat: What is the current state of this project?",
        reviewUrl: "http://127.0.0.1:3000/interviews/interview_123",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("wires context bundle retrieval to the backend", async () => {
    const bundleCalls: Array<{ brainInstanceId: string; input: unknown }> = [];
    const server = createMcpServer(
      createFakeClient({
        getContextBundle: async (brainInstanceId, input) => {
          bundleCalls.push({ brainInstanceId, input });
          return {
            query: input.query,
            memories: [{ memory: { _id: "memory_123", title: "Rollout preference" }, score: 12 }],
            entities: [{ ref: { entityType: "project", entityId: "project_123" }, title: "Skippy" }],
            sourceRefs: [{ _id: "source_123", sourceSystem: "codex" }],
          };
        },
      }),
      "brain_123",
    );
    const client = new Client({ name: "context-bundle-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: "get_context_bundle",
        arguments: {
          query: " rollout preferences ",
          relatedEntityRefs: [{ entityType: "project", entityId: "project_123" }],
          memoryLimit: 5,
        },
      });

      expect(bundleCalls).toEqual([
        {
          brainInstanceId: "brain_123",
          input: {
            query: "rollout preferences",
            relatedEntityRefs: [{ entityType: "project", entityId: "project_123" }],
            memoryLimit: 5,
            entityLimit: 12,
            sourceLimit: 12,
          },
        },
      ]);
      expect(textResult(result)).toMatchObject({
        query: "rollout preferences",
        memories: [{ memory: { _id: "memory_123", title: "Rollout preference" }, score: 12 }],
        entities: [{ ref: { entityType: "project", entityId: "project_123" }, title: "Skippy" }],
        sourceRefs: [{ _id: "source_123", sourceSystem: "codex" }],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns chat-friendly confirmations for direct task creation and completion", async () => {
    const server = createMcpServer(createFakeClient(), "brain_123");
    const client = new Client({ name: "direct-confirmation-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const createResult = await client.callTool({
        name: "create_task",
        arguments: {
          title: "Improve confirmations",
          projectId: "project_123",
        },
      });

      expect(textResult(createResult)).toMatchObject({
        status: "created",
        entityType: "task",
        title: "Improve confirmations",
        entityId: "task_123",
        projectId: "project_123",
        reviewUrl: "http://127.0.0.1:3000/projects",
      });

      const inProgressResult = await client.callTool({
        name: "mark_task_in_progress",
        arguments: {
          taskId: "task_123",
          startedBy: "codex",
        },
      });

      expect(textResult(inProgressResult)).toMatchObject({
        status: "in_progress",
        entityType: "task",
        taskId: "task_123",
        startedBy: "codex",
        reviewUrl: "http://127.0.0.1:3000/projects",
      });

      const doneResult = await client.callTool({
        name: "mark_task_done",
        arguments: {
          taskId: "task_123",
        },
      });

      expect(textResult(doneResult)).toMatchObject({
        status: "done",
        entityType: "task",
        taskId: "task_123",
        reviewUrl: "http://127.0.0.1:3000/projects",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns chat-friendly confirmations for task briefing", async () => {
    const briefCalls: Array<{ brainInstanceId: string; input: unknown }> = [];
    const server = createMcpServer(
      createFakeClient({
        briefTask: async (brainInstanceId, input) => {
          briefCalls.push({ brainInstanceId, input });
          return { taskId: input.taskId, executionState: "briefed" };
        },
      }),
      "brain_123",
    );
    const client = new Client({ name: "brief-task-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: "brief_task",
        arguments: {
          taskId: "task_123",
          executionBrief: "  Add the mutation in convex/planning.ts following writeTaskBrief.  ",
          acceptanceCriteria: ["Ownership is validated.", "Task moves to briefed."],
          title: "Add brief_task MCP tool",
          kind: "coding",
        },
      });

      expect(briefCalls).toEqual([
        {
          brainInstanceId: "brain_123",
          input: {
            taskId: "task_123",
            executionBrief: "Add the mutation in convex/planning.ts following writeTaskBrief.",
            acceptanceCriteria: ["Ownership is validated.", "Task moves to briefed."],
            title: "Add brief_task MCP tool",
            kind: "coding",
            actorId: "skippy_mcp",
          },
        },
      ]);
      expect(textResult(result)).toMatchObject({
        status: "briefed",
        entityType: "task",
        taskId: "task_123",
        executionState: "briefed",
        reviewUrl: "http://127.0.0.1:3000/projects",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns chat-friendly confirmations for link status updates", async () => {
    const updateCalls: Array<{ brainInstanceId: string; input: unknown }> = [];
    const server = createMcpServer(
      createFakeClient({
        updateLinkStatus: async (brainInstanceId, input) => {
          updateCalls.push({ brainInstanceId, input });
          return { linkId: input.linkId, title: "Interesting article", status: input.status };
        },
      }),
      "brain_123",
    );
    const client = new Client({ name: "update-link-status-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: "update_link_status",
        arguments: {
          linkId: "link_123",
          status: "read",
          reason: "Ingested the article content during a sync.",
        },
      });

      expect(updateCalls).toEqual([
        {
          brainInstanceId: "brain_123",
          input: {
            linkId: "link_123",
            status: "read",
            reason: "Ingested the article content during a sync.",
            actorId: "skippy_mcp",
          },
        },
      ]);
      expect(textResult(result)).toMatchObject({
        status: "read",
        entityType: "link",
        linkId: "link_123",
        title: "Interesting article",
        reviewUrl: "http://127.0.0.1:3000/brain",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns the upload flow for project file upload URL generation", async () => {
    const urlCalls: string[] = [];
    const server = createMcpServer(
      createFakeClient({
        generateProjectFileUploadUrl: async (brainInstanceId) => {
          urlCalls.push(brainInstanceId);
          return "https://upload.convex.cloud/api/storage/upload_123";
        },
      }),
      "brain_123",
    );
    const client = new Client({ name: "upload-url-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: "generate_project_file_upload_url",
        arguments: { projectId: "project_123" },
      });

      expect(urlCalls).toEqual(["brain_123"]);
      const confirmation = textResult(result);
      expect(confirmation).toMatchObject({
        status: "upload_url_generated",
        entityType: "project_file",
        uploadUrl: "https://upload.convex.cloud/api/storage/upload_123",
      });
      expect(String(confirmation.nextAction)).toContain("{storageId}");
      expect(String(confirmation.nextAction)).toContain("register_project_file");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("maps register_project_file fields onto the brain client call", async () => {
    const registerCalls: Array<{ brainInstanceId: string; input: unknown }> = [];
    const server = createMcpServer(
      createFakeClient({
        registerProjectFile: async (brainInstanceId, input) => {
          registerCalls.push({ brainInstanceId, input });
          return {
            fileId: "project_file_123",
            projectId: input.projectId,
            taskId: input.taskId,
            fileName: input.fileName,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            uploadedBy: "harness",
          };
        },
      }),
      "brain_123",
    );
    const client = new Client({ name: "register-file-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: "register_project_file",
        arguments: {
          projectId: "project_123",
          taskId: "task_123",
          fileName: "brand-guidelines.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
          storageId: "storage_123",
          note: "Use for all deliverables.",
        },
      });

      expect(registerCalls).toEqual([
        {
          brainInstanceId: "brain_123",
          input: {
            projectId: "project_123",
            taskId: "task_123",
            fileName: "brand-guidelines.pdf",
            mimeType: "application/pdf",
            sizeBytes: 2048,
            storageId: "storage_123",
            note: "Use for all deliverables.",
            actorId: "skippy_mcp",
          },
        },
      ]);
      expect(textResult(result)).toMatchObject({
        status: "registered",
        entityType: "project_file",
        fileId: "project_file_123",
        projectId: "project_123",
        taskId: "task_123",
        fileName: "brand-guidelines.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        uploadedBy: "harness",
        reviewUrl: "http://127.0.0.1:3000/projects",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects register_project_file calls for disallowed file types", async () => {
    const server = createMcpServer(createFakeClient(), "brain_123");
    const client = new Client({ name: "register-file-reject-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: "register_project_file",
        arguments: {
          projectId: "project_123",
          fileName: "malware.exe",
          mimeType: "application/x-msdownload",
          sizeBytes: 2048,
          storageId: "storage_123",
        },
      });

      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      expect(content[0]?.text).toContain("not allowed in the project library");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns chat-friendly project file listings with ephemeral download URLs", async () => {
    const listCalls: Array<{ brainInstanceId: string; input: unknown }> = [];
    const server = createMcpServer(
      createFakeClient({
        listProjectFiles: async (brainInstanceId, input) => {
          listCalls.push({ brainInstanceId, input });
          return [
            {
              _id: "project_file_123",
              projectId: input.projectId,
              taskId: "task_123",
              fileName: "brand-guidelines.pdf",
              mimeType: "application/pdf",
              sizeBytes: 2048,
              uploadedBy: "user",
              note: "Use for all deliverables.",
              createdAt: 1780850000000,
              url: "https://files.convex.cloud/project_file_123?token=ephemeral",
            },
          ];
        },
      }),
      "brain_123",
    );
    const client = new Client({ name: "list-files-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: "list_project_files",
        arguments: { projectId: "project_123" },
      });

      expect(listCalls).toEqual([
        { brainInstanceId: "brain_123", input: { projectId: "project_123" } },
      ]);
      const confirmation = textResult(result);
      expect(confirmation).toMatchObject({
        status: "listed",
        entityType: "project_file",
        projectId: "project_123",
        count: 1,
      });
      expect(confirmation.files).toEqual([
        {
          fileId: "project_file_123",
          fileName: "brand-guidelines.pdf",
          sizeBytes: 2048,
          mimeType: "application/pdf",
          taskId: "task_123",
          note: "Use for all deliverables.",
          uploadedBy: "user",
          downloadUrl: "https://files.convex.cloud/project_file_123?token=ephemeral",
        },
      ]);
      expect(String(confirmation.nextAction)).toContain("ephemeral");
      expect(String(confirmation.nextAction)).toContain("effectiveAssetsPath");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns chat-friendly confirmations for pending action listing and result recording", async () => {
    const listCalls: Array<{ brainInstanceId: string; status?: string }> = [];
    const recordCalls: Array<{
      pendingActionId: string;
      result: {
        status: "sent" | "failed" | "completed";
        executionProvider?: string;
        externalMessageId?: string;
        error?: string;
      };
    }> = [];
    const server = createMcpServer(
      createFakeClient({
        listPendingActions: async (brainInstanceId, status) => {
          listCalls.push(status === undefined ? { brainInstanceId } : { brainInstanceId, status });
          return [
            {
              _id: "pending_action_123",
              actionType: "send_email",
              status: "approved",
              recipients: ["pat@example.com"],
              subject: "Follow up",
            },
          ];
        },
        recordPendingActionResult: async (pendingActionId, result) => {
          recordCalls.push({ pendingActionId, result });
          return { pendingActionId };
        },
      }),
      "brain_123",
    );
    const client = new Client({ name: "pending-action-confirmation-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const listResult = await client.callTool({
        name: "list_pending_actions",
        arguments: { status: "approved" },
      });

      expect(listCalls).toEqual([{ brainInstanceId: "brain_123", status: "approved" }]);
      expect(textResult(listResult)).toMatchObject({
        status: "listed",
        entityType: "pending_action",
        filterStatus: "approved",
        count: 1,
        pendingActions: [
          {
            _id: "pending_action_123",
            actionType: "send_email",
            status: "approved",
            subject: "Follow up",
          },
        ],
        reviewUrl: "http://127.0.0.1:3000/actions",
      });

      const recordResult = await client.callTool({
        name: "record_pending_action_result",
        arguments: {
          pendingActionId: "pending_action_123",
          status: "sent",
          executionProvider: "gmail",
          externalMessageId: "gmail_message_123",
        },
      });

      expect(recordCalls).toEqual([
        {
          pendingActionId: "pending_action_123",
          result: {
            pendingActionId: "pending_action_123",
            status: "sent",
            executionProvider: "gmail",
            externalMessageId: "gmail_message_123",
          },
        },
      ]);
      expect(textResult(recordResult)).toMatchObject({
        status: "sent",
        entityType: "pending_action",
        pendingActionId: "pending_action_123",
        executionProvider: "gmail",
        externalMessageId: "gmail_message_123",
        reviewUrl: "http://127.0.0.1:3000/actions",
        nextAction: "Execution result recorded in Skippy.",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("wires financial account upsert and bulk transaction ingestion with counts", async () => {
    const accountCalls: Array<{ brainInstanceId: string; input: unknown }> = [];
    const transactionCalls: Array<{ brainInstanceId: string; input: unknown }> = [];
    const server = createMcpServer(
      createFakeClient({
        upsertFinancialAccount: async (brainInstanceId, input) => {
          accountCalls.push({ brainInstanceId, input });
          return {
            accountId: "financial_account_123",
            status: "created",
            name: input.name,
            accountType: input.accountType,
            mask: input.mask,
          };
        },
        recordFinancialTransactions: async (brainInstanceId, input) => {
          transactionCalls.push({ brainInstanceId, input });
          return {
            accountId: input.accountId,
            accountName: "Chase Checking",
            source: input.source ?? "plaid",
            inserted: 1,
            updated: 1,
            skipped: 0,
          };
        },
      }),
      "brain_123",
    );
    const client = new Client({ name: "financial-tools-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const accountResult = await client.callTool({
        name: "upsert_financial_account",
        arguments: {
          name: "Chase Checking",
          accountType: "Family Shared",
          mask: "4321",
          institution: "Chase",
          plaidAccountId: "plaid_acct_1",
        },
      });

      expect(accountCalls).toEqual([
        {
          brainInstanceId: "brain_123",
          input: {
            name: "Chase Checking",
            accountType: "Family Shared",
            mask: "4321",
            institution: "Chase",
            plaidAccountId: "plaid_acct_1",
            actorId: "skippy_mcp",
          },
        },
      ]);
      expect(textResult(accountResult)).toMatchObject({
        status: "created",
        entityType: "financial_account",
        accountId: "financial_account_123",
        title: "Chase Checking",
        accountType: "Family Shared",
        mask: "4321",
        reviewUrl: "http://127.0.0.1:3000/finances",
      });

      const transactionsResult = await client.callTool({
        name: "record_financial_transactions",
        arguments: {
          accountId: "financial_account_123",
          transactions: [
            {
              date: 1780850000000,
              amountCents: 4599,
              description: "Kroger",
              txType: "Fixed Costs",
              category: "Groceries",
              externalId: "plaid_tx_1",
            },
            {
              date: 1780851000000,
              amountCents: 500000,
              description: "Payroll",
              txType: "Income",
              category: "Jeff",
              externalId: "plaid_tx_2",
            },
          ],
        },
      });

      expect(transactionCalls).toEqual([
        {
          brainInstanceId: "brain_123",
          input: {
            accountId: "financial_account_123",
            source: "plaid",
            actorId: "skippy_mcp",
            transactions: [
              {
                date: 1780850000000,
                amountCents: 4599,
                description: "Kroger",
                txType: "Fixed Costs",
                category: "Groceries",
                externalId: "plaid_tx_1",
              },
              {
                date: 1780851000000,
                amountCents: 500000,
                description: "Payroll",
                txType: "Income",
                category: "Jeff",
                externalId: "plaid_tx_2",
              },
            ],
          },
        },
      ]);
      expect(textResult(transactionsResult)).toMatchObject({
        status: "recorded",
        entityType: "financial_transactions",
        accountId: "financial_account_123",
        title: "Chase Checking",
        source: "plaid",
        submitted: 2,
        inserted: 1,
        updated: 1,
        skipped: 0,
        reviewUrl: "http://127.0.0.1:3000/finances",
      });

      const invalidPair = await client.callTool({
        name: "record_financial_transactions",
        arguments: {
          accountId: "financial_account_123",
          transactions: [
            {
              date: 1780850000000,
              amountCents: 4599,
              description: "Kroger",
              txType: "Guilt-Free",
              category: "Groceries",
            },
          ],
        },
      });
      expect(invalidPair.isError).toBe(true);
      expect(JSON.stringify(invalidPair.content)).toContain("invalid category");
      expect(transactionCalls).toHaveLength(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("wires daily balance ingestion with idempotent upsert counts", async () => {
    const balanceCalls: Array<{ brainInstanceId: string; input: unknown }> = [];
    const server = createMcpServer(
      createFakeClient({
        recordFinancialBalances: async (brainInstanceId, input) => {
          balanceCalls.push({ brainInstanceId, input });
          return {
            accountId: input.accountId,
            accountName: "Chase Checking",
            source: input.source ?? "plaid_derived",
            inserted: 2,
            updated: 1,
          };
        },
      }),
      "brain_123",
    );
    const client = new Client({ name: "financial-balances-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: "record_financial_balances",
        arguments: {
          accountId: "financial_account_123",
          balances: [
            { date: 1780790400000, endOfDayBalanceCents: 123456 },
            { date: 1780876800000, endOfDayBalanceCents: 120000 },
            { date: 1780963200000, endOfDayBalanceCents: -4500 },
          ],
        },
      });

      expect(balanceCalls).toEqual([
        {
          brainInstanceId: "brain_123",
          input: {
            accountId: "financial_account_123",
            source: "plaid_derived",
            actorId: "skippy_mcp",
            balances: [
              { date: 1780790400000, endOfDayBalanceCents: 123456 },
              { date: 1780876800000, endOfDayBalanceCents: 120000 },
              { date: 1780963200000, endOfDayBalanceCents: -4500 },
            ],
          },
        },
      ]);
      expect(textResult(result)).toMatchObject({
        status: "recorded",
        entityType: "financial_balances",
        accountId: "financial_account_123",
        title: "Chase Checking",
        source: "plaid_derived",
        submitted: 3,
        inserted: 2,
        updated: 1,
        reviewUrl: "http://127.0.0.1:3000/finances",
      });

      const invalidCents = await client.callTool({
        name: "record_financial_balances",
        arguments: {
          accountId: "financial_account_123",
          balances: [{ date: 1780790400000, endOfDayBalanceCents: 1234.56 }],
        },
      });
      expect(invalidCents.isError).toBe(true);
      // Rejected by the zod .int() input schema or the handler's integer-cents guard.
      expect(JSON.stringify(invalidCents.content)).toMatch(/int/i);
      expect(balanceCalls).toHaveLength(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns monthly financial reports with review URLs", async () => {
    const reportCalls: Array<{ brainInstanceId: string; input: unknown }> = [];
    const server = createMcpServer(
      createFakeClient({
        getFinancialReport: async (brainInstanceId, input) => {
          reportCalls.push({ brainInstanceId, input });
          return {
            monthKey: input.monthKey,
            previousMonthKey: "2026-05",
            account: { _id: input.accountId, name: "Chase Checking" },
            current: { totalOutgoingCents: 500000, totalIncomingCents: 800000, netCents: 300000 },
          };
        },
      }),
      "brain_123",
    );
    const client = new Client({ name: "financial-report-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: "get_financial_report",
        arguments: { accountId: "financial_account_123", monthKey: "2026-06" },
      });

      expect(reportCalls).toEqual([
        {
          brainInstanceId: "brain_123",
          input: { accountId: "financial_account_123", monthKey: "2026-06" },
        },
      ]);
      expect(textResult(result)).toMatchObject({
        status: "report",
        entityType: "financial_report",
        accountId: "financial_account_123",
        monthKey: "2026-06",
        previousMonthKey: "2026-05",
        current: { netCents: 300000 },
        reviewUrl: "http://127.0.0.1:3000/finances",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
