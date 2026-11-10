/* ------------------------------------------------------------------ */
/* Which project tasks Home is allowed to hide                         */
/*                                                                     */
/* Home and the agenda used to hide EVERY task linked to a project.    */
/* The intent was narrow: a code project mid-flight can spawn dozens   */
/* of agent-owned tasks, and that roadmap churn drowned the day.       */
/*                                                                     */
/* But "project" is not a synonym for "code project" (schema.ts:370:   */
/* kind is "code" | "general"). Non-code personal projects — a move, a */
/* renovation, planning a trip — hold exactly the obligations Home     */
/* exists to surface, and blanket-hiding them meant real commitments   */
/* silently never appeared anywhere the owner looks. Reported          */
/* 2026-11-09.                                                        */
/*                                                                     */
/* So the exclusion is scoped to code projects only. Absent `kind`     */
/* means "general" and therefore VISIBLE, matching the fallback used   */
/* in agentWorkbench.ts:499 — being wrong in the visible direction is  */
/* recoverable, being wrong in the hidden direction is not.           */
/* ------------------------------------------------------------------ */

/** True when a project follows the code workflow (repo + branch/PR agent runs). */
export function isCodeProject(project: { kind?: string } | null | undefined): boolean {
  return (project?.kind ?? "general") === "code";
}

/**
 * Ids of tasks belonging to a *code* project, so day-focused surfaces can hide
 * roadmap churn without hiding the owner's personal-project obligations.
 *
 * Project linkage is a `belongs_to` relationship row, not a column on `tasks`,
 * so this walks the relationship index and then resolves each distinct project
 * once (a task set can reference the same project many times).
 */
export async function codeProjectTaskIds(db: any, brainInstanceId: any): Promise<Set<string>> {
  const relationships = await db
    .query("relationships")
    .withIndex("by_brain_type", (q: any) =>
      q.eq("brainInstanceId", brainInstanceId).eq("type", "belongs_to"),
    )
    .collect();

  // Resolve each project at most once: many tasks map to the same project, and
  // this runs on every Home render.
  const isCodeByProjectId = new Map<string, boolean>();
  const ids = new Set<string>();

  for (const relationship of relationships) {
    if (relationship.from?.entityType !== "task") continue;
    if (relationship.to?.entityType !== "project") continue;

    const projectId = relationship.to.entityId as string;
    if (!isCodeByProjectId.has(projectId)) {
      const project = await db.get(projectId as any);
      // A dangling link (project deleted) must not hide the task: unknown
      // scope falls back to visible.
      isCodeByProjectId.set(projectId, project ? isCodeProject(project) : false);
    }

    if (isCodeByProjectId.get(projectId)) {
      ids.add(relationship.from.entityId as string);
    }
  }

  return ids;
}
