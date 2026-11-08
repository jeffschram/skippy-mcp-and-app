// Home consolidation contract: docs/home-surface-contract.md.
import { query } from "./_generated/server";
import { compareValues, v } from "convex/values";
import { eligible, resultValidator } from "./attention";
import { attentionKind, attentionMetadata } from "./attentionValidators";
import { attentionHref, resolveAttention, taskSourceLinks, type AttentionKind } from "./attentionModel";
import { requireOwnedBrain } from "./auth";

const kind = v.union(v.literal("task"), v.literal("event"), v.literal("recurrence"), v.literal("review"));
const terminal = (row: any) => row.status === "done" || row.status === "cancelled";
async function project(ctx: any, brain: any, id: string) {
  return ctx.db.query("relationships").withIndex("home_project", (q: any) =>
    q.eq("brainInstanceId", brain).eq("from.entityId", id).eq("type", "belongs_to").eq("to.entityType", "project")).first();
}
async function repeat(ctx: any, brain: any, id: string) {
  return ctx.db.query("recurrences").withIndex("by_brain_current_task", (q: any) =>
    q.eq("brainInstanceId", brain).eq("currentTaskId", id)).first();
}
async function liveTask(ctx: any, brain: any, recurrence: any) {
  const task = recurrence.currentTaskId ? await ctx.db.get(recurrence.currentTaskId) : null;
  return task?.brainInstanceId === brain && !terminal(task) ? task : null;
}
function row(kind: "task" | "event" | "recurrence" | "review", record: any, recurrence?: any, entityKind?: AttentionKind, now = Date.now()) {
  const want = kind === "task" && record.commitment === "want";
  return {
    occurrenceVersion: recurrence?.occurrenceVersion ?? (kind === "recurrence" ? record.occurrenceVersion ?? 0 : null),
    kind, id: record._id, title: record.title || record.name || "Untitled", status: record.status ?? "active",
    entityKind: entityKind ?? (kind === "task" ? "task" : null),
    attention: kind === "review" || kind === "task" ? record.attention ?? {} : null,
    attentionResult: kind === "review" || kind === "task" ? resolveAttention(entityKind ?? "task", record, now) : null,
    at: kind === "review" ? record.attention?.reviewAt ?? record.attention?.scheduledAt ?? null : want ? null : (kind === "event" ? record.startAt : kind === "recurrence" ? record.nextDueAt : record.dueAt) ?? null,
    reviewAt: kind === "review" ? record.attention?.reviewAt ?? null : null,
    endAt: kind === "review" ? null : record.endAt ?? null, isAllDay: kind === "review" ? false : record.isAllDay ?? false,
    area: record.area ?? null, isWant: want, isWaiting: kind === "task" && record.status === "waiting",
    waitingSince: kind === "review" ? null : record.waitingSince ?? null, lastNudgedAt: kind === "review" ? null : record.lastNudgedAt ?? null,
    recurrenceId: recurrence?._id ?? (kind === "recurrence" ? record._id : null),
    recurrenceStatus: recurrence?.status ?? (kind === "recurrence" ? record.status : null),
    fromRecurrence: !!recurrence, location: kind === "review" ? null : record.location ?? null,
    href: kind === "review" ? attentionHref(entityKind!, record._id) : record.htmlLink ?? null,
  };
}
const rowValidator = v.object({
  entityKind: v.union(attentionKind, v.null()), attention: v.union(attentionMetadata, v.null()), attentionResult: v.union(resultValidator, v.null()),
  reviewAt: v.union(v.number(), v.null()),
  occurrenceVersion: v.union(v.number(), v.null()),
  kind, id: v.string(), title: v.string(), status: v.string(), at: v.union(v.number(), v.null()),
  endAt: v.union(v.number(), v.null()), isAllDay: v.boolean(), area: v.union(v.string(), v.null()),
  isWant: v.boolean(), isWaiting: v.boolean(), waitingSince: v.union(v.number(), v.null()),
  lastNudgedAt: v.union(v.number(), v.null()), recurrenceId: v.union(v.string(), v.null()),
  recurrenceStatus: v.union(v.string(), v.null()), fromRecurrence: v.boolean(),
  location: v.union(v.string(), v.null()), href: v.union(v.string(), v.null()),
});

