import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { validateProjectFileInput } from "@skippy/shared";
import { requireOwnedBrain } from "./auth";

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
  args: { projectId: string; taskId?: string },
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
  rows.sort((a: any, b: any) => b.createdAt - a.createdAt);

  const files = [];
  for (const row of rows) {
    files.push({
      _id: row._id,
      projectId: row.projectId,
      taskId: row.taskId,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      uploadedBy: row.uploadedBy,
      note: row.note,
      createdAt: row.createdAt,
      // Time-limited URL resolved at read time. Never persist it.
      url: await ctx.storage.getUrl(row.storageId),
    });
  }
  return files;
}

async function deleteFile(
  ctx: { db: any; storage: { delete(storageId: string): Promise<void> } },
  brainInstanceId: any,
  fileId: string,
  actor: { actorType: string; actorId?: string },
) {
  const file = await ctx.db.get(fileId);
  if (!file || file.brainInstanceId !== brainInstanceId) {
    throw new Error("file not found for brain instance");
  }

  await ctx.db.delete(fileId);
  await ctx.storage.delete(file.storageId);

  const now = Date.now();
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

/* ------------------------------------------------------------------ */
/* Brain-facing (MCP token routing)                                   */
/* ------------------------------------------------------------------ */

export const generateUploadUrlForBrain = mutationGeneric({
  args: { brainInstanceId: v.id("brainInstances") },
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
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
