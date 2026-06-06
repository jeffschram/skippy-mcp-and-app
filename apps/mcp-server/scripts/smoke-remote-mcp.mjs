import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.SKIPPY_MCP_URL ?? "http://127.0.0.1:3000/api/mcp";
const token = process.env.SKIPPY_MCP_TOKEN;

if (!token) {
  console.error("SKIPPY_MCP_TOKEN is required. Set it in your shell; do not commit it.");
  process.exit(1);
}

const client = new Client({
  name: "skippy-smoke-test",
  version: "0.1.0",
});

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
  console.log(`Connected to ${endpoint}`);
  console.log(`Tools (${tools.tools.length}): ${tools.tools.map((tool) => tool.name).join(", ")}`);

  const prompts = await client.listPrompts();
  console.log(`Prompts (${prompts.prompts.length}): ${prompts.prompts.map((prompt) => prompt.name).join(", ")}`);

  const intro = await client.getPrompt({ name: "skippy_intro" });
  const introText = intro.messages.find((message) => message.content.type === "text")?.content.text;
  if (introText) {
    console.log("intro preview:");
    console.log(introText.split("\n").slice(0, 5).join("\n"));
  }

  const askResult = await client.callTool({
    name: "ask",
    arguments: {
      query: "smoke test",
    },
  });

  console.log("ask result:");
  for (const content of askResult.content) {
    if (content.type === "text") {
      console.log(content.text);
    }
  }
} finally {
  await client.close();
}
