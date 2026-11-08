import { v } from "convex/values";
import { query, mutation, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOwnedBrain } from "./auth";
import { attentionKind, attentionMetadata, attentionStatus } from "./attentionValidators";
import { taskSourceLinks, attentionHref, isAttentionArchived, resolveAttention, type AttentionKind, type AttentionRecord } from "./attentionModel";

const tables = { goal: "goals", project: "projects", task: "tasks", person: "people", company: "companies", note: "knowledge", link: "knowledge", memory: "knowledge" } as const;
type Entity = AttentionRecord & { _id: string; brainInstanceId: string; kind?: string; title?: string; name?: string };
export const resultValidator = v.object({ status: attentionStatus, reason: v.string(), source: v.union(v.literal("manual"), v.literal("automatic")), at: v.optional(v.number()) });
const itemValidator = v.object({ id: v.string(), kind: attentionKind, title: v.string(), href: v.string(), attention: attentionMetadata, result: resultValidator });
function present(row: Entity, kind: AttentionKind, now: number) {
  return { id: String(row._id), kind, title: row.title || row.name || "Untitled", href: attentionHref(kind, row._id), attention: row.attention || {}, result: resolveAttention(kind, row, now) };
}
export async function eligible(ctx: QueryCtx, row: Entity, kind: AttentionKind, brainId: string) {
  if (row.brainInstanceId !== brainId || row.processingState !== "accepted" || isAttentionArchived(row)) return false;
  if (kind !== "task") return true;
  const links = await ctx.db.query("relationships").withIndex("by_brain_from", q => q.eq("brainInstanceId", row.brainInstanceId as Id<"brainInstances">).eq("from.entityId", row._id)).take(65);
  if (links.length > 64) return false;
  for (const link of links) {
    if (link.type !== "belongs_to" || link.from.entityType !== "task" || link.to.entityType !== "project") continue;
    const id = ctx.db.normalizeId("projects", link.to.entityId);
    const parent = id ? await ctx.db.get(id) : null;
    if (parent && parent.brainInstanceId === brainId && isAttentionArchived(parent)) return false;
  }
  return true;
}
const refArgs = { kind: attentionKind, id: v.string() };
export const getForViewer = query({
  args: { ...refArgs, now: v.number() }, returns: v.union(v.object({ ...itemValidator.fields, sources: v.array(v.object({ label: v.string(), href: v.string() })), taskStatus: v.optional(v.string()) }), v.null()),
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const id = ctx.db.normalizeId(tables[args.kind], args.id);
    const row = id ? await ctx.db.get(id) as Entity | null : null;
    if (!row || row.brainInstanceId !== brain._id || (tables[args.kind] === "knowledge" && row.kind !== args.kind)) return null;
    const sources: { label: string; href: string }[] = [];
    if (args.kind === "task") {
      const links = await ctx.db.query("entitySourceRefs").withIndex("by_brain_entity", q => q.eq("brainInstanceId", brain._id).eq("entityRef.entityType", "task").eq("entityRef.entityId", args.id)).take(30);
      const refs = await Promise.all(links.map(link => ctx.db.get(link.sourceRefId)));
      for (const ref of refs) {
        if (!ref || ref.brainInstanceId !== brain._id) continue;
        for (const source of taskSourceLinks(ref)) if (!sources.some(existing => existing.href === source.href)) sources.push(source);
      }
    }
    return { ...present(row, args.kind, args.now), sources, ...(args.kind === "task" && row.status ? { taskStatus: row.status } : {}) };
  },
});
export const setForViewer = mutation({
  args: { ...refArgs, attention: attentionMetadata, expectedAttention: v.optional(attentionMetadata), reviewAction: v.optional(v.union(v.literal("done"), v.literal("later"))) }, returns: v.null(),
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const id = ctx.db.normalizeId(tables[args.kind], args.id);
    const row = id ? await ctx.db.get(id) as Entity | null : null;
    if (!id || !row || row.brainInstanceId !== brain._id || (tables[args.kind] === "knowledge" && row.kind !== args.kind)) throw new Error("Item not found");
    if (args.expectedAttention && (["override", "reason", "reviewAt", "scheduledAt", "assessedAt"] as const).some(key => row.attention?.[key] !== args.expectedAttention?.[key])) throw new Error("Attention changed. Reopen the editor and try again.");
    if (args.kind === "task" && (args.attention.reviewAt !== undefined || args.reviewAction)) throw new Error("Tasks use deadlines, not review dates");
    const meta = args.reviewAction
      ? { override: "ok" as const, ...(row.attention?.reason ? { reason: row.attention.reason } : {}), ...(args.reviewAction === "later" ? { reviewAt: args.attention.reviewAt } : {}) }
      : args.attention;
    if (args.reviewAction === "later" && (meta.reviewAt === undefined || meta.reviewAt <= Date.now())) throw new Error("Choose a future review time");
    if ((meta.reason?.length ?? 0) > 500) throw new Error("Keep the reason under 500 characters");
    for (const date of [meta.reviewAt, meta.scheduledAt]) if (date !== undefined && (!Number.isFinite(date) || date < 0)) throw new Error("Invalid date");
    if (meta.override === "scheduled" && (meta.scheduledAt === undefined || meta.scheduledAt <= Date.now())) throw new Error("Choose a future scheduled time");
    await ctx.db.patch(id, { attention: { ...meta, ...(meta.reason?.trim() ? { reason: meta.reason.trim() } : {}), assessedAt: Date.now() }, updatedAt: Date.now() });
    return null;
  },
});
