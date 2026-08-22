import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { validateProjectFileInput } from "@skippy/shared";
import { requireOwnedBrain } from "./auth";
import { requireHost } from "./agentWorkbench";

const UPLOAD_TTL_MS = 15 * 60_000;
const DELETE_RETENTION_MS = 30 * 24 * 60 * 60_000;
const SHA256_RE = /^[a-f0-9]{64}$/;

function fileKind(row: any): "library_input" | "generated_artifact" {
  return row.kind ?? "library_input";
}

function fileStatus(row: any): "pending_upload" | "ready" | "failed" | "deleted" {
  return row.status ?? "ready";
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Cloud-canonical project library backed by Convex file storage.
 *
 * Upload flow (both viewer and brain/harness):
 *   1. Call the generateUploadUrl mutation (upload URLs can only be minted
 *      from a mutation).
 *   2. HTTP POST the raw file bytes to that URL; the response JSON contains
 *      `{ storageId }`.
 *   3. Register the file row with that storageId.
 *
 * Download URLs from `storage.getUrl` are time-limited — they are resolved at
 * read time in the list queries and must never be persisted.
 */

async function requireProjectForBrain(db: any, brainInstanceId: any, projectId: string) {
  const project = await db.get(projectId);
  if (!project || project.brainInstanceId !== brainInstanceId) {
    throw new Error("project not found for brain instance");
  }
  return project;
}

async function requireTaskForBrain(db: any, brainInstanceId: any, taskId: string) {
  const task = await db.get(taskId);
  if (!task || task.brainInstanceId !== brainInstanceId) {
    throw new Error("task not found for brain instance");
  }
  return task;
}

async function registerFile(
  ctx: { db: any },
  brainInstanceId: any,
  args: {
    projectId: string;
    taskId?: string;
    storageId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    note?: string;
  },
  uploadedBy: "user" | "harness",
  actor: { actorType: string; actorId?: string },
) {
  const project = await requireProjectForBrain(ctx.db, brainInstanceId, args.projectId);
  if (args.taskId) {
    await requireTaskForBrain(ctx.db, brainInstanceId, args.taskId);
  }

  const { fileName, mimeType, sizeBytes } = validateProjectFileInput({
    fileName: args.fileName,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
  });

  const now = Date.now();
  const fileId = await ctx.db.insert("projectFiles", {
    brainInstanceId,
    projectId: args.projectId,
    taskId: args.taskId,
    storageId: args.storageId,
    fileName,
    mimeType,
    sizeBytes,
    uploadedBy,
    kind: "library_input",
    status: "ready",
    createdByType: uploadedBy,
    createdById: actor.actorId,
    readyAt: now,
    note: args.note?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("activityEvents", {
    brainInstanceId,
    entityRef: { entityType: "project", entityId: args.projectId },
    activityType: "project_file_added",
    actorType: actor.actorType,
    actorId: actor.actorId,
    timestamp: now,
    summary: `File added to ${project.title} library: ${fileName}`,
    metadata: { fileId, taskId: args.taskId, fileName, mimeType, sizeBytes, uploadedBy },
  });

  return { fileId, projectId: args.projectId, taskId: args.taskId, fileName, mimeType, sizeBytes, uploadedBy };
}

async function listFiles(
  ctx: { db: any; storage: { getUrl(storageId: string): Promise<string | null> } },
  brainInstanceId: any,
  args: { projectId: string; taskId?: string; kind?: "library_input" | "generated_artifact"; includeDeleted?: boolean },
) {
  await requireProjectForBrain(ctx.db, brainInstanceId, args.projectId);

  let rows: any[];
  if (args.taskId) {
    rows = (
      await ctx.db
        .query("projectFiles")
        .withIndex("by_brain_task", (q: any) =>
          q.eq("brainInstanceId", brainInstanceId).eq("taskId", args.taskId),
        )
        .collect()
    ).filter((row: any) => row.projectId === args.projectId);
  } else {
    rows = await ctx.db
      .query("projectFiles")
      .withIndex("by_brain_project", (q: any) =>
        q.eq("brainInstanceId", brainInstanceId).eq("projectId", args.projectId),
      )
      .collect();
  }
  rows = rows.filter((row: any) => (args.includeDeleted ? fileStatus(row) === "ready" || fileStatus(row) === "deleted" : fileStatus(row) === "ready") && (!args.kind || fileKind(row) === args.kind));
  rows.sort((a: any, b: any) => b.createdAt - a.createdAt);

  const files = [];
  for (const row of rows) {
    files.push({
      _id: row._id,
      fileId: row._id,
      projectId: row.projectId,
      taskId: row.taskId,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      uploadedBy: row.uploadedBy,
      kind: fileKind(row),
      status: fileStatus(row),
      sha256: row.sha256,
      runId: row.runId,
      chatId: row.chatId,
      messageId: row.messageId,
      required: row.required ?? false,
      note: row.note,
      createdAt: row.createdAt,
      // Time-limited URL resolved at read time. Never persist it.
      url: row.storageId ? await ctx.storage.getUrl(row.storageId) : null,
    });
  }
  return files;
}

async function deleteFile(
  ctx: { db: any },
  brainInstanceId: any,
  fileId: string,
  actor: { actorType: string; actorId?: string },
) {
  const file = await ctx.db.get(fileId);
  if (!file || file.brainInstanceId !== brainInstanceId) {
    throw new Error("file not found for brain instance");
  }

  const now = Date.now();
  if (fileStatus(file) === "deleted") {
    return { fileId, projectId: file.projectId, fileName: file.fileName, status: "deleted" };
  }
  await ctx.db.patch(fileId, {
    status: "deleted",
    deletedAt: now,
    retentionUntil: now + DELETE_RETENTION_MS,
    updatedAt: now,
  });
  await ctx.db.insert("activityEvents", {
    brainInstanceId,
    entityRef: { entityType: "project", entityId: file.projectId },
    activityType: "project_file_deleted",
    actorType: actor.actorType,
    actorId: actor.actorId,
    timestamp: now,
    summary: `File removed from project library: ${file.fileName}`,
    metadata: { fileId, projectId: file.projectId, taskId: file.taskId, fileName: file.fileName },
  });

  return { fileId, projectId: file.projectId, fileName: file.fileName, status: "deleted" };
}

async function beginUpload(ctx: any, brainInstanceId: any, args: any, uploadedBy: "user" | "harness", actorId?: string) {
  await requireProjectForBrain(ctx.db, brainInstanceId, args.projectId);
  if (args.taskId) await requireTaskForBrain(ctx.db, brainInstanceId, args.taskId);
  const metadata = validateProjectFileInput(args);
  if (args.kind === "generated_artifact" && !args.runId) throw new Error("generated artifacts require runId");
  if (args.runId) {
    const run = await ctx.db.get(args.runId);
    if (!run || run.brainInstanceId !== brainInstanceId || run.projectId !== args.projectId) throw new Error("run not found for project");
  }
  if (args.uploadKey) {
    const existing = await ctx.db.query("projectFiles").withIndex("by_brain_upload_key", (q: any) =>
      q.eq("brainInstanceId", brainInstanceId).eq("uploadKey", args.uploadKey),
    ).first();
    if (existing) {
      if (existing.projectId !== args.projectId || existing.fileName !== metadata.fileName || fileKind(existing) !== args.kind) {
        throw new Error("upload key already used for a different file");
      }
      return { fileId: existing._id, uploadUrl: fileStatus(existing) === "pending_upload" ? await ctx.storage.generateUploadUrl() : undefined, expiresAt: existing.uploadExpiresAt, status: fileStatus(existing) };
    }
  }
  const now = Date.now();
  const fileId = await ctx.db.insert("projectFiles", {
    brainInstanceId, projectId: args.projectId, taskId: args.taskId, runId: args.runId,
    chatId: args.chatId, messageId: args.messageId, kind: args.kind, status: "pending_upload",
    fileName: metadata.fileName, mimeType: metadata.mimeType, sizeBytes: metadata.sizeBytes,
    uploadedBy, createdByType: uploadedBy, createdById: actorId, required: args.required,
    uploadKey: args.uploadKey, uploadExpiresAt: now + UPLOAD_TTL_MS, note: args.note?.trim() || undefined,
    createdAt: now, updatedAt: now,
  });
  await ctx.db.insert("activityEvents", { brainInstanceId, entityRef: { entityType: "project", entityId: args.projectId }, activityType: "project_file_upload_begun", actorType: uploadedBy, actorId, timestamp: now, summary: `Upload begun: ${metadata.fileName}`, metadata: { fileId, kind: args.kind, sizeBytes: metadata.sizeBytes } });
  return { fileId, uploadUrl: await ctx.storage.generateUploadUrl(), expiresAt: now + UPLOAD_TTL_MS, status: "pending_upload" };
}

async function finalizeUpload(ctx: any, brainInstanceId: any, args: any) {
  const file = await ctx.db.get(args.fileId);
  if (!file || file.brainInstanceId !== brainInstanceId) throw new Error("file not found for brain instance");
  const sha256 = String(args.sha256).toLowerCase();
  if (!SHA256_RE.test(sha256)) throw new Error("sha256 must be 64 lowercase hexadecimal characters");
  if (fileStatus(file) === "ready") {
    if (file.storageId === args.storageId && file.sha256 === sha256) return { fileId: file._id, status: "ready", replayed: true };
    throw new Error("file was already finalized with different bytes");
  }
  if (fileStatus(file) !== "pending_upload") throw new Error(`cannot finalize file in ${fileStatus(file)} state`);
  if ((file.uploadExpiresAt ?? 0) < Date.now()) throw new Error("upload expired; begin a new upload");
  const metadata = await ctx.storage.getMetadata(args.storageId);
  if (!metadata) throw new Error("uploaded blob not found");
  if (metadata.size !== file.sizeBytes) throw new Error(`blob size mismatch: expected ${file.sizeBytes}, received ${metadata.size}`);
  if (metadata.contentType && metadata.contentType !== file.mimeType) throw new Error(`blob MIME mismatch: expected ${file.mimeType}, received ${metadata.contentType}`);
  if (metadata.sha256.toLowerCase() !== sha256) throw new Error("blob SHA-256 does not match finalize request");
  const now = Date.now();
  await ctx.db.patch(file._id, { storageId: args.storageId, sha256, status: "ready", readyAt: now, updatedAt: now, failureReason: undefined });
  await ctx.db.insert("activityEvents", { brainInstanceId, entityRef: { entityType: "project", entityId: file.projectId }, activityType: "project_file_ready", actorType: file.createdByType ?? file.uploadedBy, actorId: file.createdById, timestamp: now, summary: `File durable: ${file.fileName}`, metadata: { fileId: file._id, kind: fileKind(file), runId: file.runId, sizeBytes: metadata.size } });
  return { fileId: file._id, status: "ready", replayed: false, sha256, sizeBytes: metadata.size, mimeType: metadata.contentType ?? file.mimeType };
}

async function abortUpload(ctx: any, brainInstanceId: any, args: any) {
  const file = await ctx.db.get(args.fileId);
  if (!file || file.brainInstanceId !== brainInstanceId) throw new Error("file not found for brain instance");
  if (fileStatus(file) === "ready") throw new Error("ready files cannot be aborted");
  if (fileStatus(file) !== "failed") await ctx.db.patch(file._id, { status: "failed", failureReason: args.reason?.slice(0, 500) ?? "upload aborted", updatedAt: Date.now() });
  if (args.storageId) await ctx.storage.delete(args.storageId).catch(() => undefined);
  return { fileId: file._id, status: "failed" };
}

async function restoreFile(ctx: any, brainInstanceId: any, fileId: string) {
  const file = await ctx.db.get(fileId);
  if (!file || file.brainInstanceId !== brainInstanceId) throw new Error("file not found for brain instance");
  if (fileStatus(file) !== "deleted") return { fileId, status: fileStatus(file), replayed: true };
  if (!file.storageId || (file.retentionUntil ?? 0) < Date.now()) throw new Error("file retention window has expired");
  await ctx.db.patch(fileId, { status: "ready", deletedAt: undefined, retentionUntil: undefined, updatedAt: Date.now() });
  return { fileId, status: "ready", replayed: false };
}

/* ------------------------------------------------------------------ */
/* Viewer-facing (Clerk auth)                                         */
/* ------------------------------------------------------------------ */

export const generateUploadUrlForViewer = mutationGeneric({
  args: {},
  handler: async (ctx) => {
    await requireOwnedBrain(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

const beginArgs = {
  projectId: v.id("projects"), taskId: v.optional(v.id("tasks")), runId: v.optional(v.id("agentRuns")),
  chatId: v.optional(v.id("projectChats")), messageId: v.optional(v.id("chatMessages")),
  kind: v.union(v.literal("library_input"), v.literal("generated_artifact")),
  fileName: v.string(), mimeType: v.string(), sizeBytes: v.number(), sha256: v.optional(v.string()),
  required: v.optional(v.boolean()), note: v.optional(v.string()), uploadKey: v.optional(v.string()),
};

export const beginUploadForViewer = mutationGeneric({ args: beginArgs, handler: async (ctx, args) => {
  const { user, brain } = await requireOwnedBrain(ctx);
  return await beginUpload(ctx, brain._id, args, "user", user._id);
} });

export const finalizeUploadForViewer = mutationGeneric({
  args: { fileId: v.id("projectFiles"), storageId: v.id("_storage"), sha256: v.string() },
  handler: async (ctx, args) => { const { brain } = await requireOwnedBrain(ctx); return await finalizeUpload(ctx, brain._id, args); },
});

export const abortUploadForViewer = mutationGeneric({
  args: { fileId: v.id("projectFiles"), storageId: v.optional(v.id("_storage")), reason: v.optional(v.string()) },
  handler: async (ctx, args) => { const { brain } = await requireOwnedBrain(ctx); return await abortUpload(ctx, brain._id, args); },
});

export const registerFileForViewer = mutationGeneric({
  args: {
    projectId: v.id("projects"),
    taskId: v.optional(v.id("tasks")),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    return await registerFile(ctx, brain._id, args, "user", {
      actorType: "user",
      actorId: user._id,
    });
  },
});

export const listFilesForViewer = queryGeneric({
  args: {
    projectId: v.id("projects"),
    taskId: v.optional(v.id("tasks")),
    kind: v.optional(v.union(v.literal("library_input"), v.literal("generated_artifact"))),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    return await listFiles(ctx, brain._id, args);
  },
});

export const deleteFileForViewer = mutationGeneric({
  args: { fileId: v.id("projectFiles") },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    return await deleteFile(ctx, brain._id, args.fileId, {
      actorType: "user",
      actorId: user._id,
    });
  },
});

export const restoreFileForViewer = mutationGeneric({
  args: { fileId: v.id("projectFiles") },
  handler: async (ctx, args) => { const { brain } = await requireOwnedBrain(ctx); return await restoreFile(ctx, brain._id, args.fileId); },
});

/* ------------------------------------------------------------------ */
/* Brain-facing (MCP token routing)                                   */
/* ------------------------------------------------------------------ */

export const generateUploadUrlForBrain = mutationGeneric({
  args: { brainInstanceId: v.id("brainInstances") },
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const beginUploadForBrain = mutationGeneric({
  args: { brainInstanceId: v.id("brainInstances"), ...beginArgs, actorId: v.optional(v.string()) },
  handler: async (ctx, args) => { const { brainInstanceId, actorId, ...fileArgs } = args; return await beginUpload(ctx, brainInstanceId, fileArgs, "harness", actorId); },
});

export const finalizeUploadForBrain = mutationGeneric({
  args: { brainInstanceId: v.id("brainInstances"), fileId: v.id("projectFiles"), storageId: v.id("_storage"), sha256: v.string() },
  handler: async (ctx, args) => await finalizeUpload(ctx, args.brainInstanceId, args),
});

export const abortUploadForBrain = mutationGeneric({
  args: { brainInstanceId: v.id("brainInstances"), fileId: v.id("projectFiles"), storageId: v.optional(v.id("_storage")), reason: v.optional(v.string()) },
  handler: async (ctx, args) => await abortUpload(ctx, args.brainInstanceId, args),
});

export const registerFileForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    projectId: v.id("projects"),
    taskId: v.optional(v.id("tasks")),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    note: v.optional(v.string()),
    actorId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { brainInstanceId, actorId, ...fileArgs } = args;
    return await registerFile(ctx, brainInstanceId, fileArgs, "harness", {
      actorType: "harness",
      ...(actorId ? { actorId } : {}),
    });
  },
});

export const listFilesForBrain = queryGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    projectId: v.id("projects"),
    taskId: v.optional(v.id("tasks")),
  },
  handler: async (ctx, args) => {
    const { brainInstanceId, ...listArgs } = args;
    return await listFiles(ctx, brainInstanceId, listArgs);
  },
});

export const deleteFileForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    fileId: v.id("projectFiles"),
    actorId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await deleteFile(ctx, args.brainInstanceId, args.fileId, {
      actorType: "harness",
      ...(args.actorId ? { actorId: args.actorId } : {}),
    });
  },
});

