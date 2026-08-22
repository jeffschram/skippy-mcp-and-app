import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { safeFileName } from "./fileWorkspace.js";

export interface LegacyImportEntry { sourcePath: string; relativePath: string; kind: "library_input" | "generated_artifact"; fileName: string; sizeBytes: number; sha256: string; collision: boolean }
export interface LegacyImportPreview { root: string; createdAt: number; entries: LegacyImportEntry[]; collisions: string[] }

async function hashFile(file: string) {
  return await new Promise<string>((resolve, reject) => { const hash = createHash("sha256"); const stream = fs.createReadStream(file); stream.on("data", (chunk) => hash.update(chunk)); stream.on("error", reject); stream.on("end", () => resolve(hash.digest("hex"))); });
}

/** Read-only preview. It never follows symlinks and never modifies local files. */
export async function previewLegacyFolders(projectRoot: string): Promise<LegacyImportPreview> {
  const root = path.resolve(projectRoot); const entries: LegacyImportEntry[] = []; const names = new Map<string, number>();
  for (const [folder, kind] of [["_library", "library_input"], ["_output", "generated_artifact"]] as const) {
    const base = path.join(root, folder); if (!fs.existsSync(base)) continue;
    const walk = async (dir: string) => {
      for (const item of await fsp.readdir(dir, { withFileTypes: true })) {
        const sourcePath = path.join(dir, item.name); if (item.isSymbolicLink()) continue;
        if (item.isDirectory()) { await walk(sourcePath); continue; } if (!item.isFile()) continue;
        const stat = await fsp.stat(sourcePath); const fileName = safeFileName(item.name); const key = `${kind}:${fileName.toLowerCase()}`; names.set(key, (names.get(key) ?? 0) + 1);
        entries.push({ sourcePath, relativePath: path.relative(root, sourcePath), kind, fileName, sizeBytes: stat.size, sha256: await hashFile(sourcePath), collision: false });
      }
    }; await walk(base);
  }
  const collisions = [...names.entries()].filter(([, count]) => count > 1).map(([name]) => name);
  for (const entry of entries) entry.collision = collisions.includes(`${entry.kind}:${entry.fileName.toLowerCase()}`);
  return { root, createdAt: Date.now(), entries, collisions };
}

/** Executes only a caller-approved preview. Upload is injected so this module
 * cannot silently start transfers; source paths are read and never deleted. */
export async function importLegacyPreview(preview: LegacyImportPreview, approved: boolean, upload: (entry: LegacyImportEntry) => Promise<{ fileId: string }>) {
  if (!approved) throw new Error("legacy import requires explicit preview approval");
  const results = [];
  for (const entry of preview.entries) {
    try { results.push({ relativePath: entry.relativePath, status: "uploaded" as const, ...(await upload(entry)) }); }
    catch (error) { results.push({ relativePath: entry.relativePath, status: "failed" as const, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { previewCreatedAt: preview.createdAt, sourceFilesDeleted: 0, results };
}
