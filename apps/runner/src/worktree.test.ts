import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COREPACK_SHIM_DIR, extendRunnerPath } from "./config.js";
import { provisionWorktree, slugify, type ProvisionExec } from "./worktree.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skippy-worktree-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("provisionWorktree", () => {
  it("skips when the worktree has no package.json", async () => {
    const calls: string[] = [];
    const exec: ProvisionExec = async (file) => {
      calls.push(file);
    };
    const result = await provisionWorktree(tmpDir, exec);
    expect(result.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("runs corepack pnpm install --frozen-lockfile when a lockfile exists", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "");
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    const exec: ProvisionExec = async (file, args, options) => {
      calls.push({ file, args, cwd: options.cwd });
    };
    const result = await provisionWorktree(tmpDir, exec);
    expect(result.status).toBe("provisioned");
    expect(calls).toEqual([
      { file: "corepack", args: ["pnpm", "install", "--frozen-lockfile"], cwd: tmpDir },
    ]);
  });

  it("omits --frozen-lockfile when no lockfile exists", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
    const calls: string[][] = [];
    const exec: ProvisionExec = async (_file, args) => {
      calls.push(args);
    };
    const result = await provisionWorktree(tmpDir, exec);
    expect(result.status).toBe("provisioned");
    expect(calls).toEqual([["pnpm", "install"]]);
  });

  it("suppresses corepack's interactive download prompt", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
    let env: NodeJS.ProcessEnv | undefined;
    const exec: ProvisionExec = async (_file, _args, options) => {
      env = options.env;
    };
    await provisionWorktree(tmpDir, exec);
    expect(env?.COREPACK_ENABLE_DOWNLOAD_PROMPT).toBe("0");
  });

  it("degrades gracefully: install failures become a failed result, never a throw", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
    const exec: ProvisionExec = async () => {
      throw new Error("ENOENT: corepack not found");
    };
    const result = await provisionWorktree(tmpDir, exec);
    expect(result.status).toBe("failed");
    expect(result.message).toContain("corepack pnpm install");
    expect(result.message).toContain("ENOENT");
  });
});

describe("extendRunnerPath", () => {
  it("prepends the corepack shim dir and node's bin dir to a minimal launchd PATH", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" };
    const result = extendRunnerPath(env);
    const parts = result.split(path.delimiter);
    expect(parts[0]).toBe(COREPACK_SHIM_DIR);
    expect(parts[1]).toBe(path.dirname(process.execPath));
    expect(parts).toContain("/usr/bin");
    // Headless daemon: corepack must never wait on an interactive prompt.
    expect(env.COREPACK_ENABLE_DOWNLOAD_PROMPT).toBe("0");
  });

  it("is idempotent (no duplicate entries on repeated calls)", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
    const first = extendRunnerPath(env);
    const second = extendRunnerPath(env);
    expect(second).toBe(first);
    const parts = second.split(path.delimiter);
    expect(new Set(parts).size).toBe(parts.length);
  });

  it("does not override an explicit COREPACK_ENABLE_DOWNLOAD_PROMPT", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin", COREPACK_ENABLE_DOWNLOAD_PROMPT: "1" };
    extendRunnerPath(env);
    expect(env.COREPACK_ENABLE_DOWNLOAD_PROMPT).toBe("1");
  });
});

describe("slugify", () => {
  it("produces branch-safe slugs", () => {
    expect(slugify("Skippy MCP & App")).toBe("skippy-mcp-app");
    expect(slugify("")).toBe("task");
  });
});