export const restoreFileForBrain = mutationGeneric({
  args: { brainInstanceId: v.id("brainInstances"), fileId: v.id("projectFiles") },
  handler: async (ctx, args) => await restoreFile(ctx, args.brainInstanceId, args.fileId),
});

export const getFileForBrain = queryGeneric({
  args: { brainInstanceId: v.id("brainInstances"), fileId: v.id("projectFiles") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.fileId);
    if (!row || row.brainInstanceId !== args.brainInstanceId || fileStatus(row) !== "ready") throw new Error("ready file not found for brain instance");
    return { ...row, fileId: row._id, kind: fileKind(row), status: fileStatus(row), url: row.storageId ? await ctx.storage.getUrl(row.storageId) : null };
  },
});

async function requireRunnerClaim(ctx: any, host: any, runId: string, claimToken: string) {
  const run = await ctx.db.get(runId);
  if (!run || run.brainInstanceId !== host.brainInstanceId || run.hostId !== host._id || run.claimToken !== claimToken) throw new Error("run is not claimed by this host");
  return run;
}

export const beginArtifactUploadForRunner = mutationGeneric({
  args: { hostToken: v.string(), runId: v.id("agentRuns"), claimToken: v.string(), fileName: v.string(), mimeType: v.string(), sizeBytes: v.number(), sha256: v.string(), relativePath: v.string(), required: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken); const run = await requireRunnerClaim(ctx, host, args.runId, args.claimToken);
    return await beginUpload(ctx, host.brainInstanceId, { projectId: run.projectId, taskId: run.taskId, runId: run._id, kind: "generated_artifact", fileName: args.fileName, mimeType: args.mimeType, sizeBytes: args.sizeBytes, required: args.required, uploadKey: `${run._id}:${args.relativePath}:${args.sha256}` }, "harness", host._id);
  },
});

