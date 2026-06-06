import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    name: "Skippy",
    short_name: "Skippy",
    description: "Focused review surface for the Skippy second brain.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f4ec",
    theme_color: "#f7f4ec",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
    ],
  });
}
