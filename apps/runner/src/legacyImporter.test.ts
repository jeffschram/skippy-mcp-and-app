import fsp from "node:fs/promises"; import os from "node:os"; import path from "node:path";
import { describe, expect, it } from "vitest"; import { importLegacyPreview, previewLegacyFolders } from "./legacyImporter.js";
describe("legacy importer", () => {
  it("previews classification/collisions and never deletes local files", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "legacy-import-")); try {
      await fsp.mkdir(path.join(root, "_library", "nested"), { recursive: true }); await fsp.mkdir(path.join(root, "_output"));
      await fsp.writeFile(path.join(root, "_library", "same.txt"), "a"); await fsp.writeFile(path.join(root, "_library", "nested", "same.txt"), "b"); await fsp.writeFile(path.join(root, "_output", "report.md"), "c");
      const preview = await previewLegacyFolders(root); expect(preview.entries.map((entry) => entry.kind)).toEqual(["library_input", "library_input", "generated_artifact"]); expect(preview.collisions).toEqual(["library_input:same.txt"]);
      await expect(importLegacyPreview(preview, false, async () => ({ fileId: "x" }))).rejects.toThrow("explicit preview approval");
      const report = await importLegacyPreview(preview, true, async (entry) => ({ fileId: entry.sha256 })); expect(report.sourceFilesDeleted).toBe(0); expect(await fsp.readFile(path.join(root, "_output", "report.md"), "utf8")).toBe("c");
    } finally { await fsp.rm(root, { recursive: true, force: true }); }
  });
});
