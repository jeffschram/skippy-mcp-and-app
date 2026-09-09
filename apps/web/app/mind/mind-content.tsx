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
import { filterGraph, KINDS, layoutGraph } from "./graph-layout";
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
  const [list, setList] = useState(false);
  const [reset, setReset] = useState(0);
  const positions = useMemo(() => layoutGraph(graph), [graph]);
  const visible = useMemo(
    () => filterGraph(graph, enabled, query, focus),
    [graph, enabled, query, focus],
  );
  const node = graph.nodes.find((n) => n.id === selected);
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
    graph.nodes.forEach((n) =>
      result.set(n.kind, (result.get(n.kind) || 0) + 1),
    );
    return result;
  }, [graph]);
  function clear() {
    setQuery("");
    setEnabled(new Set(Object.keys(KINDS) as MindKind[]));
    setFocus(null);
    setSelected(null);
    setReset((n) => n + 1);
  }
  return (
    <div className="mx-auto max-w-[1800px]">
      <header className="mb-[22px] flex items-end justify-between gap-5">
        <div>
          <p className="mb-[7px] mt-0 text-[10px] font-bold uppercase leading-[1.8] tracking-[0.17em] text-[#738ca6]">
            A different perspective
          </p>
          <h1 className="mb-[7px] mt-0 flex items-center gap-3.5 text-[36px] font-[650] leading-[1.2] tracking-[-0.045em] max-[700px]:text-[30px]">
            Mind
            <span className="rounded-md border border-[#a7ceee70] bg-[#a7ceee20] px-2 py-[5px] text-[10px] uppercase tracking-[0.03em] text-[#54799a]">
              Experiment
            </span>
          </h1>
          <p className="text-[14px] text-[#73869a]">
            Follow a thought. See where it leads.
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
          connections
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
          <div className="flex gap-[5px]">
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
        {focus && (
          <div className="flex flex-wrap items-center gap-2 bg-[#a7ceee0b] px-5 py-1 text-[12px] text-[#a7ceee]">
            <Focus size={14} />
            Neighborhood of {graph.nodes.find((n) => n.id === focus)?.title}
            <button
              className={cn("ml-auto", mindControlClass, mindToolClass)}
              onClick={() => setFocus(null)}
            >
              Show whole map <X size={13} />
            </button>
          </div>
        )}
        <div className="grid h-[calc(100dvh-300px)] min-h-[620px] max-h-[950px] grid-cols-[minmax(0,1fr)_290px] max-[1050px]:grid-cols-[minmax(0,1fr)_250px] max-[700px]:flex max-[700px]:h-auto max-[700px]:min-h-0 max-[700px]:max-h-none max-[700px]:flex-col">
          <div className="relative min-h-[450px] min-w-0 overflow-hidden bg-[radial-gradient(ellipse_at_45%_45%,#18294360,transparent_70%),radial-gradient(#93b9e710_0.7px,transparent_0.7px)] bg-size-[auto,24px_24px] max-[700px]:h-[480px] max-[700px]:min-h-0">
            {!graph.nodes.length ? (
              <div className={mindFallbackClass}>
                <Network size={38} />
                <h2 className="text-[20px] text-[#dce8f6]">
                  Your mind map starts here
                </h2>
                <p className="max-w-[390px]">
                  Saved projects, tasks, people, companies, and Knowledge will
                  appear here. Connections appear as Skippy links them.
                </p>
              </div>
            ) : !visible.nodes.length ? (
              <div className={mindFallbackClass}>
                <Search size={30} />
                <h2 className="text-[20px] text-[#dce8f6]">
                  No matching records
                </h2>
                <p className="max-w-[390px]">
                  Try another search or include more record types.
                </p>
                <button
                  className={cn("text-[#a7ceee] underline", mindControlClass)}
                  onClick={clear}
                >
                  Clear filters
                </button>
              </div>
            ) : list ? (
              <div
                className="h-full overflow-auto px-4 pb-[55px] pt-3 [scrollbar-width:thin]"
                aria-label="Records"
              >
                {visible.nodes.map((n) => (
                  <button
                    className={cn(
                      "flex w-full items-center gap-3 border-b border-[#ffffff13] p-3 text-left hover:bg-[#a7ceee10] aria-pressed:bg-[#a7ceee10]",
                      mindControlClass,
                    )}
                    key={n.id}
                    aria-pressed={selected === n.id}
                    onClick={() => setSelected(n.id)}
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
                  graph={visible}
                  positions={positions}
                  selected={selected}
                  onSelect={setSelected}
                  reset={reset}
                />
              </MapBoundary>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between gap-3 bg-[linear-gradient(transparent,#0b1220)] px-[18px] py-3.5 text-[10px] text-[#748ba4] max-[700px]:flex-col max-[700px]:gap-1 max-[700px]:text-[9px]">
              <span>
                {visible.nodes.length} visible
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
            {node ? (
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
                    setQuery("");
                    setEnabled(new Set(Object.keys(KINDS) as MindKind[]));
                  }}
                >
                  <Focus size={16} />
                  Explore this neighborhood
                </button>
                <h3 className="mb-3 mt-[26px] text-[11px] uppercase tracking-[0.1em] text-[#9fb3c9]">
                  Connections{" "}
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
                        onClick={() => setSelected(neighbor.id)}
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
                    No connections in this view yet. This record still has a
                    place in your Mind.
                  </p>
                )}
              </>
            ) : (
              <div className="pt-[30px] max-[700px]:p-[5px]">
                <div className="mb-8 mt-[5px] grid size-[70px] place-items-center rounded-full border border-[#a7ceee22] text-[#a7ceee] shadow-[0_0_0_10px_#a7ceee04,0_0_40px_#a7ceee08] max-[700px]:hidden">
                  <Network size={32} />
                </div>
                <p className="mb-[7px] mt-0 text-[10px] font-bold uppercase leading-[1.8] tracking-[0.17em] text-[#738ca6]">
                  Everything is connected.
                  <br />
                  Some links are still waiting.
                </p>
                <h2 className="my-3 text-[21px] font-semibold leading-[1.35] tracking-[-0.025em] [overflow-wrap:anywhere]">
                  Start anywhere.
                </h2>
                <p className="mb-[26px] mt-3 text-[12px] leading-[1.8] text-[#8ba2ba]">
                  Select a dot to see what it holds and follow its connections.
                </p>
                <div className="my-[15px] flex gap-2.5 text-[11px] leading-[1.7] text-[#8ba2ba] max-[700px]:hidden">
                  <span className="font-mono text-[#547492]">01</span>Colors
                  distinguish record types.
                </div>
                <div className="my-[15px] flex gap-2.5 text-[11px] leading-[1.7] text-[#8ba2ba] max-[700px]:hidden">
                  <span className="font-mono text-[#547492]">02</span>Larger
                  dots have more connections.
                </div>
                <div className="my-[15px] flex gap-2.5 text-[11px] leading-[1.7] text-[#8ba2ba] max-[700px]:hidden">
                  <span className="font-mono text-[#547492]">03</span>Lines are
                  saved relationships, not guesses.
                </div>
                <button
                  className={cn(mindControlClass, mindNeighborhoodClass)}
                  onClick={() => setList(true)}
                >
                  <List size={16} />
                  Browse records as a list
                </button>
              </div>
            )}
          </aside>
        </div>
      </section>
      <p className="mx-[3px] my-[13px] text-[11px] leading-[1.8] text-[#71849a]">
        Projects, tasks, goals, people, companies & Knowledge. Nearby dots are
        arranged by their connections; distance is a visual aid, not a measure
        of meaning.
        {graph.limited
          ? " This experiment shows up to 70 records of each type and connections from a bounded sample."
          : ""}
      </p>
    </div>
  );
}
