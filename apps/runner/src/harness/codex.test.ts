import { describe, expect, it } from "vitest";
import { buildCodexArgs } from "./codex.js";

describe("buildCodexArgs", () => {
  it("builds fresh-session arguments", () => {
    expect(buildCodexArgs({ worktreePath: "/tmp/skippy-task" })).toEqual([
      "exec",
      "--json",
      "--cd",
      "/tmp/skippy-task",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--sandbox",
      "workspace-write",
      "-",
    ]);
  });

  it("places exec-level arguments before the resume subcommand", () => {
    expect(
      buildCodexArgs({
        worktreePath: "/tmp/skippy-task",
        threadId: "019cafe-resume-session",
      }),
    ).toEqual([
      "exec",
      "--json",
      "--cd",
      "/tmp/skippy-task",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--sandbox",
      "workspace-write",
      "resume",
      "019cafe-resume-session",
      "-",
    ]);
  });

  it("keeps permission bypass before resume", () => {
    expect(
      buildCodexArgs({
        worktreePath: "/tmp/skippy-task",
        threadId: "019cafe-resume-session",
        bypassPermissions: true,
      }),
    ).toEqual([
      "exec",
      "--json",
      "--cd",
      "/tmp/skippy-task",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--dangerously-bypass-approvals-and-sandbox",
      "resume",
      "019cafe-resume-session",
      "-",
    ]);
  });
});
