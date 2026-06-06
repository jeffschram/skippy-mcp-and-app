import { makeFunctionReference } from "convex/server";

export const api = {
  auth: {
    ensureViewer: makeFunctionReference<"mutation">("auth:ensureViewer"),
    viewer: makeFunctionReference<"query">("auth:viewer"),
  },
  knowledge: {
    dashboardForViewer: makeFunctionReference<"query">("knowledge:dashboardForViewer"),
    projectsAndTasksForViewer: makeFunctionReference<"query">("knowledge:projectsAndTasksForViewer"),
    contactsForViewer: makeFunctionReference<"query">("knowledge:contactsForViewer"),
    triageForViewer: makeFunctionReference<"query">("knowledge:triageForViewer"),
    pendingActionsForViewer: makeFunctionReference<"query">("knowledge:pendingActionsForViewer"),
    reviewTriageItem: makeFunctionReference<"mutation">("knowledge:reviewTriageItem"),
    markTaskDone: makeFunctionReference<"mutation">("knowledge:markTaskDone"),
    markTaskDoneForViewer: makeFunctionReference<"mutation">("knowledge:markTaskDoneForViewer"),
  },
  mcpTokens: {
    list: makeFunctionReference<"query">("mcpTokens:list"),
    create: makeFunctionReference<"mutation">("mcpTokens:create"),
    revoke: makeFunctionReference<"mutation">("mcpTokens:revoke"),
    authenticate: makeFunctionReference<"mutation">("mcpTokens:authenticate"),
  },
  settings: {
    getSettings: makeFunctionReference<"query">("settings:getSettings"),
    updateConfig: makeFunctionReference<"mutation">("settings:updateConfig"),
    recordAiProcessingRun: makeFunctionReference<"mutation">("settings:recordAiProcessingRun"),
  },
} as const;

export function isLiveConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_CONVEX_URL && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}
