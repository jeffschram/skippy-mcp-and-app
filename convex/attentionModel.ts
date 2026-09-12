/** Shared attention semantics for every canonical entity. No browser or database dependencies. */
export const ATTENTION = {
  immediate: { label: "Needs immediate attention", color: "#C7472C", rank: 0 },
  todo: { label: "To do", color: "#C99724", rank: 2 },
  scheduled: { label: "Scheduled", color: "#417BA0", rank: 3 },
  ok: { label: "Everything OK", color: "#6F8A72", rank: 4 },
  stale: { label: "Needs review", color: "#88769C", rank: 1 },
  unassessed: { label: "Not assessed", color: "#C2B9A6", rank: 5 },
} as const;
export type AttentionStatus = keyof typeof ATTENTION;
export type AttentionKind = "goal" | "project" | "task" | "person" | "company" | "note" | "link" | "knowledgeObject" | "memory";
export type AttentionMetadata = {
  override?: AttentionStatus;
  reason?: string;
  reviewAt?: number;
  scheduledAt?: number;
  assessedAt?: number;
};
export type AttentionRecord = {
  status?: string;
  processingState?: string;
  reviewState?: string;
  dueAt?: number;
  commitment?: string;
  executionState?: string;
  attention?: AttentionMetadata;
};
export type AttentionResult = { status: AttentionStatus; reason: string; source: "manual" | "automatic"; at?: number };
export const isAttentionArchived = (row: AttentionRecord) => row.status === "archived" || row.processingState === "archived" || row.reviewState === "archived" || row.status === "discarded";

export function resolveAttention(kind: AttentionKind, row: AttentionRecord, now: number): AttentionResult {
  const meta = row.attention;
  const override = meta?.override;
  const result = (status: AttentionStatus, reason: string, at?: number): AttentionResult => ({ status, reason, source: "automatic", ...(at === undefined ? {} : { at }) });
  const manual = (): AttentionResult => ({ status: override!, reason: meta?.reason || "Set by you", source: "manual" });
  if (override === "immediate") return manual();
  if (meta?.reviewAt !== undefined && meta.reviewAt <= now) return result("stale", "Your review date has arrived", meta.reviewAt);
  if (override && override !== "scheduled") return manual();
  if (kind === "task" && ["done", "cancelled"].includes(row.status || "")) return result("ok", row.status === "done" ? "Task completed" : "Task cancelled");
  if (kind === "project" && ["completed", "cancelled"].includes(row.status || "")) return result("ok", "Project closed");
  if (kind === "goal" && ["achieved", "abandoned"].includes(row.status || "")) return result("ok", "Goal closed");
  if (kind === "task" && row.commitment !== "want" && row.dueAt !== undefined && row.dueAt <= now) return result("immediate", "Task deadline has passed", row.dueAt);
  if (kind === "task" && row.executionState === "blocked") return result("immediate", "Task is blocked and needs a decision");
  if (meta?.scheduledAt !== undefined) {
    return meta.scheduledAt > now
      ? result("scheduled", "A time is reserved", meta.scheduledAt)
      : result("stale", "Scheduled time has passed; check the outcome", meta.scheduledAt);
  }
  if (kind === "task" && ["todo", "in_progress", "waiting"].includes(row.status || "")) return result("todo", row.status === "waiting" ? "Waiting for a follow-up or outcome" : "Task is open");
  return result("unassessed", "No attention assessment yet");
}

export function attentionHref(kind: AttentionKind, id: string): string {
  const escaped = encodeURIComponent(id);
  return kind === "project" ? `/projects/${escaped}` : kind === "task" ? `/tasks#task-${escaped}` : kind === "memory" ? `/memory/${escaped}` : kind === "goal" ? `/brain/goals#goal-${escaped}` : kind === "person" || kind === "company" ? "/brain/contacts" : "/brain/library";
}


/** Only stored web links are actionable; never expose executable URL schemes. */
export function taskSourceLinks(source: { sourceSystem: string; url?: string; deepLink?: string; threadId?: string; messageId?: string }): { label: string; href: string }[] {
  const links: { label: string; href: string }[] = [];
  for (const value of [source.deepLink, source.url]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
      if (links.some(link => link.href === url.href)) continue;
      links.push({ label: url.hostname === "mail.google.com" ? "Open source email" : `Open source · ${url.hostname}`, href: url.href });
    } catch { /* Ignore malformed stored URLs. */ }
  }
  if (!links.length && /^(gmail|google_mail|google-mail)$/i.test(source.sourceSystem)) {
    const message = source.threadId || source.messageId;
    if (message && /^[a-f0-9]{12,32}$/i.test(message)) links.push({ label: "Open source email", href: `https://mail.google.com/mail/u/0/#all/${message}` });
  }
  return links;
}

/** Completing a task resolves its attention override and outstanding review/schedule. */
export function completedTaskAttention(previous: AttentionMetadata | undefined, now: number): AttentionMetadata {
  return { ...(previous?.reason ? { reason: previous.reason } : {}), assessedAt: now };
}
