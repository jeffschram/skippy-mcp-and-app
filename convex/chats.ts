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
import {
  internalMutationGeneric,
  makeFunctionReference,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import { effectiveProjectPaths, validateProjectFileInput } from "@skippy/shared";
import { requireOwnedBrain } from "./auth";
import { requireHost } from "./agentWorkbench";
import { tokenUsage } from "./schema";
import { chatHistoryWindow, shouldRefreshHistorySummary } from "./chatHistoryHelpers";
import { CHAT_LEASE_MS, isChatTurnLeaseExpired } from "./chatLeaseHelpers";

const MAX_MESSAGE_CHARS = 8000;
/** Max files attachable to a single chat message. */
const MAX_MESSAGE_ATTACHMENTS = 8;
const refreshChatHistorySummaryRef = makeFunctionReference<"action">("chatHistorySummary:refresh");

const attachmentArg = v.union(
  v.object({ fileId: v.id("projectFiles") }),
  v.object({ storageId: v.id("_storage"), fileName: v.string(), mimeType: v.string(), sizeBytes: v.number() }),
);

/** Resolve short-lived download URLs for a message's attachments at read time. */
async function attachmentsWithUrls(
  ctx: any,
  attachments: Array<any> | undefined,
) {
  if (!attachments?.length) return undefined;
  const resolved = [];
  for (const attachment of attachments) {
    const file = attachment.fileId ? await ctx.db.get(attachment.fileId) : undefined;
    if (attachment.fileId && (!file || (file.status ?? "ready") !== "ready")) continue;
    const storageId = file?.storageId ?? attachment.storageId;
    resolved.push({
      fileId: file?._id,
      fileName: file?.fileName ?? attachment.fileName,
      mimeType: file?.mimeType ?? attachment.mimeType,
      sizeBytes: file?.sizeBytes ?? attachment.sizeBytes,
      sha256: file?.sha256,
      // Time-limited URL — resolved fresh on every read, never persisted.
      url: storageId ? await ctx.storage.getUrl(storageId) : null,
    });
  }
  return resolved;
}

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

async function expireStaleChatTurns(ctx: any, brainInstanceId: any, now: number) {
  const activeTurns = (
    await Promise.all(
      ["claimed", "running"].map((status) =>
        ctx.db
          .query("chatTurns")
          .withIndex("by_brain_status", (q: any) =>
            q.eq("brainInstanceId", brainInstanceId).eq("status", status),
          )
          .collect(),
      ),
    )
  ).flat();

  let expired = 0;
  for (const turn of activeTurns) {
    if (!isChatTurnLeaseExpired(turn, now, CHAT_LEASE_MS)) continue;
    expired += 1;

    const errorMessage = "The runner connection was interrupted before this reply completed. Please try again.";
    const assistantMessage = await ctx.db.get(turn.assistantMessageId);
    if (assistantMessage?.status === "pending") {
      await ctx.db.patch(turn.assistantMessageId, {
        status: "error",
        content: "",
        error: errorMessage,
        completedAt: now,
      });
    }
    await ctx.db.patch(turn._id, {
      status: "failed",
      errorMessage,
      hostId: undefined,
      claimToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    await deleteTurnEvents(ctx, turn._id);

    const approvals = await ctx.db
      .query("agentApprovals")
      .withIndex("by_chat_turn", (q: any) => q.eq("chatTurnId", turn._id))
      .collect();
    for (const approval of approvals) {
      if (approval.status === "pending") {
        await ctx.db.patch(approval._id, { status: "expired", updatedAt: now });
      }
    }
  }
  return expired;
}

/**
 * Cron entry point (convex/crons.ts) — sweep every brain, not just the one a
 * host is polling for.
 *
 * Incident 2026-09-02: expireStaleChatTurns only ran inside claimNextChatTurn,
 * so the sweep required a live runner. When a chat turn restarted the runner
 * that owned it, the turn died with its host and nothing was left to expire it:
 * the chat panel spun indefinitely and the turn held a claimed lease for as
 * long as the runner stayed down (16+ minutes, three times over). Expiry must
 * not depend on the thing that failed.
 */
export const sweepStaleChatTurns = internalMutationGeneric({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const brains = await ctx.db.query("brainInstances").collect();
    let expired = 0;
    for (const brain of brains) {
      expired += await expireStaleChatTurns(ctx, brain._id, now);
    }
    return { brains: brains.length, expired };
  },
});

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
    let activeTurnEvents: any[] = [];
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
      // Live harness activity for the in-flight turn so the panel can show
      // real progress (commands, edits, narration) instead of bare "Thinking".
      const events = await ctx.db
        .query("chatTurnEvents")
        .withIndex("by_turn_seq", (q: any) => q.eq("chatTurnId", activeTurn._id))
        .collect();
      activeTurnEvents = events
        .sort((a: any, b: any) => a.seq - b.seq)
        .slice(-40)
        .map((event: any) => ({
          seq: event.seq,
          type: event.type,
          payload: event.payload,
          createdAt: event.createdAt,
        }));
    }
    return {
      chat: { _id: chat._id, title: chat.title, kind: chat.kind, harness: chat.harness },
      activeTurnStatus: activeTurn?.status ?? null,
      pendingApprovals,
      activeTurnEvents,
      messages: await Promise.all(
        messages.map(async (m: any) => ({
          _id: m._id,
          role: m.role,
          content: m.content,
          attachments: await attachmentsWithUrls(ctx, m.attachments),
          status: m.status,
          error: m.error,
          createdAt: m.createdAt,
          completedAt: m.completedAt,
        })),
      ),
    };
  },
});