const nested = (record: any, field: string) => field.split(".").reduce((value, key) => value?.[key], record);
const reviewTables = ["goals", "projects", "tasks", "people", "companies", "knowledge"] as const;
function reviewKind(table: typeof reviewTables[number], record: any): AttentionKind {
  return table === "knowledge" ? record.kind : ({ goals: "goal", projects: "project", tasks: "task", people: "person", companies: "company" } as const)[table];
}
// Exactly one source owns each entity, including when several indexes match.
function reviewSource(table: string, record: any) {
  const meta = record.attention ?? {};
  if (meta.override === "immediate") return `override-${table}-immediate`;
  if (meta.reviewAt !== undefined) return `review-${table}`;
  if (meta.scheduledAt !== undefined) return `scheduled-${table}`;
  if (["todo", "in_progress", "stale"].includes(meta.override)) return `override-${table}-${meta.override}`;
  return `active-${table}`;
}
export function reviewInPeriod(record: any, entityKind: AttentionKind, args: any) {
  if (entityKind === "task" || record.focusSnoozedUntil > args.now) return false;
  const status = resolveAttention(entityKind, record, args.now).status;
  if (status === "ok" || status === "unassessed") return false;
  if (args.period === "all") return true;
  if (status === "immediate") return args.period === "today";
  const at = record.attention?.reviewAt ?? record.attention?.scheduledAt;
  return at !== undefined && (args.period === "today" ? at < args.tomorrow : at >= args.tomorrow && at < args.weekEnd);
}
// Lexicographic seek over explicit index columns. Each branch takes only the
// remaining budget, including when many records share a timestamp/title.
export async function seek(db: any, source: any, last: any[] | null, limit: number) {
  last = last?.map(value => value && value.undefined === true ? undefined : value) ?? null;
  const output: any[] = [];
  const branches = last ? source.fields.map((_: any, i: number) => i).reverse() : [0];
  for (const branch of branches) {
    const found = await db.query(source.table).withIndex(source.index, (q: any) => {
      for (const [key, value] of source.prefix) q = q.eq(key, value);
      if (last) {
        for (let i = 0; i < branch; i++) q = q.eq(source.fields[i], last[i]);
        q = q.gt(source.fields[branch], last[branch]);
      } else if (source.lower !== undefined) q = q.gte(source.fields[0], source.lower);
      if (branch === 0 && source.upper !== undefined) q = q.lt(source.fields[0], source.upper);
      return q;
    }).take(limit - output.length);
    output.push(...found);
    if (output.length === limit) break;
  }
  return output;
}

