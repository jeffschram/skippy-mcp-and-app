import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { AppProviders } from "./providers";
import "./globals.css";

const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export const metadata: Metadata = {
  title: {
    default: "Skippy",
    template: "%s | Skippy",
  },
  description: "A focused second-brain review surface for Skippy.",
  applicationName: "Skippy",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Skippy",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f4ec",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const content = (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );

  if (!clerkPublishableKey) {
    return content;
  }

  return <ClerkProvider publishableKey={clerkPublishableKey}>{content}</ClerkProvider>;
}
