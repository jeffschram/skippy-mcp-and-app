import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export interface FileManifestEntry {
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string;
  url: string | null;
  required: boolean;
}

export class FileWorkspaceError extends Error {
  constructor(public category: "input_materialization" | "input_corrupt" | "input_url_expired" | "disk_limit", message: string) {
    super(message);
  }
}

export function safeFileName(name: string): string {
  return path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/^\.+/, "_").slice(0, 180) || "file";
}

export function assertContained(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new FileWorkspaceError("input_materialization", "file path escapes workspace");
  return resolved;
}

async function downloadVerified(entry: FileManifestEntry, target: string, maxBytes: number): Promise<void> {
  if (!entry.url) throw new FileWorkspaceError("input_url_expired", `download URL unavailable for ${entry.fileId}`);
  const response = await fetch(entry.url);
  if (!response.ok) throw new FileWorkspaceError(response.status === 401 || response.status === 403 || response.status === 404 ? "input_url_expired" : "input_materialization", `download failed for ${entry.fileId} (HTTP ${response.status})`);
  if (!response.body) throw new FileWorkspaceError("input_materialization", `empty response body for ${entry.fileId}`);
  const part = `${target}.${randomUUID()}.part`;
  const output = fs.createWriteStream(part, { flags: "wx", mode: 0o600 });
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > entry.sizeBytes || bytes > maxBytes) throw new FileWorkspaceError("disk_limit", `download exceeded declared limit for ${entry.fileId}`);
      hash.update(value);
      if (!output.write(value)) await new Promise<void>((resolve, reject) => { output.once("drain", resolve); output.once("error", reject); });
    }
    await new Promise<void>((resolve, reject) => output.end((error?: Error | null) => error ? reject(error) : resolve()));
    const digest = hash.digest("hex");
    if (bytes !== entry.sizeBytes) throw new FileWorkspaceError("input_corrupt", `byte count mismatch for ${entry.fileId}`);
    if (entry.sha256 && digest !== entry.sha256.toLowerCase()) throw new FileWorkspaceError("input_corrupt", `SHA-256 mismatch for ${entry.fileId}`);
    await fsp.rename(part, target);
  } catch (error) {
    output.destroy(); await fsp.rm(part, { force: true }); throw error;
  }
}

export async function materializeManifest(root: string, entries: FileManifestEntry[], maxTotalBytes = 100 * 1024 * 1024) {
  const inputRoot = assertContained(root, path.join(root, ".skippy", "inputs"));
  await fsp.mkdir(inputRoot, { recursive: true, mode: 0o700 });
  const declaredTotal = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  if (declaredTotal > maxTotalBytes) throw new FileWorkspaceError("disk_limit", `input manifest exceeds ${maxTotalBytes} bytes`);
  const materialized: Array<FileManifestEntry & { localPath?: string; warning?: string }> = [];
  for (const entry of entries) {
    const target = assertContained(inputRoot, path.join(inputRoot, `${safeFileName(entry.fileId.slice(-12))}--${safeFileName(entry.fileName)}`));
    try { await downloadVerified(entry, target, maxTotalBytes); materialized.push({ ...entry, localPath: target }); }
    catch (error) {
      if (entry.required) throw error;
      materialized.push({ ...entry, warning: error instanceof Error ? error.message : String(error) });
    }
  }
  await fsp.writeFile(path.join(inputRoot, "manifest.json"), JSON.stringify({ files: materialized }, null, 2), { mode: 0o600 });
  return { inputRoot, files: materialized };
}

export interface ArtifactCandidate { relativePath: string; absolutePath: string; fileName: string; sizeBytes: number; sha256: string; mimeType: string }

export async function collectArtifacts(outputRoot: string, limits = { maxFiles: 32, maxFileBytes: 25 * 1024 * 1024, maxTotalBytes: 100 * 1024 * 1024 }): Promise<ArtifactCandidate[]> {
  const root = path.resolve(outputRoot); const found: ArtifactCandidate[] = []; let total = 0;
  const walk = async (dir: string) => {
    for (const item of await fsp.readdir(dir, { withFileTypes: true })) {
      const absolutePath = assertContained(root, path.join(dir, item.name));
      if (item.isSymbolicLink()) throw new FileWorkspaceError("input_materialization", `artifact symlink refused: ${item.name}`);
      if (item.isDirectory()) { await walk(absolutePath); continue; }
      if (!item.isFile()) continue;
      const stat = await fsp.stat(absolutePath); total += stat.size;
      if (found.length >= limits.maxFiles || stat.size > limits.maxFileBytes || total > limits.maxTotalBytes) throw new FileWorkspaceError("disk_limit", "artifact output limits exceeded");
      const sha256 = await new Promise<string>((resolve, reject) => { const hash = createHash("sha256"); const stream = fs.createReadStream(absolutePath); stream.on("data", (chunk) => hash.update(chunk)); stream.on("error", reject); stream.on("end", () => resolve(hash.digest("hex"))); });
      const ext = path.extname(item.name).toLowerCase();
      const mimeTypes: Record<string, string> = { ".txt": "text/plain", ".csv": "text/csv", ".md": "text/markdown", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pdf": "application/pdf" };
      const mimeType = mimeTypes[ext]; if (!mimeType) throw new FileWorkspaceError("input_materialization", `artifact type is not allowed: ${item.name}`);
      found.push({ relativePath: path.relative(root, absolutePath), absolutePath, fileName: item.name, sizeBytes: stat.size, sha256, mimeType });
    }
  };
  await fsp.mkdir(root, { recursive: true, mode: 0o700 }); await walk(root); return found;
}
