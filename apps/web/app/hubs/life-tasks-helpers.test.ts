import { describe, expect, it } from "vitest";
import {
  areaLabel,
  areasPresent,
  bucketLifeTasks,
  filterByArea,
  isOverdue,
  laneFor,
  waitingDays,
  type LifeTask,
} from "./life-tasks-helpers";

const NOW = Date.parse("2026-07-25T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function task(overrides: Partial<LifeTask> = {}): LifeTask {
  return {
    _id: overrides._id ?? "task_1",
    title: "Something",
    status: "todo",
    commitment: "must",
    ...overrides,
  };
}

describe("laneFor", () => {
  it("routes dated obligations to Due", () => {
    expect(laneFor(task({ dueAt: NOW + DAY }))).toBe("due");
  });

  it("routes undated obligations to Anytime", () => {
    expect(laneFor(task())).toBe("anytime");
  });

  it("routes wants to Wants even when they somehow carry a date", () => {
    expect(laneFor(task({ commitment: "want" }))).toBe("wants");
    expect(laneFor(task({ commitment: "want", dueAt: NOW - DAY }))).toBe("wants");
  });
});

describe("isOverdue", () => {
  it("is true strictly after the due moment", () => {
    expect(isOverdue(task({ dueAt: NOW - 1 }), NOW)).toBe(true);
    expect(isOverdue(task({ dueAt: NOW }), NOW)).toBe(false);
    expect(isOverdue(task({ dueAt: NOW + 1 }), NOW)).toBe(false);
  });

  it("is never true for a want", () => {
    expect(isOverdue(task({ commitment: "want", dueAt: NOW - 10 * DAY }), NOW)).toBe(false);
  });

  it("is false with no due date", () => {
    expect(isOverdue(task(), NOW)).toBe(false);
  });
});

describe("bucketLifeTasks", () => {
  it("splits the three lanes", () => {
    const lanes = bucketLifeTasks([
      task({ _id: "a", dueAt: NOW + DAY }),
      task({ _id: "b" }),
      task({ _id: "c", commitment: "want" }),
    ]);

    expect(lanes.due.map((t) => t._id)).toEqual(["a"]);
    expect(lanes.anytime.map((t) => t._id)).toEqual(["b"]);
    expect(lanes.wants.map((t) => t._id)).toEqual(["c"]);
  });

  it("drops completed and cancelled work", () => {
    const lanes = bucketLifeTasks([
      task({ _id: "a", status: "done" }),
      task({ _id: "b", status: "cancelled" }),
      task({ _id: "c" }),
    ]);

    expect(lanes.anytime.map((t) => t._id)).toEqual(["c"]);
  });

  // Blocked-on-someone-else is a different kind of item from I-need-to-do-this.
  it("pulls waiting tasks out of the Due lane", () => {
    const lanes = bucketLifeTasks([task({ _id: "a", status: "waiting", dueAt: NOW + DAY })]);

    expect(lanes.due).toHaveLength(0);
    expect(lanes.waiting.map((t) => t._id)).toEqual(["a"]);
  });

  it("orders Due soonest first", () => {
    const lanes = bucketLifeTasks([
      task({ _id: "later", dueAt: NOW + 5 * DAY }),
      task({ _id: "sooner", dueAt: NOW + DAY }),
    ]);

    expect(lanes.due.map((t) => t._id)).toEqual(["sooner", "later"]);
  });

  it("orders waiting oldest first, since that is the one needing a nudge", () => {
    const lanes = bucketLifeTasks([
      task({ _id: "recent", status: "waiting", waitingSince: NOW - DAY }),
      task({ _id: "stale", status: "waiting", waitingSince: NOW - 20 * DAY }),
    ]);

    expect(lanes.waiting.map((t) => t._id)).toEqual(["stale", "recent"]);
  });

  it("handles an absent task list", () => {
    expect(bucketLifeTasks(undefined)).toEqual({ due: [], anytime: [], wants: [], waiting: [] });
  });
});

describe("area helpers", () => {
  it("labels known areas and falls back for anything else", () => {
    expect(areaLabel("household")).toBe("Household");
    expect(areaLabel(undefined)).toBe("Unsorted");
    expect(areaLabel("gardening")).toBe("Unsorted");
  });

  it("lists present areas in taxonomy order with unsorted last", () => {
    const areas = areasPresent([
      task({ _id: "a", area: "errand" }),
      task({ _id: "b", area: "work" }),
      task({ _id: "c" }),
    ]);

    expect(areas).toEqual(["work", "errand", "unsorted"]);
  });

  it("filters by area, treating absent as unsorted", () => {
    const tasks = [task({ _id: "a", area: "health" }), task({ _id: "b" })];

    expect(filterByArea(tasks, "health").map((t) => t._id)).toEqual(["a"]);
    expect(filterByArea(tasks, "unsorted").map((t) => t._id)).toEqual(["b"]);
    expect(filterByArea(tasks, null)).toHaveLength(2);
  });
});

describe("waitingDays", () => {
  it("reports whole days waited", () => {
    expect(waitingDays(task({ waitingSince: NOW - 9 * DAY }), NOW)).toBe(9);
    expect(waitingDays(task({ waitingSince: NOW - 1000 }), NOW)).toBe(0);
  });

  it("never reports negative days for a future timestamp", () => {
    expect(waitingDays(task({ waitingSince: NOW + DAY }), NOW)).toBe(0);
  });

  it("is undefined when nothing is being waited on", () => {
    expect(waitingDays(task(), NOW)).toBeUndefined();
  });
});
