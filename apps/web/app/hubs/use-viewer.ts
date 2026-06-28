"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../lib/skippy-api";

/** True once Convex auth is settled and the viewer has a bootstrapped brain. */
export function useViewerReady() {
  const { isAuthenticated } = useConvexAuth();
  const viewer = useQuery(api.auth.viewer, isAuthenticated ? {} : "skip") as
    | { brain?: { _id?: string } | null }
    | null
    | undefined;
  return Boolean(viewer?.brain);
}
