/**
 * Shared helpers for the supervised task-execution lifecycle.
 * A task `A depends_on B` is modelled as a relationship { from: A, to: B, type: "depends_on" }.
 * `A` is ready once every `B` it depends on is `done`.
 */

export async function dependencyTaskIds(db: any, brainInstanceId: any, taskId: string): Promise<string[]> {
  const rels = await db
    .query("relationships")
    .withIndex("by_brain_type", (q: any) => q.eq("brainInstanceId", brainInstanceId))
    .filter((q: any) => q.eq(q.field("type"), "depends_on"))
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
    .withIndex("by_brain_type", (q: any) => q.eq("brainInstanceId", brainInstanceId))
    .filter((q: any) => q.eq(q.field("type"), "depends_on"))
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
