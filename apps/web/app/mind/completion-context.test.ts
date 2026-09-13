import { describe, expect, it } from "vitest";
import type { MindGraph } from "../../../../convex/mindGraphHelpers";
import { completionProject } from "./completion-context";

const graph = {
  nodes: [{ id: "task", kind: "task" }, { id: "a", kind: "project" }, { id: "b", kind: "project" }, { id: "person", kind: "person" }],
  edges: [{ source: "task", target: "person" }, { source: "task", target: "a" }, { source: "b", target: "task" }],
} as MindGraph;

describe("task completion context", () => {
  it("returns to the previously visited project in either edge direction", () => {
    expect(completionProject(graph, "task", "b")).toBe("b");
    expect(completionProject(graph, "task", "a")).toBe("a");
  });
  it("finds a linked project for a task opened directly", () => {
    expect(completionProject(graph, "task", null)).toBe("a");
    expect(completionProject(graph, "task", "person")).toBe("a");
  });
  it("does not invent a project for an unlinked task", () => {
    expect(completionProject({ ...graph, edges: [] }, "task", "a")).toBeNull();
  });
});
