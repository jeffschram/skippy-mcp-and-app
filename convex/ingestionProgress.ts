import { makeToken } from "./agentWorkbench";
/** Durable ingestion protocol over the existing status tool. All calls execute
 * inside a Convex mutation: lease checks, receipts and entity writes are atomic. */
export const OVERLAP_MS = 15 * 60_000;
export const WINDOW_MS = 48 * 60 * 60_000;
export const LEASE_MS = 10 * 60_000;

export function sourceKey(source: string) {
  if (!source.trim() || source.length > 200) throw new Error("A bounded, account-qualified source is required");
  return `ingestion:${source}`;
}
export async function sourceRow(db: any, brain: any, source: string) {
  return db.query("sourceSyncStatuses").withIndex("by_brain_key", (q: any) =>
    q.eq("brainInstanceId", brain).eq("statusKey", sourceKey(source))).first();
}
export function requireLease(row: any, token: string, now: number) {
  if (!row || row.status !== "running" || row.metadata?.progress?.token !== token ||
      row.metadata.progress.leaseUntil <= now) throw new Error("Stale ingestion lease; reclaim and replay the frozen window");
  return row.metadata.progress;
}

// Old lastErrors remain historical even when a later window succeeds.
function progressReport(progress: any, errors: string[] = []) {
  const { lastErrors, lastFailureAt, ...rest } = progress ?? {};
  return { ...rest, errors, currentErrors: errors,
    historicalFailure: rest.historicalFailure ?? (lastFailureAt ? { at: lastFailureAt, errors: lastErrors ?? [] } : null) };
}

async function lookupReceipt(db: any, brain: any, source: string, objectKey: string, entityType: string) {
  if (typeof objectKey !== "string" || !objectKey.trim() || objectKey.length > 500) throw new Error("Stable source objectKey required");
  if (!["task", "project", "person", "company", "link", "note", "goal", "memory"].includes(entityType)) throw new Error("Invalid receipt entityType");
  const key = JSON.stringify([source, objectKey, entityType]);
  const receipt = await db.query("ingestionReceipts").withIndex("by_brain_key", (q: any) =>
    q.eq("brainInstanceId", brain).eq("key", key)).first();
  if (receipt) {
    const entityId = receipt.result.entityId ?? receipt.result.memoryId;
    const entity = entityId ? await db.get(entityId) : null;
    if (!entity || entity.brainInstanceId !== brain) throw new Error("Previously ingested object is missing or outside this brain; reconcile before completion");
  }
  return { key, receipt };
}

