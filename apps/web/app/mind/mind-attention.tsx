"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ChevronRight, CalendarDays, Inbox, CircleAlert } from "lucide-react";
import type { AgendaItem } from "@skippy/shared";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../lib/skippy-api";
import { useViewerReady } from "../hubs/use-viewer";
import { useAttentionClock, useAttentionRefresh } from "../components/attention";
import { MindCategoryIcon } from "./mind-category-icon";
import { mindControlClass } from "./mind-classes";
import { mindAttentionRows, todayRange, type FeedRow, type ReviewItem } from "./mind-attention-model";
import type { MindGraph } from "../../../../convex/mindGraphHelpers";

const ReviewDetail = dynamic(() => import("../live-pages").then(module => module.MindReviewDetail), { loading: () => <p role="status">Loading review…</p> });
const actionClass = `${mindControlClass} rounded px-2 py-1 text-xs text-[var(--mind-accent)] hover:bg-[var(--mind-surface)] disabled:opacity-50`;
const groups = [{ id: "needs", title: "Needs you" }, { id: "today", title: "Today" }, { id: "review", title: "To review" }, { id: "next", title: "Next up" }] as const;

function AttentionIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--mind-accent)]" aria-hidden="true">
    <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" fill="currentColor" fillOpacity=".12" /><circle cx="12" cy="12" r="3.5" fill="currentColor" fillOpacity=".2" /><path d="M12 10.5a1.5 1.5 0 1 1-1.5 1.5" strokeWidth="2" /><path d="M12 1.5v1.5M5 3.5l1 1M19 3.5l-1 1" opacity=".7" />
  </svg>;
}

