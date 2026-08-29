import { describe, expect, it } from "vitest";
import { buildCodexArgs, buildCodexSpawnEnv } from "./codex.js";

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

  it("passes a model override as an exec-level flag", () => {
    expect(buildCodexArgs({ worktreePath: "/tmp/skippy-task", model: "gpt-5-codex" })).toEqual([
      "exec",
      "--json",
      "--cd",
      "/tmp/skippy-task",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--model",
      "gpt-5-codex",
      "--sandbox",
      "workspace-write",
      "-",
    ]);
  });

  it("omits the model flag when no model is configured (harness default)", () => {
    expect(buildCodexArgs({ worktreePath: "/tmp/skippy-task" })).not.toContain("--model");
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

  it("injects Skippy MCP config overrides before the resume subcommand", () => {
    expect(
      buildCodexArgs({
        worktreePath: "/tmp/skippy-task",
        threadId: "019cafe-resume-session",
        skippyMcpUrl: "https://skippy.example.com/api/mcp",
      }),
    ).toEqual([
      "exec",
      "--json",
      "--cd",
      "/tmp/skippy-task",
      "--skip-git-repo-check",
      "--color",
      "never",
      "-c",
      'mcp_servers.skippy.url="https://skippy.example.com/api/mcp"',
      "-c",
      'mcp_servers.skippy.bearer_token_env_var="SKIPPY_MCP_TOKEN"',
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

describe("buildCodexSpawnEnv", () => {
  it("puts a per-turn MCP token in the spawned environment, never argv", () => {
    const token = "task-role-secret";
    const env = buildCodexSpawnEnv(token, { SKIPPY_MCP_TOKEN: "full-owner-secret" });
    const args = buildCodexArgs({ worktreePath: "/tmp/skippy-task", skippyMcpUrl: "https://mcp.example" });

    expect(env.SKIPPY_MCP_TOKEN).toBe(token);
    expect(args.join(" ")).not.toContain(token);
  });

  it("falls back to the inherited full-access token when no override is supplied", () => {
    const baseEnv = { SKIPPY_MCP_TOKEN: "full-owner-secret" };
    expect(buildCodexSpawnEnv(undefined, baseEnv)).toBe(baseEnv);
    expect(buildCodexSpawnEnv(undefined, baseEnv).SKIPPY_MCP_TOKEN).toBe("full-owner-secret");
  });
});
