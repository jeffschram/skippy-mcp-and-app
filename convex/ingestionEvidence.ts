import { internalMutation, internalQuery } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { sourceRow } from "./ingestionProgress";

/** Append-only terminal attempts. Existing run reports are never rewritten. */
export async function saveAttempt(db: any, brain: any, source: string, p: any, status: string,
  errors: string[], finishedAt: number, evidence: any, key = p.token) {
  const existing = await db.query("ingestionWindowHistory").withIndex("by_brain_key", (q: any) =>
    q.eq("brainInstanceId", brain).eq("key", key)).first();
  if (existing) return existing._id;
  return db.insert("ingestionWindowHistory", { brainInstanceId: brain, key, source, runId: p.runId,
    windowStart: p.windowStart, windowEnd: p.windowEnd, status, finishedAt, errors, evidence });
}

export function completionEvidence(p: any, input: any, errors: string[] = []) {
  const counts = input.counts;
  const countsValid = !!counts && [counts.read, counts.ignored, counts.accepted].every(n => Number.isSafeInteger(n) && n >= 0)
    && counts.read === counts.ignored + counts.accepted;
  const reportedBoundsMatch = input.windowStart === p.windowStart && input.windowEnd === p.windowEnd;
  const boundsRequired = p.protocolVersion >= 10 || input.protocolVersion >= 10 || input.windowStart !== undefined || input.windowEnd !== undefined;
  const receiptReconciled = countsValid && counts.accepted <= p.writes + p.replays;
  return { origin: "current_attempt", runId: p.runId, windowStart: p.windowStart, windowEnd: p.windowEnd,
    reportedWindowStart: input.windowStart ?? null, reportedWindowEnd: input.windowEnd ?? null,
    reportedBoundsMatch, boundsRequired, paginationComplete: input.paginationComplete === true,
    persistenceComplete: input.persistenceComplete === true, counts: counts ?? null, countsValid,
    receiptReconciliation: { accepted: counts?.accepted ?? null, writes: p.writes, replays: p.replays, satisfied: receiptReconciled },
    currentErrors: errors, checksSatisfied: (!boundsRequired || reportedBoundsMatch) && countsValid && receiptReconciled
      && input.paginationComplete === true && input.persistenceComplete === true && errors.length === 0,
    evidenceLimit: "Pagination, classification and persistence completeness are harness attestations, not independent connector verification. This is not safety-review authorization." };
}

async function recoveryFor(db: any, brain: any, row: any) {
  if (row.status === "completed") return null;
  const recovery = await db.query("ingestionWindowHistory").withIndex("by_window_status_time", (q: any) =>
    q.eq("brainInstanceId", brain).eq("source", row.source).eq("windowStart", row.windowStart)
      .eq("windowEnd", row.windowEnd).eq("status", "completed").gt("finishedAt", row.finishedAt)).first();
  return recovery ? { runId: recovery.runId, at: recovery.finishedAt, historyId: recovery._id,
    basis: "Recorded successful completion of the exact same window" } : null;
}

