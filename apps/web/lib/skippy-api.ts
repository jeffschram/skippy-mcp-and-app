import { api } from "../../../convex/_generated/api";

export { api };

export function isLiveConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_CONVEX_URL && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}
