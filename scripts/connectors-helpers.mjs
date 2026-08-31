// Pure helpers for the connector manifest (scripts/connectors.json).
//
// Deliberately plain ESM (.mjs), not TypeScript: setup-connectors.mjs must run
// on a freshly rebuilt host *before* `pnpm install` has happened — a build step
// would defeat the point of a bootstrap script. Keeping the logic pure here
// makes it testable (connectors-helpers.test.mjs) without touching the disk.

const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * Expand `~`, `{{repoRoot}}` and `{{installDir}}` placeholders.
 * Relative paths resolve against repoRoot (workspace entries).
 */
export function expandPath(input, ctx) {
  if (typeof input !== "string") return input;
  let out = input;
  if (ctx.installDir !== undefined) out = out.replaceAll("{{installDir}}", ctx.installDir);
  out = out.replaceAll("{{repoRoot}}", ctx.repoRoot);
  if (out === "~") return ctx.home;
  if (out.startsWith("~/")) return `${ctx.home}/${out.slice(2)}`;
  if (out.startsWith("/")) return out;
  return `${ctx.repoRoot}/${out}`;
}

/** Returns an array of human-readable problems; empty means valid. */
export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") return ["manifest is not an object"];
  if (!Array.isArray(manifest.connectors)) return ["manifest.connectors must be an array"];

  const seen = new Set();
  for (const [i, entry] of manifest.connectors.entries()) {
    const label = entry?.slug ? `connectors[${i}] (${entry.slug})` : `connectors[${i}]`;
    if (!entry?.slug) errors.push(`${label}: missing slug`);
    else if (seen.has(entry.slug)) errors.push(`${label}: duplicate slug`);
    else seen.add(entry.slug);

    if (!entry?.mcpServerName) errors.push(`${label}: missing mcpServerName`);

    const kind = entry?.source?.kind;
    if (kind !== "git" && kind !== "workspace") {
      errors.push(`${label}: source.kind must be "git" or "workspace"`);
    }
    if (!entry?.source?.installPath) errors.push(`${label}: missing source.installPath`);
    if (kind === "git") {
      if (!entry.source.repo) errors.push(`${label}: git source requires source.repo`);
      // A pinned full SHA is the trust anchor for an audited third-party server
      // (docs/google-source.md) — refuse tags/branches/short hashes.
      if (!SHA_RE.test(entry.source.commit ?? "")) {
        errors.push(`${label}: source.commit must be a full 40-char SHA`);
      }
    }
    if (!entry?.build?.artifact) errors.push(`${label}: missing build.artifact`);
    if (!Array.isArray(entry?.build?.steps)) errors.push(`${label}: build.steps must be an array`);
    if (!entry?.register?.command) errors.push(`${label}: missing register.command`);
    if (!Array.isArray(entry?.register?.args)) errors.push(`${label}: register.args must be an array`);
  }
  return errors;
}

/**
 * Expand only values that are actually paths. A bare command like "node" is a
 * PATH lookup and must survive untouched — expanding it against repoRoot would
 * produce "/repo/node" and silently mismatch a working registration.
 */
function expandIfPath(value, ctx) {
  const isPath = value.includes("{{") || value.startsWith("~") || value.startsWith("/") || value.includes("/");
  return isPath ? expandPath(value, ctx) : value;
}

/** Resolve every path/placeholder in an entry against the host context. */
export function resolveEntry(entry, ctx) {
  const installDir = expandPath(entry.source.installPath, ctx);
  const inner = { ...ctx, installDir };
  return {
    slug: entry.slug,
    mcpServerName: entry.mcpServerName,
    kind: entry.source.kind,
    repo: entry.source.repo ?? null,
    commit: entry.source.commit ?? null,
    docs: entry.docs ?? null,
    installDir,
    buildSteps: entry.build.steps,
    buildCwd: entry.source.kind === "workspace" ? ctx.repoRoot : installDir,
    artifactPath: `${installDir}/${entry.build.artifact}`,
    registerCommand: expandIfPath(entry.register.command, inner),
    // Only substitute placeholders in args; a bare "-m" must stay "-m".
    registerArgs: entry.register.args.map((a) =>
      a.includes("{{") ? expandPath(a, inner) : a,
    ),
    credentialFiles: (entry.credentialFiles ?? []).map((c) => ({
      path: expandPath(c.path, inner),
      mode: c.mode,
    })),
    hostRequirements: entry.hostRequirements ?? [],
  };
}

