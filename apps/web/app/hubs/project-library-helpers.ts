import {
  PROJECT_FILE_ALLOWED_MIME_PATTERNS,
  PROJECT_FILE_MAX_BYTES,
  isAllowedProjectFileMimeType,
  validateProjectFileInput,
  type ProjectFileInput,
} from "@skippy/shared";

/* ------------------------------------------------------------------ */
/* Pure helpers for the Project Library: file-size formatting, icon    */
/* selection by MIME type, and a non-throwing wrapper around the       */
/* shared upload validation so rejections surface inline in the UI.    */
/* ------------------------------------------------------------------ */

export { PROJECT_FILE_MAX_BYTES, isAllowedProjectFileMimeType };

/**
 * `accept` attribute for the file input, derived from the shared allowlist so
 * phone photo pickers / cameras stay usable (image/* is on the list). This is
 * a soft hint only — the real gate is checkProjectFile + server validation.
 */
export const PROJECT_FILE_ACCEPT = PROJECT_FILE_ALLOWED_MIME_PATTERNS.join(",");

export type IconKind = "image" | "text" | "spreadsheet" | "generic";

const SPREADSHEET_MIME_TYPES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.oasis.opendocument.spreadsheet",
]);

const TEXTLIKE_MIME_TYPES = new Set([
  "application/pdf",
  "application/json",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.presentation",
]);

/** Which lucide icon family a file row should show for a given MIME type. */
export function iconKindForMimeType(mimeType: string): IconKind {
  const normalized = mimeType.trim().toLowerCase().split(";")[0]!.trim();
  if (normalized.startsWith("image/")) return "image";
  if (SPREADSHEET_MIME_TYPES.has(normalized)) return "spreadsheet";
  if (normalized.startsWith("text/") || TEXTLIKE_MIME_TYPES.has(normalized)) return "text";
  return "generic";
}

/** Human-readable file size: 512 B, 1.5 KB, 25 MB, 1.2 GB. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded =
    value >= 10 ? String(Math.round(value)) : (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, "");
  return `${rounded} ${units[unitIndex]}`;
}

/** 'Jul 5, 2026' — UTC to match the backend's date math conventions. */
export function formatUploadDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export type ProjectFileCheck =
  | { ok: true; fileName: string; mimeType: string; sizeBytes: number }
  | { ok: false; reason: string };

/**
 * Client pre-check wrapper around the shared validateProjectFileInput: same
 * rules as the server (name, 25 MB cap, MIME allowlist) but returns a result
 * object instead of throwing, so rejections can render inline per file.
 */
export function checkProjectFile(input: ProjectFileInput): ProjectFileCheck {
  try {
    return { ok: true, ...validateProjectFileInput(input) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "file rejected" };
  }
}
