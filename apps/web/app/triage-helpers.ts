/**
 * Pure helpers for Review › Finds triage cards.
 *
 * Phase 2 of the UI plan (docs/ui-audit/improvements/claude/ui-ux-improvement-plan.md,
 * Sep 2026) collapses every triage item into a read card: icon · title · one
 * meta line · Accept / Edit… / Dismiss. The meta line is the only context the
 * collapsed card gives the owner, so its formatting lives here where it can be
 * unit-tested without React/Convex.
 */

/**
 * "task signal · 82% confident" — the one-line meta for a collapsed triage
 * card. Confidence is stored as a 0–1 float; anything non-numeric (or a bare 0,
 * which upstream never emits for real signals) is omitted rather than rendered
 * as a misleading "0% confident".
 */
export function triageMetaLabel(item: { candidateEntityType?: unknown; confidence?: unknown }): string {
  const type =
    typeof item.candidateEntityType === "string" && item.candidateEntityType.trim()
      ? item.candidateEntityType.trim()
      : "unclassified";
  const confidence =
    typeof item.confidence === "number" && Number.isFinite(item.confidence) && item.confidence > 0
      ? ` · ${Math.round(item.confidence * 100)}% confident`
      : "";
  return `${type} signal${confidence}`;
}
