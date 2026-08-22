/**
 * Shared helper for DEFAULT task placement in a Plan phase.
 *
 * Newly created tasks (MCP `create_task`, viewer proposals, phase backfills)
 * append to the END of their target phase: compute from the phase's current
 * max orderIndex so sequential creates get strictly increasing values after
 * existing tasks instead of colliding at 0. Explicit-placement paths
 * (set_task_phase, drag-reorder mutations) keep their own between-neighbors
 * math and do not use this.
 */
import { appendOrderIndex } from "@skippy/shared";

export async function phaseAppendOrderIndex(
  db: any,
  brainInstanceId: any,
  phaseId: any,
  excludeTaskId?: string,
): Promise<number> {
  const siblings = await db
    .query("tasks")
    .withIndex("by_brain_phase", (q: any) =>
      q.eq("brainInstanceId", brainInstanceId).eq("phaseId", phaseId),
    )
    .collect();
  return appendOrderIndex(
    siblings
      .filter((task: any) => task.processingState === "accepted" && task._id !== excludeTaskId)
      .map((task: any) => task.orderIndex as number | undefined),
  );
}
