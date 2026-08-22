import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectArtifacts, FileWorkspaceError, materializeManifest, safeFileName } from "./fileWorkspace.js";

const roots: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true }))); });
async function root() { const value = await fsp.mkdtemp(path.join(os.tmpdir(), "skippy-files-")); roots.push(value); return value; }

describe("file workspaces", () => {
  it("uses collision-safe file IDs, contains traversal, streams, and verifies hashes", async () => {
    const bytes = Buffer.from("canonical"); const sha256 = createHash("sha256").update(bytes).digest("hex");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
    const workspace = await materializeManifest(await root(), [
      { fileId: "file-aaaaaaaaaaaa", fileName: "../same.txt", mimeType: "text/plain", sizeBytes: bytes.length, sha256, url: "https://files/1", required: true },
      { fileId: "file-bbbbbbbbbbbb", fileName: "same.txt", mimeType: "text/plain", sizeBytes: bytes.length, sha256, url: "https://files/2", required: true },
    ]);
    expect(workspace.files.map((file) => path.basename(file.localPath!))).toEqual(["aaaaaaaaaaaa--same.txt", "bbbbbbbbbbbb--same.txt"]);
    expect(workspace.files.every((file) => file.localPath!.startsWith(workspace.inputRoot))).toBe(true);
  });

  it.each([
    ["corruption", Buffer.from("wrong"), "0".repeat(64), "input_corrupt"],
    ["expired URL", Buffer.from("x"), undefined, "input_url_expired"],
  ])("classifies %s as retryable", async (_label, bytes, sha256, category) => {
    vi.stubGlobal("fetch", vi.fn(async () => category === "input_url_expired" ? new Response(null, { status: 403 }) : new Response(bytes)));
    await expect(materializeManifest(await root(), [{ fileId: "f1", fileName: "x.txt", mimeType: "text/plain", sizeBytes: bytes.length, ...(sha256 ? { sha256 } : {}), url: "https://files/x", required: true }])).rejects.toMatchObject({ category });
  });

  it("refuses artifact symlinks and aggregate limit violations", async () => {
    const dir = await root(); await fsp.writeFile(path.join(dir, "a.txt"), "1234"); await fsp.symlink(path.join(dir, "a.txt"), path.join(dir, "link.txt"));
    await expect(collectArtifacts(dir)).rejects.toBeInstanceOf(FileWorkspaceError);
    await fsp.rm(path.join(dir, "link.txt")); await expect(collectArtifacts(dir, { maxFiles: 1, maxFileBytes: 2, maxTotalBytes: 2 })).rejects.toMatchObject({ category: "disk_limit" });
  });

  it("sanitizes hostile and empty names", () => { expect(safeFileName("../../.ssh/id_rsa")).toBe("id_rsa"); expect(safeFileName(".." )).toBe("_"); });
});