export const page = query({
  args: {
    period: v.union(v.literal("today"), v.literal("week"), v.literal("all")),
    now: v.number(), start: v.number(), tomorrow: v.number(), weekEnd: v.number(), overdueStart: v.number(),
    horizon: v.number(), utcToday: v.number(), utcTomorrow: v.number(), utcWeekEnd: v.number(),
    area: v.union(v.string(), v.null()), status: v.union(v.literal("open"), v.literal("completed"), v.literal("paused")),
    cursor: v.optional(v.string()),
  },
  returns: v.object({ rows: v.array(rowValidator), cursor: v.union(v.string(), v.null()), hasMore: v.boolean() }),
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const { cursor, ...scope } = args;
    const signature = JSON.stringify(["review-v2", brain._id, scope]);
    let positions: Record<string, any> = {};
    if (cursor) {
      if (cursor.length > 20000) throw new Error("Invalid Home cursor");
      const decoded = JSON.parse(cursor);
      if (decoded.signature !== signature) throw new Error("Home filters changed; restart this list");
      positions = decoded.positions;
    }
    const all = args.period === "all";
    const from = args.period === "today" ? args.overdueStart : args.tomorrow;
    const to = args.period === "today" ? args.tomorrow : args.weekEnd;
    const prefix = [["brainInstanceId", brain._id]];
    const sources: any[] = [];
    for (const commitment of [undefined, "must"]) {
      const base = [...prefix, ["processingState", "accepted"], ["commitment", commitment]];
      sources.push({ key: `dated-${commitment}`, table: "tasks", kind: "task", index: "home_dated", prefix: base,
        fields: ["dueAt", "title", "_creationTime", "_id"], lower: all ? -Number.MAX_VALUE : from, upper: all ? undefined : to });
      if (all) sources.push({ key: `undated-${commitment}`, table: "tasks", kind: "task", index: "home_dated",
        prefix: [...base, ["dueAt", undefined]], fields: ["title", "_creationTime", "_id"], group: 1 });
    }
    if (all) sources.push({ key: "wants", table: "tasks", kind: "task", index: "home_wants",
      prefix: [...prefix, ["processingState", "accepted"], ["commitment", "want"]], fields: ["title", "_creationTime", "_id"], group: 2 });
    sources.push({ key: "repeats", table: "recurrences", kind: "recurrence", index: "home_due", prefix,
      fields: ["nextDueAt", "title", "_creationTime", "_id"], lower: all ? undefined : from, upper: all ? undefined : to });
    if (args.status === "open") {
      // Scan bounded start-ordered pages, including old starts: a long-running
      // event must not disappear simply because it began before the lookback.
      sources.push({ key: "events", table: "calendarEvents", kind: "event", index: "home_start", prefix,
        fields: ["startAt", "title", "_creationTime", "_id"], upper: all ? args.horizon : Math.max(to, args.utcWeekEnd) });
    }
    if (args.status === "open") {
      for (const table of reviewTables) {
        const base = { table, kind: table === "tasks" ? "task" : "review", reviewSource: true, prefix: [...prefix, ["processingState", "accepted"]] };
        sources.push({ ...base, key: `review-${table}`, index: "by_brain_review", fields: ["attention.reviewAt", "_creationTime", "_id"], lower: all || args.period === "today" ? 0 : args.tomorrow, upper: all ? undefined : to });
        // Tasks retain deadline/status placement; their old review metadata is ignored.
        if (table === "tasks") continue;
        sources.push({ ...base, key: `scheduled-${table}`, index: "by_brain_scheduled", fields: ["attention.scheduledAt", "_creationTime", "_id"], lower: all || args.period === "today" ? 0 : args.tomorrow, upper: all ? undefined : to });
        for (const override of ["immediate", "todo", "in_progress", "stale"]) {
          if (override !== "immediate" && !all) continue;
          sources.push({ ...base, key: `override-${table}-${override}`, index: "by_brain_attention", prefix: [...base.prefix, ["attention.override", override]], fields: ["_creationTime", "_id"], group: override === "immediate" ? -1 : 1 });
        }
        if (table === "projects" && all) sources.push({ ...base, key: "active-projects", index: "by_brain_status", prefix: [...prefix, ["status", "in_progress"]], fields: ["_creationTime", "_id"], group: 1 });
      }
    }
    const size = all ? 50 : 20;
    const streams = await Promise.all(sources.map(async (source) => ({ source, index: 0,
      records: positions[source.key] === false ? [] : await seek(ctx.db, source, positions[source.key] ?? null, size + 1) })));
    const rows: any[] = [];
    let scanned = 0;
    // Eligibility may read up to 65 relationship links per task. Keep the
    // total page budget below Convex read limits even for rejected candidates.
    while (rows.length < size && scanned < 128) {
      // A depleted, non-exhausted source may have an earlier next head.
      // Return a short page rather than jumping over it in another stream.
      if (streams.some(s => s.index === s.records.length && s.records.length === size + 1)) break;
      const available = streams.filter(s => s.index < s.records.length);
      if (!available.length) break;
      available.sort((a, b) => {
        const ar = a.records[a.index], br = b.records[b.index];
        const group = (a.source.group ?? 0) - (b.source.group ?? 0);
        if (group) return group;
        const date = (source: any, record: any) => source.group ? 0 : nested(record, source.fields[0]) ?? 0;
        return compareValues(date(a.source, ar), date(b.source, br)) ||
          Number(!!a.source.reviewSource) - Number(!!b.source.reviewSource) ||
          (!a.source.reviewSource ? compareValues(ar.title, br.title) : 0) ||
          compareValues(ar._creationTime, br._creationTime) || compareValues(ar._id, br._id) || compareValues(a.source.key, b.source.key);
      });
      const stream = available[0]!;
      const record = stream.records[stream.index++];
      const source = stream.source;
      positions[source.key] = source.fields.map((field: string) => nested(record, field) ?? { undefined: true });
      scanned++;
      const entityKind = source.reviewSource ? reviewKind(source.table, record) : undefined;
      if (source.reviewSource && (entityKind === "task" || source.key !== reviewSource(source.table, record))) continue;
      let recurrence = null;
      if (source.kind === "review") {
        if (!["goal", "project", "person", "company", "note", "link", "memory"].includes(entityKind!) || !await eligible(ctx, record, entityKind!, brain._id) || !reviewInPeriod(record, entityKind!, args)) continue;
      } else if (source.kind === "task") {
        if (await project(ctx, brain._id, record._id)) continue;
        if (!await eligible(ctx, record, "task", brain._id)) continue;
        recurrence = await repeat(ctx, brain._id, record._id);
        if (args.status === "completed" ? !terminal(record) : terminal(record)) continue;
        if (args.status === "paused" && (!recurrence || recurrence.status === "active")) continue;
      } else if (source.kind === "recurrence") {
        if (args.status === "completed") continue;
        if (args.status === "paused" ? record.status === "active" : record.status !== "active") continue;
        if (await liveTask(ctx, brain._id, record)) continue;
      } else {
        if (record.status === "cancelled" || record.isMaster) continue;
        const end = record.endAt ?? record.startAt;
        if (end <= (record.isAllDay ? args.utcToday : args.now)) continue;
        if (!all) {
          const eventStart = args.period === "today" ? (record.isAllDay ? args.utcToday : args.start) : (record.isAllDay ? args.utcTomorrow : args.tomorrow);
          const eventEnd = record.isAllDay ? (args.period === "today" ? args.utcTomorrow : args.utcWeekEnd) : to;
          if (record.startAt >= eventEnd || end <= eventStart) continue;
          // Ongoing events belong to Today only, never duplicate into This Week.
          if (args.period === "week" && record.startAt < eventStart) continue;
        }
      }
      if (source.kind !== "event" && args.area !== null && (record.area ?? "unsorted") !== args.area) continue;
      rows.push(row(source.kind, record, recurrence, entityKind, args.now));
    }
    for (const stream of streams) {
      if (stream.index === stream.records.length && stream.records.length < size + 1) positions[stream.source.key] = false;
    }
    const hasMore = sources.some(source => positions[source.key] !== false);
    return { rows, hasMore, cursor: hasMore ? JSON.stringify({ signature, positions }) : null };
  },
});

