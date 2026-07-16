import {
  validateQuickCaptureFileInput,
  type ProjectFileInput,
  type QuickCaptureIntent,
} from "@skippy/shared";

/* ------------------------------------------------------------------ */
/* Pure helpers for the Quick Capture box: the non-throwing wrapper    */
/* around the shared file validation (all MIME types, 100 MB cap) and  */
/* the per-device sticky intent stored in localStorage.                */
/* ------------------------------------------------------------------ */

/** localStorage key for the per-device sticky Remember | Hold intent. */
export const QUICK_CAPTURE_INTENT_STORAGE_KEY = "skippy.quickCapture.intent";

/** Parse a stored intent value; anything unexpected falls back to remember. */
export function parseStoredIntent(value: string | null | undefined): QuickCaptureIntent {
  return value === "hold" ? "hold" : "remember";
}

export type QuickCaptureFileCheck =
  | { ok: true; fileName: string; mimeType: string; sizeBytes: number }
  | { ok: false; reason: string };

/**
 * Client pre-check wrapper around the shared validateQuickCaptureFileInput:
 * same rules as the server (non-empty name, 100 MB cap, ANY MIME type — the
 * inbox doubles as a personal transfer channel) but returns a result object
 * instead of throwing, so rejections surface as toasts.
 */
export function checkQuickCaptureFile(input: ProjectFileInput): QuickCaptureFileCheck {
  try {
    return { ok: true, ...validateQuickCaptureFileInput(input) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "file rejected" };
  }
}
