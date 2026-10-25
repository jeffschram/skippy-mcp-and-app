import { protectedResourceMetadata } from "@skippy/mcp-server/remote";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    const metadata = protectedResourceMetadata();
    return Response.json(metadata ?? { error: "OAuth is not enabled" }, { status: metadata ? 200 : 404, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "OAuth is not configured" }, { status: 503 }); }
}
