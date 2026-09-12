"use client";
import Link from "next/link";
import { Component, useEffect, useId, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../lib/skippy-api";
import { ATTENTION, type AttentionKind, type AttentionMetadata, type AttentionResult, type AttentionStatus } from "../../../../convex/attentionModel";
import { useViewerReady } from "../hubs/use-viewer";

export function useAttentionClock() {
  const [now, setNow] = useState(0);
  useEffect(() => { const tick = () => setNow(Math.floor(Date.now() / 60000) * 60000); tick(); const timer = setInterval(tick, 60000); return () => clearInterval(timer); }, []);
  return now;
}
// A new clock argument temporarily makes Convex return undefined. Keep the
// previous result during that refresh so cards/forms don't disappear. Scope
// changes and explicit null results must still clear the previous record.
function useAttentionRefresh<T>(value: T | undefined, scope: string | null) {
  const [previous, setPrevious] = useState<{ scope: string | null; value: T | undefined }>({ scope, value });
  if (previous.scope !== scope || (value !== undefined && previous.value !== value)) {
    setPrevious({ scope, value });
  }
  if (scope === null) return undefined;
  return value !== undefined ? value : previous.scope === scope ? previous.value : undefined;
}
export function AttentionBadge({ result }: { result: AttentionResult }) {
  return <span className="inline-flex items-center gap-2 text-sm" title={result.reason}>
    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ATTENTION[result.status].color }} />
    {ATTENTION[result.status].label}
  </span>;
}
function localDate(value?: number) {
  if (value === undefined) return "";
  const d = new Date(value);
  return new Date(value - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const inputClass = "w-full rounded-md border border-current/20 bg-transparent px-2 py-1.5 text-sm";
function AttentionForm({ kind, id, initial, onClose }: { kind: AttentionKind; id: string; initial: AttentionMetadata; onClose: () => void }) {
  const save = useMutation(api.attention.setForViewer);
  const fieldId = useId();
  const [override, setOverride] = useState<AttentionStatus | "automatic">(initial.override || "automatic");
  const [reason, setReason] = useState(initial.reason || "");
  const [review, setReview] = useState(localDate(initial.reviewAt));
  const [scheduled, setScheduled] = useState(localDate(initial.scheduledAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form className="mt-3 grid gap-3" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const attention: AttentionMetadata = {};
      if (override !== "automatic") attention.override = override;
      if (reason.trim()) attention.reason = reason.trim();
      if (review) attention.reviewAt = new Date(review).getTime();
      if (scheduled && (override === "automatic" || override === "scheduled")) attention.scheduledAt = new Date(scheduled).getTime();
      await save({ kind, id, attention }); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save attention"); } finally { setBusy(false); }
  }}>
    <label htmlFor={`${fieldId}-status`} className="grid gap-1 text-sm">Attention
      <select id={`${fieldId}-status`} className={inputClass} value={override} onChange={e => setOverride(e.target.value as typeof override)} disabled={busy}>
        <option value="automatic">Automatic</option>
        {Object.entries(ATTENTION).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-sm">Why?
      <input className={inputClass} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional context" disabled={busy} />
    </label>
    {(override === "automatic" || override === "scheduled") && <label className="grid gap-1 text-sm">Scheduled for
      <input className={inputClass} type="datetime-local" value={scheduled} onChange={e => setScheduled(e.target.value)} required={override === "scheduled"} disabled={busy} />
      <span className="text-xs opacity-70">Reserves an attention time; does not create a calendar event.</span>
    </label>}
    <label className="grid gap-1 text-sm">Review again on
      <input className={inputClass} type="datetime-local" value={review} onChange={e => setReview(e.target.value)} disabled={busy} />
      <span className="text-xs opacity-70">Clear or move an overdue review date when you finish reviewing.</span>
    </label>
    {error && <p role="alert" className="m-0 text-sm text-red-600">{error}</p>}
    <div className="flex gap-3"><button className="rounded-md bg-teal-800 px-3 py-2 text-sm text-white disabled:opacity-50" disabled={busy}>{busy ? "Saving…" : "Save attention"}</button><button type="button" onClick={onClose} disabled={busy} className="text-sm">Cancel</button></div>
  </form>;
}
function AttentionEditorContent({ kind, id }: { kind: AttentionKind; id: string }) {
  const ready = useViewerReady();
  const now = useAttentionClock();
  const result = useQuery(api.attention.getForViewer, ready && now ? { kind, id, now } : "skip");
  const item = useAttentionRefresh(result, ready ? `${kind}:${id}` : null);
  const [open, setOpen] = useState(false);
  const complete = useMutation(api.knowledge.markTaskDoneForViewer);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState("");
  useEffect(() => { setOpen(false); setCompleteError(""); }, [id, kind]);
  if (!item) return null;
  return <div className="my-3 rounded-lg border border-current/15 p-3">
    <div className="flex items-center justify-between gap-3"><AttentionBadge result={item.result} /><button type="button" aria-expanded={open} className="text-sm underline underline-offset-2" onClick={() => setOpen(v => !v)}>Edit</button></div>
    <p className="mb-0 mt-1 text-xs opacity-75">{item.result.reason}{item.result.at ? ` · ${new Date(item.result.at).toLocaleString()}` : ""}</p>
    {kind === "task" && <div className="mt-3 grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {(item.sources || []).map(source => <a key={source.href} href={source.href} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-2">{source.label} ↗</a>)}
        {item.taskStatus === "done" ? <span className="text-sm">✓ Done</span> : item.taskStatus !== "cancelled" && <button type="button" disabled={completing} className="rounded-md bg-teal-800 px-3 py-1.5 text-sm text-white disabled:opacity-50" onClick={async () => {
          setCompleting(true); setCompleteError("");
          try { await complete({ taskId: id as Id<"tasks"> }); setOpen(false); } catch (error) { setCompleteError(error instanceof Error ? error.message : "Could not complete task"); } finally { setCompleting(false); }
        }}>{completing ? "Saving…" : "✓ Done"}</button>}
      </div>
      {!item.sources?.length && <p className="m-0 text-xs opacity-70">No source link saved for this task.</p>}
      {completeError && <p role="alert" className="m-0 text-sm text-red-600">{completeError}</p>}
    </div>}
    {open && <AttentionForm key={`${kind}:${id}`} kind={kind} id={id} initial={item.attention} onClose={() => setOpen(false)} />}
  </div>;
}
function AttentionFocusContent({ expanded = false }: { expanded?: boolean }) {
  const ready = useViewerReady(); const now = useAttentionClock();
  const result = useQuery(api.attention.focusForViewer, ready && now ? { now } : "skip");
  const data = useAttentionRefresh(result, ready ? "focus" : null);
  return <section className="rounded-xl border bg-card p-5">
    <div className="flex items-center justify-between gap-3"><h2 className="m-0 text-xl">Needs attention</h2>{!expanded && <Link href="/attention" className="text-sm underline">Review all items</Link>}</div>
    {!data ? <p role="status">Checking attention…</p> : !data.items.length ? <p className="text-sm text-muted-foreground">No items in the current attention queue. Unassessed items are available in Review all items.</p> : <div className="mt-3 divide-y">{data.items.slice(0, expanded ? 30 : 6).map(item => <div key={item.id} className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><Link href={item.href} className="font-medium hover:underline">{item.title}</Link><AttentionBadge result={item.result} /></div>
      <p className="mb-0 mt-1 text-sm text-muted-foreground">{item.result.reason}{item.result.at ? ` · ${new Date(item.result.at).toLocaleString()}` : ""}</p>
      {expanded && <AttentionEditor kind={item.kind} id={item.id} />}
    </div>)}</div>}
    {expanded && data?.limited && <p className="text-sm text-muted-foreground">Showing a bounded priority queue. Browse categories below to review the rest.</p>}
  </section>;
}


export class AttentionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div role="status" className="my-3 rounded-lg border border-current/15 p-3 text-sm">
      Attention is currently unavailable. <button className="underline" type="button" onClick={() => this.setState({ failed: false })}>Try again</button>
    </div> : this.props.children;
  }
}
export function AttentionEditor(props: { kind: AttentionKind; id: string }) {
  return <AttentionBoundary key={`${props.kind}:${props.id}`}><AttentionEditorContent {...props} /></AttentionBoundary>;
}
export function AttentionFocus(props: { expanded?: boolean }) {
  return <AttentionBoundary><AttentionFocusContent {...props} /></AttentionBoundary>;
}
