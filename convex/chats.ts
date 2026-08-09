/**
 * Page-aware conversational chat (docs/mac-mini-agent-workbench.md → General
 * chat behavior). This is the LIGHTWEIGHT path: no run record, lease, or
 * worktree — replies come from the brain's configured LLM provider with
 * page/project context. Code-changing work stays on the run machinery in
 * convex/agentWorkbench.ts.
 *
 * Scope resolution: a chat belongs to exactly one of
 *   - a project  (projectId → that project's General chat), or
 *   - a page     (pageKey: "home" | "agenda" | "finances" | ...).
 */
import {
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import { createLlmClient, type AiProviderConfig } from "@skippy/ai";
import { requireOwnedBrain } from "./auth";

const replyContextRef = makeFunctionReference<"query">("chats:replyContext");
const finishReplyRef = makeFunctionReference<"mutation">("chats:finishReply");
const generateReplyRef = makeFunctionReference<"action">("chats:generateReply");

/** How many prior turns ride along as conversation context. */
const HISTORY_LIMIT = 20;
const MAX_MESSAGE_CHARS = 8000;

const PAGE_DESCRIPTIONS: Record<string, string> = {
  home: "the Skippy home page: quick capture inbox, focus summary, and recent activity",
  agenda: "the Agenda page: today's tasks, calendar events, and recurring obligations",
  finances: "the Finances page: accounts, transactions, budgets, and debts",
  review: "the Review page: pending knowledge triage and memory review queues",
  projects: "the Projects overview page listing all active projects",
  brain: "the Brain page: stored memories, principles, decisions, and knowledge",
  skills: "the Skills page: reusable harness skill documents",
  settings: "the Settings page: brain configuration, tokens, and agent hosts",
};

function chatTitleForScope(pageKey: string | undefined, projectTitle: string | undefined): string {
  if (projectTitle) return `General · ${projectTitle}`;
  const key = pageKey ?? "home";
  return `${key.charAt(0).toUpperCase()}${key.slice(1)} chat`;
}

async function findChatForScope(db: any, brainInstanceId: any, projectId?: string, pageKey?: string) {
  if (projectId) {
    const chats = await db
      .query("projectChats")
      .withIndex("by_brain_project", (q: any) => q.eq("brainInstanceId", brainInstanceId).eq("projectId", projectId))
      .collect();
    return chats.find((c: any) => c.kind === "general" && c.state !== "archived") ?? null;
  }
  const chats = await db
    .query("projectChats")
    .withIndex("by_brain_page", (q: any) => q.eq("brainInstanceId", brainInstanceId).eq("pageKey", pageKey))
    .collect();
  return chats.find((c: any) => c.state !== "archived") ?? null;
}

/* ------------------------------------------------------------------ */
/* Viewer surface                                                     */
/* ------------------------------------------------------------------ */

/** The chat and transcript for a scope; null chat until the first message. */
export const chatForScopeForViewer = queryGeneric({
  args: {
    projectId: v.optional(v.id("projects")),
    pageKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    if (!args.projectId && !args.pageKey) throw new Error("projectId or pageKey is required");
    const chat = await findChatForScope(ctx.db, brain._id, args.projectId, args.pageKey);
    if (!chat) return { chat: null, messages: [] };
    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_chat", (q: any) => q.eq("chatId", chat._id))
      .collect();
    return {
      chat: { _id: chat._id, title: chat.title, kind: chat.kind },
      messages: messages.map((m: any) => ({
        _id: m._id,
        role: m.role,
        content: m.content,
        status: m.status,
        error: m.error,
        createdAt: m.createdAt,
      })),
    };
  },
});

export const sendChatMessageForViewer = mutationGeneric({
  args: {
    projectId: v.optional(v.id("projects")),
    pageKey: v.optional(v.string()),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    if (!args.projectId && !args.pageKey) throw new Error("projectId or pageKey is required");
    const content = args.content.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!content) throw new Error("message cannot be empty");

    const now = Date.now();
    let chat = await findChatForScope(ctx.db, brain._id, args.projectId, args.pageKey);
    let chatId = chat?._id;
    if (!chatId) {
      let projectTitle: string | undefined;
      if (args.projectId) {
        const project = await ctx.db.get(args.projectId);
        if (!project || project.brainInstanceId !== brain._id) throw new Error("project not found");
        projectTitle = project.title;
      }
      chatId = await ctx.db.insert("projectChats", {
        brainInstanceId: brain._id,
        ...(args.projectId ? { projectId: args.projectId } : { pageKey: args.pageKey }),
        title: chatTitleForScope(args.pageKey, projectTitle),
        kind: args.projectId ? "general" : "page",
        state: "active",
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(chatId, { updatedAt: now });
    }

    await ctx.db.insert("chatMessages", {
      brainInstanceId: brain._id,
      chatId,
      role: "user",
      content,
      status: "complete",
      createdAt: now,
    });
    // The pending row renders as "thinking" until generateReply patches it.
    const assistantMessageId = await ctx.db.insert("chatMessages", {
      brainInstanceId: brain._id,
      chatId,
      role: "assistant",
      content: "",
      status: "pending",
      createdAt: now + 1,
    });
    await ctx.scheduler.runAfter(0, generateReplyRef, {
      brainInstanceId: brain._id,
      chatId,
      assistantMessageId,
    });
    return { chatId, assistantMessageId };
  },
});

/* ------------------------------------------------------------------ */
/* Reply generation                                                   */
/* ------------------------------------------------------------------ */

export const replyContext = internalQueryGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    chatId: v.id("projectChats"),
  },
  handler: async (ctx, args) => {
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.brainInstanceId !== args.brainInstanceId) throw new Error("chat not found");
    const config = await ctx.db
      .query("brainConfigs")
      .withIndex("by_brain", (q: any) => q.eq("brainInstanceId", args.brainInstanceId))
      .first();

    let scopeContext = "";
    if (chat.projectId) {
      const project = await ctx.db.get(chat.projectId);
      if (project) {
        const parts = [
          `The user is viewing the project "${project.title}" (status: ${project.status}).`,
          project.summary ? `Project summary: ${project.summary}` : "",
          project.kind === "code" && project.repoUrl ? `Code project, repo: ${project.repoUrl}` : "",
        ];
        scopeContext = parts.filter(Boolean).join("\n");
      }
    } else {
      const description = PAGE_DESCRIPTIONS[chat.pageKey ?? ""] ?? `the ${chat.pageKey} page`;
      scopeContext = `The user is viewing ${description}.`;
    }

    const all = await ctx.db
      .query("chatMessages")
      .withIndex("by_chat", (q: any) => q.eq("chatId", args.chatId))
      .collect();
    const history = all
      .filter((m: any) => m.status === "complete" && m.content)
      .slice(-HISTORY_LIMIT)
      .map((m: any) => ({ role: m.role, content: m.content }));

    return {
      assistantName: config?.assistantDisplayName ?? "Skippy",
      aiMode: config?.llmProviderMode ?? "none",
      synthesisModel: config?.synthesisModel,
      scopeContext,
      history,
    };
  },
});

