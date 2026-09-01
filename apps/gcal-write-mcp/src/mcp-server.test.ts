import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createGcalWriteMcpServer } from "./mcp-server.js";

async function connect(fetchImpl: typeof fetch, getAccessToken = async () => "tok") {
  const server = createGcalWriteMcpServer({ getAccessToken }, fetchImpl);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

const ARGS = {
  summary: "Coffee with Helen",
  start: Date.UTC(2026, 8, 2, 19, 0),
  end: Date.UTC(2026, 8, 2, 20, 0),
};

describe("tool surface", () => {
  it("exposes create_event and nothing else", async () => {
    // This is the security property of the package, not a style preference:
    // the connector can add an event and do nothing else. If this test starts
    // failing because a tool was added, that needs owner sign-off and a docs
    // audit update (docs/google-source.md), not a snapshot bump.
    const client = await connect(vi.fn() as never);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["create_event"]);
  });
});

describe("create_event", () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchImpl = vi.fn(async () => ({
      status: 200,
      text: async () => JSON.stringify({ id: "abc12", htmlLink: "https://cal/e" }),
    }));
  });

  it("returns the created outcome", async () => {
    const client = await connect(fetchImpl as never);
    const result = await client.callTool({ name: "create_event", arguments: ARGS });
    expect(result.isError).toBeFalsy();
    const content = result.content as { text: string }[];
    expect(JSON.parse(content[0]!.text)).toMatchObject({ status: "created", eventId: "abc12" });
  });

  it("surfaces a validation failure without calling Google", async () => {
    const client = await connect(fetchImpl as never);
    const result = await client.callTool({
      name: "create_event",
      arguments: { ...ARGS, end: ARGS.start - 1 },
    });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]!.text).toMatch(/end cannot precede start/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a Google failure as an error but keeps the structured outcome", async () => {
    // PR-2's executor forwards this JSON straight to Convex; losing the shape
    // would mean re-parsing a prose message.
    const failing = vi.fn(async () => ({
      status: 403,
      text: async () => JSON.stringify({ error: { message: "Insufficient permission" } }),
    }));
    const client = await connect(failing as never);
    const result = await client.callTool({ name: "create_event", arguments: ARGS });
    expect(result.isError).toBe(true);
    expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toMatchObject({
      status: "failed",
    });
  });

  it("turns a missing credential file into setup guidance", async () => {
    const client = await connect(fetchImpl as never, async () => {
      throw new Error("token.json is missing refresh_token; re-run --authorize");
    });
    const result = await client.callTool({ name: "create_event", arguments: ARGS });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]!.text).toMatch(/--authorize/);
  });
});