// Direct resolution deliberately bypasses inventory windows, status and area.
export const getForViewer = query({
  args: { kind, id: v.string() },
  returns: v.union(v.null(), v.object({ row: rowValidator, description: v.union(v.string(), v.null()), projectId: v.union(v.string(), v.null()),
    dates: v.array(v.object({ label: v.string(), at: v.number() })), timeZone: v.union(v.string(), v.null()),
    updatedAt: v.number(), waitingOn: v.union(v.object({ entityType: v.string(), entityId: v.string() }), v.null()),
    schedule: v.union(v.null(), v.object({ rule: v.union(v.object({ kind: v.literal("interval"), everyDays: v.number() }), v.object({ kind: v.literal("calendar"), rrule: v.string() })), anchor: v.union(v.literal("completion"), v.literal("schedule")), nextDueAt: v.number(),
      history: v.array(v.object({ outcome: v.string(), at: v.number(), scheduledFor: v.union(v.number(), v.null()), note: v.union(v.string(), v.null()) })) })),
    recurrence: v.union(v.string(), v.null()), sources: v.array(v.object({ label: v.string(), url: v.string() })),
  })),
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const table = args.kind === "task" ? "tasks" : args.kind === "event" ? "calendarEvents" : "recurrences";
    let entityKind: AttentionKind | undefined;
    let id: import("./_generated/dataModel").Id<"tasks" | "calendarEvents" | "recurrences" | "goals" | "projects" | "people" | "companies" | "knowledge"> | null = args.kind === "review" ? null : ctx.db.normalizeId(table, args.id);
    if (args.kind === "review") for (const candidate of reviewTables) {
      if (candidate === "tasks") continue;
      const normalized = ctx.db.normalizeId(candidate, args.id);
      if (normalized) { id = normalized; break; }
    }
    const record = id ? await ctx.db.get(id) : null;
    if (args.kind === "review" && record) {
      const candidate = reviewTables.find(table => ctx.db.normalizeId(table, args.id));
      entityKind = reviewKind(candidate!, record);
      if (!["goal", "project", "person", "company", "note", "link", "memory"].includes(entityKind)) return null;
    }
    if (!record || record.brainInstanceId !== brain._id) return null;
    const linked = args.kind === "task" ? await project(ctx, brain._id, record._id) : null;
    const recurrence = args.kind === "task" ? await repeat(ctx, brain._id, record._id) : null;
    const data = record as typeof record & Record<string, any>;
    const previousRepeat = args.kind === "task" && data.recurrenceId ? await ctx.db.get(data.recurrenceId as import("./_generated/dataModel").Id<"recurrences">) : null;
    const repeatRecord = args.kind === "recurrence" ? data : recurrence ?? (previousRepeat?.brainInstanceId === brain._id ? previousRepeat : null);
    const dates = [
      ["Review", args.kind === "review" ? data.attention?.reviewAt : undefined], ["Due", data.dueAt], ["Starts", data.startAt], ["Ends", data.endAt],
      ["Completed", data.completedAt], ["Next due", repeatRecord?.nextDueAt], ["Last completed", repeatRecord?.lastCompletedAt],
    ].flatMap(([label, at]) => typeof at === "number" ? [{ label: String(label), at }] : []);
    const refs = args.kind === "task" || args.kind === "review" ? await ctx.db.query("entitySourceRefs").withIndex("by_brain_entity", q =>
      q.eq("brainInstanceId", brain._id).eq("entityRef.entityType", entityKind ?? "task").eq("entityRef.entityId", String(record._id))).take(20) : [];
    const sources: { label: string; url: string }[] = [];
    for (const sourceId of [...new Set([...refs.map(ref => ref.sourceRefId), ...(data.sourceRefIds ?? [])])].slice(0, 20)) {
      const source = await ctx.db.get(sourceId as import("./_generated/dataModel").Id<"sourceRefs">);
      if (!source || source.brainInstanceId !== brain._id) continue;
      for (const link of taskSourceLinks(source)) {
        if (!sources.some(existing => existing.url === link.href)) sources.push({ label: link.label, url: link.href });
      }
    }
    if (data.htmlLink) sources.push({ label: "Calendar event", url: data.htmlLink });
    if (args.kind === "event" && data.location?.trim()) sources.push({ label: "Open in Maps", url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.location)}` });
    if (data.conferenceUrl) sources.push({ label: "Join meeting", url: data.conferenceUrl });
    const rule = repeatRecord?.rule;
    const repeatDescription = repeatRecord ? [repeatRecord.title, repeatRecord.status,
      rule?.kind === "interval" ? `Every ${rule.everyDays} days` : rule?.rrule,
      repeatRecord.anchor ? `From ${repeatRecord.anchor}` : null].filter(Boolean).join(" · ") :
      data.recurringEventId ? `Instance of calendar series ${data.recurringEventId}` : data.recurrence?.join(" · ") ?? null;
    return { row: row(args.kind, record, recurrence, entityKind), description: data.description ?? data.content ?? null, projectId: linked?.to.entityId ?? null,
      updatedAt: data.updatedAt ?? 0, waitingOn: data.waitingOn ?? null,
      schedule: repeatRecord?.rule ? { rule: repeatRecord.rule, anchor: repeatRecord.anchor, nextDueAt: repeatRecord.nextDueAt,
        history: (repeatRecord.history ?? []).map((entry: any) => ({ outcome: entry.outcome ?? "completed", at: entry.occurredAt ?? entry.completedAt, scheduledFor: entry.scheduledFor ?? null, note: entry.note ?? null })) } : null,
      dates, timeZone: data.timeZone ?? repeatRecord?.timeZone ?? null, recurrence: repeatDescription,
      sources: sources.filter(source => taskSourceLinks({ sourceSystem: "", url: source.url }).length > 0) };

  },
});
