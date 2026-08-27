import { describe, expect, it } from "vitest";
import {
  describeAgentSchedule,
  nextAgentDueAt,
  validateAgentSchedule,
  type AgentSchedule,
} from "./agent-schedule";

const utc = (iso: string) => Date.parse(iso);

describe("validateAgentSchedule", () => {
  it("accepts sane interval and daily schedules", () => {
    expect(() => validateAgentSchedule({ kind: "interval", everyMinutes: 30 })).not.toThrow();
    expect(() =>
      validateAgentSchedule({
        kind: "interval",
        everyMinutes: 30,
        window: { start: "07:00", end: "22:00" },
      }),
    ).not.toThrow();
    expect(() => validateAgentSchedule({ kind: "daily", timesOfDay: ["06:30", "23:30"] })).not.toThrow();
  });

  it("rejects malformed schedules", () => {
    expect(() => validateAgentSchedule({ kind: "interval", everyMinutes: 0 })).toThrow(/everyMinutes/);
    expect(() =>
      validateAgentSchedule({ kind: "interval", everyMinutes: 30, window: { start: "22:00", end: "07:00" } }),
    ).toThrow(/window/);
    expect(() => validateAgentSchedule({ kind: "daily", timesOfDay: [] })).toThrow(/at least one/);
    expect(() => validateAgentSchedule({ kind: "daily", timesOfDay: ["25:00"] })).toThrow(/HH:MM/);
  });
});

describe("nextAgentDueAt: interval", () => {
  it("advances by the interval without a window", () => {
    const schedule: AgentSchedule = { kind: "interval", everyMinutes: 30 };
    expect(nextAgentDueAt(schedule, utc("2026-01-05T10:00:00Z"))).toBe(utc("2026-01-05T10:30:00Z"));
  });

  it("clamps a too-early slot to the window start", () => {
    const schedule: AgentSchedule = {
      kind: "interval",
      everyMinutes: 30,
      window: { start: "07:00", end: "22:00" },
    };
    // 05:40 + 30min = 06:10, before the window -> 07:00.
    expect(nextAgentDueAt(schedule, utc("2026-01-05T05:40:00Z"))).toBe(utc("2026-01-05T07:00:00Z"));
  });

  it("rolls a past-window slot to tomorrow's window start", () => {
    const schedule: AgentSchedule = {
      kind: "interval",
      everyMinutes: 30,
      window: { start: "07:00", end: "22:00" },
    };
    // 21:45 + 30min = 22:15, past the end -> tomorrow 07:00.
    expect(nextAgentDueAt(schedule, utc("2026-01-05T21:45:00Z"))).toBe(utc("2026-01-06T07:00:00Z"));
  });

  it("stays inside the window otherwise", () => {
    const schedule: AgentSchedule = {
      kind: "interval",
      everyMinutes: 30,
      window: { start: "07:00", end: "22:00" },
    };
    expect(nextAgentDueAt(schedule, utc("2026-01-05T12:00:00Z"))).toBe(utc("2026-01-05T12:30:00Z"));
  });

  it("respects the window's time zone", () => {
    const schedule: AgentSchedule = {
      kind: "interval",
      everyMinutes: 30,
      window: { start: "07:00", end: "22:00" },
      timeZone: "America/New_York",
    };
    // 23:50 ET (04:50Z next day) + 30min = 00:20 ET, before window -> 07:00 ET = 12:00Z.
    expect(nextAgentDueAt(schedule, utc("2026-01-06T04:50:00Z"))).toBe(utc("2026-01-06T12:00:00Z"));
  });

  it("collapses missed slots into one future occurrence", () => {
    const schedule: AgentSchedule = { kind: "interval", everyMinutes: 30 };
    // Host slept 6 hours; claiming at wake computes from "now", not from the
    // last scheduled slot — exactly one catch-up pass.
    const wake = utc("2026-01-05T16:00:00Z");
    expect(nextAgentDueAt(schedule, wake)).toBe(utc("2026-01-05T16:30:00Z"));
  });
});

describe("nextAgentDueAt: daily", () => {
  it("picks the next configured time today", () => {
    const schedule: AgentSchedule = { kind: "daily", timesOfDay: ["06:30", "23:30"] };
    expect(nextAgentDueAt(schedule, utc("2026-01-05T10:00:00Z"))).toBe(utc("2026-01-05T23:30:00Z"));
  });

  it("rolls to tomorrow when all of today's slots have passed", () => {
    const schedule: AgentSchedule = { kind: "daily", timesOfDay: ["06:30"] };
    expect(nextAgentDueAt(schedule, utc("2026-01-05T07:00:00Z"))).toBe(utc("2026-01-06T06:30:00Z"));
  });

  it("is strictly after: an exact-slot instant advances to the next slot", () => {
    const schedule: AgentSchedule = { kind: "daily", timesOfDay: ["06:30"] };
    expect(nextAgentDueAt(schedule, utc("2026-01-05T06:30:00Z"))).toBe(utc("2026-01-06T06:30:00Z"));
  });

  it("computes wall-clock times in the schedule's zone", () => {
    const schedule: AgentSchedule = { kind: "daily", timesOfDay: ["23:30"], timeZone: "America/New_York" };
    // 23:30 ET on Jan 5 = 04:30Z on Jan 6.
    expect(nextAgentDueAt(schedule, utc("2026-01-05T10:00:00Z"))).toBe(utc("2026-01-06T04:30:00Z"));
  });
});

describe("describeAgentSchedule", () => {
  it("labels the shapes", () => {
    expect(describeAgentSchedule(undefined)).toBe("manual");
    expect(describeAgentSchedule({ kind: "interval", everyMinutes: 30 })).toBe("every 30 min");
    expect(
      describeAgentSchedule({ kind: "interval", everyMinutes: 60, window: { start: "07:00", end: "22:00" } }),
    ).toBe("every 1h, 07:00–22:00");
    expect(describeAgentSchedule({ kind: "daily", timesOfDay: ["23:30", "06:30"] })).toBe(
      "daily at 06:30, 23:30",
    );
  });
});