export function MindAttentionCard({ row, onClose }: { row: FeedRow; onClose: () => void }) {
  const ready = useViewerReady();
  const approvals = useQuery(api.knowledge.pendingActionsForViewer, ready && row.reviews?.some(r => r.type === "approval") ? { scope: "open" } : "skip");
  const triage = useQuery(api.knowledge.triageForViewer, ready && row.reviews?.some(r => r.type === "triage") ? {} : "skip");
  const memories = useQuery(api.knowledge.listMemoryInboxForViewer, ready && row.reviews?.some(r => r.type === "memory") ? { limit: 50 } : "skip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const done = useMutation(api.knowledge.markTaskDoneForViewer);
  const completeRecurring = useMutation(api.recurrences.completeRecurrenceForViewer);
  const task = !row.review && (row.focus?.kind === "task" || row.agenda?.source === "task");
  const recurring = !row.review && row.agenda?.source === "recurrence";
  async function complete() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (recurring) await completeRecurring({ recurrenceId: row.agenda!.id as Id<"recurrences"> });
      else await done({ taskId: row.entityId as Id<"tasks"> });
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not complete item."); }
    finally { setBusy(false); }
  }
  return <>
    <p className="m-0 text-xs text-[var(--mind-muted)]">{row.review ? "Review" : recurring ? "Recurring" : row.agenda?.source === "event" ? "Event" : "Attention"}</p>
    <h2 className="my-3 font-serif text-[28px] font-normal leading-[1.35] tracking-[-0.025em] [overflow-wrap:anywhere]">{row.title}</h2>
    <p className="text-sm leading-relaxed text-[var(--mind-muted)]">{row.reason}</p>
    {row.agenda && <p className="text-sm text-[var(--mind-muted)]">{new Intl.DateTimeFormat(undefined, { dateStyle: "full", ...(row.agenda.isAllDay ? {} : { timeStyle: "short" as const }) }).format(row.agenda.at)}{row.agenda.isAllDay ? " · All day" : ""}</p>}
    {row.agenda?.location && <p className="text-sm">{row.agenda.location}</p>}
    {recurring && <p className="text-sm text-[var(--mind-muted)]">Marking this done records this occurrence and advances its next due date.</p>}
    {(task || recurring) && <button type="button" className={`${actionClass} mt-3 border border-[var(--mind-border)]`} disabled={busy} onClick={() => void complete()}>{busy ? "Saving…" : "✓ Done"}</button>}
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {row.agenda?.conferenceUrl && /^https?:\/\//.test(row.agenda.conferenceUrl) && <a className={`${actionClass} mt-3 inline-block`} href={row.agenda.conferenceUrl} target="_blank" rel="noreferrer">Join meeting ↗</a>}
    {row.agenda?.href && /^https?:\/\//.test(row.agenda.href) && <a className={`${actionClass} mt-3 inline-block`} href={row.agenda.href} target="_blank" rel="noreferrer">Open calendar event ↗</a>}
    {row.reviews?.map(review => {
      const items = review.type === "approval" ? approvals : review.type === "triage" ? triage : memories;
      const item = items?.find(item => item._id === review.id);
      return <div key={`${review.type}:${review.id}`} className="mt-4 text-sm [overflow-wrap:anywhere]">{!items ? <p role="status">Loading review…</p> : item ? <ReviewDetail type={review.type} item={item} /> : <p role="status">This review has been resolved.</p>}</div>;
    })}
  </>;
}

function FeedItem({ row, graph, onSelect, onOpenAttention }: { row: FeedRow; graph: MindGraph; onSelect: (id: string) => void; onOpenAttention: (row: FeedRow) => void }) {
  const inMap = row.entityId && graph.nodes.some(node => node.id === row.entityId);
  return <button type="button" className={`${mindControlClass} flex w-full items-start gap-3 border-b border-[var(--mind-border)] px-2 py-3 text-left text-sm hover:bg-[var(--mind-surface)]`} onClick={() => !row.review && inMap ? onSelect(row.entityId!) : onOpenAttention(row)}>
    <span className="mt-1 shrink-0">{row.review ? <Inbox size={20} className="text-[var(--mind-accent)]" aria-hidden /> : row.focus ? <MindCategoryIcon kind={row.focus.kind} /> : row.agenda ? <CalendarDays size={20} className="text-[var(--mind-accent)]" aria-hidden /> : <CircleAlert size={20} aria-hidden />}</span>
    <span className="min-w-0 flex-1"><span className="block [overflow-wrap:anywhere]">{row.title}</span><span className="mt-1 block text-xs text-[var(--mind-muted)]">{row.reason}</span></span>
    <ChevronRight size={16} className="mt-1 shrink-0" />
  </button>;
}

export function MindAttention({ graph, query, onSelect, onOpenAttention }: { graph: MindGraph; query: string; onSelect: (id: string) => void; onOpenAttention: (row: FeedRow) => void }) {
  const ready = useViewerReady();
  const now = useAttentionClock();
  const focusResult = useQuery(api.attention.focusForViewer, ready && now ? { now } : "skip");
  const focus = useAttentionRefresh(focusResult, ready ? "mind-feed" : null);
  const range = todayRange(now);
  const agenda = useQuery(api.agenda.agendaForViewer, ready && now ? { ...range, includeProjectTasks: true } : "skip") as AgendaItem[] | undefined;
  const approvals = useQuery(api.knowledge.pendingActionsForViewer, ready ? { scope: "open" } : "skip");
  const triage = useQuery(api.knowledge.triageForViewer, ready ? {} : "skip");
  const memories = useQuery(api.knowledge.listMemoryInboxForViewer, ready ? { limit: 50 } : "skip");
  const reviewItems: ReviewItem[] = [
    ...(approvals ?? []).map(item => ({ id: String(item._id), title: item.subject || item.actionType || "Pending approval", reason: "Waiting for your approval", type: "approval" as const })),
    ...(triage ?? []).filter(item => item.candidateEntityType !== "project").map(item => ({ id: String(item._id), entityId: item.candidateEntityId, title: String(item.candidatePayload?.title || item.candidatePayload?.name || item.candidatePayload?.url || "New suggestion"), reason: "Suggested · awaiting acceptance", type: "triage" as const })),
    ...(memories ?? []).map(item => ({ id: String(item._id), entityId: String(item._id), title: item.title || "New memory", reason: "Captured memory · awaiting acceptance", type: "memory" as const })),
  ];
  const rows = mindAttentionRows(focus?.items ?? [], agenda ?? [], reviewItems, now, query);
  const loading = !focus || !agenda || !approvals || !triage || !memories;
  return <section aria-label="Attention">
    <h2 className="m-0 flex items-center gap-3 border-b border-[var(--mind-border)] px-2 py-4 text-base font-medium"><AttentionIcon />Attention</h2>
    {loading && <p role="status" className="px-2 text-xs text-[var(--mind-muted)]">Checking your day and decisions…</p>}
    {!loading && !rows.length && <p className="px-2 text-sm text-[var(--mind-muted)]">{query.trim() ? "Nothing matches your search." : "Nothing needs your attention right now."}</p>}
    {groups.map(group => {
      const items = rows.filter(row => row.group === group.id);
      if (!items.length) return null;
      return <section key={group.id} aria-label={group.title}>
        <h3 className="mb-0 mt-4 px-2 text-xs font-medium text-[var(--mind-muted)]">{group.title} <span className="ml-1 tabular-nums">{items.length}</span></h3>
        {items.map(row => <FeedItem key={row.key} row={row} graph={graph} onSelect={onSelect} onOpenAttention={onOpenAttention} />)}
      </section>;
    })}
  </section>;
}