export async function updateProgress(db: any, args: any, now: number) {
  const input = args.metadata.ingestion;
  const { source, runId, operation } = input;
  if (typeof source !== "string") throw new Error("source required");
  const statusKey = sourceKey(source);
  if (args.statusKey && args.statusKey !== statusKey) throw new Error("Incorrect ingestion statusKey");
  const row = await sourceRow(db, args.brainInstanceId, source);
  const old = row?.metadata?.progress;
  if (operation === "inspect") return { statusKey, status: row?.status === "running" && old?.leaseUntil <= now
    ? "failed" : row?.status ?? "idle", ...progressReport(old, row?.errors ?? []) };
  if (operation === "inspect_receipt") {
    const { receipt } = await lookupReceipt(db, args.brainInstanceId, source, input.objectKey, input.entityType);
    return { statusKey, found: !!receipt, result: receipt?.result ?? null };
  }
  if (operation === "replay_receipt") {
    const lease = requireLease(row, input.token, now);
    if (lease.runId !== runId) throw new Error("Run does not own source");
    const { receipt } = await lookupReceipt(db, args.brainInstanceId, source, input.objectKey, input.entityType);
    if (!receipt) throw new Error("No receipt for this exact source/objectKey/entityType; reconcile before completion");
    const entityId = receipt.result.entityId ?? receipt.result.memoryId;
    if (!input.expectedEntityId || input.expectedEntityId !== entityId) throw new Error("Receipt entity does not match expectedEntityId");
    // Same receipt replay is idempotent within this claim, including a lost response.
    if (receipt.lastReplayToken !== input.token) {
      await db.patch(receipt._id, { lastReplayToken: input.token });
      await db.patch(row._id, { metadata: { ...row.metadata, progress: { ...lease, replays: lease.replays + 1 } } });
    }
    return { statusKey, status: "duplicate_existing", result: receipt.result };
  }
  if (typeof runId !== "string" || !runId.trim()) throw new Error("runId required");
  let progress: any;
  let status: "running" | "completed" | "failed" = "running";
  let errors: string[] = [];
  if (operation === "claim") {
    if (args.status !== "running") throw new Error("Claim must be running");
    if (row?.status === "running" && old?.leaseUntil > now) {
      // Repeating a lost claim response is safe; other runs cannot steal it.
      if (old.runId === runId) return { statusKey, ...progressReport(old), status: "running" };
      throw new Error("Source already claimed by another run");
    }
    const baseline = old?.baseline ?? now - WINDOW_MS;
    const replay = old && row.status !== "completed";
    const windowStart = replay ? old.windowStart : Math.max(baseline, (old?.coveredThrough ?? baseline) - OVERLAP_MS);
    const windowEnd = replay ? old.windowEnd : Math.min(now, windowStart + WINDOW_MS);
    progress = { ...progressReport(old), counts: { read: 0, ignored: 0, accepted: 0 }, caughtUp: false, baseline, windowStart, windowEnd, targetEnd: now, runId,
      token: makeToken("ingestion"), leaseUntil: now + LEASE_MS, writes: 0, replays: 0 };
  } else {
    if (operation === "finish" && row?.status !== "running" && old?.runId === runId && old?.token === input.token) {
      return { statusKey, status: row.status, ...progressReport(old, row.errors ?? []) };
    }
    progress = { ...requireLease(row, input.token, now) };
    if (progress.runId !== runId) throw new Error("Run does not own source");
    if (operation === "heartbeat") {
      if (args.status !== "running") throw new Error("Heartbeat must be running");
      progress.leaseUntil = now + LEASE_MS;
    } else if (operation === "finish") {
      const counts = input.counts;
      if (!counts || ![counts.read, counts.ignored, counts.accepted].every(n => Number.isSafeInteger(n) && n >= 0)) {
        throw new Error("Report nonnegative integer read, ignored and accepted counts");
      }
      const complete = args.status === "completed" && input.paginationComplete === true &&
        input.persistenceComplete === true && counts.read === counts.ignored + counts.accepted &&
        counts.accepted <= progress.writes + progress.replays && !(args.errors?.length);
      status = complete ? "completed" : "failed";
      errors = complete ? [] : [...(args.errors ?? []), "Incomplete source coverage or persistence; replay required"];
      progress = { ...progress, counts, leaseUntil: 0,
        ...(!complete ? { historicalFailure: { at: now, errors } } : {}) };
      if (complete) {
        progress.coveredThrough = progress.windowEnd;
        progress.lastSuccessAt = now;
      }
      progress.caughtUp = complete && progress.coveredThrough >= progress.targetEnd;
    } else throw new Error("Unknown ingestion operation");
  }
  delete progress.errors;
  delete progress.currentErrors;
  const patch = { statusKey, harness: args.harness, status, sourceSystemsChecked: [source],
    startedAt: operation === "claim" ? now : row.startedAt, lastHeartbeatAt: now,
    ...(status !== "running" ? { completedAt: now } : {}), errors,
    message: args.message ?? `Source ${source}: ${status}`,
    metadata: { role: args.metadata.role ?? "agenda", progress }, updatedAt: now };
  if (row) await db.patch(row._id, patch);
  else await db.insert("sourceSyncStatuses", { ...patch, brainInstanceId: args.brainInstanceId, createdAt: now });
  return { statusKey, status, ...progressReport(progress, errors) };
}

