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
const ingestObjectRef = makeFunctionReference<"mutation">("knowledge:ingestObject");
const createProjectDirectRef = makeFunctionReference<"mutation">("knowledge:createProjectDirect");
const createTaskDirectRef = makeFunctionReference<"mutation">("knowledge:createTaskDirect");
const addSourceRefRef = makeFunctionReference<"mutation">("knowledge:addSourceRef");
const linkEntitiesRef = makeFunctionReference<"mutation">("knowledge:linkEntities");
const getLatestFocusSummaryRef = makeFunctionReference<"query">("knowledge:getLatestFocusSummary");
const aiContextForBrainRef = makeFunctionReference<"query">("knowledge:aiContextForBrain");
const upsertEntityEmbeddingRef = makeFunctionReference<"mutation">("knowledge:upsertEntityEmbedding");
const upsertFocusSummaryRef = makeFunctionReference<"mutation">("knowledge:upsertFocusSummary");
const listPendingActionsRef = makeFunctionReference<"query">("knowledge:listPendingActions");
const markTaskInProgressRef = makeFunctionReference<"mutation">("knowledge:markTaskInProgress");
const markTaskDoneRef = makeFunctionReference<"mutation">("knowledge:markTaskDone");
const recordPendingActionResultRef = makeFunctionReference<"mutation">("knowledge:recordPendingActionResult");
const recordEntityReviewRef = makeFunctionReference<"mutation">("knowledge:recordEntityReview");
const recordIngestionRunRef = makeFunctionReference<"mutation">("knowledge:recordIngestionRun");
const updateSourceSyncStatusRef = makeFunctionReference<"mutation">("knowledge:updateSourceSyncStatus");
const operatingRulesForBrainRef = makeFunctionReference<"query">("settings:operatingRulesForBrain");
const getEffectiveRubricForBrainRef = makeFunctionReference<"query">("settings:getEffectiveRubricForBrain");
const notificationDispatchContextForBrainRef = makeFunctionReference<"query">("settings:notificationDispatchContextForBrain");
const recordNotificationDeliveryRef = makeFunctionReference<"mutation">("settings:recordNotificationDelivery");

export function createConvexSkippyClient(convexUrl: string, authToken?: string): SkippyClient {
  const client = new ConvexHttpClient(convexUrl);
  if (authToken) {
    client.setAuth(authToken);
  }

  return {
    submitCandidateObject: (brainInstanceId, input) =>
      client.mutation(submitCandidateObjectRef, { brainInstanceId, ...input }),
    ingestObject: (brainInstanceId, input) =>
      client.mutation(ingestObjectRef, { brainInstanceId, ...input }),
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
    getAiContext: (brainInstanceId) => client.query(aiContextForBrainRef, { brainInstanceId }),
    upsertEntityEmbedding: (brainInstanceId, embedding) =>
      client.mutation(upsertEntityEmbeddingRef, { brainInstanceId, ...embedding }),
    upsertFocusSummary: (brainInstanceId, summary) =>
      client.mutation(upsertFocusSummaryRef, { brainInstanceId, ...summary }),
    listPendingActions: (brainInstanceId, status) =>
      client.query(listPendingActionsRef, { brainInstanceId, status }),
    markTaskInProgress: (brainInstanceId, taskId, startedBy) =>
      client.mutation(markTaskInProgressRef, {
        brainInstanceId,
        taskId,
        startedBy,
      }),
    markTaskDone: (brainInstanceId, taskId, completedByUserId, externalReminderSourceRefId) =>
      client.mutation(markTaskDoneRef, {
        brainInstanceId,
        taskId,
        completedBy: completedByUserId,
        externalReminderSourceRefId,
      }),
    recordPendingActionResult: (pendingActionId, result) =>
      client.mutation(recordPendingActionResultRef, { pendingActionId, ...result }),
    recordEntityReview: (brainInstanceId, review) =>
      client.mutation(recordEntityReviewRef, { brainInstanceId, ...review }),
    recordIngestionRun: (brainInstanceId, run) =>
      client.mutation(recordIngestionRunRef, { brainInstanceId, ...run }),
    updateSourceSyncStatus: (brainInstanceId, status) =>
      client.mutation(updateSourceSyncStatusRef, { brainInstanceId, ...status }),
    getOperatingRules: (brainInstanceId, scope) =>
      client.query(operatingRulesForBrainRef, { brainInstanceId, scope }),
    getEffectiveRubric: (brainInstanceId) =>
      client.query(getEffectiveRubricForBrainRef, { brainInstanceId }),
    getNotificationDispatchContext: (brainInstanceId) =>
      client.query(notificationDispatchContextForBrainRef, { brainInstanceId }),
    recordNotificationDelivery: (brainInstanceId, delivery) =>
      client.mutation(recordNotificationDeliveryRef, { brainInstanceId, ...delivery }),
  };
}

export type ConvexSkippyClientInput = {
  submitCandidateObject: CandidateObjectInput;
  ingestObject: CandidateObjectInput & { rubricDecision: string };
  addSourceRef: SourceRefInput;
  linkEntities: RelationshipInput;
  focusSummary: FocusSummary;
  pendingAction: PendingActionInput;
  entityRef: EntityRef;
};
