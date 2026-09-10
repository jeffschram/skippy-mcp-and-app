"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Component, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import {
  ArrowUpRight,
  Focus,
  List,
  Network,
  RotateCcw,
  Search,
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
        <div className="p-20 text-center text-[#73869a]" role="status">
          Gathering your thoughts and connections…
        </div>
      )}
    </LiveGate>
  );
}
export function MindExplorer({ graph }: { graph: MindGraph }) {
  const [query, setQuery] = useState("");
  const [enabled, setEnabled] = useState(
    () => new Set(Object.keys(KINDS) as MindKind[]),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [branch, setBranch] = useState<MindKind | null>(null);
  const [list, setList] = useState(false);
  const [reset, setReset] = useState(0);
  const owner = graph.owner || { id: "owner:self", title: "You" };
  const selectedKind = categoryKind(selected);
  const shownKinds = useMemo(
    () => new Set([...enabled].filter((k) => !branch || k === branch)),
    [enabled, branch],
  );
  const visible = useMemo(
    () => filterGraph(graph, shownKinds, query, focus),
    [graph, shownKinds, query, focus],
  );
  const world = useMemo(
    () => buildMyWorld(graph, visible, shownKinds),
    [graph, visible, shownKinds],
  );
  const node = graph.nodes.find((n) => n.id === selected);
  const records = visible.nodes.filter((n) => n.id !== owner.personId);
  function selectNode(id: string | null) {
    if (id === owner.id || id === owner.personId) {
      clear();
      setSelected(owner.id);
      return;
    }
    const kind = categoryKind(id);
    if (kind) {
      setBranch(kind);
      setFocus(null);
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
    setFocus(null);
    setBranch(null);
    setSelected(null);
    setReset((n) => n + 1);
  }
  return (
    <div>
      <header className="mb-[22px] flex items-end justify-between gap-5">
        <div>
          <p className="mb-[7px] mt-0 text-[10px] font-bold uppercase leading-[1.8] tracking-[0.17em] text-[#738ca6]">
            Your world, connected
          </p>
          <h1 className="mb-[7px] mt-0 flex items-center gap-3.5 text-[36px] font-[650] leading-[1.2] tracking-[-0.045em] max-[700px]:text-[30px]">
            Mind
            <span className="rounded-md border border-[#a7ceee70] bg-[#a7ceee20] px-2 py-[5px] text-[10px] uppercase tracking-[0.03em] text-[#54799a]">
              Experiment
            </span>
          </h1>
          <p className="text-[14px] text-[#73869a]">
            You at the center. Every part of your world within reach.
          </p>
        </div>
        <div className="whitespace-nowrap pb-[3px] text-[12px] text-[#71859a] max-[1050px]:hidden">
          <strong className="text-[18px] font-[650] text-inherit">
            {graph.nodes.length}
          </strong>{" "}
          records <span className="px-2.5">·</span>{" "}
          <strong className="text-[18px] font-[650] text-inherit">
            {graph.edges.length}
          </strong>{" "}
          saved relationships
        </div>
      </header>
      <section
        className="overflow-hidden rounded-[18px] border border-[#21334a] bg-[#0b1220] text-[#e2eaf5] shadow-[0_20px_50px_#06112117] max-[700px]:rounded-xl"
        aria-label="Mind explorer"
      >
        <div className="flex items-center justify-between gap-4 border-b border-[#ffffff13] px-5 py-4 max-[700px]:flex-wrap max-[700px]:gap-2 max-[700px]:p-3">
          <label className="flex max-w-[480px] flex-1 items-center gap-2.5 text-[#93a7be] focus-within:rounded-md focus-within:outline-2 focus-within:outline-offset-[3px] focus-within:outline-[#a7ceee] max-[700px]:max-w-none max-[700px]:basis-full">
            <Search size={17} />
            <input
              className="min-w-0 w-full border-0 bg-transparent text-[13px] text-[#e2eaf5] outline-none placeholder:text-[#7890a9]"
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
          <div className="flex flex-wrap gap-[5px]">
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
          </div>
        </div>
        <div
          className="flex flex-wrap gap-1.5 border-b border-[#ffffff13] px-5 py-3 max-[700px]:gap-0.5 max-[700px]:p-2.5"
          aria-label="Filter record types"
        >
          {(Object.keys(KINDS) as MindKind[]).map((kind) => (
            <button
              className={cn(
                "flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1.5 text-[11px] text-[#93a7be] opacity-40 aria-pressed:border-[#ffffff10] aria-pressed:bg-[#ffffff04] aria-pressed:opacity-100 max-[700px]:p-[5px] max-[700px]:text-[10px]",
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
                style={{ background: KINDS[kind].color }}
              />
              {KINDS[kind].label}
              <span className="ml-0.5 text-[10px] text-[#7089a4]">
                {counts.get(kind) || 0}
              </span>
            </button>
          ))}
        </div>
        {(focus || branch) && (
          <div className="flex flex-wrap items-center gap-2 bg-[#a7ceee0b] px-5 py-1 text-[12px] text-[#a7ceee]">
            <Focus size={14} />
            {branch
              ? KINDS[branch].label
              : `Connections of ${graph.nodes.find((n) => n.id === focus)?.title}`}
            <button
              className={cn("ml-auto", mindControlClass, mindToolClass)}
              onClick={() => {
                setFocus(null);
                setBranch(null);
                setSelected(null);
              }}
            >
              Show whole map <X size={13} />
            </button>
          </div>
        )}
        <div className="grid h-[calc(100dvh-300px)] min-h-[620px] max-h-[950px] grid-cols-[minmax(0,2fr)_minmax(340px,1fr)] max-[700px]:flex max-[700px]:h-auto max-[700px]:min-h-0 max-[700px]:max-h-none max-[700px]:flex-col">
          <div className="relative min-h-[450px] min-w-0 overflow-hidden bg-[radial-gradient(ellipse_at_45%_45%,#18294360,transparent_70%),radial-gradient(#93b9e710_0.7px,transparent_0.7px)] bg-size-[auto,24px_24px] max-[700px]:h-[480px] max-[700px]:min-h-0">
            {list && !records.length ? (
              <div className={mindFallbackClass}>
                <Search size={30} />
                <h2 className="text-[20px] text-[#dce8f6]">
                  No matching records
                </h2>
                <p className="max-w-[390px]">Try another search or category.</p>
                <button
                  className={cn("text-[#a7ceee] underline", mindControlClass)}
                  onClick={clear}
                >
                  Show my world
                </button>
              </div>
            ) : list ? (
              <div
                className="h-full overflow-auto px-4 pb-[55px] pt-3 [scrollbar-width:thin]"
                aria-label="Records"
              >
                {records.map((n) => (
                  <button
                    className={cn(
                      "flex w-full items-center gap-3 border-b border-[#ffffff13] p-3 text-left hover:bg-[#a7ceee10] aria-pressed:bg-[#a7ceee10]",
                      mindControlClass,
                    )}
                    key={n.id}
                    aria-pressed={selected === n.id}
                    onClick={() => selectNode(n.id)}
                  >
                    <i
                      className="inline-block size-1.5 shrink-0 rounded-full"
                      style={{ background: KINDS[n.kind].color }}
                    />
                    <span className="min-w-0 flex-1">
                      <strong className="block text-[12px] font-medium [overflow-wrap:anywhere]">
                        {n.title}
                      </strong>
                      <small className="mt-1 block text-[10px] text-[#7891ab]">
                        {KINDS[n.kind].label}
                        {n.status ? ` · ${n.status.replaceAll("_", " ")}` : ""}
                      </small>
                    </span>
                    <ArrowUpRight
                      className="shrink-0 text-[#7891ab]"
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
                />
              </MapBoundary>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between gap-3 bg-[linear-gradient(transparent,#0b1220)] px-[18px] py-3.5 text-[10px] text-[#748ba4] max-[700px]:flex-col max-[700px]:gap-1 max-[700px]:text-[9px]">
              <span>
                {records.length} records around you
                {graph.limited ? " · Showing a sample of your brain" : ""}
              </span>
              <span>
                {list
                  ? "Select a record to explore"
                  : "Drag to orbit · Scroll to zoom · Right-drag to pan"}
              </span>
            </div>
          </div>
          <aside
            className="overflow-y-auto border-l border-[#ffffff13] bg-[#101b2c80] p-[22px] [scrollbar-width:thin] [scrollbar-color:#30445d_transparent] max-[1050px]:p-4 max-[700px]:max-h-[420px] max-[700px]:border-l-0 max-[700px]:border-t"
            aria-label="Selected record"
            aria-live="polite"
          >
            {selectedKind ? (
              <div>
                <p className="text-[11px] uppercase tracking-[.15em] text-[#93a7be]">
                  {owner.title} / category
                </p>
                <h2
                  className="my-3 text-[24px] font-semibold"
                  style={{ color: KINDS[selectedKind].color }}
                >
                  {KINDS[selectedKind].label}
                </h2>
                <p className="mb-5 text-[12px] leading-[1.8] text-[#98acc2]">
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
                          "rounded-md border-b border-[#ffffff13] px-2 py-3 text-left text-[12px] text-[#c3d2e3] hover:bg-[#a7ceee10]",
                          mindControlClass,
                        )}
                        onClick={() => selectNode(record.id)}
                      >
                        {record.title}
                      </button>
                    ))}
                </div>
                {!records.some((n) => n.kind === selectedKind) && (
                  <p className="text-[12px] text-[#93a7be]">
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
                <div className="flex items-center justify-between text-[11px]">
                  <span style={{ color: KINDS[node.kind].color }}>
                    {KINDS[node.kind].label}
                  </span>
                  <button
                    className={cn("p-[5px] text-[#93a7be]", mindControlClass)}
                    onClick={() => setSelected(null)}
                    aria-label="Close record"
                  >
                    <X size={17} />
                  </button>
                </div>
                <h2 className="my-3 text-[21px] font-semibold leading-[1.35] tracking-[-0.025em] [overflow-wrap:anywhere]">
                  {node.title}
                </h2>
                {node.status && (
                  <span className="inline-block rounded bg-[#a7ceee13] px-[7px] py-1 text-[10px] text-[#a7ceee]">
                    {node.status.replaceAll("_", " ")}
                  </span>
                )}
                <p className="mb-[18px] mt-3 whitespace-pre-wrap text-[12px] leading-[1.8] text-[#98acc2] [overflow-wrap:anywhere]">
                  {node.summary || "No description saved yet."}
                </p>
                <Link
                  className={cn(
                    "flex items-center justify-between border-b border-[#ffffff13] pb-3.5 pt-2.5 text-[12px] text-[#bddcf5]",
                    mindControlClass,
                  )}
                  href={node.href}
                >
                  Open in Skippy <ArrowUpRight size={15} />
                </Link>
                <button
                  className={cn(mindControlClass, mindNeighborhoodClass)}
                  onClick={() => {
                    setFocus(node.id);
                    setBranch(null);
                    setQuery("");
                    setEnabled(new Set(Object.keys(KINDS) as MindKind[]));
                  }}
                >
                  <Focus size={16} />
                  Explore saved connections
                </button>
                <h3 className="mb-3 mt-[26px] text-[11px] uppercase tracking-[0.1em] text-[#9fb3c9]">
                  Saved relationships{" "}
                  <span className="ml-2 text-[#617e9c]">
                    {neighbors.length}
                  </span>
                </h3>
                {neighbors.length ? (
                  <div className="flex flex-col gap-1">
                    {neighbors.map(({ edge, node: neighbor }) => (
                      <button
                        className={cn(
                          "rounded-md px-2 py-2.5 text-left [overflow-wrap:anywhere] hover:bg-[#a7ceee0c]",
                          mindControlClass,
                        )}
                        key={edge.id}
                        onClick={() => selectNode(neighbor.id)}
                      >
                        <small className="mb-[5px] block text-[10px] text-[#708eab]">
                          {edge.source === selected ? "→" : "←"}{" "}
                          {edge.type.replaceAll("_", " ")}
                        </small>
                        <span className="flex items-baseline gap-2 text-[12px] leading-[1.5] text-[#c3d2e3]">
                          <i
                            className="inline-block size-1.5 shrink-0 rounded-full"
                            style={{ background: KINDS[neighbor.kind].color }}
                          />
                          {neighbor.title}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mb-[18px] mt-3 whitespace-pre-wrap text-[12px] leading-[1.8] text-[#98acc2] [overflow-wrap:anywhere]">
                    No saved relationships in this sample yet. This record is
                    shown in its category color in your world.
                  </p>
                )}
              </>
            ) : (
              <div className="pt-3">
                <div className="mb-6 grid size-[70px] place-items-center rounded-full border border-[#a7ceee44] bg-[#a7ceee0a] text-[#dceeff]">
                  <Network size={32} />
                </div>
                <p className="text-[10px] uppercase tracking-[.17em] text-[#93a7be]">
                  At the center
                </p>
                <h2 className="my-3 text-[26px] font-semibold tracking-tight">
                  {owner.title}
                </h2>
                <p className="mb-6 text-[12px] leading-[1.8] text-[#98acc2]">
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
                        "flex items-center gap-3 rounded-md px-2 py-3 text-left text-[12px] hover:bg-[#a7ceee10]",
                        mindControlClass,
                      )}
                      onClick={() => selectNode(categoryId(kind))}
                    >
                      <i
                        className="size-2 rounded-full"
                        style={{ background: KINDS[kind].color }}
                      />
                      <span className="flex-1">{KINDS[kind].label}</span>
                      <span className="text-[#93a7be]">
                        {counts.get(kind) || 0}
                      </span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
                <p className="mt-6 text-[11px] leading-[1.8] text-[#7891ab]">
                  Colors identify each record’s category. Select a record to
                  highlight its saved relationships across the map.
                </p>
              </div>
            )}
          </aside>
        </div>
      </section>
      <p className="mx-[3px] my-[13px] text-[11px] leading-[1.8] text-[#71849a]">
        Your world surrounds you in 3D. Colors identify categories; highlighted
        cross-links show saved relationships. Projects, tasks, goals, people,
        companies, and all four Knowledge kinds are included.
        {graph.limited
          ? " This experiment shows up to 70 records of each type and connections from a bounded sample."
          : ""}
      </p>
    </div>
  );
}