export async function checkRunCoverage(db: any, args: any, requireComplete = true) {
  const runId = args.metadata?.ingestion?.runId;
  const sources: string[] = args.sourceSystemsChecked;
  if (!runId || !sources.length || new Set(sources).size !== sources.length) throw new Error("Completed ingestion requires runId and all unique sources in scope");
  const reports = [];
  for (const source of sources) {
    const row = await sourceRow(db, args.brainInstanceId, source);
    const p = row?.metadata?.progress;
    reports.push({ source, status: row?.status ?? "skipped", progress: p ? progressReport(p, row?.errors ?? []) : null, errors: row?.errors ?? [] });
    if (requireComplete && (row?.status !== "completed" || p?.runId !== runId || !p?.caughtUp)) {
      throw new Error(`Source ${source} is skipped, failed, busy or still catching up; record aggregate failed`);
    }
  }
  return reports;
}

export async function prepareReceipt(db: any, brain: any, ingestion: any, entityType: string, now: number) {
  if (!ingestion) return null;
  const { source, token, objectKey } = ingestion;
  if (!objectKey?.trim() || objectKey.length > 500) throw new Error("Stable source objectKey required");
  const row = await sourceRow(db, brain, source);
  const progress = requireLease(row, token, now);
  const key = JSON.stringify([source, objectKey, entityType]);
  const receipt = await db.query("ingestionReceipts").withIndex("by_brain_key", (q: any) =>
    q.eq("brainInstanceId", brain).eq("key", key)).first();
  if (receipt) {
    const entityId = receipt.result.entityId ?? receipt.result.memoryId;
    if (!entityId || !await db.get(entityId)) throw new Error("Previously ingested object is missing; reconcile before completion");
    await db.patch(row._id, { metadata: { ...row.metadata, progress: { ...progress, replays: progress.replays + 1 } } });
  }
  return { row, progress, key, receipt };
}
export async function saveReceipt(db: any, brain: any, prepared: any, result: any, now: number) {
  if (!prepared) return;
  await db.insert("ingestionReceipts", { brainInstanceId: brain, key: prepared.key, result, createdAt: now });
  await db.patch(prepared.row._id, { metadata: { ...prepared.row.metadata,
    progress: { ...prepared.progress, writes: prepared.progress.writes + 1 } } });
}

/** Freeze the expected sources before reading; terminal reports cannot omit one. */
export async function recordProgressRun(db: any, args: any, now: number) {
  const runKey = args.metadata?.ingestion?.runId;
  if (typeof runKey !== "string" || !runKey.trim()) throw new Error("Durable runId required");
  const existing = await db.query("ingestionRuns").withIndex("by_brain_run", (q: any) =>
    q.eq("brainInstanceId", args.brainInstanceId).eq("runKey", runKey)).first();
  if (!existing && args.status !== "running") throw new Error("Register running ingestion with all expected sources before reading");
  if (!args.sourceSystemsChecked.length || new Set(args.sourceSystemsChecked).size !== args.sourceSystemsChecked.length) {
    throw new Error("Declare all unique sources in scope");
  }
  if (existing && JSON.stringify([...existing.sourceSystemsChecked].sort()) !== JSON.stringify([...args.sourceSystemsChecked].sort())) {
    throw new Error("Expected source scope cannot change within a run");
  }
  if (args.status === "completed" && args.errors?.length) throw new Error("A completed ingestion cannot contain failures");
  if (existing?.status === "completed") return existing._id;
  const reports = args.status === "running" ? [] : await checkRunCoverage(db, args, args.status === "completed");
  const value = { ...args, runKey, startedAt: existing?.startedAt ?? args.startedAt ?? now,
    ...(args.status !== "running" ? { completedAt: now } : {}),
    metadata: { ...args.metadata, sourceReports: reports } };
  if (existing) { await db.patch(existing._id, value); return existing._id; }
  return db.insert("ingestionRuns", value);
}
