#!/usr/bin/env node
// Reproducible install/verify for this host's local MCP connector servers.
//
// Why this exists: the audited Gmail/Calendar servers are third-party clones in
// ~/src (docs/google-source.md deliberately does not vendor them). Before this
// script the only way to rebuild them was to follow a doc by hand, which meant a
// dead mini = an unreproducible agenda pipeline. scripts/connectors.json pins
// them; this script makes the pin executable.
//
// Modes:
//   (default)    check   — report drift, change nothing, exit 1 if not clean
//   --install            — clone/fetch to the pinned commit and run build steps
//   --register           — `claude mcp add -s user` anything not registered
//   --force              — allow --register to replace a mismatched registration
//
// Never automated here: OAuth consent, credential files, Full Disk Access.
// Those are owner-only steps and are reported, not performed.

import { execFileSync, execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  diagnoseEntry,
  parseClaudeMcpList,
  resolveEntry,
  summarize,
  validateManifest,
} from "./connectors-helpers.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = resolve(REPO_ROOT, "scripts/connectors.json");

const args = new Set(process.argv.slice(2));
const doInstall = args.has("--install");
const doRegister = args.has("--register");
const force = args.has("--force");

const ICON = { ok: "  ok  ", drift: " DRIFT", missing: "MISSING", unknown: "   ?  " };

function run(command, cwd) {
  console.log(`      $ ${command}`);
  execSync(command, { cwd, stdio: "inherit" });
}

function gitOut(cwd, ...gitArgs) {
  try {
    return execFileSync("git", ["-C", cwd, ...gitArgs], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function fileMode(path) {
  try {
    return (statSync(path).mode & 0o777).toString(8).padStart(3, "0");
  } catch {
    return null;
  }
}

function readRegistrations() {
  try {
    // Health-checks every server, so it is slow but authoritative.
    return parseClaudeMcpList(execSync("claude mcp list", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return null;
  }
}

function observe(resolved, registrations) {
  const installDirExists = existsSync(resolved.installDir);
  const credentials = resolved.credentialFiles.map((c) => ({
    path: c.path,
    exists: existsSync(c.path),
    mode: fileMode(c.path),
    expectedMode: c.mode,
  }));
  return {
    installDirExists,
    headCommit:
      installDirExists && resolved.kind === "git" ? gitOut(resolved.installDir, "rev-parse", "HEAD") : null,
    worktreeClean:
      installDirExists && resolved.kind === "git"
        ? gitOut(resolved.installDir, "status", "--porcelain") === ""
        : undefined,
    artifactExists: existsSync(resolved.artifactPath),
    credentials,
    registration:
      registrations === null
        ? null
        : registrations[resolved.mcpServerName]
          ? { present: true, command: registrations[resolved.mcpServerName].command }
          : { present: false },
  };
}

function install(resolved) {
  if (resolved.kind === "git") {
    if (!existsSync(resolved.installDir)) {
      run(`git clone ${resolved.repo} ${resolved.installDir}`, REPO_ROOT);
    } else if (gitOut(resolved.installDir, "status", "--porcelain") !== "") {
      // Refuse to blow away local edits — they may be an in-progress re-audit.
      console.log("      ! uncommitted changes present; skipping checkout (resolve by hand)");
      return;
    } else {
      run(`git fetch --quiet origin`, resolved.installDir);
    }
    run(`git checkout --quiet ${resolved.commit}`, resolved.installDir);
    const head = gitOut(resolved.installDir, "rev-parse", "HEAD");
    if (head !== resolved.commit) throw new Error(`checkout failed: HEAD is ${head}`);
  }
  for (const step of resolved.buildSteps) run(step, resolved.buildCwd);
}

function register(resolved, observed) {
  const reg = observed.registration;
  if (reg?.present && !force) {
    console.log("      · already registered; use --force to replace");
    return;
  }
  if (reg?.present) run(`claude mcp remove -s user ${resolved.mcpServerName}`, REPO_ROOT);
  const argv = [resolved.registerCommand, ...resolved.registerArgs].join(" ");
  run(`claude mcp add -s user ${resolved.mcpServerName} -- ${argv}`, REPO_ROOT);
}

const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
const errors = validateManifest(manifest);
if (errors.length) {
  console.error("Invalid scripts/connectors.json:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(2);
}

const ctx = { home: homedir(), repoRoot: REPO_ROOT };
const registrationsBefore = readRegistrations();
if (registrationsBefore === null) {
  console.log("note: could not run `claude mcp list` — registration state unknown\n");
}

const diagnoses = [];
for (const entry of manifest.connectors) {
  const resolved = resolveEntry(entry, ctx);
  console.log(`\n${resolved.slug}  (${resolved.docs ?? "no docs"})`);

  if (doInstall) install(resolved);
  let observed = observe(resolved, registrationsBefore);
  if (doRegister) {
    register(resolved, observed);
    observed = observe(resolved, readRegistrations());
  }

  const diagnosis = diagnoseEntry(resolved, observed);
  diagnoses.push(diagnosis);
  for (const check of diagnosis.checks) {
    console.log(`  [${ICON[check.status]}] ${check.name}: ${check.detail}`);
  }
  for (const requirement of resolved.hostRequirements) {
    console.log(`  [ note ] ${requirement}`);
  }
}

const summary = summarize(diagnoses);
console.log("");
if (summary.ok) {
  console.log("All connectors match the manifest.");
} else {
  if (summary.drift.length) console.log(`Drift:   ${summary.drift.join(", ")}`);
  if (summary.missing.length) console.log(`Missing: ${summary.missing.join(", ")}`);
  if (summary.unknown.length) console.log(`Unknown: ${summary.unknown.join(", ")}`);
  if (!doInstall) console.log("Run with --install (and --register) to reconcile.");
  console.log("Credential files and OAuth consent are owner-only steps — see the docs above.");
}
process.exit(summary.ok ? 0 : 1);
