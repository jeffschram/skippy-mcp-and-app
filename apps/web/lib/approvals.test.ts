import { describe, expect, it } from "vitest";
import {
  SETTLED_APPROVAL_VISIBLE_MS,
  approvalDetailText,
  approvalKindLabel,
  approvalMoments,
  approvalStatusChip,
  approvalSummaryLine,
  diffStatFileCount,
  firstLineTruncated,
  pendingApprovalCount,
  pendingApprovalsByTask,
  visibleTaskApprovals,
} from "./approvals";

const T0 = 1_787_000_000_000;

describe("approvalKindLabel", () => {
  it("maps known kinds to human labels", () => {
    expect(approvalKindLabel("command")).toBe("Command");
    expect(approvalKindLabel("push")).toBe("Push");
    expect(approvalKindLabel("pr")).toBe("Pull request");
    expect(approvalKindLabel("file_change")).toBe("File change");
  });

  it("falls back to a readable form for unknown kinds", () => {
    expect(approvalKindLabel("weird_kind")).toBe("Weird kind");
    expect(approvalKindLabel(undefined)).toBe("Approval");
  });
});

describe("firstLineTruncated", () => {
  it("keeps a short single line intact", () => {
    expect(firstLineTruncated("pnpm test")).toBe("pnpm test");
  });

  it("takes only the first line of multi-line text", () => {
    expect(firstLineTruncated("line one\nline two")).toBe("line one");
  });

  it("truncates long lines with an ellipsis", () => {
    const long = "x".repeat(200);
    const out = firstLineTruncated(long, 80);
    expect(out.length).toBe(80);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("diffStatFileCount", () => {
  it("reads the git --stat summary line", () => {
    expect(
      diffStatFileCount(
        " a.ts | 10 +-\n b.ts | 4 +\n 2 files changed, 12 insertions(+), 2 deletions(-)",
      ),
    ).toBe(2);
  });

  it("handles the singular form", () => {
    expect(diffStatFileCount("1 file changed, 3 insertions(+)")).toBe(1);
  });

  it("returns null for missing or unparseable input", () => {
    expect(diffStatFileCount(undefined)).toBeNull();
    expect(diffStatFileCount("no summary here")).toBeNull();
  });
});

describe("approvalSummaryLine", () => {
  it("renders a truncated command for command gates", () => {
    const line = approvalSummaryLine({
      kind: "command",
      title: "Run command: pnpm install",
      details: { command: "pnpm install\n# second line ignored" },
    });
    expect(line).toBe("$ pnpm install");
  });

  it("renders push: N files when the diffStat is parseable", () => {
    const line = approvalSummaryLine({
      kind: "push",
      title: "Push agent/foo and open a PR",
      details: {
        branch: "agent/foo",
        diffStat: "3 files changed, 12 insertions(+)",
      },
    });
    expect(line).toBe("push: 3 files");
  });

  it("uses the singular file wording", () => {
    const line = approvalSummaryLine({
      kind: "push",
      details: { diffStat: "1 file changed, 2 insertions(+)" },
    });
    expect(line).toBe("push: 1 file");
  });

  it("falls back to the branch when there is no diffStat", () => {
    const line = approvalSummaryLine({
      kind: "push",
      title: "Push",
      details: { branch: "agent/foo" },
    });
    expect(line).toBe("push: agent/foo");
  });

  it("falls back to the title for kinds without structured details", () => {
    const line = approvalSummaryLine({
      kind: "user_input",
      title: "Allow tool WebFetch?",
    });
    expect(line).toBe("Allow tool WebFetch?");
  });
});

describe("approvalDetailText", () => {
  it("returns the full command for command gates", () => {
    expect(
      approvalDetailText({ kind: "command", details: { command: "pnpm test" } }),
    ).toBe("pnpm test");
  });

  it("returns the diffStat for push gates", () => {
    expect(
      approvalDetailText({
        kind: "push",
        details: { diffStat: "1 file changed", branch: "agent/foo" },
      }),
    ).toBe("1 file changed");
  });

  it("returns null when there is nothing to show", () => {
    expect(approvalDetailText({ kind: "command", details: {} })).toBeNull();
    expect(approvalDetailText({ kind: "secret" })).toBeNull();
  });
});

describe("approvalStatusChip", () => {
  it("labels settled statuses", () => {
    expect(approvalStatusChip("accepted")).toEqual({
      label: "Approved",
      tone: "green",
    });
    expect(approvalStatusChip("declined")).toEqual({
      label: "Declined",
      tone: "red",
    });
    expect(approvalStatusChip("cancelled")).toEqual({
      label: "Cancelled",
      tone: "neutral",
    });
    expect(approvalStatusChip("expired")).toEqual({
      label: "Expired",
      tone: "neutral",
    });
  });

  it("returns null while pending", () => {
    expect(approvalStatusChip("pending")).toBeNull();
  });
});

describe("pendingApprovalsByTask / pendingApprovalCount", () => {
  const approvals = [
    { _id: "a1", taskId: "t1", status: "pending" },
    { _id: "a2", taskId: "t1", status: "pending" },
    { _id: "a3", taskId: "t2", status: "accepted" },
    { _id: "a4", taskId: "t3", status: "pending" },
    { _id: "a5", status: "pending" }, // no task — never counted per-task
  ];

  it("counts only pending approvals per task", () => {
    expect(pendingApprovalsByTask(approvals)).toEqual({ t1: 2, t3: 1 });
  });

  it("counts all pending approvals for the board indicator", () => {
    expect(pendingApprovalCount(approvals)).toBe(4);
  });
});

describe("visibleTaskApprovals", () => {
  it("shows pending approvals for the task, oldest first", () => {
    const visible = visibleTaskApprovals(
      [
        { _id: "a2", taskId: "t1", status: "pending", createdAt: T0 + 10 },
        { _id: "a1", taskId: "t1", status: "pending", createdAt: T0 },
        { _id: "b1", taskId: "t2", status: "pending", createdAt: T0 },
      ],
      "t1",
      T0 + 60_000,
    );
    expect(visible.map((a) => a._id)).toEqual(["a1", "a2"]);
  });

  it("keeps a freshly settled approval so the card resolves in place", () => {
    const visible = visibleTaskApprovals(
      [
        {
          _id: "a1",
          taskId: "t1",
          status: "accepted",
          createdAt: T0,
          decidedAt: T0 + 1_000,
        },
      ],
      "t1",
      T0 + 2_000,
    );
    expect(visible.map((a) => a._id)).toEqual(["a1"]);
  });

  it("drops settled approvals after the linger window", () => {
    const visible = visibleTaskApprovals(
      [
        {
          _id: "a1",
          taskId: "t1",
          status: "declined",
          createdAt: T0,
          decidedAt: T0 + 1_000,
        },
      ],
      "t1",
      T0 + 1_000 + SETTLED_APPROVAL_VISIBLE_MS + 1,
    );
    expect(visible).toEqual([]);
  });

  it("orders pending before settled", () => {
    const visible = visibleTaskApprovals(
      [
        {
          _id: "done",
          taskId: "t1",
          status: "accepted",
          createdAt: T0,
          decidedAt: T0 + 500,
        },
        { _id: "open", taskId: "t1", status: "pending", createdAt: T0 + 100 },
      ],
      "t1",
      T0 + 1_000,
    );
    expect(visible.map((a) => a._id)).toEqual(["open", "done"]);
  });
});

describe("approvalMoments", () => {
  it("produces stable timeline moments keyed by approval id", () => {
    const moments = approvalMoments([
      { _id: "a1", createdAt: T0, status: "pending" },
      { _id: "a2", createdAt: T0 + 5, status: "accepted" },
    ]);
    expect(moments).toEqual([
      {
        key: "approval:a1",
        timestamp: T0,
        approval: { _id: "a1", createdAt: T0, status: "pending" },
      },
      {
        key: "approval:a2",
        timestamp: T0 + 5,
        approval: { _id: "a2", createdAt: T0 + 5, status: "accepted" },
      },
    ]);
  });
});
