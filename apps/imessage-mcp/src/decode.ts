// Extracts plain text from the `attributedBody` typedstream blob in chat.db.
//
// Since ~macOS Ventura, Messages leaves message.text NULL for many rows and
// stores the content only as an NSKeyedArchiver "typedstream" of an
// NSAttributedString. Full typedstream parsing is a large undertaking; every
// practical iMessage reader instead uses the same heuristic: locate the
// embedded `NSString` class name, skip the archiver tag bytes up to the `+`
// (0x2b) marker that introduces the string payload, read the length, and
// decode the UTF-8 bytes. We return null rather than throw on anything
// unexpected — callers treat null as "no text" (e.g. attachment-only rows).

const NSSTRING = new TextEncoder().encode("NSString");

// How far past "NSString" we scan for the 0x2b payload marker. The archiver
// emits 3–5 tag bytes here depending on OS version; 12 is a safe window that
// cannot reach into the payload of any non-empty string.
const MARKER_SCAN_WINDOW = 12;

function indexOfSequence(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

export function decodeAttributedBody(blob: Uint8Array | null | undefined): string | null {
  if (!blob || blob.length === 0) {
    return null;
  }

  // Note: "NSAttributedString" appears earlier in the blob but does not
  // contain the byte sequence "NSString", so this match is unambiguous.
  const classIndex = indexOfSequence(blob, NSSTRING);
  if (classIndex === -1) {
    return null;
  }

  const scanStart = classIndex + NSSTRING.length;
  const scanEnd = Math.min(blob.length, scanStart + MARKER_SCAN_WINDOW);
  let plusIndex = -1;
  for (let i = scanStart; i < scanEnd; i++) {
    if (blob[i] === 0x2b) {
      plusIndex = i;
      break;
    }
  }
  if (plusIndex === -1) {
    return null;
  }

  let cursor = plusIndex + 1;
  const lengthTag = blob[cursor];
  if (lengthTag === undefined) {
    return null;
  }

  let length: number;
  if (lengthTag === 0x81) {
    // Two-byte little-endian length (strings 128..65535 bytes).
    const lo = blob[cursor + 1];
    const hi = blob[cursor + 2];
    if (lo === undefined || hi === undefined) {
      return null;
    }
    length = lo | (hi << 8);
    cursor += 3;
  } else if (lengthTag === 0x82) {
    // Four-byte little-endian length (very long strings).
    const b0 = blob[cursor + 1];
    const b1 = blob[cursor + 2];
    const b2 = blob[cursor + 3];
    const b3 = blob[cursor + 4];
    if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
      return null;
    }
    length = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    cursor += 5;
  } else {
    // Single-byte length (strings < 128 bytes).
    length = lengthTag;
    cursor += 1;
  }

  if (length <= 0 || cursor + length > blob.length) {
    return null;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(blob.subarray(cursor, cursor + length));
  } catch {
    return null;
  }
}
