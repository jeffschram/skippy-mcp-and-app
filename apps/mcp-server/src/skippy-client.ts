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
import type {
  CaptureThoughtInput,
  AnswerInterviewQuestionInput,
  ArchiveInterviewInput,
  CompleteInterviewInput,
  ContextBundleInput,
  GetInterviewInput,
  InterviewListInput,
  LinkMemoryInput,
  MemoryDetailInput,
  MemoryListInput,
  MemoryReviewCandidateInput,
  RecordMemoryInput,
  SkippyClient,
  StartInterviewInput,
} from "./tools.js";

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
const currentContextForBrainRef = makeFunctionReference<"query">("projects:currentContextForBrain");
const planProjectForBrainRef = makeFunctionReference<"action">("planning:planProjectForBrain");
const readyTasksForBrainRef = makeFunctionReference<"query">("projects:readyTasksForBrain");
const requestedReadyTasksForBrainRef = makeFunctionReference<"query">("projects:requestedReadyTasksForBrain");
const getTaskBriefForBrainRef = makeFunctionReference<"query">("projects:getTaskBriefForBrain");
const briefTaskForBrainRef = makeFunctionReference<"mutation">("planning:briefTaskForBrain");
const recordTaskResultForBrainRef = makeFunctionReference<"mutation">("projects:recordTaskResultForBrain");
const updateLinkStatusForBrainRef = makeFunctionReference<"mutation">("knowledge:updateLinkStatusForBrain");
const getSkillForBrainRef = makeFunctionReference<"query">("skills:getSkillForBrain");
const captureThoughtForBrainRef = makeFunctionReference<"mutation">("knowledge:captureThoughtForBrain");
const recordMemoryForBrainRef = makeFunctionReference<"mutation">("knowledge:recordMemoryForBrain");
const submitMemoryReviewCandidateForBrainRef = makeFunctionReference<"mutation">(
  "knowledge:submitMemoryReviewCandidateForBrain",
);
const searchMemoriesForBrainRef = makeFunctionReference<"query">("knowledge:searchMemoriesForBrain");
const getContextBundleForBrainRef = makeFunctionReference<"query">("knowledge:getContextBundleForBrain");
const memoryDetailForBrainRef = makeFunctionReference<"query">("knowledge:memoryDetailForBrain");
const linkMemoryForBrainRef = makeFunctionReference<"mutation">("knowledge:linkMemoryForBrain");
const interviewTemplatesForBrainRef = makeFunctionReference<"query">("interviews:templatesForBrain");
const listInterviewsForBrainRef = makeFunctionReference<"query">("interviews:listForBrain");
const interviewDetailForBrainRef = makeFunctionReference<"query">("interviews:detailForBrain");
const startInterviewForBrainRef = makeFunctionReference<"mutation">("interviews:startForBrain");
const answerInterviewQuestionForBrainRef = makeFunctionReference<"mutation">("interviews:answerCurrentQuestionForBrain");
const completeInterviewForBrainRef = makeFunctionReference<"mutation">("interviews:completeForBrain");
const archiveInterviewForBrainRef = makeFunctionReference<"mutation">("interviews:archiveForBrain");
const recordIngestionRunRef = makeFunctionReference<"mutation">("knowledge:recordIngestionRun");
const updateSourceSyncStatusRef = makeFunctionReference<"mutation">("knowledge:updateSourceSyncStatus");
const operatingRulesForBrainRef = makeFunctionReference<"query">("settings:operatingRulesForBrain");
const getEffectiveRubricForBrainRef = makeFunctionReference<"query">("settings:getEffectiveRubricForBrain");
const notificationDispatchContextForBrainRef = makeFunctionReference<"query">("settings:notificationDispatchContextForBrain");
const recordNotificationDeliveryRef = makeFunctionReference<"mutation">("settings:recordNotificationDelivery");
const upsertFinancialAccountForBrainRef = makeFunctionReference<"mutation">("finances:upsertFinancialAccountForBrain");
const recordFinancialTransactionsForBrainRef = makeFunctionReference<"mutation">(
  "finances:recordFinancialTransactionsForBrain",
);
const recordDailyBalancesForBrainRef = makeFunctionReference<"mutation">(
  "finances:recordDailyBalancesForBrain",
);
const monthlyReportForBrainRef = makeFunctionReference<"query">("finances:monthlyReportForBrain");

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
    getCurrentContext: (brainInstanceId) =>
      client.query(currentContextForBrainRef, { brainInstanceId }),
    planProject: (brainInstanceId, input) =>
      client.action(planProjectForBrainRef, { brainInstanceId, ...input }),
    listReadyTasks: (brainInstanceId, input) =>
      client.query(readyTasksForBrainRef, { brainInstanceId, ...input }),
    listRequestedReadyTasks: (brainInstanceId, input) =>
      client.query(requestedReadyTasksForBrainRef, { brainInstanceId, ...input }),
    getTaskBrief: (brainInstanceId, input) =>
      client.query(getTaskBriefForBrainRef, { brainInstanceId, ...input }),
    briefTask: (brainInstanceId, input) =>
      client.mutation(briefTaskForBrainRef, { brainInstanceId, ...input }),
    getSkill: (brainInstanceId, input) =>
      client.query(getSkillForBrainRef, { brainInstanceId, ...input }),
    recordTaskResult: (brainInstanceId, input) =>
      client.mutation(recordTaskResultForBrainRef, { brainInstanceId, ...input }),
    updateLinkStatus: (brainInstanceId, input) =>
      client.mutation(updateLinkStatusForBrainRef, { brainInstanceId, ...input }),
    captureThought: (brainInstanceId, input) =>
      client.mutation(captureThoughtForBrainRef, { brainInstanceId, ...input }),
    recordMemory: (brainInstanceId, input) =>
      client.mutation(recordMemoryForBrainRef, { brainInstanceId, ...input }),
    submitMemoryReviewCandidate: (brainInstanceId, input) =>
      client.mutation(submitMemoryReviewCandidateForBrainRef, { brainInstanceId, ...input }),
    listMemory: (brainInstanceId, input) =>
      client.query(searchMemoriesForBrainRef, { brainInstanceId, ...input }),
    getContextBundle: (brainInstanceId, input) =>
      client.query(getContextBundleForBrainRef, { brainInstanceId, ...input }),
    getMemoryDetail: (brainInstanceId, input) =>
      client.query(memoryDetailForBrainRef, { brainInstanceId, ...input }),
    linkMemory: (brainInstanceId, input) =>
      client.mutation(linkMemoryForBrainRef, { brainInstanceId, ...input }),
    listInterviewTemplates: (brainInstanceId) =>
      client.query(interviewTemplatesForBrainRef, { brainInstanceId }),
    listInterviews: (brainInstanceId, input) =>
      client.query(listInterviewsForBrainRef, { brainInstanceId, ...input }),
    startInterview: (brainInstanceId, input) =>
      client.mutation(startInterviewForBrainRef, { brainInstanceId, ...input }),
    getInterview: (brainInstanceId, input) =>
      client.query(interviewDetailForBrainRef, { brainInstanceId, ...input }),
    answerInterviewQuestion: (brainInstanceId, input) =>
      client.mutation(answerInterviewQuestionForBrainRef, { brainInstanceId, ...input }),
    completeInterview: (brainInstanceId, input) =>
      client.mutation(completeInterviewForBrainRef, { brainInstanceId, ...input }),
    archiveInterview: (brainInstanceId, input) =>
      client.mutation(archiveInterviewForBrainRef, { brainInstanceId, ...input }),
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
    upsertFinancialAccount: (brainInstanceId, input) =>
      client.mutation(upsertFinancialAccountForBrainRef, { brainInstanceId, ...input }),
    recordFinancialTransactions: (brainInstanceId, input) =>
      client.mutation(recordFinancialTransactionsForBrainRef, { brainInstanceId, ...input }),
    recordFinancialBalances: (brainInstanceId, input) =>
      client.mutation(recordDailyBalancesForBrainRef, { brainInstanceId, ...input }),
    getFinancialReport: (brainInstanceId, input) =>
      client.query(monthlyReportForBrainRef, { brainInstanceId, ...input }),
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
  captureThought: CaptureThoughtInput;
  recordMemory: RecordMemoryInput;
  memoryReviewCandidate: MemoryReviewCandidateInput;
  memoryList: MemoryListInput;
  contextBundle: ContextBundleInput;
  memoryDetail: MemoryDetailInput;
  linkMemory: LinkMemoryInput;
  interviewList: InterviewListInput;
  startInterview: StartInterviewInput;
  getInterview: GetInterviewInput;
  answerInterviewQuestion: AnswerInterviewQuestionInput;
  completeInterview: CompleteInterviewInput;
  archiveInterview: ArchiveInterviewInput;
};
