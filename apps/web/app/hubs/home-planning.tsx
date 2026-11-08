"use client";

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { HomeActionsProvider, HomeItemActions, ItemActionFeedback } from "./home-item-actions";
import { ItemDetailsModal } from "./item-details-modal";
import { TASK_AREAS } from "@skippy/shared";
import { api } from "../../lib/skippy-api";
import { Button, Dialog, LoadingRow, Section, Select } from "../components";
import { useViewerReady } from "./use-viewer";
import { AddRow, HomeItemRow } from "./life-tasks";
import { areaLabel } from "./life-tasks-helpers";
import type { AgendaRow } from "./agenda-rows";
import { homePeriods, parseHomeHash } from "./home-planning-helpers";
import { buildTodaySummary } from "../../../../convex/todayModel";

type Scope = ReturnType<typeof homePeriods> & { area: string | null; status: "open" | "completed" | "paused" };
type Page = { rows: any[]; hasMore: boolean; cursor: string | null };
function adapt(row: any, start: number): AgendaRow {
  return { ...row, at: row.at ?? undefined, area: row.area ?? undefined, areaLabel: row.area ? areaLabel(row.area) : undefined,
    isOverdue: row.kind !== "event" && !row.isWant && row.at !== null && row.at < start };
}

// Each mounted page stays reactive. Parent-owned cursors preserve loaded pages
// when All collapses or a dialog opens; changed filters start a fresh list.
function Inventory({ period, scope, now, renderRow, moreInAll }: {
  period: "today" | "week" | "all"; scope: Scope; now: number;
  renderRow: (row: any) => React.ReactNode; moreInAll: () => void;
}) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [batchLimit, setBatchLimit] = useState(10);
  const [target, setTarget] = useState(period === "all" ? 50 : 20);
  const [pages, setPages] = useState<Record<number, Page>>({});
  const rows = Object.values(pages).flatMap(page => page.rows).filter(row => row.kind !== "event" ||
    (row.endAt ?? row.at) > (row.isAllDay ? scope.utcToday : now));
  const unique = [...new Map(rows.map(row => [`${row.kind}:${row.id}`, row])).values()];
  if (period === "today") {
    const overdue = (row: any) => row.kind !== "event" && row.at !== null && row.at < scope.start;
    unique.sort((a, b) => Number(overdue(b)) - Number(overdue(a)));
  }
  const limit = period === "all" ? target : 20;
  const summary = period === "today" ? buildTodaySummary(unique.slice(0, limit).filter(r => r.at >= scope.start || r.kind === "event")
    .map(r => ({ source: r.kind, at: r.at, endAt: r.endAt ?? undefined, isAllDay: r.isAllDay }))) : null;
  useEffect(() => {
    // A reactive insertion/deletion can move a page boundary. Rebuild its
    // suffix so stale cursors cannot leave gaps between loaded pages.
    const changed = cursors.findIndex((cursor, index) => index > 0 && pages[index - 1] && pages[index - 1]!.cursor !== cursor);
    if (changed > 0) {
      setCursors(previous => previous.slice(0, changed));
      setPages(previous => Object.fromEntries(Object.entries(previous).filter(([index]) => Number(index) < changed)));
    }
  }, [pages, cursors]);
  const last = pages[cursors.length - 1];
  const loading = !last || (!!last.hasMore && unique.length < target && cursors.length < batchLimit);
  useEffect(() => {
    if (last?.cursor && unique.length < target && cursors.length < batchLimit) setCursors(previous => [...previous, last.cursor!]);
  }, [last, unique.length, target, cursors.length, batchLimit]);
  return <>
    {summary ? <p aria-label="Today summary" className="text-sm">{summary}</p> : null}
    {cursors.map((cursor, index) => <InventoryPage key={index} cursor={cursor} period={period} scope={scope}
      onResult={page => setPages(previous => {
        if (previous[index] === page) return previous;
        return { ...previous, [index]: page };
      })} />)}
    <ul className="m-0 list-none p-0">{unique.slice(0, limit).map((row, index) => {
      const overdue = row.kind !== "event" && row.at !== null && row.at < scope.start;
      const previous = unique[index - 1];
      const previousOverdue = previous && previous.kind !== "event" && previous.at !== null && previous.at < scope.start;
      return <li key={`${row.kind}:${row.id}`}>
        {period === "today" && (index === 0 || overdue !== previousOverdue) ? <h3 className="mb-1 mt-3 text-xs text-muted-foreground">{overdue ? "Overdue" : "Today"}</h3> : null}
        {renderRow(row)}
      </li>;
    })}</ul>
    {loading ? <LoadingRow label={`Loading ${period === "week" ? "this week" : period}…`} /> : null}
    {!loading && unique.length === 0 ? <p className="text-sm text-muted-foreground">{last.hasMore ? "No matching items in this batch. Continue to see more." : "Nothing here for these filters."}</p> : null}
    {last?.hasMore || unique.length > limit ? (
      period !== "all" ? <Button small onClick={moreInAll}>More in All</Button> :
      <Button small disabled={loading} onClick={() => { if (unique.length >= target) setTarget(value => value + 50); setBatchLimit(value => value + 10); }}>Load more</Button>
    ) : null}
    {period === "all" ? <p className="text-xs text-muted-foreground">Includes undated tasks, wants, all overdue work, repeats, and calendar events through {new Date(scope.horizon).toLocaleDateString()}.</p> : null}
  </>;
}
function InventoryPage({ period, scope, cursor, onResult }: {
  period: "today" | "week" | "all"; scope: Scope; cursor?: string | undefined; onResult: (page: Page) => void;
}) {
  const data = useQuery(api.homeInventory.page, { ...scope, period, ...(cursor ? { cursor } : {}) }) as Page | undefined;
  const callback = useRef(onResult); callback.current = onResult;
  useEffect(() => { if (data) callback.current(data); }, [data]);
  return null;
}

class HomePlanningBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div role="alert" className="grid gap-2">
      <p>Home items could not load.</p><Button onClick={() => this.setState({ failed: false })}>Retry</Button>
    </div> : this.props.children;
  }
}
export function HomePlanning() {
  return <HomePlanningBoundary><HomeActionsProvider><HomePlanningContent /></HomeActionsProvider></HomePlanningBoundary>;
}
function HomePlanningContent() {
  const ready = useViewerReady();
  const [now, setNow] = useState(0);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    refresh();
    const timer = setInterval(refresh, 60_000);
    const returnToHome = () => { refresh(); setSnapshot(homePeriods(Date.now())); };
    window.addEventListener("focus", returnToHome);
    document.addEventListener("visibilitychange", returnToHome);
    return () => { clearInterval(timer); window.removeEventListener("focus", returnToHome); document.removeEventListener("visibilitychange", returnToHome); };
  }, []);
  const [area, setArea] = useState<string | null>(null);
  const [status, setStatus] = useState<Scope["status"]>("open");
  const [allOpen, setAllOpen] = useState(false);
  const [allMounted, setAllMounted] = useState(false);
  const [years, setYears] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [selection, setSelection] = useState<ReturnType<typeof parseHomeHash>>(null);
  const opener = useRef<HTMLElement | null>(null);
  const openAll = () => { setAllOpen(true); setAllMounted(true); };
  useEffect(() => {
    const sync = () => { const value = parseHomeHash(window.location.hash); setSelection(value); if (value) { setAllOpen(true); setAllMounted(true); } };
    sync(); window.addEventListener("hashchange", sync); window.addEventListener("popstate", sync);
    return () => { window.removeEventListener("hashchange", sync); window.removeEventListener("popstate", sync); };
  }, []);
  const periods = useMemo(() => homePeriods(now), [now]);
  // Freeze the paging clock until local day/timezone changes or a return to Home.
  // Minute ticks expire visible events; do not invalidate pagination on each tick.
  const [snapshot, setSnapshot] = useState(periods);
  if (snapshot.start !== periods.start || snapshot.tomorrow !== periods.tomorrow) setSnapshot(periods);
  const scope: Scope = { ...snapshot, area, status: "open", horizon: new Date(new Date(snapshot.start).getFullYear(), new Date(snapshot.start).getMonth(), new Date(snapshot.start).getDate() + 365 * years).getTime() };
  function open(row: AgendaRow) {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (window.location.hash !== `#${row.kind}-${row.id}`) window.history.pushState(null, "", `${window.location.pathname}${window.location.search}#${row.kind}-${row.id}`);
    setSelection({ kind: row.kind, id: row.id });
  }
  const renderRow = (raw: any) => {
    const row = adapt(raw, periods.start);
    if (row.kind === "event" && (raw.endAt ?? row.at) <= (row.isAllDay ? periods.utcToday : now)) return null;
    return <><HomeItemRow row={row} now={now} onOpen={open} actions={<HomeItemActions row={row} />} />
      <ItemActionFeedback row={row} /></>;
  };
  const key = JSON.stringify(scope);
  if (!ready || !now) return <LoadingRow label="Loading Home…" />;
  return <div id="home-planning" tabIndex={-1} className="grid min-w-0 gap-4">
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Filter area" value={area ?? ""} onChange={e => setArea(e.target.value || null)}>
        <option value="">All areas</option><option value="unsorted">Unsorted</option>
        {TASK_AREAS.map(value => <option key={value} value={value}>{areaLabel(value)}</option>)}
      </Select>
      <Button onClick={() => setAddOpen(true)}>Add task / repeat</Button>
    </div>
    <Section title="Today">
      <p className="text-xs text-muted-foreground">{new Date(periods.start).toLocaleDateString()} · Includes the preceding seven days of overdue work.</p>
      <Inventory key={`today-${key}`} scope={scope} now={now} period="today" renderRow={renderRow} moreInAll={openAll} />
      <Button small variant="ghost" onClick={openAll}>Older overdue items may remain in All</Button>
    </Section>
    <Section title="This Week">
      <p className="text-xs text-muted-foreground">{periods.tomorrow === periods.weekEnd ? "The week ends today." : `${new Date(periods.tomorrow).toLocaleDateString()} – ${new Date(periods.weekEnd - 1).toLocaleDateString()}`}</p>
      <Inventory key={`week-${key}`} scope={scope} now={now} period="week" renderRow={renderRow} moreInAll={openAll} />
    </Section>
    <Section title={<button className="min-h-11 text-left" aria-expanded={allOpen} aria-controls="home-all" onClick={() => { setAllOpen(!allOpen); setAllMounted(true); }}>{allOpen ? "▾" : "▸"} All</button>}>
      <div id="home-all" hidden={!allOpen}>
        <Select aria-label="Item status" value={status} onChange={e => setStatus(e.target.value as Scope["status"])}>
          <option value="open">Open</option><option value="completed">Completed/cancelled</option><option value="paused">Paused/retired</option>
        </Select>
        {allMounted ? <Inventory key={`all-${key}-${status}`} scope={{ ...scope, status }} now={now} period="all" renderRow={renderRow} moreInAll={openAll} /> : null}
        <Button small onClick={() => setYears(value => value + 1)}>Include another year of calendar events</Button>
      </div>
    </Section>
    <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add to Home"><AddRow onAdded={() => { setAddOpen(false); openAll(); }} /></Dialog>
    <ItemDetailsModal selection={selection} opener={opener} onClose={() => {
      window.history.pushState(null, "", `${window.location.pathname}${window.location.search}`);
      setSelection(null);
    }} />
  </div>;
}
