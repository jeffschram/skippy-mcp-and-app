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
import "./mind.css";

const Scene = dynamic(() => import("./mind-scene"), {
  ssr: false,
  loading: () => (
    <div className="mind-fallback">Preparing your constellation…</div>
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
      <div className="mind-fallback">
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
        <div className="mind-loading" role="status">
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
    <div className="mind-page">
      <header className="mind-heading">
        <div>
          <p className="mind-eyebrow">A different perspective</p>
          <h1>
            Mind<span>Experiment</span>
          </h1>
          <p>Follow a thought. See where it leads.</p>
        </div>
        <div className="mind-stats">
          <strong>{graph.nodes.length}</strong> records <span>·</span>{" "}
          <strong>{graph.edges.length}</strong> connections
        </div>
      </header>
      <section className="mind-workspace" aria-label="Mind explorer">
        <div className="mind-toolbar">
          <label className="mind-search">
            <Search size={17} />
            <input
              aria-label="Search mind"
              placeholder="Find a thought, person, project…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button aria-label="Clear search" onClick={() => setQuery("")}>
                <X size={15} />
              </button>
            )}
          </label>
          <div className="mind-tools">
            <button aria-pressed={!list} onClick={() => setList(false)}>
              <Network size={16} />
              3D
            </button>
            <button aria-pressed={list} onClick={() => setList(true)}>
              <List size={16} />
              List
            </button>
            <button onClick={() => setReset((n) => n + 1)} title="Reset camera">
              <RotateCcw size={16} />
              <span className="mind-reset-label">Reset view</span>
            </button>
          </div>
        </div>
        <div className="mind-filters" aria-label="Filter record types">
          {(Object.keys(KINDS) as MindKind[]).map((kind) => (
            <button
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
              <i style={{ background: KINDS[kind].color }} />
              {KINDS[kind].label}
              <span>{counts.get(kind) || 0}</span>
            </button>
          ))}
        </div>
        {focus && (
          <div className="mind-focus-bar">
            <Focus size={14} />
            Neighborhood of {graph.nodes.find((n) => n.id === focus)?.title}
            <button onClick={() => setFocus(null)}>
              Show whole map <X size={13} />
            </button>
          </div>
        )}
        <div className="mind-body">
          <div className="mind-map">
            {!graph.nodes.length ? (
              <div className="mind-fallback">
                <Network size={38} />
                <h2>Your mind map starts here</h2>
                <p>
                  Saved projects, tasks, people, companies, and Knowledge will
                  appear here. Connections appear as Skippy links them.
                </p>
              </div>
            ) : !visible.nodes.length ? (
              <div className="mind-fallback">
                <Search size={30} />
                <h2>No matching records</h2>
                <p>Try another search or include more record types.</p>
                <button onClick={clear}>Clear filters</button>
              </div>
            ) : list ? (
              <div className="mind-record-list" aria-label="Records">
                {visible.nodes.map((n) => (
                  <button
                    key={n.id}
                    aria-pressed={selected === n.id}
                    onClick={() => setSelected(n.id)}
                  >
                    <i style={{ background: KINDS[n.kind].color }} />
                    <span>
                      <strong>{n.title}</strong>
                      <small>
                        {KINDS[n.kind].label}
                        {n.status ? ` · ${n.status.replaceAll("_", " ")}` : ""}
                      </small>
                    </span>
                    <ArrowUpRight size={15} />
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
            <div className="mind-map-footer">
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
            className="mind-inspector"
            aria-label="Selected record"
            aria-live="polite"
          >
            {node ? (
              <>
                <div className="mind-inspector-top">
                  <span style={{ color: KINDS[node.kind].color }}>
                    {KINDS[node.kind].label}
                  </span>
                  <button
                    onClick={() => setSelected(null)}
                    aria-label="Close record"
                  >
                    <X size={17} />
                  </button>
                </div>
                <h2>{node.title}</h2>
                {node.status && (
                  <span className="mind-status">
                    {node.status.replaceAll("_", " ")}
                  </span>
                )}
                <p className="mind-summary">
                  {node.summary || "No description saved yet."}
                </p>
                <Link className="mind-open" href={node.href}>
                  Open in Skippy <ArrowUpRight size={15} />
                </Link>
                <button
                  className="mind-neighborhood"
                  onClick={() => {
                    setFocus(node.id);
                    setQuery("");
                    setEnabled(new Set(Object.keys(KINDS) as MindKind[]));
                  }}
                >
                  <Focus size={16} />
                  Explore this neighborhood
                </button>
                <h3>
                  Connections <span>{neighbors.length}</span>
                </h3>
                {neighbors.length ? (
                  <div className="mind-neighbors">
                    {neighbors.map(({ edge, node: neighbor }) => (
                      <button
                        key={edge.id}
                        onClick={() => setSelected(neighbor.id)}
                      >
                        <small>
                          {edge.source === selected ? "→" : "←"}{" "}
                          {edge.type.replaceAll("_", " ")}
                        </small>
                        <span>
                          <i
                            style={{ background: KINDS[neighbor.kind].color }}
                          />
                          {neighbor.title}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mind-summary">
                    No connections in this view yet. This record still has a
                    place in your Mind.
                  </p>
                )}
              </>
            ) : (
              <div className="mind-inspector-empty">
                <div className="mind-orbit-icon">
                  <Network size={32} />
                </div>
                <p className="mind-eyebrow">
                  Everything is connected.
                  <br />
                  Some links are still waiting.
                </p>
                <h2>Start anywhere.</h2>
                <p>
                  Select a dot to see what it holds and follow its connections.
                </p>
                <div className="mind-tip">
                  <span>01</span>Colors distinguish record types.
                </div>
                <div className="mind-tip">
                  <span>02</span>Larger dots have more connections.
                </div>
                <div className="mind-tip">
                  <span>03</span>Lines are saved relationships, not guesses.
                </div>
                <button
                  className="mind-neighborhood"
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
      <p className="mind-caption">
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
