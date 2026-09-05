/**
 * Pure helpers for rendering pendingActions review cards.
 *
 * Calendar actions carry their executor payload as JSON in `body`
 * (convex/calendar.ts writes it; the runner parses it verbatim). The review
 * card must never EDIT that payload — but rendering the raw JSON made the
 * highest-stakes surface in the app the least readable one (docs/ui-audit,
 * Sep 2026). These helpers decode the payload for display only.
 */

export type CalendarEventPayload = {
  summary?: string;
  description?: string;
  location?: string;
  start?: number;
  end?: number;
  isAllDay?: boolean;
  timeZone?: string;
};

/**
 * Decode a calendar action's JSON body for display. Returns null for
 * non-calendar actions and for malformed bodies — callers fall back to the
 * raw text so a broken payload is still visible, never silently hidden.
 */
export function parseCalendarActionBody(action: {
  actionType?: unknown;
  body?: unknown;
}): CalendarEventPayload | null {
  if (action.actionType !== "calendar_event_create" || typeof action.body !== "string") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(action.body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as CalendarEventPayload;
  } catch {
    return null;
  }
}

/**
 * "Wed, Sep 10 · 6:30 – 9:00 PM" — the one line the approve/reject decision
 * actually needs. Rendered in the event's own time zone when the payload
 * carries one, otherwise the viewer's.
 */
export function formatEventWhen(payload: CalendarEventPayload): string {
  const { start, end, isAllDay, timeZone } = payload;
  if (typeof start !== "number") {
    return "";
  }
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  const startDay = day.format(start);
  if (isAllDay) {
    return `${startDay} · All day`;
  }
  if (typeof end !== "number") {
    return `${startDay} · ${time.format(start)}`;
  }
  const endDay = day.format(end);
  if (endDay === startDay) {
    return `${startDay} · ${time.format(start)} – ${time.format(end)}`;
  }
  return `${startDay}, ${time.format(start)} – ${endDay}, ${time.format(end)}`;
}
