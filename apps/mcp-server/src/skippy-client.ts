import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type {
  CandidateObjectInput,
  EntityRef,
  FocusSummary,
  PendingActionInput,
  RelationshipInput,
  SourceRefInput,
} from "@skippy/shared";
import type { SkippyClient } from "./tools.js";

const submitCandidateObjectRef = makeFunctionReference<"mutation">("knowledge:submitCandidateObject");
const createProjectDirectRef = makeFunctionReference<"mutation">("knowledge:createProjectDirect");
const createTaskDirectRef = makeFunctionReference<"mutation">("knowledge:createTaskDirect");
const addSourceRefRef = makeFunctionReference<"mutation">("knowledge:addSourceRef");
const linkEntitiesRef = makeFunctionReference<"mutation">("knowledge:linkEntities");
const getLatestFocusSummaryRef = makeFunctionReference<"query">("knowledge:getLatestFocusSummary");
const upsertFocusSummaryRef = makeFunctionReference<"mutation">("knowledge:upsertFocusSummary");
const listPendingActionsRef = makeFunctionReference<"query">("knowledge:listPendingActions");
const markTaskDoneRef = makeFunctionReference<"mutation">("knowledge:markTaskDone");
const recordPendingActionResultRef = makeFunctionReference<"mutation">("knowledge:recordPendingActionResult");
const recordIngestionRunRef = makeFunctionReference<"mutation">("knowledge:recordIngestionRun");

export function createConvexSkippyClient(convexUrl: string, authToken?: string): SkippyClient {
  const client = new ConvexHttpClient(convexUrl);
  if (authToken) {
    client.setAuth(authToken);
  }

  return {
    submitCandidateObject: (brainInstanceId, input) =>
      client.mutation(submitCandidateObjectRef, { brainInstanceId, ...input }),
    createProjectDirect: (brainInstanceId, input) =>
      client.mutation(createProjectDirectRef, { brainInstanceId, ...input }),
    createTaskDirect: (brainInstanceId, input) =>
      client.mutation(createTaskDirectRef, { brainInstanceId, ...input }),
    addSourceRef: (brainInstanceId, sourceRef) =>
      client.mutation(addSourceRefRef, { brainInstanceId, sourceRef }),
    linkEntities: (brainInstanceId, relationship) =>
      client.mutation(linkEntitiesRef, { brainInstanceId, ...relationship }),
    getLatestFocusSummary: (brainInstanceId) =>
      client.query(getLatestFocusSummaryRef, { brainInstanceId }) as Promise<FocusSummary | null>,
    upsertFocusSummary: (brainInstanceId, summary) =>
      client.mutation(upsertFocusSummaryRef, { brainInstanceId, ...summary }),
    listPendingActions: (brainInstanceId, status) =>
      client.query(listPendingActionsRef, { brainInstanceId, status }),
    markTaskDone: (brainInstanceId, taskId, completedBy, externalReminderSourceRefId) =>
      client.mutation(markTaskDoneRef, {
        brainInstanceId,
        taskId,
        completedBy,
        externalReminderSourceRefId,
      }),
    recordPendingActionResult: (pendingActionId, result) =>
      client.mutation(recordPendingActionResultRef, { pendingActionId, ...result }),
    recordIngestionRun: (brainInstanceId, run) =>
      client.mutation(recordIngestionRunRef, { brainInstanceId, ...run }),
  };
}

export type ConvexSkippyClientInput = {
  submitCandidateObject: CandidateObjectInput;
  addSourceRef: SourceRefInput;
  linkEntities: RelationshipInput;
  focusSummary: FocusSummary;
  pendingAction: PendingActionInput;
  entityRef: EntityRef;
};
