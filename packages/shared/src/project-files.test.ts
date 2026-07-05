import { describe, expect, it } from "vitest";
import {
  PROJECT_FILE_MAX_BYTES,
  isAllowedProjectFileMimeType,
  validateProjectFileInput,
} from "./index";

describe("isAllowedProjectFileMimeType", () => {
  it("allows every image type", () => {
    expect(isAllowedProjectFileMimeType("image/png")).toBe(true);
    expect(isAllowedProjectFileMimeType("image/jpeg")).toBe(true);
    expect(isAllowedProjectFileMimeType("image/svg+xml")).toBe(true);
  });

  it("allows text types including plain, markdown, and csv", () => {
    expect(isAllowedProjectFileMimeType("text/plain")).toBe(true);
    expect(isAllowedProjectFileMimeType("text/markdown")).toBe(true);
    expect(isAllowedProjectFileMimeType("text/csv")).toBe(true);
  });

  it("allows pdf, json, and application/csv", () => {
    expect(isAllowedProjectFileMimeType("application/pdf")).toBe(true);
    expect(isAllowedProjectFileMimeType("application/json")).toBe(true);
    expect(isAllowedProjectFileMimeType("application/csv")).toBe(true);
  });

  it("allows common office document types", () => {
    expect(isAllowedProjectFileMimeType("application/msword")).toBe(true);
    expect(
      isAllowedProjectFileMimeType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
    expect(
      isAllowedProjectFileMimeType(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe(true);
    expect(
      isAllowedProjectFileMimeType(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ).toBe(true);
    expect(isAllowedProjectFileMimeType("application/vnd.oasis.opendocument.text")).toBe(true);
    expect(isAllowedProjectFileMimeType("application/vnd.oasis.opendocument.spreadsheet")).toBe(true);
  });

  it("rejects executables and arbitrary binaries", () => {
    expect(isAllowedProjectFileMimeType("application/octet-stream")).toBe(false);
    expect(isAllowedProjectFileMimeType("application/x-msdownload")).toBe(false);
    expect(isAllowedProjectFileMimeType("application/x-executable")).toBe(false);
    expect(isAllowedProjectFileMimeType("application/x-sh")).toBe(false);
    expect(isAllowedProjectFileMimeType("application/zip")).toBe(false);
    expect(isAllowedProjectFileMimeType("video/mp4")).toBe(false);
  });

  it("is case-insensitive and ignores parameters", () => {
    expect(isAllowedProjectFileMimeType("Image/PNG")).toBe(true);
    expect(isAllowedProjectFileMimeType("text/plain; charset=utf-8")).toBe(true);
  });

  it("rejects empty and malformed values", () => {
    expect(isAllowedProjectFileMimeType("")).toBe(false);
    expect(isAllowedProjectFileMimeType("   ")).toBe(false);
    expect(isAllowedProjectFileMimeType("imagepng")).toBe(false);
  });
});

describe("validateProjectFileInput", () => {
  const valid = { fileName: "report.pdf", mimeType: "application/pdf", sizeBytes: 1024 };

  it("returns normalized fields for a valid file", () => {
    expect(
      validateProjectFileInput({
        fileName: "  report.pdf  ",
        mimeType: "Application/PDF; charset=binary",
        sizeBytes: 1024,
      }),
    ).toEqual(valid);
  });

  it("accepts a file exactly at the size cap", () => {
    expect(
      validateProjectFileInput({ ...valid, sizeBytes: PROJECT_FILE_MAX_BYTES }).sizeBytes,
    ).toBe(PROJECT_FILE_MAX_BYTES);
  });

  it("rejects a file one byte over the size cap with a clear message", () => {
    expect(() =>
      validateProjectFileInput({ ...valid, sizeBytes: PROJECT_FILE_MAX_BYTES + 1 }),
    ).toThrow(/too large/);
    expect(() =>
      validateProjectFileInput({ ...valid, sizeBytes: PROJECT_FILE_MAX_BYTES + 1 }),
    ).toThrow(/25 MB/);
  });

  it("rejects negative and non-finite sizes", () => {
    expect(() => validateProjectFileInput({ ...valid, sizeBytes: -1 })).toThrow(
      /sizeBytes must be a non-negative number/,
    );
    expect(() => validateProjectFileInput({ ...valid, sizeBytes: Number.NaN })).toThrow(
      /sizeBytes must be a non-negative number/,
    );
  });

  it("rejects an empty fileName", () => {
    expect(() => validateProjectFileInput({ ...valid, fileName: "" })).toThrow(
      /fileName cannot be empty/,
    );
    expect(() => validateProjectFileInput({ ...valid, fileName: "   " })).toThrow(
      /fileName cannot be empty/,
    );
  });

  it("rejects an empty mimeType", () => {
    expect(() => validateProjectFileInput({ ...valid, mimeType: "  " })).toThrow(
      /mimeType cannot be empty/,
    );
  });

  it("rejects disallowed types with an explicit executables/binaries message", () => {
    expect(() =>
      validateProjectFileInput({ ...valid, mimeType: "application/octet-stream" }),
    ).toThrow(/not allowed in the project library/);
    expect(() =>
      validateProjectFileInput({ ...valid, mimeType: "application/x-msdownload" }),
    ).toThrow(/Executables and arbitrary binaries are rejected/);
  });
});
