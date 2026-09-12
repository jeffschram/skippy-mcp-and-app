"use client";
import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import Link from "next/link";
import { api } from "../../lib/skippy-api";
import { AttentionBoundary, AttentionEditor, AttentionFocus } from "../components/attention";
import { useViewerReady } from "../hubs/use-viewer";
import { LiveGate } from "../live-auth";
import { KINDS } from "../mind/graph-layout";
import type { AttentionKind } from "../../../../convex/attentionModel";
function AttentionPageContent() {
  const [kind, setKind] = useState<AttentionKind>("task");
  const ready = useViewerReady(); const [now] = useState(() => Date.now());
  const { results, status, loadMore } = usePaginatedQuery(api.attention.browseForViewer, ready && now ? { kind, now } : "skip", { initialNumItems: 25 });
  return <LiveGate><div className="mx-auto grid max-w-5xl gap-6">
    <header><h1>Attention</h1><p className="text-muted-foreground">See what needs action, reserve time, and decide when to review something again.</p></header>
    <AttentionFocus expanded />
    <section className="rounded-xl border bg-card p-5"><div className="flex items-center justify-between gap-3"><h2 className="m-0 text-xl">Review all items</h2><select aria-label="Item category" className="rounded-md border bg-background p-2" value={kind} onChange={e => setKind(e.target.value as AttentionKind)}>{Object.entries(KINDS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></div>
      <div className="mt-4 divide-y">{results.map(item => <article key={item.id} className="py-3"><Link className="font-medium hover:underline" href={item.href}>{item.title}</Link><AttentionEditor kind={item.kind} id={item.id} /></article>)}</div>
      {status === "LoadingFirstPage" && <p role="status">Loading items…</p>}
      {!results.length && status === "Exhausted" && <p>No active items in this category.</p>}
      {(status === "CanLoadMore" || status === "LoadingMore") && <button className="mt-4 rounded-md border px-3 py-2" disabled={status === "LoadingMore"} onClick={() => loadMore(25)}>{status === "LoadingMore" ? "Loading…" : "Load more"}</button>}
    </section>
  </div></LiveGate>;
}

export function AttentionContent() { return <AttentionBoundary><AttentionPageContent /></AttentionBoundary>; }
