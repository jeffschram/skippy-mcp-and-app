import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query, mutation, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOwnedBrain } from "./auth";
import { attentionKind, attentionMetadata, attentionStatus } from "./attentionValidators";
import { ATTENTION, taskSourceLinks, attentionHref, isAttentionArchived, resolveAttention, type AttentionKind, type AttentionRecord } from "./attentionModel";

const tables = { goal: "goals", project: "projects", task: "tasks", person: "people", company: "companies", note: "knowledge", link: "knowledge", knowledgeObject: "knowledge", memory: "knowledge" } as const;
const canonicalTables = ["goals", "projects", "tasks", "people", "companies", "knowledge"] as const;
type Entity = AttentionRecord & { _id: string; brainInstanceId: string; kind?: string; title?: string; name?: string };
const resultValidator = v.object({ status: attentionStatus, reason: v.string(), source: v.union(v.literal("manual"), v.literal("automatic")), at: v.optional(v.number()) });
const itemValidator = v.object({ id: v.string(), kind: attentionKind, title: v.string(), href: v.string(), attention: attentionMetadata, result: resultValidator });
function present(row: Entity, kind: AttentionKind, now: number) {
  return { id: String(row._id), kind, title: row.title || row.name || "Untitled", href: attentionHref(kind, row._id), attention: row.attention || {}, result: resolveAttention(kind, row, now) };
}
function tableKind(table: typeof canonicalTables[number], row: Entity): AttentionKind {
  return table === "knowledge" ? row.kind as AttentionKind : table === "people" ? "person" : table === "companies" ? "company" : table === "goals" ? "goal" : table === "projects" ? "project" : "task";
}
async function eligible(ctx: QueryCtx, row: Entity, kind: AttentionKind, brainId: string) {
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
  args: { ...refArgs, attention: attentionMetadata }, returns: v.null(),
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const id = ctx.db.normalizeId(tables[args.kind], args.id);
    const row = id ? await ctx.db.get(id) as Entity | null : null;
    if (!id || !row || row.brainInstanceId !== brain._id || (tables[args.kind] === "knowledge" && row.kind !== args.kind)) throw new Error("Item not found");
    const meta = args.attention;
    if ((meta.reason?.length ?? 0) > 500) throw new Error("Keep the reason under 500 characters");
    for (const date of [meta.reviewAt, meta.scheduledAt]) if (date !== undefined && (!Number.isFinite(date) || date < 0)) throw new Error("Invalid date");
    if (meta.override === "scheduled" && (meta.scheduledAt === undefined || meta.scheduledAt <= Date.now())) throw new Error("Choose a future scheduled time");
    await ctx.db.patch(id, { attention: { ...meta, ...(meta.reason?.trim() ? { reason: meta.reason.trim() } : {}), assessedAt: Date.now() }, updatedAt: Date.now() });
    return null;
  },
});
export const browseForViewer = query({
  args: { kind: attentionKind, now: v.number(), paginationOpts: paginationOptsValidator },
  returns: v.object({ page: v.array(itemValidator), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const table = tables[args.kind];
    const result = table === "knowledge"
      ? await ctx.db.query("knowledge").withIndex("by_brain_kind_state", q => q.eq("brainInstanceId", brain._id).eq("kind", args.kind as "note" | "link" | "knowledgeObject" | "memory").eq("processingState", "accepted")).order("desc").paginate({ ...args.paginationOpts, numItems: Math.min(25, args.paginationOpts.numItems) })
      : await ctx.db.query(table).withIndex("by_brain_state", q => q.eq("brainInstanceId", brain._id).eq("processingState", "accepted")).order("desc").paginate({ ...args.paginationOpts, numItems: Math.min(25, args.paginationOpts.numItems) });
    const page = [];
    for (const row of result.page) if (await eligible(ctx, row, args.kind, brain._id)) page.push(present(row, args.kind, args.now));
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});
/** Indexed candidates, independent of Mind's display sample. No stored AI summary is required. */
export const focusForViewer = query({
  args: { now: v.number() }, returns: v.object({ items: v.array(itemValidator), limited: v.boolean() }),
  handler: async (ctx, { now }) => {
    const { brain } = await requireOwnedBrain(ctx);
    const candidates = new Map<string, { row: Entity; kind: AttentionKind }>();
    let limited = false;
    const add = (table: typeof canonicalTables[number], rows: Entity[]) => {
      if (rows.length > 20) limited = true;
      for (const row of rows.slice(0, 20)) candidates.set(row._id, { row, kind: tableKind(table, row) });
    };
    for (const table of canonicalTables) {
      const groups = await Promise.all([
        ...(["immediate", "todo", "stale"] as const).map(status => ctx.db.query(table).withIndex("by_brain_attention", q => q.eq("brainInstanceId", brain._id).eq("processingState", "accepted").eq("attention.override", status)).take(21)),
        ctx.db.query(table).withIndex("by_brain_review", q => q.eq("brainInstanceId", brain._id).eq("processingState", "accepted").gt("attention.reviewAt", 0).lte("attention.reviewAt", now)).take(21),
        ctx.db.query(table).withIndex("by_brain_scheduled", q => q.eq("brainInstanceId", brain._id).eq("processingState", "accepted").gt("attention.scheduledAt", 0).lte("attention.scheduledAt", now + 7 * 86400000)).take(21),
      ]);
      groups.forEach(rows => add(table, rows));
    }
    const taskGroups = await Promise.all([
      ...(["todo", "in_progress", "waiting"] as const).map(status => ctx.db.query("tasks").withIndex("by_brain_status_due", q => q.eq("brainInstanceId", brain._id).eq("processingState", "accepted").eq("status", status).gt("dueAt", 0).lte("dueAt", now)).take(21)),
      ...(["todo", "in_progress", "waiting"] as const).map(status => ctx.db.query("tasks").withIndex("by_brain_status", q => q.eq("brainInstanceId", brain._id).eq("status", status)).order("desc").take(21)),
    ]);
    taskGroups.forEach(rows => add("tasks", rows));
    const items = [];
    for (const { row, kind } of candidates.values()) {
      const item = present(row, kind, now);
      if (["ok", "unassessed"].includes(item.result.status) || (row as Entity & { focusSnoozedUntil?: number }).focusSnoozedUntil! > now) continue;
      if (await eligible(ctx, row, kind, brain._id)) items.push(item);
    }
    items.sort((a, b) => ATTENTION[a.result.status].rank - ATTENTION[b.result.status].rank || (a.result.at ?? Infinity) - (b.result.at ?? Infinity) || a.title.localeCompare(b.title));
    return { items: items.slice(0, 30), limited: limited || items.length > 30 };
  },
});
