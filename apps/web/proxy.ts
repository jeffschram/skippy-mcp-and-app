import { clerkMiddleware } from "@clerk/nextjs/server";

/*
 * Clerk's server-side auth() only resolves on requests that passed through
 * clerkMiddleware. The app is otherwise fully client-authenticated (Clerk
 * React + Convex), so the proxy only needs to cover the Web Share Target
 * endpoint, which authenticates server-side before writing a quick capture.
 * (Next 16 replaced middleware.ts with proxy.ts; the contract is the same.)
 */
export default clerkMiddleware();

export const config = {
  matcher: ["/share"],
};
