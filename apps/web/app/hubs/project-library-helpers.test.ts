import { describe, expect, it } from "vitest";
import { PROJECT_FILE_MAX_BYTES } from "@skippy/shared";
import {
  PROJECT_FILE_ACCEPT,
  checkProjectFile,
  formatFileSize,
  formatUploadDate,
  iconKindForMimeType,
} from "./project-library-helpers";

describe("formatFileSize", () => {
  it("shows raw bytes below 1 KB", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("shows one decimal for small KB/MB values and none from 10 up", () => {
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(10 * 1024)).toBe("10 KB");
    expect(formatFileSize(2.4 * 1024 * 1024)).toBe("2.4 MB");
    expect(formatFileSize(25 * 1024 * 1024)).toBe("25 MB");
    expect(formatFileSize(1.2 * 1024 * 1024 * 1024)).toBe("1.2 GB");
  });

  it("returns a dash for invalid input", () => {
    expect(formatFileSize(-1)).toBe("—");
    expect(formatFileSize(Number.NaN)).toBe("—");
  });
});

describe("iconKindForMimeType", () => {
  it("classifies images", () => {
    expect(iconKindForMimeType("image/png")).toBe("image");
    expect(iconKindForMimeType("image/svg+xml")).toBe("image");
    expect(iconKindForMimeType("IMAGE/JPEG; charset=binary")).toBe("image");
  });

  it("classifies spreadsheets, including csv text", () => {
    expect(iconKindForMimeType("text/csv")).toBe("spreadsheet");
    expect(iconKindForMimeType("application/csv")).toBe("spreadsheet");
    expect(iconKindForMimeType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(
      "spreadsheet",
    );
    expect(iconKindForMimeType("application/vnd.ms-excel")).toBe("spreadsheet");
  });

  it("classifies text-like documents", () => {
    expect(iconKindForMimeType("text/plain")).toBe("text");
    expect(iconKindForMimeType("text/markdown")).toBe("text");
    expect(iconKindForMimeType("application/pdf")).toBe("text");
    expect(iconKindForMimeType("application/json")).toBe("text");
    expect(
      iconKindForMimeType("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe("text");
  });

  it("falls back to generic for everything else", () => {
    expect(iconKindForMimeType("application/octet-stream")).toBe("generic");
    expect(iconKindForMimeType("application/zip")).toBe("generic");
    expect(iconKindForMimeType("")).toBe("generic");
  });
});

describe("formatUploadDate", () => {
  it("formats an epoch as a short UTC date", () => {
    expect(formatUploadDate(Date.UTC(2026, 6, 5, 12, 0, 0))).toBe("Jul 5, 2026");
    expect(formatUploadDate(Date.UTC(2025, 11, 31, 23, 59, 0))).toBe("Dec 31, 2025");
  });
});

describe("checkProjectFile", () => {
  it("accepts allowed files and returns normalized fields", () => {
    const result = checkProjectFile({ fileName: " notes.md ", mimeType: "Text/Markdown", sizeBytes: 1024 });
    expect(result).toEqual({ ok: true, fileName: "notes.md", mimeType: "text/markdown", sizeBytes: 1024 });
  });

  it("rejects oversize files with a reason", () => {
    const result = checkProjectFile({
      fileName: "big.png",
      mimeType: "image/png",
      sizeBytes: PROJECT_FILE_MAX_BYTES + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("too large");
  });

  it("rejects disallowed mime types with a reason", () => {
    const result = checkProjectFile({ fileName: "app.exe", mimeType: "application/x-msdownload", sizeBytes: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not allowed");
  });

  it("rejects empty file names and empty mime types", () => {
    expect(checkProjectFile({ fileName: "  ", mimeType: "image/png", sizeBytes: 10 }).ok).toBe(false);
    expect(checkProjectFile({ fileName: "photo.heic", mimeType: "", sizeBytes: 10 }).ok).toBe(false);
  });
});

describe("PROJECT_FILE_ACCEPT", () => {
  it("includes image/* so phone camera/photo pickers work", () => {
    const parts = PROJECT_FILE_ACCEPT.split(",");
    expect(parts).toContain("image/*");
    expect(parts).toContain("application/pdf");
    expect(parts).toContain("text/*");
  });
});
