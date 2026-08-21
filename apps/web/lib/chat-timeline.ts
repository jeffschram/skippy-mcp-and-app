type AnyRecord = Record<string, any>;

export type ChatTimelineItem =
  | { kind: "message"; key: string; timestamp: number; tieBreak: number; message: AnyRecord }
  | { kind: "task"; key: string; timestamp: number; tieBreak: number; moment: AnyRecord }
  | { kind: "approval"; key: string; timestamp: number; tieBreak: number; moment: AnyRecord };

/**
 * Interleave chat messages, task moments, and run-approval notices into one
 * chronological feed.
 *
 * Assistant placeholders are inserted at send time and filled when the turn
 * finishes, so a finished reply sorts by its completedAt: task moments
 * produced mid-turn (e.g. "Task completed") land before the reply that
 * announces them instead of dangling below it as the "most recent" item.
 * Pending/streaming replies keep their send-time position.
 *
 * Approval notices sort by request time and stay in the timeline after the
 * decision — the settled notice is the record of what was approved or
 * declined.
 */
export function buildChatTimeline(
  messages: AnyRecord[],
  taskMoments: AnyRecord[] | undefined,
  approvalMoments?: AnyRecord[] | undefined,
): ChatTimelineItem[] {
  return [
    ...messages.map((message) => ({
      kind: "message" as const,
      key: `message:${message._id}`,
      timestamp: Number(message.completedAt ?? message.createdAt ?? 0),
      tieBreak: 1,
      message,
    })),
    ...(taskMoments ?? []).map((moment) => ({
      kind: "task" as const,
      key: moment.key as string,
      timestamp: Number(moment.timestamp ?? 0),
      tieBreak: 0,
      moment,
    })),
    ...(approvalMoments ?? []).map((moment) => ({
      kind: "approval" as const,
      key: moment.key as string,
      timestamp: Number(moment.timestamp ?? 0),
      tieBreak: 0,
      moment,
    })),
  ].sort(
    (a, b) =>
      a.timestamp - b.timestamp ||
      a.tieBreak - b.tieBreak ||
      a.key.localeCompare(b.key),
  );
}
