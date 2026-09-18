"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { AttentionBoundary, useAttentionClock } from "../components/attention";
import { ATTENTION, resolveAttention } from "../../../../convex/attentionModel";
import type { MindGraph, MindKind } from "../../../../convex/mindGraphHelpers";
import { KINDS } from "./graph-layout";
import { MindCategoryIcon } from "./mind-category-icon";
import { mindControlClass } from "./mind-classes";
import type { FeedRow } from "./mind-attention-model";
import { MindAttention } from "./mind-attention";
import { cn } from "@/lib/utils";

type Props = { graph: MindGraph; records: MindGraph["nodes"]; selected: string | null; query: string; onSelect: (id: string) => void; attentionSelected: boolean; onOpenAttention: (row: FeedRow) => void };
const rowClass = "flex w-full items-center gap-3 border-b border-[var(--mind-border)] px-2 py-4 text-left hover:bg-[var(--mind-surface)]";
export function MindList(props: Props) {
  const [category, setCategory] = useState<MindKind | null>(null);
  const now = useAttentionClock();
  return <div className="mind-list-scroll h-full overflow-y-auto pb-8" data-selected={Boolean(props.selected) || props.attentionSelected}>
    <div className="mind-list-column">
      <AttentionBoundary><MindAttention {...props} /></AttentionBoundary>
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
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: KINDS[kind].color }} /><span className="min-w-0 flex-1"><span className="block text-sm [overflow-wrap:anywhere]">{node.title}</span><span className="mt-1 block text-xs text-[var(--mind-muted)]">{KINDS[kind].label} · {kind === "event" && node.agenda ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(node.agenda.at) : ATTENTION[resolveAttention(kind === "event" ? "task" : kind, node, now).status].label}</span></span><ChevronRight size={17} className="shrink-0" />
              </button>) : <p className="px-6 py-2 text-sm text-[var(--mind-muted)]">No matching records in this map.</p>}
            </div>}
          </section>;
        })}
      </nav>
    </div>
  </div>;
}
