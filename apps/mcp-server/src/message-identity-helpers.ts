import { createHash } from "node:crypto";
import { z } from "zod";

// Process native connector output in memory only. No source reader or archive.
export const messageIdentitySchema = z.object({
  source: z.string().regex(/^imessage:[^\s]+$/),
  chatGuid: z.string().min(1),
  windowStart: z.number().int(),
  windowEnd: z.number().int(),
  senders: z.array(z.object({ local_ref: z.string(), handle: z.string().min(1) })).max(500),
  messages: z.array(z.object({
    date: z.string(), sender: z.string(), body: z.string().optional(),
    attachments: z.array(z.object({ id: z.string().min(1) })).optional(),
  })).max(500),
});

export function messageIdentities(input: z.infer<typeof messageIdentitySchema>) {
  if (input.windowStart >= input.windowEnd || input.windowEnd > Date.now()) {
    throw new Error("Invalid or future frozen window");
  }
  const senders = new Map<string, string>();
  for (const sender of input.senders) {
    if (senders.has(sender.local_ref) && senders.get(sender.local_ref) !== sender.handle) {
      throw new Error("Ambiguous sender reference");
    }
    senders.set(sender.local_ref, sender.handle);
  }
  const seen = new Set<string>();
  const items = input.messages.map((message, index) => {
    // Keep sub-millisecond precision in the hash; epoch ms is only provenance/window filtering.
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(message.date);
    const timestamp = Date.parse(message.date);
    if (!match || !Number.isFinite(timestamp)) throw new Error(`Invalid message date at index ${index}`);
    const date = new Date(Date.parse(match[1]! + match[3]!)).toISOString().slice(0, 19)
      + "." + (match[2] ?? "").padEnd(9, "0") + "Z";
    const sender = message.sender === "me" ? ["self"] : ["handle", senders.get(message.sender)];
    if (message.sender !== "me" && (!sender[1] || message.sender === "unknown")) {
      throw new Error(`Unresolved sender at index ${index}`);
    }
    const attachments = (message.attachments ?? []).map(a => a.id).sort();
    if (message.body === undefined && attachments.length === 0) throw new Error(`Missing content at index ${index}`);
    const canonical = JSON.stringify(["imessage-fingerprint-v1", input.source, input.chatGuid, sender, date, message.body ?? null, attachments]);
    const externalId = "imessage-fingerprint-v1:" + createHash("sha256").update(canonical).digest("hex");
    const ambiguous = seen.has(externalId);
    seen.add(externalId);
    return { index, externalId, sourceTimestamp: timestamp, sourceDate: date,
      inWindow: timestamp >= input.windowStart && timestamp < input.windowEnd, ambiguous };
  });
  return { identityKind: "derived_fingerprint", version: 1, items,
    complete: !items.some(item => item.ambiguous),
    limitation: "Not a provider message ID. Identical records cannot be distinguished; edits produce new fingerprints. Late sync beyond the overlap is not covered." };
}
