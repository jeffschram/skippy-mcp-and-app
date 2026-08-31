import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  diagnoseEntry,
  expandPath,
  parseClaudeMcpList,
  resolveEntry,
  summarize,
  validateManifest,
} from "./connectors-helpers.mjs";

const CTX = { home: "/Users/skippy", repoRoot: "/repo" };

const GIT_ENTRY = {
  slug: "gmail",
  mcpServerName: "gmail",
  source: {
    kind: "git",
    repo: "https://example.com/gmail-mcp.git",
    commit: "e054cf1efe82e386552bf8e1e6d0115f5ac86c3e",
    installPath: "~/src/gmail-mcp-audit",
  },
  build: { steps: ["python3 -m venv .venv"], artifact: ".venv/bin/python" },
  register: { command: "{{installDir}}/.venv/bin/python", args: ["-m", "gmail_mcp"] },
  credentialFiles: [{ path: "~/.gmail-mcp/token.json", mode: "600" }],
};

describe("expandPath", () => {
  it("expands ~ and placeholders", () => {
    expect(expandPath("~/src/x", CTX)).toBe("/Users/skippy/src/x");
    expect(expandPath("{{repoRoot}}/apps/y", CTX)).toBe("/repo/apps/y");
    expect(expandPath("{{installDir}}/bin", { ...CTX, installDir: "/i" })).toBe("/i/bin");
  });

  it("resolves relative paths against the repo root and leaves absolutes alone", () => {
    expect(expandPath("apps/imessage-mcp", CTX)).toBe("/repo/apps/imessage-mcp");
    expect(expandPath("/usr/bin/node", CTX)).toBe("/usr/bin/node");
  });
});

describe("validateManifest", () => {
  it("accepts the committed manifest", () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL("./connectors.json", import.meta.url)), "utf8"),
    );
    expect(validateManifest(manifest)).toEqual([]);
  });

  it("requires a full pinned SHA for git sources", () => {
    const bad = { connectors: [{ ...GIT_ENTRY, source: { ...GIT_ENTRY.source, commit: "main" } }] };
    expect(validateManifest(bad)).toContain(
      "connectors[0] (gmail): source.commit must be a full 40-char SHA",
    );
  });

  it("rejects duplicate slugs", () => {
    const bad = { connectors: [GIT_ENTRY, GIT_ENTRY] };
    expect(validateManifest(bad)).toContain("connectors[1] (gmail): duplicate slug");
  });

  it("does not demand a commit for workspace sources", () => {
    const ws = {
      connectors: [
        {
          slug: "imessage",
          mcpServerName: "imessage",
          source: { kind: "workspace", installPath: "apps/imessage-mcp" },
          build: { steps: [], artifact: "dist/stdio.js" },
          register: { command: "node", args: ["{{installDir}}/dist/stdio.js"] },
        },
      ],
    };
    expect(validateManifest(ws)).toEqual([]);
  });
});

describe("resolveEntry", () => {
  it("resolves install dir, artifact and registration", () => {
    const r = resolveEntry(GIT_ENTRY, CTX);
    expect(r.installDir).toBe("/Users/skippy/src/gmail-mcp-audit");
    expect(r.artifactPath).toBe("/Users/skippy/src/gmail-mcp-audit/.venv/bin/python");
    expect(r.registerCommand).toBe("/Users/skippy/src/gmail-mcp-audit/.venv/bin/python");
    // Plain args must survive untouched — "-m" is not a path.
    expect(r.registerArgs).toEqual(["-m", "gmail_mcp"]);
    expect(r.buildCwd).toBe("/Users/skippy/src/gmail-mcp-audit");
  });

  it("builds workspace entries from the repo root", () => {
    const r = resolveEntry(
      {
        slug: "imessage",
        mcpServerName: "imessage",
        source: { kind: "workspace", installPath: "apps/imessage-mcp" },
        build: { steps: ["pnpm build"], artifact: "dist/stdio.js" },
        register: { command: "node", args: ["{{installDir}}/dist/stdio.js"] },
      },
      CTX,
    );
    expect(r.buildCwd).toBe("/repo");
    expect(r.registerArgs).toEqual(["/repo/apps/imessage-mcp/dist/stdio.js"]);
    // Regression: a bare command is a PATH lookup, not a repo-relative path.
    // Expanding it produced "/repo/node" and reported false drift against a
    // perfectly good registration (caught on the script's first live run).
    expect(r.registerCommand).toBe("node");
  });
});

