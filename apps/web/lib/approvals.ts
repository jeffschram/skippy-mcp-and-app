/**
 * Pure helpers for the run-approval surface (task panel card, chat notice,
 * board indicator). Everything here operates on the plain records returned
 * by agentWorkbench.approvalsForProjectForViewer so it stays unit-testable
 * without Convex.
 */

type AnyRecord = Record<string, any>;

export type ApprovalStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled"
  | "expired";

const KIND_LABELS: Record<string, string> = {
  command: "Command",
  file_change: "File change",
  network: "Network",
  secret: "Secret",
  push: "Push",
  pr: "Pull request",
  deployment: "Deployment",
  user_input: "Input",
};

export function approvalKindLabel(kind: unknown): string {
  if (typeof kind !== "string" || !kind) return "Approval";
  return (
    KIND_LABELS[kind] ??
    kind.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}

/** First line of a possibly multi-line string, truncated with an ellipsis. */
export function firstLineTruncated(text: string, max = 80): string {
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > max ? `${line.slice(0, Math.max(0, max - 1))}…` : line;
}

/**
 * File count from a `git diff --stat` summary line
 * ("3 files changed, 40 insertions(+), 2 deletions(-)").
 */
export function diffStatFileCount(diffStat: unknown): number | null {
  if (typeof diffStat !== "string") return null;
  const match = diffStat.match(/(\d+)\s+files?\s+changed/);
  return match?.[1] ? Number(match[1]) : null;
}

/**
 * One-line summary for the compact chat notice: command text truncated,
 * "push: N files", a file path — never the full detail payload.
 */
export function approvalSummaryLine(approval: AnyRecord, max = 80): string {
  const details: AnyRecord = approval.details ?? {};
  switch (approval.kind) {
    case "command": {
      const command = typeof details.command === "string" ? details.command : "";
      if (command) return firstLineTruncated(`$ ${command}`, max);
      break;
    }
    case "push":
    case "pr": {
      const files = diffStatFileCount(details.diffStat);
      if (files !== null) {
        return `${approval.kind}: ${files} ${files === 1 ? "file" : "files"}`;
      }
      const branch =
        typeof details.branch === "string" && details.branch
          ? details.branch
          : typeof approval.branch === "string"
            ? approval.branch
            : "";
      if (branch) return firstLineTruncated(`${approval.kind}: ${branch}`, max);
      break;
    }
    case "file_change": {
      if (typeof details.filePath === "string" && details.filePath) {
        return firstLineTruncated(details.filePath, max);
      }
      break;
    }
    default:
      break;
  }
  if (typeof approval.explanation === "string" && approval.explanation) {
    return firstLineTruncated(approval.explanation, max);
  }
  return firstLineTruncated(String(approval.title ?? ""), max);
}

/**
 * The monospace detail block for the panel card: the command for command
 * gates, the diffStat for push/pr gates, the path or tool for the rest.
 * Push extras (branch, verification) render as their own labelled rows,
 * not here.
 */
export function approvalDetailText(approval: AnyRecord): string | null {
  const details: AnyRecord = approval.details ?? {};
  switch (approval.kind) {
    case "command":
      return typeof details.command === "string" && details.command
        ? details.command
        : null;
    case "push":
    case "pr":
      return typeof details.diffStat === "string" && details.diffStat
        ? details.diffStat
        : null;
    case "file_change":
      return typeof details.filePath === "string" && details.filePath
        ? details.filePath
        : null;
    case "network":
      return typeof details.input === "string" && details.input
        ? details.input
        : null;
    case "user_input":
      return typeof details.toolName === "string" && details.toolName
        ? details.toolName
        : null;
    default:
      return null;
  }
}

export function approvalStatusChip(
  status: unknown,
): { label: string; tone: "green" | "red" | "neutral" } | null {
  switch (status) {
    case "accepted":
      return { label: "Approved", tone: "green" };
    case "declined":
      return { label: "Declined", tone: "red" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    case "expired":
      return { label: "Expired", tone: "neutral" };
    default:
      return null;
  }
}

/** Pending approval counts per task, for the board indicator. */
export function pendingApprovalsByTask(
  approvals: AnyRecord[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const approval of approvals) {
    if (approval.status !== "pending") continue;
    const taskId = approval.taskId;
    if (typeof taskId !== "string" || !taskId) continue;
    counts[taskId] = (counts[taskId] ?? 0) + 1;
  }
  return counts;
}

export function pendingApprovalCount(approvals: AnyRecord[]): number {
  return approvals.filter((approval) => approval.status === "pending").length;
}

/**
 * All run approvals for one task, oldest first. The query intentionally
 * returns settled approvals too (history may want them later); live surfaces
 * filter to pending at render via useSettlingApprovals — settled cards
 * disappear (owner decision superseding PR #117's lingering chips), with the
 * durable record living in run/task activity history.
 */
export function approvalsForTask(
  approvals: AnyRecord[],
  taskId: string,
): AnyRecord[] {
  return approvals
    .filter((approval) => approval.taskId === taskId)
    .sort(
      (a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0),
    );
}

/**
 * Chat timeline moments for run approvals: one per approval, pinned at its
 * request time. Callers filter settled approvals out first (see
 * useSettlingApprovals) — a decided approval leaves the transcript; its
 * durable record is the run/task activity history, not the conversation.
 */
export function approvalMoments(approvals: AnyRecord[]): AnyRecord[] {
  return approvals.map((approval) => ({
    key: `approval:${approval._id}`,
    timestamp: Number(approval.createdAt ?? 0),
    approval,
  }));
}
