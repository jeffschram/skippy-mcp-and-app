import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const required = [
  ["CONVEX_URL or NEXT_PUBLIC_CONVEX_URL", Boolean(process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL)],
  ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)],
  ["OPENAI_API_KEY", Boolean(process.env.OPENAI_API_KEY)],
];

const recommended = [
  ["CLERK_SECRET_KEY", Boolean(process.env.CLERK_SECRET_KEY)],
  ["SKIPPY_MCP_TOKEN", Boolean(process.env.SKIPPY_MCP_TOKEN)],
  ["SKIPPY_MCP_URL", Boolean(process.env.SKIPPY_MCP_URL)],
  ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.SKIPPY_VAPID_PUBLIC_KEY)],
  ["SKIPPY_VAPID_PRIVATE_KEY", Boolean(process.env.SKIPPY_VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY)],
  ["SKIPPY_VAPID_SUBJECT", Boolean(process.env.SKIPPY_VAPID_SUBJECT || process.env.VAPID_SUBJECT)],
];

function printCheck([label, ok]) {
  console.log(`${ok ? "ok" : "missing"} ${label}`);
}

console.log("Required environment");
required.forEach(printCheck);
console.log("\nRecommended environment");
recommended.forEach(printCheck);

const missingRequired = required.filter(([, ok]) => !ok).map(([label]) => label);
if (missingRequired.length) {
  console.error(`\nMissing required values: ${missingRequired.join(", ")}`);
  process.exitCode = 1;
}

const endpoint = process.env.SKIPPY_MCP_URL;
const token = process.env.SKIPPY_MCP_TOKEN;
if (endpoint && token) {
  const client = new Client({ name: "skippy-production-env-check", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    console.log(`\nMCP smoke ok: ${endpoint}`);
    console.log(`Tools: ${tools.tools.map((tool) => tool.name).join(", ")}`);
  } catch (error) {
    console.error(`\nMCP smoke failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
} else {
  console.log("\nMCP smoke skipped: set SKIPPY_MCP_URL and SKIPPY_MCP_TOKEN to test the remote endpoint.");
}
