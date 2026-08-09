/**
 * Page-aware conversational chat, executed by the Mac mini runner's LOCAL
 * harnesses (Claude Code / Codex CLI under the user's own subscription auth).
 *
 * Deliberately NOT a metered LLM API call: a chat turn is a queued work item
 * (chatTurns) that a host claims exactly like an agent run — same token auth,
 * same lease model — but without worktree/verify/publish machinery. The
 * harness runs with the same local capabilities as a terminal session; gated
 * actions flow through agentApprovals (chatTurnId variant) and surface as
 * approval cards in the chat panel.
 *
 * Scope resolution: a chat belongs to exactly one of
 *   - a project  (projectId → that project's General chat), or
 *   - a page     (pageKey: "home" | "agenda" | "finances" | ...).
 * A chat is bound to ONE harness for its lifetime (conversation context lives
 * in the harness's own thread/session).
 */
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireOwnedBrain } from "./auth";
import { requireHost } from "./agentWorkbench";

const CHAT_LEASE_MS = 150_000;
const HISTORY_LIMIT = 20;
const MAX_MESSAGE_CHARS = 8000;

const harnessArg = v.union(v.literal("codex"), v.literal("claude"));

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

function makeToken(prefix: string) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const body = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${prefix}_${body}`;
}

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

async function activeTurnForChat(db: any, chatId: any) {
  const turns = await db
    .query("chatTurns")
    .withIndex("by_chat", (q: any) => q.eq("chatId", chatId))
    .collect();
  return turns.find((t: any) => ["queued", "claimed", "running"].includes(t.status)) ?? null;
}

/* ------------------------------------------------------------------ */
/* Viewer surface                                                     */
/* ------------------------------------------------------------------ */

/** Chat, transcript, active turn, and pending approvals for a scope. */
export const chatForScopeForViewer = queryGeneric({
  args: {
    projectId: v.optional(v.id("projects")),
    pageKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    if (!args.projectId && !args.pageKey) throw new Error("projectId or pageKey is required");
    const chat = await findChatForScope(ctx.db, brain._id, args.projectId, args.pageKey);
    if (!chat) return { chat: null, messages: [], pendingApprovals: [] };

    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_chat", (q: any) => q.eq("chatId", chat._id))
      .collect();
    const activeTurn = await activeTurnForChat(ctx.db, chat._id);
    let pendingApprovals: any[] = [];
    if (activeTurn) {
      const approvals = await ctx.db
        .query("agentApprovals")
        .withIndex("by_chat_turn", (q: any) => q.eq("chatTurnId", activeTurn._id))
        .collect();
      pendingApprovals = approvals
        .filter((a: any) => a.status === "pending")
        .map((a: any) => ({
          _id: a._id,
          kind: a.kind,
          title: a.title,
          explanation: a.explanation,
          details: a.details,
        }));
    }
    return {
      chat: { _id: chat._id, title: chat.title, kind: chat.kind, harness: chat.harness },
      activeTurnStatus: activeTurn?.status ?? null,
      pendingApprovals,
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
    harness: v.optional(harnessArg),
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
        // One harness per chat for its lifetime; picked on first message.
        harness: args.harness ?? "claude",
        state: "active",
        createdAt: now,
        updatedAt: now,
      });
      chat = await ctx.db.get(chatId);
    } else {
      if (!chat.harness) {
        await ctx.db.patch(chatId, { harness: args.harness ?? "claude", updatedAt: now });
        chat = await ctx.db.get(chatId);
      } else {
        await ctx.db.patch(chatId, { updatedAt: now });
      }
    }

    const userMessageId = await ctx.db.insert("chatMessages", {
      brainInstanceId: brain._id,
      chatId,
      role: "user",
      content,
      status: "complete",
      createdAt: now,
    });
    // Renders as "thinking" until the runner completes the turn.
    const assistantMessageId = await ctx.db.insert("chatMessages", {
      brainInstanceId: brain._id,
      chatId,
      role: "assistant",
      content: "",
      status: "pending",
      createdAt: now + 1,
    });
    await ctx.db.insert("chatTurns", {
      brainInstanceId: brain._id,
      chatId,
      userMessageId,
      assistantMessageId,
      harness: chat.harness,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });
    return { chatId, assistantMessageId };
  },
});

/* ------------------------------------------------------------------ */
/* Host surface (runner)                                              */
/* ------------------------------------------------------------------ */

export const claimNextChatTurn = mutationGeneric({
  args: { hostToken: v.string() },
  handler: async (ctx, { hostToken }) => {
    const host = await requireHost(ctx, hostToken);
    if (host.draining) return null;
    const now = Date.now();
    const harnesses: string[] = host.capabilities?.harnesses ?? [];

    const queued = await ctx.db
      .query("chatTurns")
      .withIndex("by_brain_status", (q: any) => q.eq("brainInstanceId", host.brainInstanceId).eq("status", "queued"))
      .collect();
    queued.sort((a: any, b: any) => a.createdAt - b.createdAt);

    for (const turn of queued) {
      if (!harnesses.includes(turn.harness)) continue;
      // Turns within one chat run strictly in order — skip a chat that already
      // has a claimed/running turn (the harness thread is sequential).
      const siblings = await ctx.db
        .query("chatTurns")
        .withIndex("by_chat", (q: any) => q.eq("chatId", turn.chatId))
        .collect();
      const busy = siblings.some(
        (t: any) => t._id !== turn._id && (t.status === "claimed" || t.status === "running"),
      );
      if (busy) continue;

      const chat = await ctx.db.get(turn.chatId);
      if (!chat || chat.state === "archived") continue;
      const userMessage = await ctx.db.get(turn.userMessageId);

      // Scope context + working directory for the harness.
      let scopeContext = "";
      let cwd: string | undefined;
      if (chat.projectId) {
        const project = await ctx.db.get(chat.projectId);
        const config = await ctx.db
          .query("projectExecutionConfigs")
          .withIndex("by_brain_project", (q: any) =>
            q.eq("brainInstanceId", host.brainInstanceId).eq("projectId", chat.projectId),
          )
          .first();
        if (config?.hostId === host._id) cwd = config.localPath;
        if (project) {
          scopeContext = [
            `The user is chatting from the project "${project.title}" (status: ${project.status}).`,
            project.summary ? `Project summary: ${project.summary}` : "",
            project.repoUrl ? `Repository: ${project.repoUrl}` : "",
            cwd ? `The project checkout is your working directory.` : "",
          ]
            .filter(Boolean)
            .join("\n");
        }
      } else {
        const description = PAGE_DESCRIPTIONS[chat.pageKey ?? ""] ?? `the ${chat.pageKey} page of the Skippy app`;
        scopeContext = `The user is chatting from ${description}.`;
      }

      // Transcript for thread bootstrap (resumed threads only need the new turn).
      const all = await ctx.db
        .query("chatMessages")
        .withIndex("by_chat", (q: any) => q.eq("chatId", turn.chatId))
        .collect();
      const history = all
        .filter((m: any) => m.status === "complete" && m.content && m._id !== turn.userMessageId)
        .slice(-HISTORY_LIMIT)
        .map((m: any) => ({ role: m.role, content: m.content }));

      const claimToken = makeToken("skippychat");
      await ctx.db.patch(turn._id, {
        status: "claimed",
        hostId: host._id,
        claimToken,
        leaseExpiresAt: now + CHAT_LEASE_MS,
        updatedAt: now,
      });
      await ctx.db.patch(host._id, { lastClaimAt: now, updatedAt: now });

      return {
        turnId: turn._id,
        claimToken,
        chatId: turn.chatId,
        harness: turn.harness,
        externalThreadId: chat.externalThreadId,
        scopeContext,
        cwd,
        history,
        userContent: userMessage?.content ?? "",
      };
    }
    return null;
  },
});

async function requireClaimedTurn(ctx: any, host: any, turnId: string, claimToken: string) {
  const turn = await ctx.db.get(turnId);
  if (!turn || turn.brainInstanceId !== host.brainInstanceId) throw new Error("chat turn not found");
  if (turn.hostId !== host._id || !turn.claimToken || turn.claimToken !== claimToken) {
    throw new Error("chat turn is not claimed by this host");
  }
  return turn;
}

export const markChatTurnRunning = mutationGeneric({
  args: { hostToken: v.string(), turnId: v.id("chatTurns"), claimToken: v.string() },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken);
    const turn = await requireClaimedTurn(ctx, host, args.turnId, args.claimToken);
    if (turn.status === "claimed") {
      await ctx.db.patch(args.turnId, { status: "running", updatedAt: Date.now() });
    }
    return { turnId: args.turnId };
  },
});

export const requestChatApproval = mutationGeneric({
  args: {
    hostToken: v.string(),
    turnId: v.id("chatTurns"),
    claimToken: v.string(),
    harnessRequestId: v.string(),
    kind: v.union(
      v.literal("command"),
      v.literal("file_change"),
      v.literal("network"),
      v.literal("secret"),
      v.literal("push"),
      v.literal("pr"),
      v.literal("deployment"),
      v.literal("user_input"),
    ),
    title: v.string(),
    explanation: v.optional(v.string()),
    details: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken);
    await requireClaimedTurn(ctx, host, args.turnId, args.claimToken);
    const existing = await ctx.db
      .query("agentApprovals")
      .withIndex("by_chat_turn_request", (q: any) =>
        q.eq("chatTurnId", args.turnId).eq("harnessRequestId", args.harnessRequestId),
      )
      .first();
    if (existing) return { approvalId: existing._id, status: existing.status };
    const now = Date.now();
    const approvalId = await ctx.db.insert("agentApprovals", {
      brainInstanceId: host.brainInstanceId,
      chatTurnId: args.turnId,
      harnessRequestId: args.harnessRequestId,
      kind: args.kind,
      title: args.title,
      explanation: args.explanation,
      details: args.details,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    return { approvalId, status: "pending" };
  },
});

export const chatTurnControlState = queryGeneric({
  args: { hostToken: v.string(), turnId: v.id("chatTurns") },
  handler: async (ctx, { hostToken, turnId }) => {
    const host = await requireHost(ctx, hostToken);
    const turn = await ctx.db.get(turnId);
    if (!turn || turn.brainInstanceId !== host.brainInstanceId) throw new Error("chat turn not found");
    const approvals = await ctx.db
      .query("agentApprovals")
      .withIndex("by_chat_turn", (q: any) => q.eq("chatTurnId", turnId))
      .collect();
    return {
      status: turn.status,
      cancelRequested: turn.cancelRequested ?? false,
      approvals: approvals.map((a: any) => ({
        harnessRequestId: a.harnessRequestId,
        status: a.status,
      })),
    };
  },
});

export const completeChatTurn = mutationGeneric({
  args: {
    hostToken: v.string(),
    turnId: v.id("chatTurns"),
    claimToken: v.string(),
    resultText: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    externalThreadId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken);
    const turn = await requireClaimedTurn(ctx, host, args.turnId, args.claimToken);
    if (turn.status === "completed" || turn.status === "failed" || turn.status === "cancelled") {
      return { turnId: args.turnId, status: turn.status };
    }
    const now = Date.now();
    const failed = Boolean(args.errorMessage);
    if (failed) {
      await ctx.db.patch(turn.assistantMessageId, {
        status: "error",
        error: (args.errorMessage ?? "chat turn failed").slice(0, 500),
        content: "",
      });
    } else {
      await ctx.db.patch(turn.assistantMessageId, {
        status: "complete",
        content: (args.resultText ?? "").slice(0, MAX_MESSAGE_CHARS) || "(no reply)",
      });
    }
    await ctx.db.patch(args.turnId, {
      status: failed ? "failed" : "completed",
      ...(failed ? { errorMessage: (args.errorMessage ?? "").slice(0, 500) } : {}),
      updatedAt: now,
    });
    if (args.externalThreadId) {
      await ctx.db.patch(turn.chatId, { externalThreadId: args.externalThreadId, updatedAt: now });
    }
    // Nothing should stay waiting on a finished turn.
    const approvals = await ctx.db
      .query("agentApprovals")
      .withIndex("by_chat_turn", (q: any) => q.eq("chatTurnId", args.turnId))
      .collect();
    for (const approval of approvals) {
      if (approval.status === "pending") {
        await ctx.db.patch(approval._id, { status: "cancelled", updatedAt: now });
      }
    }
    return { turnId: args.turnId, status: failed ? "failed" : "completed" };
  },
});
