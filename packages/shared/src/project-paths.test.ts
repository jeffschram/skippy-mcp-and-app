import { describe, expect, it } from "vitest";
import { effectiveProjectPaths, isValidFolderPathFormat, normalizeFolderPathInput } from "./index";

describe("isValidFolderPathFormat", () => {
  it("accepts POSIX absolute paths", () => {
    expect(isValidFolderPathFormat("/Users/pat/projects/thing")).toBe(true);
    expect(isValidFolderPathFormat("/")).toBe(true);
  });

  it("accepts home-relative paths", () => {
    expect(isValidFolderPathFormat("~/projects/thing")).toBe(true);
    expect(isValidFolderPathFormat("~")).toBe(true);
  });

  it("accepts Windows drive-letter paths", () => {
    expect(isValidFolderPathFormat("C:\\projects\\thing")).toBe(true);
    expect(isValidFolderPathFormat("d:/projects/thing")).toBe(true);
  });

  it("rejects relative and malformed paths", () => {
    expect(isValidFolderPathFormat("projects/thing")).toBe(false);
    expect(isValidFolderPathFormat("./thing")).toBe(false);
    expect(isValidFolderPathFormat("C:thing")).toBe(false);
    expect(isValidFolderPathFormat("file.txt")).toBe(false);
  });
});

describe("normalizeFolderPathInput", () => {
  it("returns undefined for empty input (clears the override)", () => {
    expect(normalizeFolderPathInput("")).toBeUndefined();
    expect(normalizeFolderPathInput("   ")).toBeUndefined();
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeFolderPathInput("  /Users/pat/assets  ")).toBe("/Users/pat/assets");
  });

  it("strips trailing slashes", () => {
    expect(normalizeFolderPathInput("/Users/pat/assets/")).toBe("/Users/pat/assets");
    expect(normalizeFolderPathInput("/Users/pat/assets///")).toBe("/Users/pat/assets");
    expect(normalizeFolderPathInput("C:\\projects\\thing\\")).toBe("C:\\projects\\thing");
  });

  it("keeps a bare root path intact instead of stripping it to empty", () => {
    expect(normalizeFolderPathInput("/")).toBe("/");
  });

  it("throws for non-absolute paths", () => {
    expect(() => normalizeFolderPathInput("projects/thing")).toThrow(/absolute path/);
    expect(() => normalizeFolderPathInput("relative", "assets folder")).toThrow(/assets folder/);
  });
});

describe("effectiveProjectPaths", () => {
  it("derives _library and _output from localPath when no overrides are set", () => {
    expect(effectiveProjectPaths({ localPath: "/Users/pat/projects/thing" })).toEqual({
      effectiveAssetsPath: "/Users/pat/projects/thing/_library",
      effectiveOutputPath: "/Users/pat/projects/thing/_output",
    });
  });

  it("prefers explicit overrides over derived defaults", () => {
    expect(
      effectiveProjectPaths({
        localPath: "/Users/pat/projects/thing",
        assetsFolderPath: "/Volumes/inputs",
        outputFolderPath: "/Volumes/artifacts",
      }),
    ).toEqual({
      effectiveAssetsPath: "/Volumes/inputs",
      effectiveOutputPath: "/Volumes/artifacts",
    });
  });

  it("mixes an override with a derived default", () => {
    expect(
      effectiveProjectPaths({ localPath: "/Users/pat/thing", assetsFolderPath: "/Volumes/inputs" }),
    ).toEqual({
      effectiveAssetsPath: "/Volumes/inputs",
      effectiveOutputPath: "/Users/pat/thing/_output",
    });
  });

  it("returns undefined effective paths when localPath is unset and no overrides exist", () => {
    expect(effectiveProjectPaths({})).toEqual({
      effectiveAssetsPath: undefined,
      effectiveOutputPath: undefined,
    });
  });

  it("honors overrides even without a localPath", () => {
    expect(effectiveProjectPaths({ outputFolderPath: "/Volumes/artifacts" })).toEqual({
      effectiveAssetsPath: undefined,
      effectiveOutputPath: "/Volumes/artifacts",
    });
  });

  it("tracks localPath edits because derivation happens at read time", () => {
    const before = effectiveProjectPaths({ localPath: "/old/spot" });
    const after = effectiveProjectPaths({ localPath: "/new/spot" });
    expect(before.effectiveAssetsPath).toBe("/old/spot/_library");
    expect(after.effectiveAssetsPath).toBe("/new/spot/_library");
    expect(after.effectiveOutputPath).toBe("/new/spot/_output");
  });
});
