/**
 * Pure drag-and-drop projection logic for the project Plan board
 * (project-board.tsx). @dnd-kit reports an "active" id (the dragged task)
 * and an "over" id (a task row or a phase container); these helpers turn
 * those into a projected arrangement of per-phase task-id lists and,
 * finally, into the arguments for the reorderTaskInPhaseForViewer mutation.
 * Kept free of React and @dnd-kit imports so the reorder logic stays
 * unit-testable.
 */

export type PhaseList = { phaseId: string; taskIds: string[] };

const PHASE_PREFIX = "phase:";

/**
 * Droppable id for a phase's task-list container. The container must be a
 * droppable of its own so tasks can be dropped into a phase with no rows
 * (there is no sortable row to hover in an empty phase).
 */
export function phaseDropId(phaseId: string): string {
  return `${PHASE_PREFIX}${phaseId}`;
}

/** Resolve which phase a sortable/droppable id belongs to. */
export function containerOf(
  lists: PhaseList[],
  id: string,
): string | undefined {
  if (id.startsWith(PHASE_PREFIX)) {
    const phaseId = id.slice(PHASE_PREFIX.length);
    return lists.some((list) => list.phaseId === phaseId)
      ? phaseId
      : undefined;
  }
  return lists.find((list) => list.taskIds.includes(id))?.phaseId;
}

function cloneLists(lists: PhaseList[]): PhaseList[] {
  return lists.map((list) => ({ ...list, taskIds: [...list.taskIds] }));
}

/**
 * Live projection while dragging: when the pointer crosses into another
 * phase, move the active task into that phase — before the hovered row, or
 * at the end when hovering the phase container itself. Returns null when
 * nothing changes so callers can skip a state update (and re-render).
 */
export function projectDragOver(
  lists: PhaseList[],
  activeId: string,
  overId: string,
): PhaseList[] | null {
  const from = containerOf(lists, activeId);
  const to = containerOf(lists, overId);
  if (!from || !to || from === to) return null;
  const next = cloneLists(lists);
  const fromList = next.find((list) => list.phaseId === from)!;
  fromList.taskIds = fromList.taskIds.filter((id) => id !== activeId);
  const toList = next.find((list) => list.phaseId === to)!;
  const overIndex = toList.taskIds.indexOf(overId);
  const insertAt = overIndex === -1 ? toList.taskIds.length : overIndex;
  toList.taskIds.splice(insertAt, 0, activeId);
  return next;
}

/**
 * Final arrangement on drop: a same-phase drag moves the task to the
 * hovered row's slot; a cross-phase drop reuses the drag-over projection
 * (normally a no-op, because onDragOver already moved the task while the
 * pointer traveled).
 */
export function projectDragEnd(
  lists: PhaseList[],
  activeId: string,
  overId: string,
): PhaseList[] {
  const from = containerOf(lists, activeId);
  const to = containerOf(lists, overId);
  if (!from || !to) return lists;
  if (from !== to) return projectDragOver(lists, activeId, overId) ?? lists;
  const next = cloneLists(lists);
  const list = next.find((entry) => entry.phaseId === from)!;
  const fromIndex = list.taskIds.indexOf(activeId);
  const toIndex = overId.startsWith(PHASE_PREFIX)
    ? list.taskIds.length - 1
    : list.taskIds.indexOf(overId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex)
    return lists;
  list.taskIds.splice(fromIndex, 1);
  list.taskIds.splice(toIndex, 0, activeId);
  return next;
}

/**
 * Translate a projected arrangement into the reorder mutation's arguments:
 * the phase the task landed in and the task it now sits before (undefined
 * means "end of phase", matching reorderTaskInPhaseForViewer's optional
 * beforeTaskId).
 */
export function dropPlacement(
  lists: PhaseList[],
  taskId: string,
): { phaseId: string; beforeTaskId?: string } | null {
  for (const list of lists) {
    const index = list.taskIds.indexOf(taskId);
    if (index === -1) continue;
    const beforeTaskId = list.taskIds[index + 1];
    return { phaseId: list.phaseId, ...(beforeTaskId ? { beforeTaskId } : {}) };
  }
  return null;
}

/**
 * True when two arrangements are identical — used to skip the reorder
 * mutation entirely when a drag ends where it started.
 */
export function listsEqual(a: PhaseList[], b: PhaseList[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((list, index) => {
    const other = b[index];
    if (!other) return false;
    return (
      list.phaseId === other.phaseId &&
      list.taskIds.length === other.taskIds.length &&
      list.taskIds.every((id, i) => id === other.taskIds[i])
    );
  });
}
