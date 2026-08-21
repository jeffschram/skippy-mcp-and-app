import { describe, expect, it } from "vitest";
import { prTitle } from "./runExecutor.js";

describe("prTitle", () => {
  it("titles the PR after the task, not the project", () => {
    expect(
      prTitle({ taskTitle: "Collapse completed phases", project: { title: "Skippy MCP and APP" } }, "agent/task-abc"),
    ).toBe("Agent: Collapse completed phases");
  });

  it("falls back to the project title for chat-scoped runs without a task", () => {
    expect(prTitle({ project: { title: "Skippy MCP and APP" } }, "agent/chat-abc")).toBe(
      "Agent: Skippy MCP and APP",
    );
  });

  it("falls back to the branch name when neither title exists", () => {
    expect(prTitle({ project: {} }, "agent/chat-abc")).toBe("Agent work on agent/chat-abc");
  });

  it("ignores whitespace-only task titles", () => {
    expect(prTitle({ taskTitle: "   ", project: { title: "Skippy MCP and APP" } }, "agent/task-abc")).toBe(
      "Agent: Skippy MCP and APP",
    );
  });
});
