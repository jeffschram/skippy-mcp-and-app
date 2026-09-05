/**
 * Pure helpers for Brain › Contacts read cards.
 *
 * Phase 2 of the UI plan (docs/ui-audit/improvements/claude/ui-ux-improvement-plan.md,
 * Sep 2026) collapses each person/company into a read card: icon · name · one
 * clamped meta line, expanding inline to the full record on tap. Which fields
 * show (and how blank/whitespace values are skipped) is decided here so it can
 * be unit-tested without React/Convex.
 */

/** Loose record shape covering both `people` and `companies` rows. */
export type ContactRecord = {
  relationshipContext?: unknown;
  notes?: unknown;
  roleTitle?: unknown;
  relationshipLabel?: unknown;
  emails?: unknown;
  phoneNumbers?: unknown;
  addresses?: unknown;
  website?: unknown;
  domain?: unknown;
};

export type ContactDetailField = { label: string; value: string };

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function listValue(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((entry) => stringValue(entry))
    .filter(Boolean)
    .join(", ");
}

/**
 * The one-line meta for a collapsed contact card. Mirrors the historic
 * `relationshipContext ?? notes ?? domain ?? "Accepted"` fallback chain, but
 * skips blank/whitespace-only values instead of rendering an empty line.
 */
export function contactMetaLabel(item: ContactRecord): string {
  return (
    stringValue(item.relationshipContext) || stringValue(item.notes) || stringValue(item.domain) || "Accepted"
  );
}

/**
 * Every populated field on the record, in display order, for the expanded
 * card. Long-form context first, then identity/contact details. Blank strings
 * and empty arrays are omitted so the detail view never shows hollow rows.
 */
export function contactDetailFields(item: ContactRecord): ContactDetailField[] {
  const fields: ContactDetailField[] = [
    { label: "Context", value: stringValue(item.relationshipContext) },
    { label: "Notes", value: stringValue(item.notes) },
    { label: "Role", value: stringValue(item.roleTitle) },
    { label: "Relationship", value: stringValue(item.relationshipLabel) },
    { label: "Email", value: listValue(item.emails) },
    { label: "Phone", value: listValue(item.phoneNumbers) },
    { label: "Address", value: listValue(item.addresses) },
    { label: "Website", value: stringValue(item.website) },
    { label: "Domain", value: stringValue(item.domain) },
  ];
  return fields.filter((field) => field.value);
}
