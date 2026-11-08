"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../lib/skippy-api";
import { useViewerReady } from "../hubs/use-viewer";
import { mindControlClass } from "./mind-classes";
import { type FeedRow } from "./mind-attention-model";

const actionClass = `${mindControlClass} rounded px-2 py-1 text-xs text-[var(--mind-accent)] hover:bg-[var(--mind-surface)] disabled:opacity-50`;
export function MindAttentionCard({ row, onClose }: { row: FeedRow; onClose: () => void }) {
  const ready = useViewerReady();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const done = useMutation(api.knowledge.markTaskDoneForViewer);
  const completeRecurring = useMutation(api.recurrences.completeRecurrenceForViewer);
  const task = (row.focus?.kind === "task" || row.agenda?.source === "task");
  const recurring = row.agenda?.source === "recurrence";
  const detail = useQuery(api.homeInventory.getForViewer, ready && recurring ? { kind: "recurrence", id: row.agenda!.id } : "skip");
  const pending = useRef(false);
  const requests = useRef<Record<string, string>>({});
  async function complete() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError("");
    try {
      if (recurring) {
        if (!detail) throw new Error("This occurrence is unavailable. Reopen it and try again.");
        const version = detail.row.occurrenceVersion ?? 0;
        const key = `${row.agenda!.id}:${version}`;
        await completeRecurring({ recurrenceId: row.agenda!.id as Id<"recurrences">, expectedOccurrenceVersion: version, requestId: requests.current[key] ??= crypto.randomUUID() });
      }
      else await done({ taskId: row.entityId as Id<"tasks"> });
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not complete item."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <>
    <p className="m-0 text-xs text-[var(--mind-muted)]">{recurring ? "Recurring" : row.agenda?.source === "event" ? "Event" : "Attention"}</p>
    <h2 className="my-3 font-serif text-[28px] font-normal leading-[1.35] tracking-[-0.025em] [overflow-wrap:anywhere]">{row.title}</h2>
    <p className="text-sm leading-relaxed text-[var(--mind-muted)]">{row.reason}</p>
    {row.agenda && <p className="text-sm text-[var(--mind-muted)]">{new Intl.DateTimeFormat(undefined, { dateStyle: "full", ...(row.agenda.isAllDay ? {} : { timeStyle: "short" as const }) }).format(row.agenda.at)}{row.agenda.isAllDay ? " · All day" : ""}</p>}
    {row.agenda?.location && <p className="text-sm">{row.agenda.location}</p>}
    {recurring && <p className="text-sm text-[var(--mind-muted)]">Marking this done records this occurrence and advances its next due date.</p>}
    {(task || recurring) && <button type="button" className={`${actionClass} mt-3 border border-[var(--mind-border)]`} disabled={busy || (recurring && !detail)} onClick={() => void complete()}>{busy ? "Saving…" : "✓ Done"}</button>}
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {row.agenda?.conferenceUrl && /^https?:\/\//.test(row.agenda.conferenceUrl) && <a className={`${actionClass} mt-3 inline-block`} href={row.agenda.conferenceUrl} target="_blank" rel="noreferrer">Join meeting ↗</a>}
    {row.agenda?.href && /^https?:\/\//.test(row.agenda.href) && <a className={`${actionClass} mt-3 inline-block`} href={row.agenda.href} target="_blank" rel="noreferrer">Open calendar event ↗</a>}

  </>;
}
