/** Mirror a newly-created legacy memory into the unified knowledge table. */
export async function insertKnowledgeForMemory(db: any, memory: any) {
  await db.insert("knowledge", {
    brainInstanceId: memory.brainInstanceId,
    kind: "memory",
    title: memory.title,
    body: memory.body,
    summary: memory.summary,
    memoryType: memory.memoryType,
    processingState:
      memory.status === "accepted"
        ? "accepted"
        : memory.status === "rejected"
          ? "rejected"
          : memory.status === "archived"
            ? "archived"
            : "suggested",
    confidence: memory.confidence,
    sourceRefIds: memory.sourceRefIds,
    relatedEntityRefs: memory.relatedEntityRefs,
    rubricDecision: memory.rubricDecision,
    captureReason: memory.captureReason,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  });
}
