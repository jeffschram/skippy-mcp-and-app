import { describe, expect, it } from "vitest";
import {
  QUICK_CAPTURE_FILE_MAX_BYTES,
  QUICK_CAPTURE_HOLD_EXPIRY_MS,
  combineSharedCaptureText,
  isQuickCaptureHoldExpired,
  normalizeQuickCaptureIntentInput,
  parseBearerToken,
  quickCaptureIntent,
  validateQuickCaptureFileInput,
} from "./index";

describe("quickCaptureIntent", () => {
  it("defaults absent intent to remember (pre-existing rows, no migration)", () => {
    expect(quickCaptureIntent({})).toBe("remember");
    expect(quickCaptureIntent({ intent: undefined })).toBe("remember");
  });

  it("returns explicit intents unchanged", () => {
    expect(quickCaptureIntent({ intent: "remember" })).toBe("remember");
    expect(quickCaptureIntent({ intent: "hold" })).toBe("hold");
  });
});

describe("isQuickCaptureHoldExpired", () => {
  const now = 1_780_850_000_000;

  it("expires hold captures older than 7 days", () => {
    expect(
      isQuickCaptureHoldExpired({ intent: "hold", createdAt: now - QUICK_CAPTURE_HOLD_EXPIRY_MS - 1 }, now),
    ).toBe(true);
  });

  it("keeps hold captures at or inside the 7-day window", () => {
    expect(
      isQuickCaptureHoldExpired({ intent: "hold", createdAt: now - QUICK_CAPTURE_HOLD_EXPIRY_MS }, now),
    ).toBe(false);
    expect(isQuickCaptureHoldExpired({ intent: "hold", createdAt: now }, now)).toBe(false);
  });

  it("never expires remember captures, including intent-less legacy rows", () => {
    const ancient = now - 100 * QUICK_CAPTURE_HOLD_EXPIRY_MS;
    expect(isQuickCaptureHoldExpired({ intent: "remember", createdAt: ancient }, now)).toBe(false);
    expect(isQuickCaptureHoldExpired({ createdAt: ancient }, now)).toBe(false);
  });

  it("uses a 7-day constant", () => {
    expect(QUICK_CAPTURE_HOLD_EXPIRY_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("validateQuickCaptureFileInput", () => {
  it("allows any MIME type, including executables and unknown binaries", () => {
    expect(
      validateQuickCaptureFileInput({
        fileName: "tool.exe",
        mimeType: "application/x-msdownload",
        sizeBytes: 1024,
      }),
    ).toEqual({ fileName: "tool.exe", mimeType: "application/x-msdownload", sizeBytes: 1024 });
    expect(
      validateQuickCaptureFileInput({
        fileName: "blob.bin",
        mimeType: "application/octet-stream",
        sizeBytes: 10,
      }).mimeType,
    ).toBe("application/octet-stream");
  });

  it("normalizes the MIME type and defaults an empty one to octet-stream", () => {
    expect(
      validateQuickCaptureFileInput({ fileName: "a.txt", mimeType: " Text/Plain; charset=utf-8 ", sizeBytes: 1 })
        .mimeType,
    ).toBe("text/plain");
    expect(
      validateQuickCaptureFileInput({ fileName: "no-extension", mimeType: "", sizeBytes: 1 }).mimeType,
    ).toBe("application/octet-stream");
  });

  it("trims the file name and rejects empty names", () => {
    expect(
      validateQuickCaptureFileInput({ fileName: "  report.pdf  ", mimeType: "application/pdf", sizeBytes: 1 })
        .fileName,
    ).toBe("report.pdf");
    expect(() =>
      validateQuickCaptureFileInput({ fileName: "   ", mimeType: "image/png", sizeBytes: 1 }),
    ).toThrow(/fileName/);
  });

  it("accepts files up to exactly 100 MB and rejects anything larger", () => {
    expect(QUICK_CAPTURE_FILE_MAX_BYTES).toBe(100 * 1024 * 1024);
    expect(
      validateQuickCaptureFileInput({
        fileName: "big.zip",
        mimeType: "application/zip",
        sizeBytes: QUICK_CAPTURE_FILE_MAX_BYTES,
      }).sizeBytes,
    ).toBe(QUICK_CAPTURE_FILE_MAX_BYTES);
    expect(() =>
      validateQuickCaptureFileInput({
        fileName: "too-big.zip",
        mimeType: "application/zip",
        sizeBytes: QUICK_CAPTURE_FILE_MAX_BYTES + 1,
      }),
    ).toThrow(/too large/);
  });

  it("rejects negative and non-finite sizes", () => {
    expect(() =>
      validateQuickCaptureFileInput({ fileName: "a", mimeType: "text/plain", sizeBytes: -1 }),
    ).toThrow(/non-negative/);
    expect(() =>
      validateQuickCaptureFileInput({ fileName: "a", mimeType: "text/plain", sizeBytes: Number.NaN }),
    ).toThrow(/non-negative/);
  });
});

describe("parseBearerToken", () => {
  it("extracts the token from a Bearer header, trimming whitespace", () => {
    expect(parseBearerToken("Bearer skippy_abc123")).toBe("skippy_abc123");
    expect(parseBearerToken("  Bearer   skippy_abc123  ")).toBe("skippy_abc123");
  });

  it("accepts a case-insensitive scheme", () => {
    expect(parseBearerToken("bearer skippy_abc123")).toBe("skippy_abc123");
    expect(parseBearerToken("BEARER skippy_abc123")).toBe("skippy_abc123");
  });

  it("rejects missing headers, other schemes, and empty tokens", () => {
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken(undefined)).toBeNull();
    expect(parseBearerToken("")).toBeNull();
    expect(parseBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
    expect(parseBearerToken("Bearer")).toBeNull();
    expect(parseBearerToken("Bearer   ")).toBeNull();
  });
});

describe("normalizeQuickCaptureIntentInput", () => {
  it("defaults absent or empty values to remember", () => {
    expect(normalizeQuickCaptureIntentInput(undefined)).toBe("remember");
    expect(normalizeQuickCaptureIntentInput(null)).toBe("remember");
    expect(normalizeQuickCaptureIntentInput("")).toBe("remember");
  });

  it("passes through the two valid intents", () => {
    expect(normalizeQuickCaptureIntentInput("remember")).toBe("remember");
    expect(normalizeQuickCaptureIntentInput("hold")).toBe("hold");
  });

  it("returns null for anything unknown so callers can 400", () => {
    expect(normalizeQuickCaptureIntentInput("forget")).toBeNull();
    expect(normalizeQuickCaptureIntentInput("HOLD")).toBeNull();
    expect(normalizeQuickCaptureIntentInput(42)).toBeNull();
    expect(normalizeQuickCaptureIntentInput({})).toBeNull();
  });
});

describe("combineSharedCaptureText", () => {
  it("joins title and text on a newline, title first", () => {
    expect(combineSharedCaptureText("A headline", "Some body")).toBe("A headline\nSome body");
  });

  it("returns whichever part is present when the other is missing", () => {
    expect(combineSharedCaptureText("Only title", undefined)).toBe("Only title");
    expect(combineSharedCaptureText(null, "Only text")).toBe("Only text");
  });

  it("trims parts and drops whitespace-only ones", () => {
    expect(combineSharedCaptureText("  spaced  ", "   ")).toBe("spaced");
  });

  it("returns undefined when both parts are empty", () => {
    expect(combineSharedCaptureText(undefined, undefined)).toBeUndefined();
    expect(combineSharedCaptureText("  ", "")).toBeUndefined();
  });
});
