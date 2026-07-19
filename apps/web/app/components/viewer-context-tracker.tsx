"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../lib/skippy-api";
import { useViewerReady } from "../hubs/use-viewer";

// Matches /projects/<id>; the /projects list page itself carries no project id.
function projectIdFromPath(pathname: string): string | undefined {
  const match = pathname.match(/^\/projects\/([^/]+)/);
  return match ? match[1] : undefined;
}

/**
 * Reports the currently open page to viewerContext so a connected harness can
 * resolve "this project" / "this page" via get_current_context. Re-reports on
 * window focus, so with multiple tabs or browsers open the most-recently-focused
 * one wins. Renders nothing.
 */
export function ViewerContextTracker() {
  const pathname = usePathname() ?? "/";
  const viewerReady = useViewerReady();
  const setViewerContext = useMutation(api.projects.setViewerContext);
  const lastSentRoute = useRef<string | null>(null);

  useEffect(() => {
    if (!viewerReady) return;

    // Focus events force a rewrite even for an unchanged route, so the focused
    // tab overwrites whatever another tab reported last.
    const report = (force: boolean) => {
      if (!force && lastSentRoute.current === pathname) return;
      lastSentRoute.current = pathname;
      void setViewerContext({
        activeRoute: pathname,
        activeProjectId: projectIdFromPath(pathname) as any,
      }).catch(() => undefined);
    };

    report(false);

    const onFocus = () => report(true);
    const onVisibility = () => {
      if (document.visibilityState === "visible") report(true);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [viewerReady, pathname, setViewerContext]);

  return null;
}