export const sendChatMessageForViewer = mutationGeneric({
  args: {
    projectId: v.optional(v.id("projects")),
    pageKey: v.optional(v.string()),
    content: v.string(),
    harness: v.optional(harnessArg),
    // Files already uploaded + registered in the project library by the
    // composer; referenced here so the message renders them and the runner
    // can hand them to the harness. Project chats only in v1.
    attachments: v.optional(v.array(attachmentArg)),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    if (!args.projectId && !args.pageKey) throw new Error("projectId or pageKey is required");
    const content = args.content.trim().slice(0, MAX_MESSAGE_CHARS);
    const attachments = args.attachments ?? [];
    if (!content && !attachments.length) throw new Error("message cannot be empty");
    if (attachments.length) {
      // v1: attachments ride the project library, so page chats reject them.
      if (!args.projectId) throw new Error("attachments are only supported in project chats");
      if (attachments.length > MAX_MESSAGE_ATTACHMENTS) {
        throw new Error(`too many attachments (max ${MAX_MESSAGE_ATTACHMENTS} per message)`);
      }
      // Same size/type gate as the library register path — the composer
      // pre-checks, but the mutation is the real boundary.
      for (const attachment of attachments) {
        if ("fileId" in attachment) {
          const file = await ctx.db.get(attachment.fileId);
          if (!file || file.brainInstanceId !== brain._id || file.projectId !== args.projectId || (file.status ?? "ready") !== "ready") {
            throw new Error("attachment file is not a ready file in this project");
          }
        } else validateProjectFileInput(attachment);
      }
    }

    const now = Date.now();
    let chat = await findChatForScope(ctx.db, brain._id, args.projectId, args.pageKey);
    let chatId = chat?._id;
    if (!chatId) {
      let projectTitle: string | undefined;
      let preferredHarness: "codex" | "claude" | undefined;
      if (args.projectId) {
        const project = await ctx.db.get(args.projectId);
        if (!project || project.brainInstanceId !== brain._id) throw new Error("project not found");
        projectTitle = project.title;
        const executionConfig = await ctx.db
          .query("projectExecutionConfigs")
          .withIndex("by_brain_project", (q: any) =>
            q.eq("brainInstanceId", brain._id).eq("projectId", args.projectId),
          )
          .first();
        preferredHarness = executionConfig?.preferredHarness;
      }
      chatId = await ctx.db.insert("projectChats", {
        brainInstanceId: brain._id,
        ...(args.projectId ? { projectId: args.projectId } : { pageKey: args.pageKey }),
        title: chatTitleForScope(args.pageKey, projectTitle),
        kind: args.projectId ? "general" : "page",
        // One harness per chat for its lifetime; picked on first message.
        harness: args.harness ?? preferredHarness ?? "claude",
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
      ...(attachments.length ? { attachments } : {}),
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

/**
 * Switch a scope to another harness by starting a fresh conversation. Harness
 * thread IDs are provider-specific, so changing an existing chat in place
 * would make the new provider inherit a transcript it cannot actually resume.
 * The prior transcript is archived (not deleted) and remains durable.
 */
export const startNewChatForViewer = mutationGeneric({
  args: {
    projectId: v.optional(v.id("projects")),
    pageKey: v.optional(v.string()),
    harness: harnessArg,
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    if (!args.projectId && !args.pageKey) throw new Error("projectId or pageKey is required");

    let projectTitle: string | undefined;
    if (args.projectId) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.brainInstanceId !== brain._id) throw new Error("project not found");
      projectTitle = project.title;
    }

    const current = await findChatForScope(ctx.db, brain._id, args.projectId, args.pageKey);
    if (current) {
      if (await activeTurnForChat(ctx.db, current._id)) {
        throw new Error("wait for the current reply to finish before switching assistants");
      }
      await ctx.db.patch(current._id, { state: "archived", updatedAt: Date.now() });
    }

    const now = Date.now();
    const chatId = await ctx.db.insert("projectChats", {
      brainInstanceId: brain._id,
      ...(args.projectId ? { projectId: args.projectId } : { pageKey: args.pageKey }),
      title: chatTitleForScope(args.pageKey, projectTitle),
      kind: args.projectId ? "general" : "page",
      harness: args.harness,
      state: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { chatId, harness: args.harness };
  },
});

/* ------------------------------------------------------------------ */
/* Host surface (runner)                                              */
/* ------------------------------------------------------------------ */

export const claimNextChatTurn = mutationGeneric({
  args: { hostToken: v.string() },
  handler: async (ctx, { hostToken }) => {
    const host = await requireHost(ctx, hostToken);
    const now = Date.now();
    await expireStaleChatTurns(ctx, host.brainInstanceId, now);
    if (host.draining) return null;
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
      const priorTurns = siblings
        .filter((sibling: any) => sibling._id !== turn._id && sibling.createdAt < turn.createdAt)
        .sort((a: any, b: any) => b.createdAt - a.createdAt);
      const latestPriorTurn = priorTurns[0];
      const resetHarnessThread =
        latestPriorTurn?.status === "failed" || latestPriorTurn?.status === "cancelled";
      const externalThreadId = resetHarnessThread ? undefined : chat.externalThreadId;
      if (resetHarnessThread && chat.externalThreadId) {
        await ctx.db.patch(chat._id, { externalThreadId: undefined, updatedAt: now });
      }

      // Scope context + working directory for the harness.
      let scopeContext = "";
      let cwd: string | undefined;
      // Where the runner should materialize message attachments (the
      // project's _library assets folder on this host's checkout).
      let assetsPath: string | undefined;
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
          // Derived from this host's mapped checkout (cwd), honoring an
          // explicit assetsFolderPath override on the project.
          assetsPath = effectiveProjectPaths({
            ...(cwd ? { localPath: cwd } : {}),
            ...(project.assetsFolderPath ? { assetsFolderPath: project.assetsFolderPath } : {}),
          }).effectiveAssetsPath;
        }
        if (project) {
          scopeContext = [
            `The user is chatting from the project "${project.title}" (status: ${project.status}).`,
            project.summary ? `Project summary: ${project.summary}` : "",
            project.repoUrl ? `Repository: ${project.repoUrl}` : "",
            project.vercelUrl ? `Vercel: ${project.vercelUrl}` : "",
            project.liveUrl ? `Live URL: ${project.liveUrl}` : "",
            "Use the Skippy MCP get_project_plan tool for the ordered phases/tasks, update_project for Overview details and links, and update_phase for phase descriptions.",
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
      const successfulMessageIds = new Set(
        siblings
          .filter((sibling: any) => sibling.status === "completed")
          .flatMap((sibling: any) => [sibling.userMessageId, sibling.assistantMessageId]),
      );
      const eligibleHistory = all
        .filter(
          (m: any) =>
            m.status === "complete" &&
            m.content &&
            m._id !== turn.userMessageId &&
            (!resetHarnessThread || successfulMessageIds.has(m._id)),
        );
      const history = chatHistoryWindow(eligibleHistory)
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
        externalThreadId,
        scopeContext,
        cwd,
        assetsPath,
        historySummary: chat.historySummary,
        history,
        userContent: userMessage?.content ?? "",
        // Attachment metadata plus short-lived download URLs so the runner
        // can materialize the files into the project's _library before the
        // harness turn starts. URLs expire — the runner downloads promptly.
        attachments: await attachmentsWithUrls(ctx, userMessage?.attachments),
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

/** Max live-activity rows kept per turn; older rows are pruned as new ones land. */
const MAX_TURN_EVENTS = 200;

export const reportChatTurnEvents = mutationGeneric({
  args: {
    hostToken: v.string(),
    turnId: v.id("chatTurns"),
    claimToken: v.string(),
    events: v.array(
      v.object({
        seq: v.number(),
        type: v.string(),
        payload: v.optional(v.any()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken);
    const turn = await requireClaimedTurn(ctx, host, args.turnId, args.claimToken);
    if (!args.events.length) return { accepted: 0 };
    const now = Date.now();

    // Idempotent by (turn, seq): a retried batch after a transient network
    // failure must not duplicate rows.
    const lastStored = await ctx.db
      .query("chatTurnEvents")
      .withIndex("by_turn_seq", (q: any) => q.eq("chatTurnId", args.turnId))
      .order("desc")
      .first();
    const lastSeq = lastStored?.seq ?? 0;
    const fresh = args.events.filter((event) => event.seq > lastSeq);
    for (const event of fresh) {
      await ctx.db.insert("chatTurnEvents", {
        brainInstanceId: turn.brainInstanceId,
        chatTurnId: args.turnId,
        seq: event.seq,
        type: event.type,
        payload: event.payload,
        createdAt: now,
      });
    }

    // Bound the live feed: prune oldest rows beyond the cap so a long turn
    // cannot grow the table (the panel only shows the tail anyway).
    const total = await ctx.db
      .query("chatTurnEvents")
      .withIndex("by_turn_seq", (q: any) => q.eq("chatTurnId", args.turnId))
      .collect();
    if (total.length > MAX_TURN_EVENTS) {
      const excess = total
        .sort((a: any, b: any) => a.seq - b.seq)
        .slice(0, total.length - MAX_TURN_EVENTS);
      for (const row of excess) await ctx.db.delete(row._id);
    }
    return { accepted: fresh.length };
  },
});

/** Delete a finished turn's live-activity rows — the reply is the product. */
async function deleteTurnEvents(ctx: any, turnId: string) {
  const events = await ctx.db
    .query("chatTurnEvents")
    .withIndex("by_turn_seq", (q: any) => q.eq("chatTurnId", turnId))
    .collect();
  for (const event of events) await ctx.db.delete(event._id);
}

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
    // Normalized session token totals (docs/token-efficiency.md lever 1).
    usage: v.optional(tokenUsage),
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
        completedAt: now,
      });
    } else {
      // completedAt (not the placeholder's send-time createdAt) is what the
      // chat timeline sorts finished replies by, so the reply lands after any
      // task moments (started/completed) that occurred during the turn.
      await ctx.db.patch(turn.assistantMessageId, {
        status: "complete",
        content: (args.resultText ?? "").slice(0, MAX_MESSAGE_CHARS) || "(no reply)",
        completedAt: now,
      });
    }
    await ctx.db.patch(args.turnId, {
      status: failed ? "failed" : "completed",
      ...(failed ? { errorMessage: (args.errorMessage ?? "").slice(0, 500) } : {}),
      ...(args.usage ? { usage: args.usage } : {}),
      updatedAt: now,
    });
    await deleteTurnEvents(ctx, args.turnId);
    if (failed) {
      // A harness-native session that just failed may no longer be resumable
      // (for example after its project cwd or runner account changes). The
      // next message starts a clean session and receives successful transcript
      // history instead of retrying the broken session forever.
      await ctx.db.patch(turn.chatId, { externalThreadId: undefined, updatedAt: now });
    } else if (args.externalThreadId) {
      await ctx.db.patch(turn.chatId, { externalThreadId: args.externalThreadId, updatedAt: now });
    }
    if (!failed) {
      const chat = await ctx.db.get(turn.chatId);
      const completeMessages = await ctx.db
        .query("chatMessages")
        .withIndex("by_chat", (q: any) => q.eq("chatId", turn.chatId))
        .collect();
      const completeMessageCount = completeMessages.filter((message: any) => message.status === "complete").length;
      if (chat && shouldRefreshHistorySummary(completeMessageCount, chat.historySummaryThroughMessageCount ?? 0)) {
        await ctx.scheduler.runAfter(0, refreshChatHistorySummaryRef, {
          chatId: turn.chatId,
          targetCompleteMessageCount: completeMessageCount,
        });
      }
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
