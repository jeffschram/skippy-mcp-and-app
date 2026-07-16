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
    // Web Share Target (Chromium PWA installs — Android/desktop Chrome; iOS
    // Safari ignores this, hence the Shortcut + /capture HTTP endpoint lane).
    // POSTs land on /share which requires a Clerk session and writes a
    // "remember" quick capture.
    share_target: {
      action: "/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [
          {
            name: "files",
            accept: [
              "image/*",
              "video/*",
              "audio/*",
              "text/*",
              "application/pdf",
              ".pdf",
            ],
          },
        ],
      },
    },
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
