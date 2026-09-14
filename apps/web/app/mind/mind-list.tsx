"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "convex/react";
import { ChevronRight, Diamond, ArrowUpRight } from "lucide-react";
import { api } from "../../lib/skippy-api";
import { useViewerReady } from "../hubs/use-viewer";
import { AttentionBoundary, useAttentionClock, useAttentionRefresh } from "../components/attention";
import { ATTENTION, resolveAttention } from "../../../../convex/attentionModel";
import type { MindGraph, MindKind } from "../../../../convex/mindGraphHelpers";
import { KINDS } from "./graph-layout";
import { MindCategoryIcon } from "./mind-category-icon";
import { mindControlClass } from "./mind-classes";
import { cn } from "@/lib/utils";

type Props = { graph: MindGraph; records: MindGraph["nodes"]; selected: string | null; query: string; onSelect: (id: string) => void };
const rowClass = "flex w-full items-center gap-3 border-b border-[var(--mind-border)] px-2 py-4 text-left hover:bg-[var(--mind-surface)]";
function AttentionList({ graph, query, onSelect, selected }: Props) {
  const ready = useViewerReady();
  const now = useAttentionClock();
  const result = useQuery(api.attention.focusForViewer, ready && now ? { now } : "skip");
  const data = useAttentionRefresh(result, ready ? "mind-list" : null);
  const items = data?.items.filter(item => `${item.title} ${item.result.reason}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section aria-label="Attention">
    <h2 className="m-0 flex items-center gap-3 border-b border-[var(--mind-border)] px-2 py-4 text-base font-medium"><Diamond size={17} className="text-[var(--mind-accent)]" />Attention</h2>
    {!data ? <p role="status" className="px-2 text-sm text-[var(--mind-muted)]">Checking attention…</p> : !items?.length ? <p className="px-2 text-sm text-[var(--mind-muted)]">{query.trim() ? "No attention items match your search." : "Nothing needs your attention right now."}</p> : items.map(item => {
      const inMap = graph.nodes.some(node => node.id === item.id);
      const content = <><span className="size-2.5 shrink-0 rounded-full" style={{ background: ATTENTION[item.result.status].color }} /><span className="min-w-0 flex-1"><span className="block text-sm [overflow-wrap:anywhere]">{item.title}</span><span className="mt-1 block text-xs text-[var(--mind-muted)]">{KINDS[item.kind].label} · {ATTENTION[item.result.status].label}</span></span>{inMap ? <ChevronRight size={17} className="shrink-0" /> : <ArrowUpRight size={17} className="shrink-0" />}</>;
      return inMap ? <button key={item.id} type="button" aria-pressed={selected === item.id} onClick={() => onSelect(item.id)} className={cn(rowClass, mindControlClass, "aria-pressed:bg-[var(--mind-surface)]")}>{content}</button> : <Link key={item.id} href={item.href} className={cn(rowClass, mindControlClass)}>{content}</Link>;
    })}
  </section>;
}
export function MindList(props: Props) {
  const [category, setCategory] = useState<MindKind | null>(null);
  const now = useAttentionClock();
  return <div className="mind-list-scroll h-full overflow-y-auto pb-8" data-selected={Boolean(props.selected)}>
    <div className="mind-list-column">
      <AttentionBoundary><AttentionList {...props} /></AttentionBoundary>
      <nav aria-label="Record categories" className="mt-4">
        {(Object.keys(KINDS) as MindKind[]).map(kind => {
          const records = props.records.filter(node => node.kind === kind);
          const expanded = category === kind || Boolean(props.query.trim());
          return <section key={kind}>
            <button type="button" className={cn(rowClass, mindControlClass, "text-base font-medium", expanded && "sticky top-0 z-10 bg-[var(--mind-canvas)]")} aria-expanded={expanded} aria-controls={`mind-list-${kind}`} onClick={() => setCategory(category === kind ? null : kind)}>
              <MindCategoryIcon kind={kind} /><span className="flex-1">{KINDS[kind].label}</span><ChevronRight size={17} className={expanded ? "rotate-90" : ""} />
            </button>
            {expanded && <div id={`mind-list-${kind}`}>
              {records.length ? records.map(node => <button key={node.id} type="button" className={cn(rowClass, mindControlClass, "pl-6 aria-pressed:bg-[var(--mind-surface)]")} aria-pressed={props.selected === node.id} onClick={() => props.onSelect(node.id)}>
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: KINDS[kind].color }} /><span className="min-w-0 flex-1"><span className="block text-sm [overflow-wrap:anywhere]">{node.title}</span><span className="mt-1 block text-xs text-[var(--mind-muted)]">{KINDS[kind].label} · {ATTENTION[resolveAttention(kind, node, now).status].label}</span></span><ChevronRight size={17} className="shrink-0" />
              </button>) : <p className="px-6 py-2 text-sm text-[var(--mind-muted)]">No matching records in this map.</p>}
            </div>}
          </section>;
        })}
      </nav>
    </div>
  </div>;
}
