"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { CalendarDays, MapPin, Video } from "lucide-react";
import { groupAgendaByDay, type AgendaItem } from "@skippy/shared";
import { api } from "../../lib/skippy-api";
import { Badge, EmptyState, LoadingRow, Section } from "../components";
import { useViewerReady } from "./use-viewer";
import styles from "./agenda.module.css";

/* ------------------------------------------------------------------ */
/* Agenda: an ordered list of what is happening and what is due.       */
/*                                                                     */
/* Deliberately a list, not a time grid. A grid is hard to use at phone */
/* width and is not where the value is — the value is a correct merged  */
/* ordering of calendar events, due tasks, and firing recurrences.     */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;

function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function timeLabel(item: AgendaItem, timeZone: string): string {
  if (item.isAllDay) return "All day";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(item.at));
}

function dayLabel(dayKey: string, timeZone: string): string {
  // dayKey is a plain calendar date; render it as one rather than as an
  // instant, so it cannot drift a day in either direction.
  const [year = 0, month = 1, day = 1] = dayKey.split("-").map(Number);
  const at = Date.UTC(year, month - 1, day, 12);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

  if (dayKey === today) return "Today";
  if (dayKey === new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(Date.now() + DAY_MS)))
    return "Tomorrow";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(at));
}

const SOURCE_LABELS: Record<AgendaItem["source"], string> = {
  event: "Event",
  task: "Due",
  recurrence: "Recurring",
};

function AgendaRow({ item, timeZone }: { item: AgendaItem; timeZone: string }) {
  const body = (
    <>
      <span className={styles.time}>{timeLabel(item, timeZone)}</span>
      <span className={styles.body}>
        <span className={styles.title}>{item.title}</span>
        <span className={styles.meta}>
          <Badge tone={item.source === "event" ? "blue" : "neutral"}>
            {SOURCE_LABELS[item.source]}
          </Badge>
          {item.isOverdue ? <span className={styles.overdue}>overdue</span> : null}
          {item.location ? (
            <span className={styles.metaItem}>
              <MapPin size={12} aria-hidden /> {item.location}
            </span>
          ) : null}
          {item.conferenceUrl ? (
            <span className={styles.metaItem}>
              <Video size={12} aria-hidden /> video
            </span>
          ) : null}
        </span>
      </span>
    </>
  );

  if (!item.href) {
    return <div className={styles.row}>{body}</div>;
  }

  return item.href.startsWith("/") ? (
    <Link className={styles.row} href={item.href}>
      {body}
    </Link>
  ) : (
    <a className={styles.row} href={item.href} target="_blank" rel="noreferrer">
      {body}
    </a>
  );
}

export function AgendaSection({ days = 7 }: { days?: number }) {
  const ready = useViewerReady();
  const timeZone = viewerTimeZone();

  // Anchored to the start of today so the range is stable across renders
  // rather than sliding with the clock and refetching constantly.
  const { from, to } = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return { from: startOfToday, to: startOfToday + days * DAY_MS };
  }, [days]);

  const items = useQuery(api.agenda.agendaForViewer, ready ? { from, to } : "skip") as
    | AgendaItem[]
    | undefined;

  const grouped = useMemo(
    () => (items ? groupAgendaByDay(items, timeZone) : []),
    [items, timeZone],
  );

  return (
    <Section
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <CalendarDays size={18} aria-hidden /> Agenda
        </span>
      }
      action={
        <Link className="text-button compact" href="/tasks">
          Tasks
        </Link>
      }
    >
      {items === undefined ? (
        <LoadingRow label="Loading agenda…" />
      ) : grouped.length === 0 ? (
        <EmptyState
          icon={<CalendarDays size={18} />}
          title="Nothing scheduled"
        >
          Calendar events, due tasks, and recurring items will appear here together.
        </EmptyState>
      ) : (
        <div className={styles.days}>
          {grouped.map((day) => (
            <div key={day.dayKey} className={styles.day}>
              <p className={styles.dayLabel}>{dayLabel(day.dayKey, timeZone)}</p>
              <div className={styles.list}>
                {day.items.map((item) => (
                  <AgendaRow key={`${item.source}-${item.id}`} item={item} timeZone={timeZone} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