/**
 * Parse `claude mcp list` output into { name: { command } }.
 * Lines look like: `gmail: /path/to/python -m gmail_mcp - ✔ Connected`
 */
export function parseClaudeMcpList(stdout) {
  const servers = {};
  for (const rawLine of String(stdout).split("\n")) {
    const line = rawLine.trim();
    const match = /^([A-Za-z0-9_-]+):\s+(.*?)\s+-\s+[^-]*$/.exec(line);
    if (!match) continue;
    servers[match[1]] = { command: match[2].trim().replace(/\s+/g, " ") };
  }
  return servers;
}

/**
 * Compare a resolved entry against observed host state.
 * `observed` fields may be null/undefined when they could not be determined.
 */
export function diagnoseEntry(resolved, observed) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });

  if (!observed.installDirExists) {
    add("install", "missing", `${resolved.installDir} does not exist`);
  } else if (resolved.kind === "git") {
    if (observed.headCommit === resolved.commit) {
      add("pin", "ok", `at ${resolved.commit.slice(0, 7)}`);
    } else {
      add(
        "pin",
        "drift",
        `HEAD ${String(observed.headCommit).slice(0, 7)} != pinned ${resolved.commit.slice(0, 7)}`,
      );
    }
    if (observed.worktreeClean === false) {
      // Local edits mean the running server is no longer the audited code.
      add("worktree", "drift", "uncommitted local modifications");
    } else if (observed.worktreeClean === true) {
      add("worktree", "ok", "clean");
    }
  } else {
    add("install", "ok", resolved.installDir);
  }

  if (observed.installDirExists) {
    add(
      "build",
      observed.artifactExists ? "ok" : "missing",
      observed.artifactExists ? resolved.artifactPath : `missing ${resolved.artifactPath}`,
    );
  }

  for (const cred of observed.credentials ?? []) {
    if (!cred.exists) add("credential", "missing", `${cred.path} absent (owner setup step)`);
    else if (cred.mode && cred.expectedMode && cred.mode !== cred.expectedMode) {
      add("credential", "drift", `${cred.path} is ${cred.mode}, expected ${cred.expectedMode}`);
    } else add("credential", "ok", cred.path);
  }

  const reg = observed.registration;
  if (reg === undefined || reg === null) {
    add("registered", "unknown", "could not read `claude mcp list`");
  } else if (!reg.present) {
    add("registered", "missing", `no MCP server named "${resolved.mcpServerName}"`);
  } else {
    const expected = [resolved.registerCommand, ...resolved.registerArgs].join(" ");
    if (reg.command === expected) add("registered", "ok", expected);
    else add("registered", "drift", `registered as "${reg.command}", manifest says "${expected}"`);
  }

  const worst = checks.some((c) => c.status === "drift")
    ? "drift"
    : checks.some((c) => c.status === "missing")
      ? "missing"
      : checks.some((c) => c.status === "unknown")
        ? "unknown"
        : "ok";
  return { slug: resolved.slug, status: worst, checks };
}

export function summarize(diagnoses) {
  return {
    ok: diagnoses.every((d) => d.status === "ok"),
    drift: diagnoses.filter((d) => d.status === "drift").map((d) => d.slug),
    missing: diagnoses.filter((d) => d.status === "missing").map((d) => d.slug),
    unknown: diagnoses.filter((d) => d.status === "unknown").map((d) => d.slug),
  };
}
