import { v } from "convex/values";

/** Canonical relationship endpoints. Capture compatibility aliases stay out. */
export const entityReferenceType = v.union(
  v.literal("goal"),
  v.literal("project"),
  v.literal("task"),
  v.literal("note"),
  v.literal("person"),
  v.literal("company"),
  v.literal("link"),
  v.literal("memory"),
);
