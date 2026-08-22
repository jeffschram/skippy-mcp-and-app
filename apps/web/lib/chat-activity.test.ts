import { describe, expect, it } from "vitest";
import { summarizeChatActivity } from "./chat-activity";

describe("summarizeChatActivity", () => {
  it("returns an idle summary for no events", () => {
    const activity = summarizeChatActivity([]);
    expect(activity.narration).toBeUndefined();
    expect(activity.lines).toEqual([]);
    expect(activity.plan).toBeUndefined();
  });

  it("keeps only the latest narration and a bounded tail of action lines", () => {
    const activity = summarizeChatActivity(
      [
        { type: "assistant_message", payload: { text: "Let me look at the config." } },
        { type: "command", payload: { command: "git status" } },
        { type: "command", payload: { command: "ls apps" } },
        { type: "command", payload: { command: "cat package.json" } },
        { type: "command", payload: { command: "pnpm test" } },
        { type: "assistant_message", payload: { text: "Tests pass — writing the fix now." } },
        { type: "file_change", payload: { filePath: "apps/web/lib/chat-activity.ts", tool: "Write" } },
      ],
      3,
    );
    expect(activity.narration).toBe("Tests pass — writing the fix now.");
    expect(activity.lines).toEqual([
      { kind: "command", text: "cat package.json" },
      { kind: "command", text: "pnpm test" },
      { kind: "file_change", text: "Writing chat-activity.ts" },
    ]);
  });

  it("summarizes the latest plan_update with progress and current item", () => {
    const activity = summarizeChatActivity([
      {
        type: "plan_update",
        payload: {
          todos: [
            { content: "Survey code", status: "completed", activeForm: "Surveying code" },
            { content: "Write fix", status: "in_progress", activeForm: "Writing fix" },
            { content: "Run tests", status: "pending", activeForm: "Running tests" },
          ],
        },
      },
    ]);
    expect(activity.plan).toEqual({ done: 1, total: 3, current: "Writing fix" });
  });

  it("truncates multi-line commands to their first line", () => {
    const activity = summarizeChatActivity([
      { type: "command", payload: { command: "git add .\ngit commit -m secret" } },
    ]);
    expect(activity.lines).toEqual([{ kind: "command", text: "git add ." }]);
  });

  it("surfaces error events distinctly", () => {
    const activity = summarizeChatActivity([
      { type: "error", payload: { message: "exited with code 1" } },
    ]);
    expect(activity.lines).toEqual([{ kind: "error", text: "exited with code 1" }]);
  });

  it("ignores unknown event types and empty payloads", () => {
    const activity = summarizeChatActivity([
      { type: "usage", payload: { tokens: 5 } },
      { type: "command", payload: {} },
      { type: "assistant_message", payload: { text: "   " } },
    ]);
    expect(activity.narration).toBeUndefined();
    expect(activity.lines).toEqual([]);
  });
});
