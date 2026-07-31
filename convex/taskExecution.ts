/**
 * Shared helpers for the supervised task-execution lifecycle.
 * A task `A depends_on B` is modelled as a relationship { from: A, to: B, type: "depends_on" }.
 * `A` is ready once every `B` it depends on is `done`.
 */

/**
 * All `depends_on` edges for a brain, in one indexed read.
 *
 * `by_brain_type` is (brainInstanceId, type), so `type` belongs in the index
 * RANGE, not in a `.filter()`. A trailing filter still reads every row the
 * range matches and discards them in memory — the read budget is spent either
 * way. Narrowing the range here is what makes the read proportional to the
 * number of dependency edges rather than to the whole relationship table.
 */
async function dependsOnEdges(db: any, brainInstanceId: any) {
  return db
    .query("relationships")
    .withIndex("by_brain_type", (q: any) =>
      q.eq("brainInstanceId", brainInstanceId).eq("type", "depends_on"),
    )
    .collect();
}

/**
 * Dependency ids for every task in one pass: taskId -> ids it depends on.
 *
 * Callers rendering more than one task MUST use this rather than looping over
 * dependencyTaskIds. Per-task querying is O(tasks x relationships): on a
 * 123-task project against 259 relationships that is ~31.8k document reads,
 * which alone is enough to breach Convex's 32k per-execution limit and fail
 * the whole query.
 */
export async function dependencyTaskIdsByTask(
  db: any,
  brainInstanceId: any,
): Promise<Map<string, string[]>> {
  const byTask = new Map<string, string[]>();
  for (const rel of await dependsOnEdges(db, brainInstanceId)) {
    if (rel.from?.entityType !== "task" || rel.to?.entityType !== "task") continue;
    const from = rel.from.entityId as string;
    byTask.set(from, [...(byTask.get(from) ?? []), rel.to.entityId as string]);
  }
  return byTask;
}

/** Single-task lookup. For several tasks use dependencyTaskIdsByTask instead. */
export async function dependencyTaskIds(db: any, brainInstanceId: any, taskId: string): Promise<string[]> {
  const rels = await db
    .query("relationships")
    .withIndex("by_brain_type", (q: any) =>
      q.eq("brainInstanceId", brainInstanceId).eq("type", "depends_on"),
    )
    .filter((q: any) => q.eq(q.field("from.entityType"), "task"))
    .filter((q: any) => q.eq(q.field("from.entityId"), taskId))
    .collect();
  return rels
    .filter((rel: any) => rel.to.entityType === "task")
    .map((rel: any) => rel.to.entityId as string);
}

export async function dependenciesMet(db: any, brainInstanceId: any, taskId: string): Promise<boolean> {
  const depIds = await dependencyTaskIds(db, brainInstanceId, taskId);
  for (const depId of depIds) {
    const dep = await db.get(depId);
    if (!dep || dep.status !== "done") return false;
  }
  return true;
}

/**
 * When a task completes, promote any `briefed`/`blocked` tasks that depend on it to `ready`
 * once all of their dependencies are satisfied.
 */
export async function advanceDependentsAfterDone(
  db: any,
  brainInstanceId: any,
  completedTaskId: string,
  now: number,
): Promise<string[]> {
  const dependents = await db
    .query("relationships")
    .withIndex("by_brain_type", (q: any) =>
      q.eq("brainInstanceId", brainInstanceId).eq("type", "depends_on"),
    )
    .filter((q: any) => q.eq(q.field("to.entityType"), "task"))
    .filter((q: any) => q.eq(q.field("to.entityId"), completedTaskId))
    .collect();

  const promoted: string[] = [];
  const seen = new Set<string>();
  for (const rel of dependents) {
    const dependentId = rel.from.entityId as string;
    if (rel.from.entityType !== "task" || seen.has(dependentId)) continue;
    seen.add(dependentId);

    const dependent = await db.get(dependentId);
    if (!dependent) continue;
    if (dependent.status === "done" || dependent.status === "cancelled") continue;
    if (dependent.executionState !== "briefed" && dependent.executionState !== "blocked") continue;

    if (await dependenciesMet(db, brainInstanceId, dependentId)) {
      await db.patch(dependentId, { executionState: "ready", updatedAt: now });
      promoted.push(dependentId);
    }
  }
  return promoted;
}
