import { describe, expect, it } from "vitest";
import {
  containerOf,
  dropPlacement,
  listsEqual,
  phaseDropId,
  projectDragEnd,
  projectDragOver,
  type PhaseList,
} from "./project-board-dnd";

const lists = (): PhaseList[] => [
  { phaseId: "p1", taskIds: ["a", "b", "c"] },
  { phaseId: "p2", taskIds: ["d", "e"] },
  { phaseId: "p3", taskIds: [] },
];

const ids = (arrangement: PhaseList[], phaseId: string) =>
  arrangement.find((list) => list.phaseId === phaseId)!.taskIds;

describe("containerOf", () => {
  it("resolves a task id to its phase", () => {
    expect(containerOf(lists(), "b")).toBe("p1");
    expect(containerOf(lists(), "e")).toBe("p2");
  });

  it("resolves a phase container id, including empty phases", () => {
    expect(containerOf(lists(), phaseDropId("p3"))).toBe("p3");
  });

  it("returns undefined for unknown ids", () => {
    expect(containerOf(lists(), "nope")).toBeUndefined();
    expect(containerOf(lists(), phaseDropId("nope"))).toBeUndefined();
  });
});

describe("projectDragOver", () => {
  it("moves a task into another phase before the hovered row", () => {
    const next = projectDragOver(lists(), "a", "e")!;
    expect(ids(next, "p1")).toEqual(["b", "c"]);
    expect(ids(next, "p2")).toEqual(["d", "a", "e"]);
  });

  it("appends when hovering an empty phase container", () => {
    const next = projectDragOver(lists(), "b", phaseDropId("p3"))!;
    expect(ids(next, "p1")).toEqual(["a", "c"]);
    expect(ids(next, "p3")).toEqual(["b"]);
  });

  it("is a no-op (null) within the same phase — sorting is drag-end's job", () => {
    expect(projectDragOver(lists(), "a", "c")).toBeNull();
    expect(projectDragOver(lists(), "a", phaseDropId("p1"))).toBeNull();
  });

  it("does not mutate the input arrangement", () => {
    const base = lists();
    projectDragOver(base, "a", "e");
    expect(base).toEqual(lists());
  });
});

describe("projectDragEnd", () => {
  it("reorders within a phase toward the end", () => {
    const next = projectDragEnd(lists(), "a", "c");
    expect(ids(next, "p1")).toEqual(["b", "c", "a"]);
  });

  it("reorders within a phase toward the start", () => {
    const next = projectDragEnd(lists(), "c", "a");
    expect(ids(next, "p1")).toEqual(["c", "a", "b"]);
  });

  it("moves to the end of its own phase when dropped on the container", () => {
    const next = projectDragEnd(lists(), "a", phaseDropId("p1"));
    expect(ids(next, "p1")).toEqual(["b", "c", "a"]);
  });

  it("handles a cross-phase drop directly (no prior drag-over projection)", () => {
    const next = projectDragEnd(lists(), "a", "d");
    expect(ids(next, "p1")).toEqual(["b", "c"]);
    expect(ids(next, "p2")).toEqual(["a", "d", "e"]);
  });

  it("returns the arrangement unchanged when dropped on itself", () => {
    expect(projectDragEnd(lists(), "a", "a")).toEqual(lists());
  });

  it("returns the arrangement unchanged for unknown ids", () => {
    expect(projectDragEnd(lists(), "nope", "a")).toEqual(lists());
    expect(projectDragEnd(lists(), "a", "nope")).toEqual(lists());
  });
});

describe("dropPlacement", () => {
  it("targets the task now after the dropped row", () => {
    const next = projectDragEnd(lists(), "c", "a");
    expect(dropPlacement(next, "c")).toEqual({
      phaseId: "p1",
      beforeTaskId: "a",
    });
  });

  it("omits beforeTaskId at the end of a phase", () => {
    const next = projectDragEnd(lists(), "a", "c");
    expect(dropPlacement(next, "a")).toEqual({ phaseId: "p1" });
  });

  it("reports the new phase after a cross-phase move", () => {
    const next = projectDragOver(lists(), "b", phaseDropId("p3"))!;
    expect(dropPlacement(next, "b")).toEqual({ phaseId: "p3" });
  });

  it("returns null when the task is in no list", () => {
    expect(dropPlacement(lists(), "nope")).toBeNull();
  });
});

describe("listsEqual", () => {
  it("treats an unchanged drag as equal so no mutation fires", () => {
    expect(listsEqual(lists(), lists())).toBe(true);
    expect(listsEqual(lists(), projectDragEnd(lists(), "a", "a"))).toBe(true);
  });

  it("detects order and membership changes", () => {
    expect(listsEqual(lists(), projectDragEnd(lists(), "a", "c"))).toBe(false);
    expect(
      listsEqual(lists(), projectDragOver(lists(), "a", "e")!),
    ).toBe(false);
  });

  it("detects differing phase counts", () => {
    expect(listsEqual(lists(), lists().slice(0, 2))).toBe(false);
  });
});
