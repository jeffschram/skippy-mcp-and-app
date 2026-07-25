import { describe, expect, it } from "vitest";
import {
  normalizeEmail,
  normalizePhoneNumber,
  personMatchesSender,
  resolveWaitingReplies,
  sortWaitingTasks,
  waitingAgeDays,
  type InboundMessage,
  type PersonLike,
  type WaitingTaskLike,
} from "./waiting";

const NOW = Date.parse("2026-07-25T12:00:00.000Z");
const DAY = 86_400_000;

const dan: PersonLike = {
  _id: "person_dan",
  emails: ["Dan@Example.com"],
  phoneNumbers: ["+1 (555) 123-4567"],
};

function waitingTask(overrides: Partial<WaitingTaskLike> = {}): WaitingTaskLike {
  return {
    _id: "task_1",
    status: "waiting",
    waitingOn: { entityType: "person", entityId: "person_dan" },
    waitingSince: NOW - 9 * DAY,
    ...overrides,
  };
}

function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return { sender: "dan@example.com", receivedAt: NOW - DAY, ...overrides };
}

describe("normalizePhoneNumber", () => {
  // Inbound messages rarely arrive in the format the contact was saved in.
  it("treats every common format as the same number", () => {
    const expected = "5551234567";
    expect(normalizePhoneNumber("+15551234567")).toBe(expected);
    expect(normalizePhoneNumber("(555) 123-4567")).toBe(expected);
    expect(normalizePhoneNumber("555-123-4567")).toBe(expected);
    expect(normalizePhoneNumber("555.123.4567")).toBe(expected);
    expect(normalizePhoneNumber("1 555 123 4567")).toBe(expected);
  });

  it("keeps international numbers distinguishable", () => {
    expect(normalizePhoneNumber("+44 20 7123 4567")).toBe("442071234567");
  });

  it("rejects values too short to be a number", () => {
    expect(normalizePhoneNumber("12345")).toBeUndefined();
    expect(normalizePhoneNumber("not a phone")).toBeUndefined();
    expect(normalizePhoneNumber(undefined)).toBeUndefined();
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Dan@Example.COM ")).toBe("dan@example.com");
  });

  it("extracts the address from a display-name form", () => {
    expect(normalizeEmail("Dan Smith <dan@example.com>")).toBe("dan@example.com");
  });

  it("rejects non-addresses", () => {
    expect(normalizeEmail("dan")).toBeUndefined();
    expect(normalizeEmail(42)).toBeUndefined();
  });
});

describe("personMatchesSender", () => {
  it("matches on email regardless of case or display name", () => {
    expect(personMatchesSender(dan, "dan@example.com")).toBe(true);
    expect(personMatchesSender(dan, "Dan Smith <DAN@EXAMPLE.COM>")).toBe(true);
  });

  it("matches on phone regardless of formatting", () => {
    expect(personMatchesSender(dan, "5551234567")).toBe(true);
    expect(personMatchesSender(dan, "+1-555-123-4567")).toBe(true);
  });

  it("does not match someone else", () => {
    expect(personMatchesSender(dan, "sam@example.com")).toBe(false);
    expect(personMatchesSender(dan, "+15559999999")).toBe(false);
  });

  it("does not match a person with no identifiers", () => {
    expect(personMatchesSender({ _id: "p" }, "dan@example.com")).toBe(false);
  });
});

describe("resolveWaitingReplies", () => {
  it("resolves a task when the blocking person replies", () => {
    const resolutions = resolveWaitingReplies([waitingTask()], [dan], [message()]);

    expect(resolutions).toMatchObject([{ taskId: "task_1", personId: "person_dan" }]);
  });

  it("matches a reply that arrives by phone rather than email", () => {
    const resolutions = resolveWaitingReplies(
      [waitingTask()],
      [dan],
      [message({ sender: "(555) 123-4567", sourceSystem: "imessage" })],
    );

    expect(resolutions).toHaveLength(1);
  });

  it("ignores messages from unrelated people", () => {
    const resolutions = resolveWaitingReplies(
      [waitingTask()],
      [dan],
      [message({ sender: "sam@example.com" })],
    );

    expect(resolutions).toHaveLength(0);
  });

  // An older message in the same thread is not a reply to a later question.
  it("ignores messages that predate the wait", () => {
    const resolutions = resolveWaitingReplies(
      [waitingTask({ waitingSince: NOW - 2 * DAY })],
      [dan],
      [message({ receivedAt: NOW - 10 * DAY })],
    );

    expect(resolutions).toHaveLength(0);
  });

  it("reports the earliest qualifying reply", () => {
    const resolutions = resolveWaitingReplies(
      [waitingTask()],
      [dan],
      [
        message({ receivedAt: NOW - DAY, excerpt: "later" }),
        message({ receivedAt: NOW - 5 * DAY, excerpt: "first" }),
      ],
    );

    expect(resolutions[0]?.message.excerpt).toBe("first");
  });

  it("only considers tasks actually in the waiting state", () => {
    const resolutions = resolveWaitingReplies([waitingTask({ status: "todo" })], [dan], [message()]);
    expect(resolutions).toHaveLength(0);
  });

  it("ignores tasks waiting on something that is not a person", () => {
    const resolutions = resolveWaitingReplies(
      [waitingTask({ waitingOn: { entityType: "company", entityId: "c1" } })],
      [dan],
      [message()],
    );

    expect(resolutions).toHaveLength(0);
  });
});

describe("waiting list ordering", () => {
  it("puts the oldest unanswered item first", () => {
    const sorted = sortWaitingTasks([
      waitingTask({ _id: "recent", waitingSince: NOW - DAY }),
      waitingTask({ _id: "stale", waitingSince: NOW - 30 * DAY }),
    ]);

    expect(sorted.map((t) => t._id)).toEqual(["stale", "recent"]);
  });

  // After nudging you are waiting on the follow-up, not the original ask.
  it("re-sorts a nudged item by how long since the nudge", () => {
    const sorted = sortWaitingTasks([
      waitingTask({ _id: "nudged", waitingSince: NOW - 30 * DAY, lastNudgedAt: NOW - 1 * DAY }),
      waitingTask({ _id: "untouched", waitingSince: NOW - 5 * DAY }),
    ]);

    expect(sorted.map((t) => t._id)).toEqual(["untouched", "nudged"]);
  });

  it("reports age from the nudge once nudged", () => {
    expect(waitingAgeDays(waitingTask({ waitingSince: NOW - 30 * DAY }), NOW)).toBe(30);
    expect(
      waitingAgeDays(
        waitingTask({ waitingSince: NOW - 30 * DAY, lastNudgedAt: NOW - 2 * DAY }),
        NOW,
      ),
    ).toBe(2);
  });

  it("has no age when nothing is being waited on", () => {
    expect(waitingAgeDays({ _id: "t", status: "waiting" }, NOW)).toBeUndefined();
  });
});
