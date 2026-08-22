import { describe, expect, it } from "vitest";
import { buildTaskMoments } from "./task-moments";

const base = {
  _id: "t1",
  title: "Ship the widget",
  createdAt: 100,
  updatedAt: 100,
};

describe("buildTaskMoments", () => {
  it("emits a created moment for every task", () => {
    const moments = buildTaskMoments([{ ...base, executionState: "briefed" }]);
    expect(moments).toEqual([
      {
        key: "task:t1:created",
        timestamp: 100,
        state: "created",
        task: expect.objectContaining({ _id: "t1" }),
      },
    ]);
  });

  it("emits a started moment preferring agentRequestedAt over startedAt", () => {
    const moments = buildTaskMoments([
      {
        ...base,
        executionState: "in_progress",
        agentRequestedAt: 200,
        startedAt: 250,
        updatedAt: 300,
      },
    ]);
    const started = moments.find((m) => m.state === "in_progress");
    expect(started).toMatchObject({ key: "task:t1:started", timestamp: 200 });
  });

  it("falls back to updatedAt for started only while actively in_progress", () => {
    const inProgress = buildTaskMoments([
      { ...base, executionState: "in_progress", updatedAt: 300 },
    ]);
    expect(inProgress.find((m) => m.state === "in_progress")).toMatchObject({
      timestamp: 300,
    });

    // An in_review task with no start markers gets no started moment: its
    // updatedAt is the review hand-off, not the start.
    const inReview = buildTaskMoments([
      { ...base, executionState: "in_review", updatedAt: 300 },
    ]);
    expect(inReview.find((m) => m.state === "in_progress")).toBeUndefined();
  });

  it("emits an in_review moment stamped by resultRecordedAt", () => {
    const moments = buildTaskMoments([
      {
        ...base,
        executionState: "in_review",
        startedAt: 200,
        resultRecordedAt: 400,
        updatedAt: 450,
      },
    ]);
    expect(moments.map((m) => m.state)).toEqual([
      "created",
      "in_progress",
      "in_review",
    ]);
    expect(moments.find((m) => m.state === "in_review")).toMatchObject({
      key: "task:t1:in_review",
      timestamp: 400,
    });
  });

  it("carries PR fields on the in_review moment's task for the chat notice", () => {
    const moments = buildTaskMoments([
      {
        ...base,
        executionState: "in_review",
        resultRecordedAt: 400,
        prUrl: "https://github.com/x/y/pull/9",
        prNumber: 9,
        prStatus: "open",
      },
    ]);
    const inReview = moments.find((m) => m.state === "in_review");
    expect(inReview?.timestamp).toBe(400);
    expect(inReview?.task).toMatchObject({
      prUrl: "https://github.com/x/y/pull/9",
      prNumber: 9,
      prStatus: "open",
    });
  });

  it("replaces the in_review moment with completed once the task is done", () => {
    const moments = buildTaskMoments([
      {
        ...base,
        executionState: "done",
        startedAt: 200,
        resultRecordedAt: 400,
        completedAt: 500,
        updatedAt: 500,
      },
    ]);
    expect(moments.map((m) => m.state)).toEqual([
      "created",
      "in_progress",
      "completed",
    ]);
    expect(moments.find((m) => m.state === "completed")).toMatchObject({
      key: "task:t1:completed",
      timestamp: 500,
    });
  });

  it("marks life-layer tasks done via status", () => {
    const moments = buildTaskMoments([
      { ...base, status: "done", completedAt: 600 },
    ]);
    expect(moments.map((m) => m.state)).toEqual(["created", "completed"]);
  });
});