export const finishReply = internalMutationGeneric({
  args: {
    assistantMessageId: v.id("chatMessages"),
    content: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.assistantMessageId);
    if (!message || message.status !== "pending") return;
    if (args.error) {
      await ctx.db.patch(args.assistantMessageId, {
        status: "error",
        error: args.error,
        content: "",
      });
    } else {
      await ctx.db.patch(args.assistantMessageId, {
        status: "complete",
        content: (args.content ?? "").slice(0, MAX_MESSAGE_CHARS),
      });
    }
  },
});

export const generateReply = internalActionGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    chatId: v.id("projectChats"),
    assistantMessageId: v.id("chatMessages"),
  },
  handler: async (ctx, args) => {
    try {
      const context: any = await ctx.runQuery(replyContextRef, {
        brainInstanceId: args.brainInstanceId,
        chatId: args.chatId,
      });
      if (!context.aiMode || context.aiMode === "none") {
        throw new Error("No LLM provider configured. Set one in Settings to enable chat.");
      }
      const config: AiProviderConfig = {
        mode: context.aiMode as AiProviderConfig["mode"],
        ...(context.synthesisModel ? { synthesisModel: context.synthesisModel } : {}),
      };
      const client = createLlmClient(config);

      const system = [
        `You are ${context.assistantName}, the user's supervised second-brain assistant inside the Skippy web app.`,
        context.scopeContext,
        "Answer conversationally and concisely. You cannot edit code or execute tasks from this chat — code work goes through a project task's Execute action on its board. When the user asks for code changes, point them there.",
      ]
        .filter(Boolean)
        .join("\n\n");
      const transcript = context.history
        .map((m: any) => `${m.role === "user" ? "User" : context.assistantName}: ${m.content}`)
        .join("\n\n");

      const result = await client.complete({
        system,
        input: transcript || "User: (empty)",
        maxTokens: 1500,
        usedFor: "page_chat_reply",
      });
      await ctx.runMutation(finishReplyRef, {
        assistantMessageId: args.assistantMessageId,
        content: result.text,
      });
    } catch (error: unknown) {
      await ctx.runMutation(finishReplyRef, {
        assistantMessageId: args.assistantMessageId,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      });
    }
  },
});
