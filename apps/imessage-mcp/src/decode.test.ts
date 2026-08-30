import { describe, expect, it } from "vitest";
import { decodeAttributedBody } from "./decode.js";

const encoder = new TextEncoder();

// Builds a blob shaped like the real archiver output: header + class chain
// (note "NSAttributedString" precedes "NSString", as in real blobs) + tag
// bytes + 0x2b marker + length + UTF-8 payload + trailing attribute noise.
export function makeTypedstream(text: string): Uint8Array {
  const utf8 = encoder.encode(text);
  const header = encoder.encode("\u0004\u000bstreamtyped");
  const classes = encoder.encode("NSAttributedString\u0000NSObject\u0000NSString");
  const tags = new Uint8Array([0x01, 0x94, 0x84, 0x01, 0x2b]);

  let lengthBytes: Uint8Array;
  if (utf8.length < 128) {
    lengthBytes = new Uint8Array([utf8.length]);
  } else if (utf8.length < 0x10000) {
    lengthBytes = new Uint8Array([0x81, utf8.length & 0xff, (utf8.length >> 8) & 0xff]);
  } else {
    lengthBytes = new Uint8Array([
      0x82,
      utf8.length & 0xff,
      (utf8.length >> 8) & 0xff,
      (utf8.length >> 16) & 0xff,
      (utf8.length >> 24) & 0xff,
    ]);
  }

  const trailer = new Uint8Array([0x86, 0x84, 0x02, 0x69, 0x49]);
  const out = new Uint8Array(
    header.length + classes.length + tags.length + lengthBytes.length + utf8.length + trailer.length,
  );
  let offset = 0;
  for (const part of [header, classes, tags, lengthBytes, utf8, trailer]) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe("decodeAttributedBody", () => {
  it("decodes a short string", () => {
    expect(decodeAttributedBody(makeTypedstream("Dinner at 7?"))).toBe("Dinner at 7?");
  });

  it("decodes multi-byte UTF-8 (emoji)", () => {
    expect(decodeAttributedBody(makeTypedstream("On my way 👋🚗"))).toBe("On my way 👋🚗");
  });

  it("decodes a long string with a two-byte length", () => {
    const long = "All work and no play makes Jack a dull boy. ".repeat(10); // 450 bytes
    expect(long.length).toBeGreaterThan(127);
    expect(decodeAttributedBody(makeTypedstream(long))).toBe(long);
  });

  it("is not confused by NSAttributedString preceding NSString", () => {
    // makeTypedstream already includes NSAttributedString; a targeted check
    // that the match anchors on the standalone class name.
    const decoded = decodeAttributedBody(makeTypedstream("anchor test"));
    expect(decoded).toBe("anchor test");
  });

  it("returns null for null/empty input", () => {
    expect(decodeAttributedBody(null)).toBeNull();
    expect(decodeAttributedBody(undefined)).toBeNull();
    expect(decodeAttributedBody(new Uint8Array(0))).toBeNull();
  });

  it("returns null for garbage without an NSString marker", () => {
    expect(decodeAttributedBody(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });

  it("returns null when the declared length overruns the blob", () => {
    const blob = makeTypedstream("hello");
    const truncated = blob.subarray(0, blob.length - 8); // cuts into the payload
    expect(decodeAttributedBody(truncated)).toBeNull();
  });
});
