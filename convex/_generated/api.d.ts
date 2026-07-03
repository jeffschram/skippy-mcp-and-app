/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as bootstrap from "../bootstrap.js";
import type * as finances from "../finances.js";
import type * as interviews from "../interviews.js";
import type * as knowledge from "../knowledge.js";
import type * as mcpTokens from "../mcpTokens.js";
import type * as memoryGraph from "../memoryGraph.js";
import type * as planning from "../planning.js";
import type * as projects from "../projects.js";
import type * as resurfacing from "../resurfacing.js";
import type * as settings from "../settings.js";
import type * as skills from "../skills.js";
import type * as taskExecution from "../taskExecution.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  bootstrap: typeof bootstrap;
  finances: typeof finances;
  interviews: typeof interviews;
  knowledge: typeof knowledge;
  mcpTokens: typeof mcpTokens;
  memoryGraph: typeof memoryGraph;
  planning: typeof planning;
  projects: typeof projects;
  resurfacing: typeof resurfacing;
  settings: typeof settings;
  skills: typeof skills;
  taskExecution: typeof taskExecution;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
