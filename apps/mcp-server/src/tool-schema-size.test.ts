import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "./mcp-server";
import type { SkippyClient } from "./tools";

// Every harness session pays the serialized tools/list payload on connect, so
// schema bloat multiplies across all chat turns, task runs, and scheduled agent
// passes (docs/token-efficiency.md, Stage 2). This budget guards against
// descriptions creeping back toward essay length; long-form guidance belongs in
// skills served through get_skill (finance-taxonomy, memory-rubric,
// file-upload, recurrence-semantics, ...).
//
// Measured 2026-02: 110_652 bytes before the Stage 2 slimming pass, 75_465
// after. The floor is ~53k of structural JSON (keys, types, enums) that cannot
// shrink without changing validation shapes, so the budget guards the
// description payload on top of that floor.
const TOOL_SCHEMA_BYTE_BUDGET = 78_000;

describe("tool schema size", () => {
  it("keeps the serialized tools/list payload within budget", async () => {
    // Registration never invokes the Skippy client, so an inert proxy is enough.
    const stubClient = new Proxy(
      {},
      { get: () => async () => ({}) },
    ) as unknown as SkippyClient;

    const server = createMcpServer(stubClient, "brain_123");
    const client = new Client({ name: "schema-size-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const { tools } = await client.listTools();
      const serialized = JSON.stringify(tools);
      const bytes = Buffer.byteLength(serialized, "utf8");

      // eslint-disable-next-line no-console
      console.log(`tools/list payload: ${tools.length} tools, ${bytes} bytes`);

      expect(tools.length).toBeGreaterThan(0);
      expect(bytes).toBeLessThanOrEqual(TOOL_SCHEMA_BYTE_BUDGET);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
