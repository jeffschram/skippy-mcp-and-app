/** Check references before internal MCP dispatch. Metadata/source-system IDs are not identity. */
const referenceKeys = new Set([
  "projectId", "taskId", "phaseId", "personId", "companyId", "goalId", "memoryId", "knowledgeId", "knowledgeObjectId",
  "entityId", "fileId", "sourceRefId", "pendingActionId", "interviewId", "templateId", "recurrenceId", "captureId",
  "accountId", "financialAccountId", "tokenId", "runId", "hostId", "userId", "completedByUserId", "createdByUserId",
  "externalReminderSourceRefId", "fromId", "toId", "triageItemId", "decisionId", "linkId", "pushSubscriptionId", "sourceRunId", "completedBy",
]);
const arrayReferenceKeys = new Set(["sourceRefIds", "artifactFileIds", "fileIds", "taskIds", "projectIds", "activityIds"]);
export async function assertMcpReferences(db: any, args: Record<string, unknown>, brainId: string) {
  const brain = await db.get(brainId);
  if (!brain) throw new Error("MCP account not found");
  async function checkId(value: unknown) {
    if (typeof value !== "string") throw new Error("Invalid reference");
    let row;
    try { row = await db.get(value); } catch { throw new Error("Reference not found"); }
    if (!row || (row.brainInstanceId !== brainId && row._id !== brain.ownerUserId)) throw new Error("Reference not found");
  }
  async function visit(value: unknown, depth: number) {
    if (depth > 30) throw new Error("MCP arguments too deeply nested");
    if (Array.isArray(value)) { for (const item of value) await visit(item, depth + 1); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined || item === null) continue;
      if (key === "brainInstanceId" && item !== brainId) throw new Error("MCP account mismatch");
      if (referenceKeys.has(key)) await checkId(item);
      else if (arrayReferenceKeys.has(key)) {
        if (!Array.isArray(item)) throw new Error("Invalid references");
        for (const id of item) await checkId(id);
      } else if (key === "storageId") {
        // Existing blobs cannot be attached to or deleted from another account.
        for (const table of ["projectFiles", "quickCaptures"]) {
          const files = await db.query(table).withIndex("by_storage", (q: any) => q.eq("storageId", item)).take(100);
          if (files.length === 100 || files.some((file: any) => file.brainInstanceId !== brainId)) throw new Error("Reference not found");
        }
      } else if (key !== "metadata") await visit(item, depth + 1);
    }
  }
  await visit(args, 0);
}
