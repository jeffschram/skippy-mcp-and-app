import { describe, expect, it } from "vitest";
import { assertMcpReferences } from "./mcpOwnership";
const rows: Record<string, any> = { brain: { ownerUserId: "owner" }, owner: { _id: "owner" }, task: { brainInstanceId: "brain" }, foreign: { brainInstanceId: "another" } };
const db = { get: async (id: string) => rows[id] };
describe("MCP account isolation", () => {
  it("accepts owned references and rejects foreign/missing/nested references", async () => {
    await expect(assertMcpReferences(db, { taskId: "task", createdByUserId: "owner" }, "brain")).resolves.toBeUndefined();
    for (const args of [{ taskId: "foreign" }, { taskId: "missing" }, { input: { entityRef: { entityId: "foreign" } } }, { artifactFileIds: ["foreign"] }, { brainInstanceId: "another" }]) {
      await expect(assertMcpReferences(db, args, "brain")).rejects.toThrow();
    }
  });
  it("does not interpret source-system metadata as account identity", async () => {
    await expect(assertMcpReferences(db, { metadata: { projectId: "external-id" } }, "brain")).resolves.toBeUndefined();
  });
});
