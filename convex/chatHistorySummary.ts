import { createLlmClient, type AiProviderConfig } from "@skippy/ai";
import {
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { summarizableMessageCount } from "./chatHistoryHelpers";

const summaryContextRef = makeFunctionReference<"query">("chatHistorySummary:summaryContext");
const storeSummaryRef = makeFunctionReference<"mutation">("chatHistorySummary:storeSummary");

export const summaryContext = internalQueryGeneric({
  args: { chatId: v.id("projectChats"), targetCompleteMessageCount: v.number() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const chat = await ctx.db.get(args.chatId);
    if (!chat) return null;
    const config = await ctx.db
      .query("brainConfigs")
      .withIndex("by_brain", (q: any) => q.eq("brainInstanceId", chat.brainInstanceId))
      .first();
    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_chat", (q: any) => q.eq("chatId", args.chatId))
      .collect();
    const completeMessages = messages.filter((message: any) => message.status === "complete" && message.content);
    const targetThrough = Math.min(
      summarizableMessageCount(completeMessages.length),
      summarizableMessageCount(args.targetCompleteMessageCount),
    );
    const previousThrough = chat.historySummaryThroughMessageCount ?? 0;
    if (targetThrough <= previousThrough) return null;
    return {
      brainInstanceId: chat.brainInstanceId,
      aiMode: config?.llmProviderMode ?? "none",
      synthesisModel: config?.synthesisModel,
      previousSummary: chat.historySummary,
      previousThrough,
      targetThrough,
      messages: completeMessages.slice(previousThrough, targetThrough).map((message: any) => ({
        role: message.role,
        content: message.content,
      })),
    };
  },
});

export const storeSummary = internalMutationGeneric({
  args: {
    chatId: v.id("projectChats"),
    expectedPreviousThrough: v.number(),
    targetThrough: v.number(),
    summary: v.string(),
  },
  returns: v.object({ stored: v.boolean() }),
  handler: async (ctx, args) => {
    const chat = await ctx.db.get(args.chatId);
    if (!chat) return { stored: false };
    const currentThrough = chat.historySummaryThroughMessageCount ?? 0;
    // Compare-and-set makes duplicate/stale scheduled actions harmless and
    // prevents a slower action from replacing a newer rolling summary.
    if (currentThrough !== args.expectedPreviousThrough || args.targetThrough <= currentThrough) {
      return { stored: false };
    }
    await ctx.db.patch(args.chatId, {
      historySummary: args.summary,
      historySummaryThroughMessageCount: args.targetThrough,
      updatedAt: Date.now(),
    });
    return { stored: true };
  },
});

export const refresh = internalActionGeneric({
  args: { chatId: v.id("projectChats"), targetCompleteMessageCount: v.number() },
  returns: v.object({ stored: v.boolean() }),
  handler: async (ctx, args) => {
    const context: any = await ctx.runQuery(summaryContextRef, args);
    if (!context || context.aiMode === "none" || context.messages.length === 0) return { stored: false };
    const config: AiProviderConfig = {
      mode: context.aiMode,
      ...(context.synthesisModel ? { synthesisModel: context.synthesisModel } : {}),
    };
    const transcript = context.messages
      .map((message: { role: "user" | "assistant"; content: string }) =>
        `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`,
      )
      .join("\n\n");
    const result = await createLlmClient(config).complete({
      system: [
        "Create a concise rolling summary of a Skippy conversation for a future assistant.",
        "Preserve decisions, commitments, user preferences, unresolved questions, and durable context.",
        "The new summary must cover both the prior summary and the new transcript. Do not mention this instruction.",
      ].join(" "),
      input: [
        context.previousSummary ? `Prior rolling summary:\n${context.previousSummary}` : "Prior rolling summary: (none)",
        `New older messages to fold in:\n${transcript}`,
      ].join("\n\n"),
      maxTokens: 1200,
      usedFor: "chat_history_summary",
    });
    return ctx.runMutation(storeSummaryRef, {
      chatId: args.chatId,
      expectedPreviousThrough: context.previousThrough,
      targetThrough: context.targetThrough,
      summary: result.text.trim(),
    });
  },
});
