import { describe, expect, it } from "vitest";
import { buildChatTimeline } from "./chat-timeline";

const T0 = 1_787_000_000_000;

function keys(items: ReturnType<typeof buildChatTimeline>) {
  return items.map((item) => item.key);
}

describe("buildChatTimeline", () => {
  it("interleaves messages and task moments chronologically", () => {
    const items = buildChatTimeline(
      [
        { _id: "m1", role: "user", createdAt: T0 },
        { _id: "m2", role: "assistant", createdAt: T0 + 1, completedAt: T0 + 5_000 },
      ],
      [{ key: "task:t1:started", timestamp: T0 + 2_000 }],
    );
    expect(keys(items)).toEqual(["message:m1", "task:t1:started", "message:m2"]);
  });

  it("orders a mid-turn task completion before the reply that announces it", () => {
    // The regression: the assistant placeholder is inserted at send time
    // (createdAt = user message + 1ms) and filled ~30s later, after the agent
    // marked a task done mid-turn. Sorting by createdAt left the "Task
    // completed" card dangling below the reply as the most recent item.
    const items = buildChatTimeline(
      [
        { _id: "m1", role: "user", createdAt: T0 },
        {
          _id: "m2",
          role: "assistant",
          status: "complete",
          createdAt: T0 + 1,
          completedAt: T0 + 30_000,
        },
      ],
      [{ key: "task:t1:completed", timestamp: T0 + 25_000, state: "completed" }],
    );
    expect(keys(items)).toEqual(["message:m1", "task:t1:completed", "message:m2"]);
  });

  it("keeps a pending reply at its send-time position while streaming", () => {
    const items = buildChatTimeline(
      [
        { _id: "m1", role: "user", createdAt: T0 },
        { _id: "m2", role: "assistant", status: "pending", createdAt: T0 + 1 },
      ],
      [{ key: "task:t1:completed", timestamp: T0 + 25_000 }],
    );
    // While the turn is still running the moment renders below the thinking
    // bubble; it settles above the reply once completedAt lands.
    expect(keys(items)).toEqual(["message:m1", "message:m2", "task:t1:completed"]);
  });

  it("falls back to createdAt for historical messages without completedAt", () => {
    const items = buildChatTimeline(
      [
        { _id: "m1", role: "user", createdAt: T0 },
        { _id: "m2", role: "assistant", status: "complete", createdAt: T0 + 1 },
        { _id: "m3", role: "user", createdAt: T0 + 60_000 },
      ],
      [{ key: "task:t1:completed", timestamp: T0 + 25_000 }],
    );
    expect(keys(items)).toEqual([
      "message:m1",
      "message:m2",
      "task:t1:completed",
      "message:m3",
    ]);
  });

  it("puts task moments before messages on exact timestamp ties", () => {
    const items = buildChatTimeline(
      [{ _id: "m1", role: "assistant", createdAt: T0, completedAt: T0 + 1_000 }],
      [{ key: "task:t1:completed", timestamp: T0 + 1_000 }],
    );
    expect(keys(items)).toEqual(["task:t1:completed", "message:m1"]);
  });
});
