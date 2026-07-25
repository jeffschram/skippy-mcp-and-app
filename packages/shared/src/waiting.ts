/* ------------------------------------------------------------------ */
/* Waiting-on ledger                                                   */
/*                                                                     */
/* "I asked Dan for the quote nine days ago and heard nothing" is the   */
/* highest-leverage thing a second brain produces. The catch is that a  */
/* waiting list the owner has to groom is worse than nothing — it just  */
/* becomes another stale queue. So entries clear themselves when a      */
/* reply lands.                                                        */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;

/**
 * Reduces a phone number to comparable digits.
 *
 * A raw string compare misses everything that matters: "+15551234567",
 * "(555) 123-4567" and "555-123-4567" are the same person, and inbound
 * messages rarely arrive in the format the contact was saved in.
 *
 * North American numbers are normalized to 10 digits by dropping a leading
 * country code, so a saved "+1" number matches a bare one.
 */
export function normalizePhoneNumber(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;

  const digits = raw.replace(/\D+/g, "");
  if (digits.length < 7) return undefined;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function normalizeEmail(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed.includes("@")) return undefined;
  // Inbound senders often arrive as `Dan Smith <dan@example.com>`.
  const angled = /<([^>]+)>/.exec(trimmed);
  const address = (angled?.[1] ?? trimmed).trim();
  return address.includes("@") ? address : undefined;
}

export type PersonLike = {
  _id: string;
  emails?: string[] | undefined;
  phoneNumbers?: string[] | undefined;
};

/** Every comparable identifier for a person, as a lookup set. */
export function personIdentifiers(person: PersonLike): Set<string> {
  const identifiers = new Set<string>();

  for (const email of person.emails ?? []) {
    const normalized = normalizeEmail(email);
    if (normalized) identifiers.add(`email:${normalized}`);
  }
  for (const phone of person.phoneNumbers ?? []) {
    const normalized = normalizePhoneNumber(phone);
    if (normalized) identifiers.add(`phone:${normalized}`);
  }

  return identifiers;
}

/** Normalizes a raw sender handle to the same key space as personIdentifiers. */
export function senderKey(raw: unknown): string | undefined {
  const email = normalizeEmail(raw);
  if (email) return `email:${email}`;
  const phone = normalizePhoneNumber(raw);
  if (phone) return `phone:${phone}`;
  return undefined;
}

export function personMatchesSender(person: PersonLike, sender: unknown): boolean {
  const key = senderKey(sender);
  if (!key) return false;
  return personIdentifiers(person).has(key);
}

export type WaitingTaskLike = {
  _id: string;
  status: string;
  waitingOn?: { entityType: string; entityId: string } | undefined;
  waitingSince?: number | undefined;
  lastNudgedAt?: number | undefined;
};

export type InboundMessage = {
  sender: string;
  receivedAt: number;
  sourceSystem?: string | undefined;
  excerpt?: string | undefined;
};

export type WaitingResolution = {
  taskId: string;
  personId: string;
  message: InboundMessage;
};

/**
 * Finds waiting tasks whose blocking person has since replied.
 *
 * Only messages that arrived *after* the task started waiting count — an older
 * message in the same thread is not a reply to a question asked later.
 *
 * Deliberately does not decide that the task is complete. The reply may not
 * contain what was needed, so the caller moves the task back into the normal
 * lane with a note rather than closing it.
 */
export function resolveWaitingReplies(
  tasks: WaitingTaskLike[],
  people: PersonLike[],
  messages: InboundMessage[],
): WaitingResolution[] {
  const identifiersByPerson = new Map<string, Set<string>>();
  for (const person of people) {
    identifiersByPerson.set(person._id, personIdentifiers(person));
  }

  const resolutions: WaitingResolution[] = [];

  for (const task of tasks) {
    if (task.status !== "waiting") continue;
    if (!task.waitingOn || task.waitingOn.entityType !== "person") continue;

    const identifiers = identifiersByPerson.get(task.waitingOn.entityId);
    if (!identifiers || identifiers.size === 0) continue;

    const since = task.waitingSince ?? 0;
    let earliest: InboundMessage | undefined;

    for (const message of messages) {
      if (message.receivedAt <= since) continue;
      const key = senderKey(message.sender);
      if (!key || !identifiers.has(key)) continue;
      if (!earliest || message.receivedAt < earliest.receivedAt) earliest = message;
    }

    if (earliest) {
      resolutions.push({
        taskId: task._id,
        personId: task.waitingOn.entityId,
        message: earliest,
      });
    }
  }

  return resolutions;
}

/**
 * Sort key for the waiting list: oldest unanswered thing first, because that is
 * the one most likely to need a nudge.
 *
 * Once nudged, an entry sorts by how long since the nudge instead — you are no
 * longer waiting on your original ask, you are waiting on the follow-up.
 */
export function waitingSortKey(task: WaitingTaskLike): number {
  return task.lastNudgedAt ?? task.waitingSince ?? 0;
}

export function sortWaitingTasks<T extends WaitingTaskLike>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => waitingSortKey(a) - waitingSortKey(b));
}

/** Whole days an item has been outstanding, measured from the last nudge if any. */
export function waitingAgeDays(task: WaitingTaskLike, now: number): number | undefined {
  const since = waitingSortKey(task);
  if (!since) return undefined;
  return Math.max(0, Math.floor((now - since) / DAY_MS));
}