export async function inspectProgress(db: any, brain: any, source: string, paginationOpts: any, completion: any, now: number) {
  const row = await sourceRow(db, brain, source);
  const p = row?.metadata?.progress;
  const expired = row?.status === "running" && p?.leaseUntil <= now;
  const status = expired ? "failed" : row?.status ?? "idle";
  const page = await db.query("ingestionWindowHistory").withIndex("by_brain_source", (q: any) =>
    q.eq("brainInstanceId", brain).eq("source", source)).order("desc").paginate(paginationOpts);
  const history = [];
  for (const item of page.page) {
    const recovery = await recoveryFor(db, brain, item);
    history.push({ id: item._id, runId: item.runId, windowStart: item.windowStart, windowEnd: item.windowEnd,
      status: item.status, finishedAt: item.finishedAt, errors: item.errors, evidence: item.evidence,
      recoveryState: item.status === "completed" ? "not_applicable" : recovery ? "recovered" : "not_recorded", recovery });
  }
  // The current state, rather than a history-page sample, determines replay.
  const requiresReplay = !!p && (status === "failed" || (status === "running" && p.replayOfFailedWindow === true));
  let preview = null;
  if (completion) {
    if (!p || completion.runKey !== p.runId) throw new Error("Completion evidence must reference the current run");
    preview = { ...completionEvidence(p, completion, completion.errors ?? []),
      activeLease: status === "running", checkpointWillAdvance: false };
  }
  return { source, status, currentWindow: p ? { runId: p.runId, windowStart: p.windowStart, windowEnd: p.windowEnd,
    coveredThrough: p.coveredThrough ?? null, caughtUp: p.caughtUp ?? false,
    historicalReplayId: p.historicalReplay?.historyId ?? null,
    resumeWindow: p.historicalReplay ? { status: p.historicalReplay.resume.status,
      windowStart: p.historicalReplay.resume.progress.windowStart, windowEnd: p.historicalReplay.resume.progress.windowEnd } : null,
    leaseActive: status === "running", requiresReplay,
    replayState: requiresReplay ? "required_until_successful_finish" : status === "completed" ? "completed" : "not_required",
    replayOfRunId: p.replayOfRunId ?? null, currentErrors: expired ? [...(row.errors ?? []), "Lease expired before finish"] : row.errors ?? [],
    completionEvidence: p.completionEvidence ?? null } : null,
    history, continueCursor: page.continueCursor, isDone: page.isDone,
    legacyFailureSummary: (p?.historicalFailure || p?.lastFailureAt) ? {
      summary: p.historicalFailure ?? { at: p.lastFailureAt, errors: p.lastErrors ?? [] },
      interpretation: "Retained legacy summary; consult exact-window history for recovery. This summary alone does not determine current replay requirements." } : null,
    historyLimit: "History is paginated. Pre-v10 entries are imported only from attributable terminal source reports; absence is not proof of recovery. Unattributed legacy summaries remain visible.",
    completionPreview: preview };
}

const counts = v.object({ read: v.number(), ignored: v.number(), accepted: v.number() });
export const getProgress = internalQuery({
  args: { brainInstanceId: v.id("brainInstances"), source: v.string(), cursor: v.optional(v.string()),
    completion: v.optional(v.object({ runKey: v.string(), windowStart: v.number(), windowEnd: v.number(),
      paginationComplete: v.boolean(), persistenceComplete: v.boolean(), counts, errors: v.optional(v.array(v.string())) })) },
  returns: v.any(),
  handler: async ({ db }, args) => inspectProgress(db, args.brainInstanceId, args.source,
    { numItems: 20, cursor: args.cursor ?? null }, args.completion, Date.now()),
});

// Additive, bounded import; repeatable and never changes source progress or old reports.
export const importLegacy = internalMutation({
  args: { brainInstanceId: v.id("brainInstances"), paginationOpts: paginationOptsValidator }, returns: v.any(),
  handler: async ({ db }, args) => {
    const page = await db.query("ingestionRuns").withIndex("by_brain_started", q => q.eq("brainInstanceId", args.brainInstanceId))
      .paginate({ ...args.paginationOpts, numItems: Math.min(args.paginationOpts.numItems, 50) });
    let imported = 0;
    for (const run of page.page) {
      for (const report of (run.metadata?.sourceReports ?? []).slice(0, 50)) {
        const p = report.progress;
        if (!p || p.completionEvidence?.origin === "current_attempt" || p.runId !== run.runKey || !["failed", "completed"].includes(report.status)
          || !Number.isSafeInteger(p.windowStart) || !Number.isSafeInteger(p.windowEnd) || p.windowStart >= p.windowEnd) continue;
        const finishedAt = report.status === "completed" ? p.lastSuccessAt : p.historicalFailure?.at ?? p.lastFailureAt;
        if (!Number.isSafeInteger(finishedAt) || finishedAt < run.startedAt || (run.completedAt && finishedAt > run.completedAt)) continue;
        await saveAttempt(db, args.brainInstanceId, report.source, p, report.status, report.errors ?? [], finishedAt,
          { origin: "legacy_run_report", ingestionRunId: run._id, counts: p.counts ?? null,
            writes: p.writes ?? null, replays: p.replays ?? null, paginationComplete: null, persistenceComplete: null,
            limitation: "Historical recorded outcome; missing attestations are unknown, not inferred." },
          `legacy:${run._id}:${report.source}`);
        imported++;
      }
    }
    return { imported, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});
