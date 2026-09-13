"use client";

import { AttentionEditor, useAttentionClock } from "../components/attention";
import { ATTENTION, resolveAttention } from "../../../../convex/attentionModel";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowUpRight,
  Focus,
  List,
  Network,
  Search,
  X,
} from "lucide-react";
import { api } from "../../lib/skippy-api";
import { useViewerReady } from "../hubs/use-viewer";
import { LiveGate } from "../live-auth";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { MindGraph, MindKind } from "../../../../convex/mindGraphHelpers";
import { layoutKey, relationshipPositions } from "./relationship-layout";
import { completionProject } from "./completion-context";
import { filterGraph, KINDS, type Position } from "./graph-layout";
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
        <div className="p-20 text-center text-[var(--mind-muted)]" role="status">
          Gathering your thoughts and connections…
        </div>
      )}
    </LiveGate>
  );
}
export function MindExplorer({ graph: liveGraph }: { graph: MindGraph }) {
  const completeTask = useMutation(api.knowledge.markTaskDoneForViewer);
  const [completion, setCompletion] = useState<{ graph: MindGraph; id: string; projectId: string | null; fading: boolean } | null>(null);
  const graph = completion?.graph ?? liveGraph;
  const previousSelection = useRef<string | null>(null);
  const latestSelection = useRef<string | null>(null);

  const now = useAttentionClock();
  const [query, setQuery] = useState("");
  const [enabled, setEnabled] = useState(
    () => new Set(Object.keys(KINDS) as MindKind[]),
  );
  const [selected, setSelected] = useState<string | null>(null);
  latestSelection.current = selected;
  useEffect(() => {
    if (!completion?.fading) return;
    const timer = setTimeout(() => {
      if (latestSelection.current === completion.id) {
        setSelected(completion.projectId && liveGraph.nodes.some(n => n.id === completion.projectId) ? completion.projectId : null);
        setReset(n => n + 1);
      }
      setCompletion(null);
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700);
    return () => clearTimeout(timer);
  }, [completion, liveGraph]);
  const [branch, setBranch] = useState<MindKind | null>(null);
  const [list, setList] = useState(false);
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
  const stablePositions = useRef(new Map<string, Position>());
  const topology = layoutKey(graph);
  const layout = useMemo(() => {
    const next = relationshipPositions(graph, stablePositions.current);
    stablePositions.current = next;
    return next;
  // Status, search, and selection changes must not run the layout solver.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topology]);
  const world = useMemo(() => {
    const mapVisible = filterGraph(graph, shownKinds, "", null);
    const next = buildMyWorld(graph, mapVisible, shownKinds, now, "category", layout);
    return query.trim() ? { ...next, searchIds: visible.nodes.map(node => node.id) } : next;
  }, [graph, visible, shownKinds, now, layout, query]);
  const node = graph.nodes.find((n) => n.id === selected);
  const records = visible.nodes.filter((n) => n.id !== owner.personId);
  function selectNode(id: string | null) {
    previousSelection.current = selected;
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
  async function finishSelectedTask() {
    if (!node || node.kind !== "task" || completion) return;
    const projectId = completionProject(graph, node.id, previousSelection.current);
    const pending = { graph, id: node.id, projectId, fading: false };
    setCompletion(pending);
    try {
      await completeTask({ taskId: node.id as Id<"tasks"> });
      setCompletion({ ...pending, fading: true });
    } catch (error) {
      setCompletion(null);
      throw error;
    }
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
    <div className="relative h-dvh overflow-hidden bg-[var(--mind-canvas)] text-[var(--mind-ink)]">
      <header className="absolute left-5 top-5 z-40 sm:left-8 sm:top-7">
        <h1 className="m-0 font-serif text-[30px] font-normal tracking-[-0.06em] text-[var(--mind-ink)]">mind<span className="text-[#c7472c]">.</span></h1>
      </header>
      <section
        className="h-full"
        aria-label="Mind explorer"
      >
        <div className="pointer-events-none absolute inset-x-0 top-5 z-40 flex items-start justify-center px-4 sm:top-7">
          <label className="pointer-events-auto mt-14 flex w-full max-w-[460px] items-center gap-3 rounded-full border border-[var(--mind-outline)] bg-[var(--mind-canvas)]/90 px-5 py-3 text-[var(--mind-muted)] backdrop-blur-md focus-within:outline-2 focus-within:outline-[var(--mind-accent)] sm:mt-0 sm:w-[40%]">
            <Search size={17} />
            <input
              className="min-w-0 w-full border-0 bg-transparent text-[14px] text-[var(--mind-ink)] outline-none placeholder:text-[var(--mind-placeholder)]"
              aria-label="Search mind"
              placeholder="Find a thought, person, project…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(null); setBranch(null); }}
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
          <div className="pointer-events-auto absolute right-5 top-0 flex gap-2 sm:right-8" role="group" aria-label="Mind view">
            <button type="button" className={cn(mindControlClass, mindToolClass, "rounded-full")} aria-pressed={list} onClick={() => setList(true)}>
              <List size={16} /> List
            </button>
            <button type="button" className={cn(mindControlClass, mindToolClass, "rounded-full")} aria-pressed={!list} onClick={() => setList(false)}>
              <Network size={16} /> Map
            </button>
          </div>
        </div>

        {branch && (
          <div className="absolute left-1/2 top-32 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[var(--mind-surface)] px-4 py-1 text-xs text-[var(--mind-accent)] sm:top-24">
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
            {!records.length && list ? (
              <div className={mindFallbackClass}>
                <Search size={30} />
                <h2 className="text-[20px] text-[var(--mind-ink)]">
                  No matching records
                </h2>
                <p className="max-w-[390px]">Try another search or category.</p>
                <button
                  className={cn("text-[var(--mind-accent)] underline", mindControlClass)}
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
                      "flex w-full items-center gap-3 border-b border-[var(--mind-border)] p-3 text-left hover:bg-[color-mix(in_srgb,var(--mind-accent)_6.27%,transparent)] aria-pressed:bg-[color-mix(in_srgb,var(--mind-accent)_6.27%,transparent)]",
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
                      <small className="mt-1 block text-[12px] text-[var(--mind-muted)]">
                        {KINDS[n.kind].label}
                        {n.status ? ` · ${n.status.replaceAll("_", " ")}` : ""}
                      </small>
                    </span>
                    <ArrowUpRight
                      className="shrink-0 text-[var(--mind-muted)]"
                      size={15}
                    />
                  </button>
                ))}
              </div>
            ) : (
              <MapBoundary>
                <Scene
                  graph={completion?.fading ? { ...world, exitingId: completion.id } : world}
                  selected={selected}
                  onSelect={selectNode}
                  reset={reset}
                  focusKey={branch || query.trim()}
                />
              </MapBoundary>
            )}

          </div>
          {!list && query.trim() && !records.length && <p role="status" className="pointer-events-none absolute inset-x-0 top-6 z-20 text-center text-sm text-[var(--mind-muted)]">No matching records</p>}
          {selected && <aside
            className="absolute bottom-4 right-4 top-4 z-30 w-[340px] max-w-[calc(100%-32px)] overflow-y-auto rounded-xl border border-[var(--mind-border)] bg-[color-mix(in_srgb,var(--mind-panel)_96.08%,transparent)] p-[22px] shadow-[0_12px_45px_color-mix(in_srgb,var(--mind-ink)_5.1%,transparent)] [scrollbar-width:thin] max-[700px]:left-3 max-[700px]:right-3 max-[700px]:top-auto max-[700px]:max-h-[55%] max-[700px]:w-auto max-[700px]:p-4"
            aria-label="Selected record"
            aria-live="polite"
          >
            {!node && <button className={cn("float-right p-1", mindControlClass)} onClick={() => selectNode(null)} aria-label="Close browser"><X size={18} /></button>}
            {selectedKind ? (
              <div>
                <p className="text-[12px] uppercase tracking-[.15em] text-[var(--mind-muted)]">
                  {owner.title} / category
                </p>
                <h2
                  className="my-3 border-l-4 pl-3 text-[24px] font-semibold"
                  style={{ borderLeftColor: "var(--mind-neutral)" }}
                >
                  {KINDS[selectedKind].label}
                </h2>
                <p className="mb-5 text-[14px] leading-[1.8] text-[var(--mind-muted)]">
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
                          "rounded-md border-b border-[var(--mind-border)] px-2 py-3 text-left text-[12px] text-[var(--mind-text)] hover:bg-[color-mix(in_srgb,var(--mind-accent)_6.27%,transparent)]",
                          mindControlClass,
                        )}
                        onClick={() => selectNode(record.id)}
                      >
                        {record.title}
                      </button>
                    ))}
                </div>
                {!records.some((n) => n.kind === selectedKind) && (
                  <p className="text-[12px] text-[var(--mind-muted)]">
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
                  <span className="text-[var(--mind-text)]">
                    {KINDS[node.kind].label}
                  </span>
                  <button
                    className={cn("p-[5px] text-[var(--mind-muted)]", mindControlClass)}
                    onClick={() => selectNode(null)}
                    aria-label="Close record"
                  >
                    <X size={17} />
                  </button>
                </div>
                <h2 className="my-3 flex items-start gap-3 font-serif text-[28px] font-normal leading-[1.35] tracking-[-0.025em] [overflow-wrap:anywhere]">
                  <span className="mt-[.5em] size-2.5 shrink-0 rounded-full" role="img" aria-label={ATTENTION[resolveAttention(node.kind, node, now).status].label} style={{ background: ATTENTION[resolveAttention(node.kind, node, now).status].color }} />
                  <span className="min-w-0">{node.title}</span>
                </h2>
                {node.kind === "task" && <AttentionEditor key={node.id} kind={node.kind} id={node.id} actionsOnly onCompleteTask={finishSelectedTask} />}
                {node.status && (
                  <span className="inline-block rounded bg-[color-mix(in_srgb,var(--mind-accent)_7.45%,transparent)] px-[7px] py-1 text-[12px] text-[var(--mind-accent)]">
                    {node.status.replaceAll("_", " ")}
                  </span>
                )}
                <p className="mb-[18px] mt-3 whitespace-pre-wrap text-[14px] leading-[1.8] text-[var(--mind-muted)] [overflow-wrap:anywhere]">
                  {node.summary || "No description saved yet."}
                </p>
                <Link
                  className={cn(
                    "flex items-center justify-between border-b border-[var(--mind-border)] pb-3.5 pt-2.5 text-[12px] text-[var(--mind-accent)]",
                    mindControlClass,
                  )}
                  href={node.href}
                >
                  Open record <ArrowUpRight size={15} />
                </Link>
                <h3 className="mb-3 mt-[26px] text-[12px] uppercase tracking-[0.1em] text-[var(--mind-muted)]">
                  Saved relationships{" "}
                  <span className="ml-2 text-[var(--mind-muted)]">
                    {neighbors.length}
                  </span>
                </h3>
                {neighbors.length ? (
                  <div className="flex flex-col gap-1">
                    {neighbors.map(({ edge, node: neighbor }) => (
                      <button
                        className={cn(
                          "rounded-md px-2 py-2.5 text-left [overflow-wrap:anywhere] hover:bg-[color-mix(in_srgb,var(--mind-accent)_4.71%,transparent)]",
                          mindControlClass,
                        )}
                        key={edge.id}
                        onClick={() => selectNode(neighbor.id)}
                      >
                        <small className="mb-[5px] block text-[12px] text-[var(--mind-muted)]">
                          {edge.source === selected ? "→" : "←"}{" "}
                          {edge.type.replaceAll("_", " ")}
                        </small>
                        <span className="flex items-baseline gap-2 text-[12px] leading-[1.5] text-[var(--mind-text)]">
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
                  <p className="mb-[18px] mt-3 whitespace-pre-wrap text-[14px] leading-[1.8] text-[var(--mind-muted)] [overflow-wrap:anywhere]">
                    No saved relationships in this sample yet. This record is
                    shown in your world.
                  </p>
                )}
              </>
            ) : (
              <div className="pt-3">
                <div className="mb-6 grid size-[70px] place-items-center rounded-full border border-[color-mix(in_srgb,var(--mind-accent)_26.67%,transparent)] bg-[color-mix(in_srgb,var(--mind-accent)_3.92%,transparent)] text-[var(--mind-ink)]">
                  <Network size={32} />
                </div>
                <p className="text-[12px] uppercase tracking-[.17em] text-[var(--mind-muted)]">
                  At the center
                </p>
                <h2 className="my-3 text-[26px] font-semibold tracking-tight">
                  {owner.title}
                </h2>
                <p className="mb-6 text-[14px] leading-[1.8] text-[var(--mind-muted)]">
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
                        "flex items-center gap-3 rounded-md px-2 py-3 text-left text-[12px] hover:bg-[color-mix(in_srgb,var(--mind-accent)_6.27%,transparent)]",
                        mindControlClass,
                      )}
                      onClick={() => selectNode(categoryId(kind))}
                    >
                      <i
                        className="size-2 rounded-full"
                        style={{ background: KINDS[kind].color }}
                      />
                      <span className="flex-1">{KINDS[kind].label}</span>
                      <span className="text-[var(--mind-muted)]">
                        {counts.get(kind) || 0}
                      </span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
                <p className="mt-6 text-[14px] leading-[1.8] text-[var(--mind-muted)]">
                  Shapes and colors identify categories; coral halos flag immediate attention. Select a record to
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