export const finalizeArtifactUploadForRunner = mutationGeneric({
  args: { hostToken: v.string(), runId: v.id("agentRuns"), claimToken: v.string(), fileId: v.id("projectFiles"), storageId: v.id("_storage"), sha256: v.string() },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken); const run = await requireRunnerClaim(ctx, host, args.runId, args.claimToken);
    const result = await finalizeUpload(ctx, host.brainInstanceId, args);
    const ids = Array.from(new Set([...(run.artifactFileIds ?? []), args.fileId]));
    await ctx.db.patch(run._id, { artifactFileIds: ids, updatedAt: Date.now() });
    return result;
  },
});

/** Bounded cron target: expire pending uploads, then physically collect only
 * soft-deleted blobs whose retention elapsed. Ready/referenced blobs are never touched. */
export const cleanupExpiredFiles = mutationGeneric({
  args: { now: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now(); const limit = Math.min(200, Math.max(1, args.limit ?? 50));
    const pending = (await ctx.db.query("projectFiles").collect()).filter((r: any) =>
      fileStatus(r) === "pending_upload" && (r.uploadExpiresAt ?? 0) < now,
    ).slice(0, limit);
    for (const row of pending) await ctx.db.patch(row._id, { status: "failed", failureReason: "upload expired", updatedAt: now });
    const remaining = limit - pending.length;
    const deleted = remaining > 0 ? (await ctx.db.query("projectFiles").collect()).filter((r: any) =>
      fileStatus(r) === "deleted" && r.storageId && (r.retentionUntil ?? Infinity) < now,
    ).slice(0, remaining) : [];
    let blobsDeleted = 0;
    for (const row of deleted) {
      const chatReference = (await ctx.db.query("chatMessages").collect()).some((m: any) =>
        (m.attachments ?? []).some((a: any) => a.fileId === row._id || (row.storageId && a.storageId === row.storageId)),
      );
      const runReference = (await ctx.db.query("agentRuns").collect()).some((run: any) =>
        (run.artifactFileIds ?? []).includes(row._id) || (run.inputFileRefs ?? []).some((ref: any) => ref.fileId === row._id),
      );
      if (chatReference || runReference) continue;
      await ctx.storage.delete(row.storageId); await ctx.db.patch(row._id, { storageId: undefined, updatedAt: now }); blobsDeleted += 1;
    }
    return { pendingExpired: pending.length, blobsDeleted };
  },
});
