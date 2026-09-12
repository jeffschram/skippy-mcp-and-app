import { v } from "convex/values";
export const attentionStatus = v.union(v.literal("immediate"), v.literal("todo"), v.literal("scheduled"), v.literal("ok"), v.literal("stale"), v.literal("unassessed"));
export const attentionKind = v.union(v.literal("goal"), v.literal("project"), v.literal("task"), v.literal("person"), v.literal("company"), v.literal("note"), v.literal("link"), v.literal("knowledgeObject"), v.literal("memory"));
export const attentionMetadata = v.object({ override: v.optional(attentionStatus), reason: v.optional(v.string()), reviewAt: v.optional(v.number()), scheduledAt: v.optional(v.number()), assessedAt: v.optional(v.number()) });
