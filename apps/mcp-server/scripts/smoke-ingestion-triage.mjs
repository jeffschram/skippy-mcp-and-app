import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const endpoint = process.env.SKIPPY_MCP_URL ?? "http://127.0.0.1:3000/api/mcp";
const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
const token = process.env.SKIPPY_MCP_TOKEN;

if (!token) {
  console.error("SKIPPY_MCP_TOKEN is required. Set it in your shell; do not commit it.");
  process.exit(1);
}
if (!convexUrl) {
  console.error("CONVEX_URL or NEXT_PUBLIC_CONVEX_URL is required.");
  process.exit(1);
}

const mcp = new Client({ name: "skippy-ingestion-triage-smoke", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
  requestInit: {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  },
});
const convex = new ConvexHttpClient(convexUrl);
const authenticate = makeFunctionReference("mcpTokens:authenticate");
const listPendingTriage = makeFunctionReference("knowledge:listPendingTriage");
const rejectTriageItem = makeFunctionReference("knowledge:rejectTriageItem");

let triageItemId;

try {
  const auth = await convex.mutation(authenticate, { token });
  await mcp.connect(transport);
  const uniqueTitle = `Skippy smoke candidate ${Date.now()}`;
  const submitted = await mcp.callTool({
    name: "submit_candidate_object",
    arguments: {
      candidateEntityType: "note",
      candidatePayload: {
        title: uniqueTitle,
        body: "Temporary smoke-test note for the MCP ingestion and triage loop.",
      },
      confidence: 0.99,
      reviewReason: "Temporary smoke test. Reject after verification.",
    },
  });
  const text = submitted.content.find((part) => part.type === "text")?.text;
  const result = text ? JSON.parse(text) : {};
  triageItemId = result.triageItemId;
  if (!triageItemId) {
    throw new Error("submit_candidate_object did not return a triageItemId");
  }

  const triageItems = await convex.query(listPendingTriage, {
    brainInstanceId: auth.brainInstanceId,
    limit: 25,
  });
  const found = triageItems.find((item) => item._id === triageItemId);
  if (!found) {
    throw new Error(`Created triage item ${triageItemId} was not returned by listTriage`);
  }

  console.log(`Created and verified triage item ${triageItemId}: ${uniqueTitle}`);
} finally {
  if (triageItemId) {
    await convex.mutation(rejectTriageItem, {
      triageItemId,
      rejectionReason: "Cleaned up by smoke-ingestion-triage.",
    });
    console.log(`Rejected smoke triage item ${triageItemId}`);
  }
  await mcp.close();
}
