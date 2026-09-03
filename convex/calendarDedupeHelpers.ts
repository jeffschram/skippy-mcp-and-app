/**
 * Duplicate detection for staged calendar proposals (2026-09-03).
 *
 * draftCalendarEvent's externalId guard only catches Skippy re-staging the
 * SAME minted id; a fresh proposal for the same real-world event mints a new
 * id every time. With nothing comparing content, the hourly agenda pass filed
 * 24 duplicate pending actions — one event proposed 15 times — and the owner
 * had to reject them one by one.
 *
 * This is deliberately narrower than the fuzzy triage dedupe (which the
 * calendar module bypasses on purpose — title similarity would collapse a
 * weekly 1:1 into one row). A duplicate here requires ALL of: same calendar,
 * colliding time window, and similar summary. Two different meetings at the
 * same hour differ in summary; the same meeting proposed twice differs in
 * nothing.
 *
 * Pure helpers, extracted so the similarity rules are testable without a
 * Convex ctx (same pattern as chatLeaseHelpers.ts).
 */

/** One staged calendar_event_create proposal, decoded from its action body. */
export type PendingCalendarProposal = {
  /** pendingActions _id, carried through so callers can point at the winner. */
  id: string;
  calendarId: string;
  summary: string;
  /** Epoch ms. */
  start: number;
  /** Epoch ms. */
  end: number;
  /** Insertion time; the sweep keeps the newest of a duplicate group. */
  createdAt: number;
};

/** Lowercase, punctuation → spaces, whitespace collapsed. "Dinner w/ Sam!"
 * and "dinner w sam" normalize identically. */
export function normalizeCalendarSummary(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Minimum shared-token fraction (of the SMALLER token set) for two summaries
 * to count as the same event. 0.6 lets "JetBlue 1023 JFK LAX" match
 * "JetBlue flight 1023" while "Dentist" vs "Team standup" shares nothing.
 */
const TOKEN_OVERLAP_THRESHOLD = 0.6;

export function calendarSummariesSimilar(a: string, b: string): boolean {
  const na = normalizeCalendarSummary(a);
  const nb = normalizeCalendarSummary(b);
  if (na.length === 0 || nb.length === 0) return na === nb;
  if (na === nb) return true;
  // Containment: "Jury duty" duplicates "Jury duty (report by 8am)".
  if (na.includes(nb) || nb.includes(na)) return true;
  const tokensA = new Set(na.split(" "));
  const tokensB = new Set(nb.split(" "));
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared += 1;
  return shared / Math.min(tokensA.size, tokensB.size) >= TOKEN_OVERLAP_THRESHOLD;
}

/** Exact same start, or half-open window overlap. Exact-start is listed
 * separately so two zero-length proposals at the same instant still collide. */
export function calendarWindowsCollide(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  if (a.start === b.start) return true;
  return a.start < b.end && b.start < a.end;
}

/**
 * The duplicate rule: same calendar target AND colliding window AND similar
 * summary. All three, always — see the module comment for why partial matches
 * must not count.
 */
export function isDuplicateCalendarProposal(
  a: Pick<PendingCalendarProposal, "calendarId" | "summary" | "start" | "end">,
  b: Pick<PendingCalendarProposal, "calendarId" | "summary" | "start" | "end">,
): boolean {
  if (a.calendarId !== b.calendarId) return false;
  if (!calendarWindowsCollide(a, b)) return false;
  return calendarSummariesSimilar(a.summary, b.summary);
}

/**
 * First still-pending proposal the candidate duplicates, newest first — the
 * id draftCalendarEvent hands back so the caller can find the original on
 * /review instead of filing another copy.
 */
export function findDuplicatePendingProposal(
  candidate: Pick<PendingCalendarProposal, "calendarId" | "summary" | "start" | "end">,
  existing: PendingCalendarProposal[],
): PendingCalendarProposal | null {
  const newestFirst = [...existing].sort((a, b) => b.createdAt - a.createdAt);
  return newestFirst.find((row) => isDuplicateCalendarProposal(candidate, row)) ?? null;
}

/**
 * Groups already-staged proposals for the one-off sweep: newest-first greedy
 * clustering, keep the newest of each group, sweep the rest. Only groups that
 * actually have something to sweep are returned.
 *
 * Greedy against the group KEEPER (not any member) so similarity cannot chain
 * transitively across a day of back-to-back meetings.
 */
export function groupDuplicatePendingCalendarActions(
  proposals: PendingCalendarProposal[],
): Array<{ keep: PendingCalendarProposal; sweep: PendingCalendarProposal[] }> {
  const newestFirst = [...proposals].sort((a, b) => b.createdAt - a.createdAt);
  const groups: Array<{ keep: PendingCalendarProposal; sweep: PendingCalendarProposal[] }> = [];
  for (const proposal of newestFirst) {
    const home = groups.find((group) => isDuplicateCalendarProposal(proposal, group.keep));
    if (home) {
      home.sweep.push(proposal);
    } else {
      groups.push({ keep: proposal, sweep: [] });
    }
  }
  return groups.filter((group) => group.sweep.length > 0);
}
