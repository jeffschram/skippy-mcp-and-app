"use client";

import { AttentionEditor, useAttentionClock } from "../components/attention";
import { ATTENTION, resolveAttention } from "../../../../convex/attentionModel";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import {
  ArrowUpRight,
  Focus,
  List,
  Network,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { api } from "../../lib/skippy-api";
import { useViewerReady } from "../hubs/use-viewer";
import { LiveGate } from "../live-auth";
import type { MindGraph, MindKind } from "../../../../convex/mindGraphHelpers";
import { filterGraph, KINDS } from "./graph-layout";
import { buildMyWorld, categoryId, categoryKind } from "./my-world";
import { cn } from "@/lib/utils";
import {
  mindControlClass,
  mindToolClass,
  mindFallbackClass,
  mindNeighborhoodClass,
} from "./mind-classes";

const Scene = dynamic(() => import("./mind-scene"), {
  ssr: false,
  loading: () => (
    <div className={mindFallbackClass}>Preparing your constellation…</div>
  ),
});
class MapBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className={mindFallbackClass}>
        The 3D view couldn’t start. Use List view to explore your records and
        connections.
      </div>
    ) : (
      this.props.children
    );
  }
}
export function MindContent() {
  const ready = useViewerReady();
  const graph = useQuery(
    api.memoryGraph.mindMapForViewer,
    ready ? {} : "skip",
  ) as MindGraph | undefined;
  return (
    <LiveGate>
      {graph ? (
        <MindExplorer graph={graph} />
      ) : (
        <div className="p-20 text-center text-[#686457]" role="status">
          Gathering your thoughts and connections…
        </div>
      )}
    </LiveGate>
  );
}
export function MindExplorer({ graph }: { graph: MindGraph }) {
  const now = useAttentionClock();
  const [query, setQuery] = useState("");
  const [enabled, setEnabled] = useState(
    () => new Set(Object.keys(KINDS) as MindKind[]),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [branch, setBranch] = useState<MindKind | null>(null);
  const [list, setList] = useState(false);
  const [filters, setFilters] = useState(false);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !(event.target instanceof HTMLElement && event.target.closest("input, textarea, select, form"))) { setSelected(null); setQuery(""); setBranch(null); setEnabled(new Set(Object.keys(KINDS) as MindKind[])); setReset(n => n + 1); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  const [reset, setReset] = useState(0);
  const owner = graph.owner || { id: "owner:self", title: "You" };
  const selectedKind = categoryKind(selected);
  const shownKinds = useMemo(
    () => new Set([...enabled].filter((k) => !branch || k === branch)),
    [enabled, branch],
  );
  const visible = useMemo(
    () => filterGraph(graph, shownKinds, query, null),
    [graph, shownKinds, query],
  );
  const world = useMemo(
    () => buildMyWorld(graph, visible, shownKinds, now),
    [graph, visible, shownKinds, now],
  );
  const node = graph.nodes.find((n) => n.id === selected);
  const records = visible.nodes.filter((n) => n.id !== owner.personId);
  function selectNode(id: string | null) {
    if (id === null) { clear(); return; }
    if (id === owner.id || id === owner.personId) {
      clear();
      setSelected(owner.id);
      return;
    }
    const kind = categoryKind(id);
    if (kind) {
      setBranch(kind);
      setReset(n => n + 1);
      setQuery("");
      setEnabled(new Set(Object.keys(KINDS) as MindKind[]));
    }
    if (!kind) {
      setBranch(null);
      setQuery("");
      setEnabled(new Set(Object.keys(KINDS) as MindKind[]));
    }
    setSelected(id);
  }
  const neighbors = useMemo(
    () =>
      graph.edges
        .filter((e) => e.source === selected || e.target === selected)
        .map((e) => ({
          edge: e,
          node: graph.nodes.find(
            (n) => n.id === (e.source === selected ? e.target : e.source),
          )!,
        })),
    [graph, selected],
  );
  const counts = useMemo(() => {
    const result = new Map<MindKind, number>();
    graph.nodes
      .filter((n) => n.id !== graph.owner?.personId)
      .forEach((n) => result.set(n.kind, (result.get(n.kind) || 0) + 1));
    return result;
  }, [graph]);
  function clear() {
    setQuery("");
    setEnabled(new Set(Object.keys(KINDS) as MindKind[]));
    setBranch(null);
    setSelected(null);
    setReset((n) => n + 1);
  }
  return (
    <div className="relative h-dvh overflow-hidden bg-[#f0e9dc] text-[#24333c]">
      <header className="absolute left-5 top-5 z-40 sm:left-8 sm:top-7">
        <h1 className="m-0 font-serif text-[30px] font-normal tracking-[-0.06em] text-[#24333c]">mind<span className="text-[#c7472c]">.</span></h1>
      </header>
      <section
        className="h-full"
        aria-label="Mind explorer"
      >
        <div className="pointer-events-none absolute inset-x-0 top-5 z-40 flex items-start justify-center px-4 sm:top-7">
          <label className="pointer-events-auto mt-14 flex w-full max-w-[460px] items-center gap-3 rounded-full border border-[#a9a394] bg-[#f0e9dc]/90 px-5 py-3 text-[#686457] backdrop-blur-md focus-within:outline-2 focus-within:outline-[#286c70] sm:mt-0 sm:w-[40%]">
            <Search size={17} />
            <input
              className="min-w-0 w-full border-0 bg-transparent text-[14px] text-[#24333c] outline-none placeholder:text-[#777367]"
              aria-label="Search mind"
              placeholder="Find a thought, person, project…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                className={mindControlClass}
                aria-label="Clear search"
                onClick={() => setQuery("")}
              >
                <X size={15} />
              </button>
            )}
          </label>
          <details className="pointer-events-auto absolute right-5 top-0 sm:right-8">
            <summary className={cn(mindControlClass, "cursor-pointer list-none rounded-full border border-[#d8d0c0] bg-[#faf6ec]/90 px-4 py-2.5 text-sm")}>Map options</summary>
            <div className="absolute right-0 mt-3 flex max-h-[65dvh] w-[260px] overflow-y-auto flex-wrap gap-1 rounded-2xl border border-[#d8d0c0] bg-[#faf6ec] p-3 shadow-lg">
            <button className={cn(mindControlClass, mindToolClass)} aria-expanded={filters} aria-controls="mind-filters" onClick={() => setFilters(!filters)}><SlidersHorizontal size={16} /> Types{enabled.size < Object.keys(KINDS).length ? ` (${enabled.size})` : ""}</button>
            <details className="relative">
              <summary className={cn(mindControlClass, mindToolClass, "cursor-pointer")}>Colors</summary>
              <div className="absolute right-0 top-full z-40 mt-2 grid min-w-[240px] gap-3 rounded-xl border border-[#d8d0c0] bg-[#faf6ec] p-4 shadow-lg">
                {Object.entries(ATTENTION).map(([status, meta]) => <span key={status} className="flex items-center gap-2 text-sm"><span className="h-3 w-3 rounded-full" style={{ background: meta.color }} />{meta.label}</span>)}
                <Link href="/attention" className="text-sm underline">Review attention</Link>
              </div>
            </details>
            <button className={cn(mindControlClass, mindToolClass)} onClick={() => setSelected(owner.id)}>Browse</button>
            <button
              className={cn(mindControlClass, mindToolClass)}
              onClick={clear}
            >
              My world
            </button>
            <button
              className={cn(mindControlClass, mindToolClass)}
              aria-pressed={!list}
              onClick={() => setList(false)}
            >
              <Network size={16} />
              3D
            </button>
            <button
              className={cn(mindControlClass, mindToolClass)}
              aria-pressed={list}
              onClick={() => setList(true)}
            >
              <List size={16} />
              List
            </button>
            <button
              className={cn(mindControlClass, mindToolClass)}
              onClick={() => setReset((n) => n + 1)}
              title="Reset camera"
            >
              <RotateCcw size={16} />
              <span className="max-[1050px]:hidden">Reset view</span>
            </button>
        {filters && <div
          id="mind-filters"
          className="flex w-full flex-wrap gap-1.5 border-t border-[#d8d0c0] pt-3"
          aria-label="Filter record types"
        >
          {(Object.keys(KINDS) as MindKind[]).map((kind) => (
            <button
              className={cn(
                "flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1.5 text-[12px] text-[#686457] opacity-40 aria-pressed:border-[#d8d0c0] aria-pressed:bg-[#286c7008] aria-pressed:opacity-100 max-[700px]:p-[5px] max-[700px]:text-[12px]",
                mindControlClass,
              )}
              key={kind}
              aria-pressed={enabled.has(kind)}
              onClick={() =>
                setEnabled((current) => {
                  const next = new Set(current);
                  if (next.has(kind)) next.delete(kind);
                  else next.add(kind);
                  return next;
                })
              }
            >
              <i
                className="inline-block size-1.5 shrink-0 rounded-full"
                style={{ background: "#8A8476" }}
              />
              {KINDS[kind].label}
              <span className="ml-0.5 text-[12px] text-[#777367]">
                {counts.get(kind) || 0}
              </span>
            </button>
          ))}
        </div>}
            </div>
          </details>
        </div>

        {branch && (
          <div className="absolute left-1/2 top-32 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#faf6ec] px-4 py-1 text-xs text-[#286c70] sm:top-24">
            <Focus size={14} />
            {KINDS[branch].label}
            <button
              className={cn("ml-auto", mindControlClass, mindToolClass)}
              onClick={() => {
                          setBranch(null);
                setSelected(null);
              }}
            >
              Show whole map <X size={13} />
            </button>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-[210px] top-[130px] sm:bottom-[190px] sm:top-[95px]">
          <div className="relative h-full min-w-0 overflow-hidden">
            {!records.length ? (
              <div className={mindFallbackClass}>
                <Search size={30} />
                <h2 className="text-[20px] text-[#24333c]">
                  No matching records
                </h2>
                <p className="max-w-[390px]">Try another search or category.</p>
                <button
                  className={cn("text-[#286c70] underline", mindControlClass)}
                  onClick={clear}
                >
                  Show my world
                </button>
              </div>
            ) : list ? (
              <div
                className={cn("h-full overflow-auto px-4 pb-[55px] pt-3 [scrollbar-width:thin]", selected && "min-[701px]:pr-[380px]")}
                aria-label="Records"
              >
                {records.map((n) => (
                  <button
                    className={cn(
                      "flex w-full items-center gap-3 border-b border-[#d8d0c0] p-3 text-left hover:bg-[#286c7010] aria-pressed:bg-[#286c7010]",
                      mindControlClass,
                    )}
                    key={n.id}
                    aria-pressed={selected === n.id}
                    onClick={() => selectNode(n.id)}
                  >
                    <i
                      className="inline-block size-1.5 shrink-0 rounded-full"
                      style={{ background: ATTENTION[resolveAttention(n.kind, n, now).status].color }}
                    />
                    <span className="min-w-0 flex-1">
                      <strong className="block text-[12px] font-medium [overflow-wrap:anywhere]">
                        {n.title}
                      </strong>
                      <small className="mt-1 block text-[12px] text-[#686457]">
                        {KINDS[n.kind].label}
                        {n.status ? ` · ${n.status.replaceAll("_", " ")}` : ""}
                      </small>
                    </span>
                    <ArrowUpRight
                      className="shrink-0 text-[#686457]"
                      size={15}
                    />
                  </button>
                ))}
              </div>
            ) : (
              <MapBoundary>
                <Scene
                  graph={world}
                  selected={selected}
                  onSelect={selectNode}
                  reset={reset}
                  focusKey={branch || query.trim()}
                />
              </MapBoundary>
            )}

          </div>
          {selected && <aside
            className="absolute bottom-4 right-4 top-4 z-30 w-[340px] max-w-[calc(100%-32px)] overflow-y-auto rounded-xl border border-[#d8d0c0] bg-[#f7f2e8f5] p-[22px] shadow-[0_12px_45px_#24333c0d] [scrollbar-width:thin] max-[700px]:left-3 max-[700px]:right-3 max-[700px]:top-auto max-[700px]:max-h-[55%] max-[700px]:w-auto max-[700px]:p-4"
            aria-label="Selected record"
            aria-live="polite"
          >
            {!node && <button className={cn("float-right p-1", mindControlClass)} onClick={() => selectNode(null)} aria-label="Close browser"><X size={18} /></button>}
            {selectedKind ? (
              <div>
                <p className="text-[12px] uppercase tracking-[.15em] text-[#686457]">
                  {owner.title} / category
                </p>
                <h2
                  className="my-3 border-l-4 pl-3 text-[24px] font-semibold"
                  style={{ borderLeftColor: "#8A8476" }}
                >
                  {KINDS[selectedKind].label}
                </h2>
                <p className="mb-5 text-[14px] leading-[1.8] text-[#686457]">
                  {records.filter((n) => n.kind === selectedKind).length}{" "}
                  records in this category. Select one to read its details and
                  saved relationships.
                </p>
                <div className="flex flex-col gap-1">
                  {records
                    .filter((n) => n.kind === selectedKind)
                    .map((record) => (
                      <button
                        key={record.id}
                        className={cn(
                          "rounded-md border-b border-[#d8d0c0] px-2 py-3 text-left text-[12px] text-[#343d3c] hover:bg-[#286c7010]",
                          mindControlClass,
                        )}
                        onClick={() => selectNode(record.id)}
                      >
                        {record.title}
                      </button>
                    ))}
                </div>
                {!records.some((n) => n.kind === selectedKind) && (
                  <p className="text-[12px] text-[#686457]">
                    No records here yet, or none match your filters.
                  </p>
                )}
                <button
                  className={cn(mindControlClass, mindNeighborhoodClass)}
                  onClick={clear}
                >
                  Back to my world
                </button>
              </div>
            ) : node ? (
              <>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-[#343d3c]">
                    {KINDS[node.kind].label}
                  </span>
                  <button
                    className={cn("p-[5px] text-[#686457]", mindControlClass)}
                    onClick={() => selectNode(null)}
                    aria-label="Close record"
                  >
                    <X size={17} />
                  </button>
                </div>
                <h2 className="my-3 font-serif text-[28px] font-normal leading-[1.35] tracking-[-0.025em] [overflow-wrap:anywhere]">
                  {node.title}
                </h2>
                <AttentionEditor key={node.id} kind={node.kind} id={node.id} />
                {node.status && (
                  <span className="inline-block rounded bg-[#286c7013] px-[7px] py-1 text-[12px] text-[#286c70]">
                    {node.status.replaceAll("_", " ")}
                  </span>
                )}
                <p className="mb-[18px] mt-3 whitespace-pre-wrap text-[14px] leading-[1.8] text-[#686457] [overflow-wrap:anywhere]">
                  {node.summary || "No description saved yet."}
                </p>
                <Link
                  className={cn(
                    "flex items-center justify-between border-b border-[#d8d0c0] pb-3.5 pt-2.5 text-[12px] text-[#286c70]",
                    mindControlClass,
                  )}
                  href={node.href}
                >
                  Open record <ArrowUpRight size={15} />
                </Link>
                <h3 className="mb-3 mt-[26px] text-[12px] uppercase tracking-[0.1em] text-[#686457]">
                  Saved relationships{" "}
                  <span className="ml-2 text-[#686457]">
                    {neighbors.length}
                  </span>
                </h3>
                {neighbors.length ? (
                  <div className="flex flex-col gap-1">
                    {neighbors.map(({ edge, node: neighbor }) => (
                      <button
                        className={cn(
                          "rounded-md px-2 py-2.5 text-left [overflow-wrap:anywhere] hover:bg-[#286c700c]",
                          mindControlClass,
                        )}
                        key={edge.id}
                        onClick={() => selectNode(neighbor.id)}
                      >
                        <small className="mb-[5px] block text-[12px] text-[#686457]">
                          {edge.source === selected ? "→" : "←"}{" "}
                          {edge.type.replaceAll("_", " ")}
                        </small>
                        <span className="flex items-baseline gap-2 text-[12px] leading-[1.5] text-[#343d3c]">
                          <i
                            className="inline-block size-1.5 shrink-0 rounded-full"
                            style={{ background: ATTENTION[resolveAttention(neighbor.kind, neighbor, now).status].color }}
                          />
                          {neighbor.title}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mb-[18px] mt-3 whitespace-pre-wrap text-[14px] leading-[1.8] text-[#686457] [overflow-wrap:anywhere]">
                    No saved relationships in this sample yet. This record is
                    shown in its category color in your world.
                  </p>
                )}
              </>
            ) : (
              <div className="pt-3">
                <div className="mb-6 grid size-[70px] place-items-center rounded-full border border-[#286c7044] bg-[#286c700a] text-[#24333c]">
                  <Network size={32} />
                </div>
                <p className="text-[12px] uppercase tracking-[.17em] text-[#686457]">
                  At the center
                </p>
                <h2 className="my-3 text-[26px] font-semibold tracking-tight">
                  {owner.title}
                </h2>
                <p className="mb-6 text-[14px] leading-[1.8] text-[#686457]">
                  Your people, projects, ideas, and tasks surround you. Choose a
                  category to explore that part of your world.
                </p>
                <div
                  className="flex flex-col gap-1"
                  aria-label="Your categories"
                >
                  {(Object.keys(KINDS) as MindKind[]).map((kind) => (
                    <button
                      key={kind}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-2 py-3 text-left text-[12px] hover:bg-[#286c7010]",
                        mindControlClass,
                      )}
                      onClick={() => selectNode(categoryId(kind))}
                    >
                      <i
                        className="size-2 rounded-full"
                        style={{ background: "#8A8476" }}
                      />
                      <span className="flex-1">{KINDS[kind].label}</span>
                      <span className="text-[#686457]">
                        {counts.get(kind) || 0}
                      </span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
                <p className="mt-6 text-[14px] leading-[1.8] text-[#686457]">
                  Shapes identify categories; color shows attention. Select a record to
                  highlight its saved relationships across the map.
                </p>
              </div>
            )}
          </aside>}
        </div>
      </section>
    </div>
  );
}
