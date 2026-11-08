"use client";

import { Component, useRef, type ReactNode, type RefObject } from "react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "../../lib/skippy-api";
import { Button, LoadingRow } from "../components";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { HomeItemActions, ItemActionFeedback } from "./home-item-actions";
import { safeExternalUrl } from "./item-action-helpers";
import { TaskEditor, ScheduleEditor } from "./item-editors";
import { AttentionEditor } from "../components/attention";
import { ItemDetailsChat } from "../components/chat-panel";

export type ItemSelection = { kind: "task" | "event" | "recurrence" | "review"; id: string };

class DetailsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div role="alert" className="p-4">
      <p>This item could not load.</p>
      <Button onClick={() => this.setState({ failed: false })}>Retry</Button>
    </div> : this.props.children;
  }
}

/** Shared by every inventory period; resolution is independent of list filters. */
export function ItemDetailsModal({ selection, onClose, opener }: {
  selection: ItemSelection | null; onClose: () => void; opener: RefObject<HTMLElement | null>;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  return <Dialog open={!!selection} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent aria-describedby={undefined} overlayClassName="z-[80]"
      onOpenAutoFocus={event => { event.preventDefault(); heading.current?.focus(); }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        const target = opener.current?.isConnected ? opener.current : document.getElementById("home-planning");
        target?.focus();
      }}
      className="z-[80] flex max-h-[calc(100dvh-24px)] w-[calc(100%-24px)] max-w-3xl flex-col gap-0 overflow-y-auto p-0 [overflow-wrap:anywhere]">
      <DialogTitle ref={heading} tabIndex={-1} className="px-5 pb-3 pt-5 pr-12">{selection?.kind === "event" ? "Event" : selection?.kind === "recurrence" ? "Recurrence" : selection?.kind === "review" ? "Review" : "Task"} details</DialogTitle>
      {selection ? <DetailsBoundary key={`${selection.kind}:${selection.id}`}><ItemDetails selection={selection} /></DetailsBoundary> : null}
    </DialogContent>
  </Dialog>;
}

function ItemDetails({ selection }: { selection: ItemSelection }) {
  const detail = useQuery(api.homeInventory.getForViewer, selection);
  if (detail === undefined) return <div role="status" className="p-5"><LoadingRow label="Loading item…" /></div>;
  if (detail === null) return <p role="status" className="p-5">This item is unavailable. It may have been deleted or you may no longer have access.</p>;
  const { row } = detail;
  return <>
    <div className="grid min-w-0 gap-3 px-5 pb-5">
      <h3 className="text-lg font-semibold">{row.title}</h3>
      <HomeItemActions row={row} details />
      <ItemActionFeedback row={row} />
      {row.entityKind ? <AttentionEditor kind={row.entityKind} id={row.id} hideTaskCompletion /> : null}
      {row.kind === "review" && row.href ? <Link className="underline" href={row.href}>Open {row.entityKind}</Link> : null}
      <p className="text-sm">Status: {row.status}{row.area ? ` · ${row.area}` : ""}</p>
      <p className="whitespace-pre-wrap">{detail.description || "No description."}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        {detail.dates.map(date => <div key={date.label} className="contents"><dt>{date.label}</dt><dd>
          {row.isAllDay ? new Date(date.at).toLocaleDateString(undefined, { timeZone: "UTC" }) : new Date(date.at).toLocaleString(undefined, detail.timeZone ? { timeZone: detail.timeZone } : undefined)}
          {row.isAllDay ? " (all day)" : null}
        </dd></div>)}
      </dl>
      {row.isAllDay ? <p className="text-xs text-muted-foreground">All-day end dates are exclusive.</p> : null}
      {detail.timeZone ? <p className="text-sm">Time zone: {detail.timeZone}</p> : null}
      {row.location ? <p>Location: {row.location}</p> : null}
      {detail.recurrence ? <p>Recurrence: {detail.recurrence}</p> : null}
      {detail.projectId ? <Link className="underline" href={`/projects/${detail.projectId}`}>Open project</Link> : null}
      {detail.sources.filter(source => safeExternalUrl(source.url)).map((source, index) =>
        <a key={`${source.url}:${index}`} className="underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a>)}
      {row.kind === "task" && row.status !== "done" && row.status !== "cancelled" ? <TaskEditor key={`task:${row.id}:${detail.updatedAt}`} detail={detail} /> : null}
      {detail.schedule && row.recurrenceId && row.recurrenceStatus !== "retired" ? <ScheduleEditor key={`repeat:${row.recurrenceId}:${row.occurrenceVersion}`} detail={detail} /> : null}
      {detail.schedule ? <section aria-label="Recent history"><h4 className="font-semibold">Recent history (up to 24 occurrences)</h4>
        {detail.schedule.history.length ? <ol className="list-disc pl-5">{[...detail.schedule.history].reverse().map((entry, index) => <li key={index}>
          {entry.outcome === "skipped" ? "Skipped" : "Completed"} · {new Date(entry.at).toLocaleString()}
          {entry.scheduledFor !== null ? ` · scheduled for ${new Date(entry.scheduledFor).toLocaleString()}` : ""}{entry.note ? ` — ${entry.note}` : ""}
        </li>)}</ol> : <p>No recorded history yet.</p>}
      </section> : null}
    </div>
    <ItemDetailsChat kind={row.kind} id={row.id} label={row.title} />
  </>;
}