describe("parseClaudeMcpList", () => {
  it("parses real `claude mcp list` output", () => {
    const out = [
      "Checking MCP server health…",
      "",
      "gmail: /Users/skippy/src/gmail-mcp-audit/.venv/bin/python -m gmail_mcp - ✔ Connected",
      "gcal: /Users/skippy/src/gcal-readonly-mcp-audit/gcal-readonly-mcp  - ✔ Connected",
      "imessage: node /repo/apps/imessage-mcp/dist/stdio.js - ✔ Connected",
    ].join("\n");
    const parsed = parseClaudeMcpList(out);
    expect(Object.keys(parsed).sort()).toEqual(["gcal", "gmail", "imessage"]);
    // Trailing double-space before the separator must not leak into the command.
    expect(parsed.gcal.command).toBe("/Users/skippy/src/gcal-readonly-mcp-audit/gcal-readonly-mcp");
    expect(parsed.gmail.command).toBe(
      "/Users/skippy/src/gmail-mcp-audit/.venv/bin/python -m gmail_mcp",
    );
  });
});

describe("diagnoseEntry", () => {
  const resolved = resolveEntry(GIT_ENTRY, CTX);
  const healthy = {
    installDirExists: true,
    headCommit: GIT_ENTRY.source.commit,
    worktreeClean: true,
    artifactExists: true,
    credentials: [{ path: "/Users/skippy/.gmail-mcp/token.json", exists: true, mode: "600", expectedMode: "600" }],
    registration: {
      present: true,
      command: "/Users/skippy/src/gmail-mcp-audit/.venv/bin/python -m gmail_mcp",
    },
  };

  it("reports ok when everything matches", () => {
    expect(diagnoseEntry(resolved, healthy).status).toBe("ok");
  });

  it("flags an unpinned checkout", () => {
    const d = diagnoseEntry(resolved, { ...healthy, headCommit: "0".repeat(40) });
    expect(d.status).toBe("drift");
    expect(d.checks.find((c) => c.name === "pin").status).toBe("drift");
  });

  it("flags local modifications to audited code", () => {
    const d = diagnoseEntry(resolved, { ...healthy, worktreeClean: false });
    expect(d.checks.find((c) => c.name === "worktree").detail).toMatch(/uncommitted/);
  });

  it("flags loosened credential permissions", () => {
    const d = diagnoseEntry(resolved, {
      ...healthy,
      credentials: [
        { path: "/Users/skippy/.gmail-mcp/token.json", exists: true, mode: "644", expectedMode: "600" },
      ],
    });
    expect(d.status).toBe("drift");
  });

  it("flags a registration pointing somewhere else", () => {
    const d = diagnoseEntry(resolved, {
      ...healthy,
      registration: { present: true, command: "/somewhere/else/python -m gmail_mcp" },
    });
    expect(d.checks.find((c) => c.name === "registered").status).toBe("drift");
  });

  it("reports missing when nothing is installed", () => {
    const d = diagnoseEntry(resolved, {
      installDirExists: false,
      credentials: [],
      registration: { present: false },
    });
    expect(d.status).toBe("missing");
  });

  it("summarizes across connectors", () => {
    const s = summarize([
      { slug: "gmail", status: "ok", checks: [] },
      { slug: "gcal", status: "drift", checks: [] },
      { slug: "imessage", status: "missing", checks: [] },
    ]);
    expect(s).toEqual({ ok: false, drift: ["gcal"], missing: ["imessage"], unknown: [] });
  });
});
