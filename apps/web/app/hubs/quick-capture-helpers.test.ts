import { describe, expect, it } from "vitest";
import {
  QUICK_CAPTURE_INTENT_STORAGE_KEY,
  checkQuickCaptureFile,
  parseStoredIntent,
} from "./quick-capture-helpers";

describe("checkQuickCaptureFile", () => {
  it("accepts any MIME type, unlike the project library validator", () => {
    const result = checkQuickCaptureFile({
      fileName: "tool.exe",
      mimeType: "application/x-msdownload",
      sizeBytes: 2048,
    });
    expect(result).toEqual({
      ok: true,
      fileName: "tool.exe",
      mimeType: "application/x-msdownload",
      sizeBytes: 2048,
    });
  });

  it("defaults a missing MIME type to octet-stream instead of rejecting", () => {
    const result = checkQuickCaptureFile({ fileName: "mystery", mimeType: "", sizeBytes: 1 });
    expect(result).toMatchObject({ ok: true, mimeType: "application/octet-stream" });
  });

  it("rejects files over the 100 MB cap with a readable reason", () => {
    const result = checkQuickCaptureFile({
      fileName: "huge.zip",
      mimeType: "application/zip",
      sizeBytes: 100 * 1024 * 1024 + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("100 MB");
  });

  it("rejects empty file names", () => {
    expect(checkQuickCaptureFile({ fileName: "  ", mimeType: "image/png", sizeBytes: 1 }).ok).toBe(false);
  });
});

describe("parseStoredIntent", () => {
  it("round-trips hold and falls back to remember for anything else", () => {
    expect(parseStoredIntent("hold")).toBe("hold");
    expect(parseStoredIntent("remember")).toBe("remember");
    expect(parseStoredIntent("garbage")).toBe("remember");
    expect(parseStoredIntent(null)).toBe("remember");
    expect(parseStoredIntent(undefined)).toBe("remember");
  });

  it("uses a stable storage key", () => {
    expect(QUICK_CAPTURE_INTENT_STORAGE_KEY).toBe("skippy.quickCapture.intent");
  });
});
