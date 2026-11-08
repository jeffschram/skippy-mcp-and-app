// Home consolidation contract: docs/home-item-contract.md.
import { query } from "./_generated/server";
import { compareValues, v } from "convex/values";
import { requireOwnedBrain } from "./auth";

const kind = v.union(v.literal("task"), v.literal("event"), v.literal("recurrence"));
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
function row(kind: "task" | "event" | "recurrence", record: any, recurrence?: any) {
  const want = kind === "task" && record.commitment === "want";
  return {
    kind, id: record._id, title: record.title, status: record.status,
    at: want ? null : (kind === "event" ? record.startAt : kind === "recurrence" ? record.nextDueAt : record.dueAt) ?? null,
    endAt: record.endAt ?? null, isAllDay: record.isAllDay ?? false,
    area: record.area ?? null, isWant: want, isWaiting: record.status === "waiting",
    waitingSince: record.waitingSince ?? null, lastNudgedAt: record.lastNudgedAt ?? null,
    recurrenceId: recurrence?._id ?? (kind === "recurrence" ? record._id : null),
    recurrenceStatus: recurrence?.status ?? (kind === "recurrence" ? record.status : null),
    fromRecurrence: !!recurrence, location: record.location ?? null,
    href: record.htmlLink ?? null,
  };
}
const rowValidator = v.object({
  kind, id: v.string(), title: v.string(), status: v.string(), at: v.union(v.number(), v.null()),
  endAt: v.union(v.number(), v.null()), isAllDay: v.boolean(), area: v.union(v.string(), v.null()),
  isWant: v.boolean(), isWaiting: v.boolean(), waitingSince: v.union(v.number(), v.null()),
  lastNudgedAt: v.union(v.number(), v.null()), recurrenceId: v.union(v.string(), v.null()),
  recurrenceStatus: v.union(v.string(), v.null()), fromRecurrence: v.boolean(),
  location: v.union(v.string(), v.null()), href: v.union(v.string(), v.null()),
});

// Lexicographic seek over explicit index columns. Each branch takes only the
// remaining budget, including when many records share a timestamp/title.
export async function seek(db: any, source: any, last: any[] | null, limit: number) {
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
    const signature = JSON.stringify([brain._id, scope]);
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
    const size = all ? 50 : 20;
    const streams = await Promise.all(sources.map(async (source) => ({ source, index: 0,
      records: positions[source.key] === false ? [] : await seek(ctx.db, source, positions[source.key] ?? null, size + 1) })));
    const rows: any[] = [];
    let scanned = 0;
    while (rows.length < size && scanned < 300) {
      // A depleted, non-exhausted source may have an earlier next head.
      // Return a short page rather than jumping over it in another stream.
      if (streams.some(s => s.index === s.records.length && s.records.length === size + 1)) break;
      const available = streams.filter(s => s.index < s.records.length);
      if (!available.length) break;
      available.sort((a, b) => {
        const ra = row(a.source.kind, a.records[a.index]);
        const rb = row(b.source.kind, b.records[b.index]);
        return (a.source.group ?? 0) - (b.source.group ?? 0) || (ra.at ?? 0) - (rb.at ?? 0) ||
          compareValues(ra.title, rb.title) ||
          compareValues(a.records[a.index]._creationTime, b.records[b.index]._creationTime) || compareValues(ra.id, rb.id);
      });
      const stream = available[0]!;
      const record = stream.records[stream.index++];
      const source = stream.source;
      positions[source.key] = source.fields.map((field: string) => record[field]);
      scanned++;
      let recurrence = null;
      if (source.kind === "task") {
        if (await project(ctx, brain._id, record._id)) continue;
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
      rows.push(row(source.kind, record, recurrence));
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
  returns: v.union(v.null(), v.object({ row: rowValidator, description: v.union(v.string(), v.null()), projectId: v.union(v.string(), v.null()) })),
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const table = args.kind === "task" ? "tasks" : args.kind === "event" ? "calendarEvents" : "recurrences";
    const id = ctx.db.normalizeId(table, args.id);
    const record = id ? await ctx.db.get(id) : null;
    if (!record || record.brainInstanceId !== brain._id) return null;
    const linked = args.kind === "task" ? await project(ctx, brain._id, record._id) : null;
    const recurrence = args.kind === "task" ? await repeat(ctx, brain._id, record._id) : null;
    return { row: row(args.kind, record, recurrence), description: record.description ?? null, projectId: linked?.to.entityId ?? null };
  },
});
