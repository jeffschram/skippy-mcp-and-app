import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guard for a failure mode that every other check in the repo is blind to.
 *
 * `moduleResolution: "Bundler"` (tsconfig.base.json) lets TypeScript resolve
 * `./recurrence` without an extension, and tsc copies the specifier into
 * `dist/` verbatim. Node's ESM loader does not guess extensions, so the emitted
 * file throws ERR_MODULE_NOT_FOUND the moment a plain `node dist/...` process
 * imports it — while typecheck, vitest, and the Next bundler all stay green,
 * because none of them use Node's resolver.
 *
 * That combination hid a broken `dist` here until a stdio MCP server (the first
 * consumer to load this package from raw Node rather than through a bundler)
 * failed at launch. apps/mcp-server had the same latent break.
 *
 * Scoped to non-test files because tsconfig.build.json excludes tests, so their
 * specifiers never reach dist.
 */
const SRC_DIR = dirname(fileURLToPath(import.meta.url));

// Matches the specifier in `from "..."` / `import("...")` for relative paths.
const RELATIVE_SPECIFIER = /(?:from|import)\s*\(?\s*"(\.[^"]*)"/g;

function emittedSourceFiles(): string[] {
  return readdirSync(SRC_DIR)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => !name.endsWith(".test.ts") && !name.endsWith(".spec.ts"));
}

describe("emitted module specifiers", () => {
  it("finds source files to check", () => {
    // Cheap canary: a bad glob would make the assertions below vacuously pass.
    expect(emittedSourceFiles().length).toBeGreaterThan(0);
  });

  it.each(emittedSourceFiles())("%s uses explicit .js extensions", (name) => {
    const contents = readFileSync(join(SRC_DIR, name), "utf8");
    const offenders = [...contents.matchAll(RELATIVE_SPECIFIER)]
      .map((match) => match[1] as string)
      .filter((specifier) => !specifier.endsWith(".js") && !specifier.endsWith(".json"));

    expect(offenders, `extensionless relative import(s) in ${name}`).toEqual([]);
  });
});
