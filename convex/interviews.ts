import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireOwnedBrain } from "./auth";

const interviewKind = v.union(
  v.literal("project"),
  v.literal("goal"),
  v.literal("person"),
  v.literal("decision"),
  v.literal("weekly_review"),
);

const entityType = v.union(
  v.literal("goal"),
  v.literal("project"),
  v.literal("task"),
  v.literal("note"),
  v.literal("person"),
  v.literal("company"),
  v.literal("link"),
  v.literal("knowledgeObject"),
);

const entityRef = v.object({
  entityType,
  entityId: v.string(),
});

const memoryType = v.union(
  v.literal("thought"),
  v.literal("memory"),
  v.literal("decision"),
  v.literal("principle"),
  v.literal("question"),
  v.literal("insight"),
  v.literal("artifact"),
);

type InterviewKind = "project" | "goal" | "person" | "decision" | "weekly_review";
type MemoryType = "thought" | "memory" | "decision" | "principle" | "question" | "insight" | "artifact";
type EntityRef = { entityType: string; entityId: string };

type InterviewQuestion = {
  id: string;
  prompt: string;
  helper?: string;
  placeholder?: string;
  captureMemoryAs?: MemoryType;
};

type InterviewTemplate = {
  kind: InterviewKind;
  title: string;
  description: string;
  questions: InterviewQuestion[];
};

type InterviewActor = {
  actorType: "user" | "harness";
  actorId?: string;
};

const interviewTemplates: Record<InterviewKind, InterviewTemplate> = {
  project: {
    kind: "project",
    title: "Project check-in",
    description: "Clarify scope, momentum, blockers, and next action.",
    questions: [
      {
        id: "project_current_state",
        prompt: "What is the current state of this project?",
        placeholder: "What is true right now, including any recent changes.",
      },
      {
        id: "project_desired_outcome",
        prompt: "What outcome would make this project successful?",
        placeholder: "Describe the finished state or the next meaningful milestone.",
        captureMemoryAs: "memory",
      },
      {
        id: "project_blockers",
        prompt: "What is blocked, risky, or unclear?",
        placeholder: "Name dependencies, decisions, missing information, or energy drains.",
      },
      {
        id: "project_next_action",
        prompt: "What is the next concrete action?",
        placeholder: "A small action someone could actually do next.",
      },
    ],
  },
  goal: {
    kind: "goal",
    title: "Goal check-in",
    description: "Reconnect a goal to motivation, evidence, constraints, and next move.",
    questions: [
      {
        id: "goal_why",
        prompt: "Why does this goal matter now?",
        placeholder: "Connect it to values, obligations, or desired future state.",
        captureMemoryAs: "insight",
      },
      {
        id: "goal_progress_signal",
        prompt: "What evidence would show real progress?",
        placeholder: "A measurable signal, visible artifact, or behavior change.",
      },
      {
        id: "goal_obstacle",
        prompt: "What is most likely to get in the way?",
        placeholder: "Time, ambiguity, fear, dependency, competing priority, etc.",
      },
      {
        id: "goal_next_commitment",
        prompt: "What commitment should Skippy help you protect?",
        placeholder: "The next action, cadence, review, or boundary.",
      },
    ],
  },
  person: {
    kind: "person",
    title: "Person check-in",
    description: "Capture relationship context and useful follow-up memory.",
    questions: [
      {
        id: "person_context",
        prompt: "What should Skippy remember about this person right now?",
        placeholder: "Role, relationship, current situation, preferences, or sensitivities.",
        captureMemoryAs: "memory",
      },
      {
        id: "person_recent_interaction",
        prompt: "What happened in the most recent interaction?",
        placeholder: "Briefly note what was discussed, promised, or implied.",
      },
      {
        id: "person_follow_up",
        prompt: "Is there a follow-up, promise, or waiting item?",
        placeholder: "Who owes what, by when, and what good follow-up looks like.",
      },
      {
        id: "person_tone",
        prompt: "How should Skippy handle this relationship?",
        placeholder: "Tone, boundaries, topics to avoid, or helpful context before contact.",
        captureMemoryAs: "principle",
      },
    ],
  },
  decision: {
    kind: "decision",
    title: "Decision check-in",
    description: "Make a decision legible: options, criteria, choice, and revisit trigger.",
    questions: [
      {
        id: "decision_question",
        prompt: "What decision are you trying to make?",
        placeholder: "Frame it as a question or choice.",
      },
      {
        id: "decision_options",
        prompt: "What options are seriously on the table?",
        placeholder: "List the viable choices and any rejected obvious alternatives.",
      },
      {
        id: "decision_criteria",
        prompt: "What criteria matter most?",
        placeholder: "Values, constraints, cost, reversibility, timing, risk, etc.",
      },
      {
        id: "decision_choice",
        prompt: "What is the current decision or leaning?",
        placeholder: "State the choice, confidence, and what would change your mind.",
        captureMemoryAs: "decision",
      },
    ],
  },
  weekly_review: {
    kind: "weekly_review",
    title: "Weekly review",
    description: "Reflect on wins, open loops, learning, and the shape of next week.",
    questions: [
      {
        id: "weekly_wins",
        prompt: "What went well this week?",
        placeholder: "Wins, good choices, useful signals, or moments worth remembering.",
        captureMemoryAs: "insight",
      },
      {
        id: "weekly_loops",
        prompt: "What open loops need attention?",
        placeholder: "Tasks, conversations, decisions, messes, or waiting items.",
      },
      {
        id: "weekly_learnings",
        prompt: "What did you learn about how you work?",
        placeholder: "Patterns, friction, energy, timing, assumptions, or useful constraints.",
        captureMemoryAs: "principle",
      },
      {
        id: "weekly_next_week",
        prompt: "What should next week be organized around?",
        placeholder: "A theme, priority, protected block, or handful of outcomes.",
      },
    ],
  },
};

function optionalTrimmed(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function templateSummaries() {
  return Object.values(interviewTemplates).map((template) => ({
    kind: template.kind,
    title: template.title,
    description: template.description,
    questionCount: template.questions.length,
  }));
}

function compactQuestion(question: InterviewQuestion | undefined) {
  if (!question) {
    return undefined;
  }

  return {
    id: question.id,
    prompt: question.prompt,
    helper: question.helper,
    placeholder: question.placeholder,
    captureMemoryAs: question.captureMemoryAs,
  };
}

function compactTemplate(template: InterviewTemplate) {
  return {
    kind: template.kind,
    title: template.title,
    description: template.description,
    questions: template.questions,
  };
}

function promptSubject(kind: InterviewKind) {
  if (kind === "weekly_review") {
    return "weekly review";
  }
  return `${kind.replace("_", " ")} interview`;
}

function proposedPrompt(kind: InterviewKind, assistantDisplayName: string) {
  return `Want to do a ${promptSubject(kind)} for ${assistantDisplayName}?`;
}

function titleForInterview(kind: InterviewKind, subjectLabel?: string, title?: string) {
  const explicitTitle = optionalTrimmed(title);
  if (explicitTitle) {
    return explicitTitle;
  }

  const template = interviewTemplates[kind];
  const label = optionalTrimmed(subjectLabel);
  return label ? `${template.title}: ${label}` : template.title;
}

function memoryTitleFor(memoryTypeName: MemoryType, prompt: string, answer: string) {
  const firstLine = answer.replace(/\s+/g, " ").trim().slice(0, 76);
  if (firstLine) {
    return firstLine;
  }
  return `${memoryTypeName.slice(0, 1).toUpperCase()}${memoryTypeName.slice(1)} from interview`;
}

function tableForEntityType(entityTypeName: string) {
  switch (entityTypeName) {
    case "goal":
      return "goals";
    case "project":
      return "projects";
    case "task":
      return "tasks";
    case "note":
      return "notes";
    case "person":
      return "people";
    case "company":
      return "companies";
    case "link":
      return "links";
    case "knowledgeObject":
      return "knowledgeObjects";
    default:
      throw new Error("unsupported entity type");
  }
}

async function requireEntityRefForBrain(db: any, brainInstanceId: string, ref: EntityRef | undefined) {
  if (!ref) {
    return undefined;
  }

  const entity = await db.get(ref.entityId);
  if (!entity || entity.brainInstanceId !== brainInstanceId) {
    throw new Error("subject entity not found");
  }

  if (tableForEntityType(ref.entityType) === undefined) {
    throw new Error("unsupported entity type");
  }

  return ref;
}

async function requireInterviewForBrain(db: any, brainInstanceId: string, interviewId: string) {
  const interview = await db.get(interviewId);
  if (!interview || interview.brainInstanceId !== brainInstanceId) {
    throw new Error("interview not found");
  }
  return interview;
}

async function requireBrain(db: any, brainInstanceId: string) {
  const brain = await db.get(brainInstanceId);
  if (!brain) {
    throw new Error("brain not found");
  }
  return brain;
}

async function assistantDisplayNameForBrain(db: any, brainInstanceId: string) {
  const config = await db
    .query("brainConfigs")
    .withIndex("by_brain", (q: any) => q.eq("brainInstanceId", brainInstanceId))
    .first();
  return config?.assistantDisplayName ?? "Skippy";
}

async function responsesForInterview(db: any, interviewId: string) {
  return await db
    .query("interviewResponses")
    .withIndex("by_interview_order", (q: any) => q.eq("interviewId", interviewId))
    .collect();
}

function buildSummaryBody(interview: any, template: InterviewTemplate, responses: any[]) {
  const subject = interview.subjectLabel ? `Subject: ${interview.subjectLabel}\n\n` : "";
  const lines = responses
    .sort((a, b) => a.questionIndex - b.questionIndex)
    .map((response) => `Q: ${response.prompt}\nA: ${response.answerText}`)
    .join("\n\n");

  return `${subject}${template.title}\n\n${lines}`.trim();
}

async function createMemoryReviewCandidate(db: any, args: {
  brainInstanceId: string;
  userId?: string;
  actor?: InterviewActor;
  memoryType: MemoryType;
  title: string;
  body: string;
  summary?: string;
  captureReason: string;
  relatedEntityRefs?: EntityRef[];
  now: number;
}) {
  const memoryId = await db.insert("memories", {
    brainInstanceId: args.brainInstanceId,
    memoryType: args.memoryType,
    title: args.title,
    ...(args.summary ? { summary: args.summary } : {}),
    body: args.body,
    status: "inbox",
    reviewState: "pending_review",
    confidence: 0.8,
    ...(args.relatedEntityRefs?.length ? { relatedEntityRefs: args.relatedEntityRefs } : {}),
    captureReason: args.captureReason,
    createdAt: args.now,
    updatedAt: args.now,
  });

  await db.insert("activityEvents", {
    brainInstanceId: args.brainInstanceId,
    activityType: "memory_review_candidate_submitted",
    actorType: args.actor?.actorType ?? "user",
    actorId: args.actor?.actorId ?? args.userId,
    timestamp: args.now,
    summary: `Memory review candidate submitted: ${args.title}`,
    metadata: {
      memoryId,
      memoryType: args.memoryType,
      captureReason: args.captureReason,
      source: "guided_interview",
    },
  });

  return memoryId;
}

async function startInterviewForBrain(db: any, args: {
  brainInstanceId: string;
  kind: InterviewKind;
  title?: string;
  subjectLabel?: string;
  subjectEntityRef?: EntityRef;
  actor: InterviewActor;
}) {
  const brain = await requireBrain(db, args.brainInstanceId);
  const now = Date.now();
  const template = interviewTemplates[args.kind];
  const subjectEntityRef = await requireEntityRefForBrain(db, args.brainInstanceId, args.subjectEntityRef);
  const subjectLabel = optionalTrimmed(args.subjectLabel);
  const title = titleForInterview(args.kind, subjectLabel, args.title);
  const assistantDisplayName = await assistantDisplayNameForBrain(db, args.brainInstanceId);
  const interviewId = await db.insert("interviews", {
    brainInstanceId: args.brainInstanceId,
    templateKind: args.kind,
    title,
    status: "active",
    currentQuestionIndex: 0,
    questionCount: template.questions.length,
    ...(subjectEntityRef ? { subjectEntityRef } : {}),
    ...(subjectLabel ? { subjectLabel } : {}),
    startedBy: brain.ownerUserId,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert("activityEvents", {
    brainInstanceId: args.brainInstanceId,
    activityType: "interview_started",
    actorType: args.actor.actorType,
    actorId: args.actor.actorId,
    timestamp: now,
    summary: `Interview started: ${title}`,
    metadata: { interviewId, templateKind: args.kind, subjectLabel, source: "mcp_interview" },
  });

  return {
    interviewId,
    assistantDisplayName,
    interview: {
      _id: interviewId,
      title,
      templateKind: args.kind,
      status: "active",
      currentQuestionIndex: 0,
      questionCount: template.questions.length,
      subjectLabel,
      subjectEntityRef,
    },
    template: compactTemplate(template),
    currentQuestion: compactQuestion(template.questions[0]),
    progress: { answered: 0, total: template.questions.length },
    suggestedPrompt: proposedPrompt(args.kind, assistantDisplayName),
    reviewUrl: `/interviews/${interviewId}`,
  };
}

async function interviewDetailForBrain(db: any, args: { brainInstanceId: string; interviewId: string }) {
  await requireBrain(db, args.brainInstanceId);
  const interview = await db.get(args.interviewId);
  if (!interview || interview.brainInstanceId !== args.brainInstanceId) {
    return null;
  }

  const template = interviewTemplates[interview.templateKind as InterviewKind];
  const responses = await responsesForInterview(db, interview._id);
  const currentQuestion =
    interview.status === "active" ? template.questions[interview.currentQuestionIndex] : undefined;
  const assistantDisplayName = await assistantDisplayNameForBrain(db, args.brainInstanceId);

  return {
    assistantDisplayName,
    interview,
    template: compactTemplate(template),
    responses,
    currentQuestion: compactQuestion(currentQuestion),
    progress: {
      answered: responses.length,
      total: template.questions.length,
    },
    reviewUrl: `/interviews/${interview._id}`,
  };
}

async function answerCurrentQuestionForBrainCore(db: any, args: {
  brainInstanceId: string;
  interviewId: string;
  answerText: string;
  answerValue?: unknown;
  createMemoryCandidate?: boolean;
  memoryType?: MemoryType;
  actor: InterviewActor;
}) {
  await requireBrain(db, args.brainInstanceId);
  const interview = await requireInterviewForBrain(db, args.brainInstanceId, args.interviewId);
  if (interview.status !== "active") {
    throw new Error("only active interviews can be answered");
  }

  const template = interviewTemplates[interview.templateKind as InterviewKind];
  const question = template.questions[interview.currentQuestionIndex];
  if (!question) {
    throw new Error("interview has no current question");
  }

  const answerText = args.answerText.trim();
  if (!answerText) {
    throw new Error("answer is required");
  }

  const now = Date.now();
  const existing = await db
    .query("interviewResponses")
    .withIndex("by_interview_order", (q: any) => q.eq("interviewId", interview._id))
    .filter((q: any) => q.eq(q.field("questionIndex"), interview.currentQuestionIndex))
    .first();

  let memoryCandidateId = existing?.memoryCandidateId;
  if (args.createMemoryCandidate && question.captureMemoryAs) {
    memoryCandidateId = await createMemoryReviewCandidate(db, {
      brainInstanceId: args.brainInstanceId,
      actor: args.actor,
      memoryType: args.memoryType ?? question.captureMemoryAs,
      title: memoryTitleFor(args.memoryType ?? question.captureMemoryAs, question.prompt, answerText),
      body: answerText,
      summary: question.prompt,
      captureReason: `Explicitly submitted from ${template.title}: ${question.prompt}`,
      ...(interview.subjectEntityRef ? { relatedEntityRefs: [interview.subjectEntityRef] } : {}),
      now,
    });
  }

  if (existing) {
    await db.patch(existing._id, {
      answerText,
      ...(args.answerValue !== undefined ? { answerValue: args.answerValue } : {}),
      ...(memoryCandidateId ? { memoryCandidateId } : {}),
      updatedAt: now,
    });
  } else {
    await db.insert("interviewResponses", {
      brainInstanceId: args.brainInstanceId,
      interviewId: interview._id,
      questionId: question.id,
      questionIndex: interview.currentQuestionIndex,
      prompt: question.prompt,
      answerText,
      ...(args.answerValue !== undefined ? { answerValue: args.answerValue } : {}),
      ...(memoryCandidateId ? { memoryCandidateId } : {}),
      createdAt: now,
      updatedAt: now,
    });
  }

  const nextQuestionIndex = Math.min(interview.currentQuestionIndex + 1, template.questions.length);
  await db.patch(interview._id, {
    currentQuestionIndex: nextQuestionIndex,
    updatedAt: now,
  });

  await db.insert("activityEvents", {
    brainInstanceId: args.brainInstanceId,
    activityType: "interview_question_answered",
    actorType: args.actor.actorType,
    actorId: args.actor.actorId,
    timestamp: now,
    summary: `Interview question answered: ${question.prompt}`,
    metadata: { interviewId: interview._id, questionId: question.id, memoryCandidateId, source: "mcp_interview" },
  });

  const assistantDisplayName = await assistantDisplayNameForBrain(db, args.brainInstanceId);
  const nextQuestion = template.questions[nextQuestionIndex];

  return {
    interviewId: interview._id,
    assistantDisplayName,
    answeredQuestion: compactQuestion(question),
    nextQuestion: compactQuestion(nextQuestion),
    nextQuestionIndex,
    isLastAnswer: nextQuestionIndex >= template.questions.length,
    memoryCandidateId,
    progress: {
      answered: Math.min(nextQuestionIndex, template.questions.length),
      total: template.questions.length,
    },
    reviewUrl: `/interviews/${interview._id}`,
  };
}

async function completeInterviewForBrain(db: any, args: {
  brainInstanceId: string;
  interviewId: string;
  summary?: string;
  createSummaryMemoryCandidate?: boolean;
  memoryType?: MemoryType;
  actor: InterviewActor;
}) {
  await requireBrain(db, args.brainInstanceId);
  const interview = await requireInterviewForBrain(db, args.brainInstanceId, args.interviewId);
  const template = interviewTemplates[interview.templateKind as InterviewKind];
  const responses = await responsesForInterview(db, interview._id);
  const now = Date.now();
  const summary = optionalTrimmed(args.summary);
  let memoryCandidateId: string | undefined;

  if (args.createSummaryMemoryCandidate) {
    const body = buildSummaryBody(interview, template, responses);
    if (body) {
      const defaultMemoryType =
        interview.templateKind === "decision"
          ? "decision"
          : interview.templateKind === "weekly_review"
            ? "insight"
            : "memory";
      memoryCandidateId = await createMemoryReviewCandidate(db, {
        brainInstanceId: args.brainInstanceId,
        actor: args.actor,
        memoryType: args.memoryType ?? defaultMemoryType,
        title: `${template.title}${interview.subjectLabel ? `: ${interview.subjectLabel}` : ""}`,
        body,
        ...(summary ? { summary } : {}),
        captureReason: `Explicitly submitted from completed ${template.title}`,
        ...(interview.subjectEntityRef ? { relatedEntityRefs: [interview.subjectEntityRef] } : {}),
        now,
      });
    }
  }

  await db.patch(interview._id, {
    status: "completed",
    currentQuestionIndex: template.questions.length,
    ...(summary ? { summary } : {}),
    completedAt: now,
    updatedAt: now,
  });

  await db.insert("activityEvents", {
    brainInstanceId: args.brainInstanceId,
    activityType: "interview_completed",
    actorType: args.actor.actorType,
    actorId: args.actor.actorId,
    timestamp: now,
    summary: `Interview completed: ${interview.title}`,
    metadata: { interviewId: interview._id, templateKind: interview.templateKind, memoryCandidateId, source: "mcp_interview" },
  });

  return {
    interviewId: interview._id,
    assistantDisplayName: await assistantDisplayNameForBrain(db, args.brainInstanceId),
    memoryCandidateId,
    reviewUrl: `/interviews/${interview._id}`,
  };
}

async function archiveInterviewForBrain(db: any, args: {
  brainInstanceId: string;
  interviewId: string;
  archiveReason?: string;
  actor: InterviewActor;
}) {
  await requireBrain(db, args.brainInstanceId);
  const interview = await requireInterviewForBrain(db, args.brainInstanceId, args.interviewId);
  const now = Date.now();
  const archiveReason = optionalTrimmed(args.archiveReason);

  await db.patch(interview._id, {
    status: "archived",
    archivedAt: now,
    ...(archiveReason ? { archiveReason } : {}),
    updatedAt: now,
  });

  await db.insert("activityEvents", {
    brainInstanceId: args.brainInstanceId,
    activityType: "interview_archived",
    actorType: args.actor.actorType,
    actorId: args.actor.actorId,
    timestamp: now,
    summary: `Interview archived: ${interview.title}`,
    metadata: { interviewId: interview._id, archiveReason, source: "mcp_interview" },
  });

  return {
    interviewId: interview._id,
    assistantDisplayName: await assistantDisplayNameForBrain(db, args.brainInstanceId),
    reviewUrl: "/interviews",
  };
}

export const templates = queryGeneric({
  args: {},
  handler: async () => templateSummaries(),
});

export const templatesForBrain = queryGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
  },
  handler: async (ctx, args) => {
    await requireBrain(ctx.db, args.brainInstanceId);
    const assistantDisplayName = await assistantDisplayNameForBrain(ctx.db, args.brainInstanceId);

    return {
      assistantDisplayName,
      templates: templateSummaries().map((template) => ({
        ...template,
        suggestedPrompt: proposedPrompt(template.kind as InterviewKind, assistantDisplayName),
      })),
    };
  },
});

export const listForBrain = queryGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    recentLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireBrain(ctx.db, args.brainInstanceId);
    const assistantDisplayName = await assistantDisplayNameForBrain(ctx.db, args.brainInstanceId);
    const recentLimit = Math.min(Math.max(args.recentLimit ?? 12, 1), 50);

    const active = await ctx.db
      .query("interviews")
      .withIndex("by_brain_status", (q) => q.eq("brainInstanceId", args.brainInstanceId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .order("desc")
      .take(50);

    const recent = await ctx.db
      .query("interviews")
      .withIndex("by_brain_updated", (q) => q.eq("brainInstanceId", args.brainInstanceId))
      .order("desc")
      .take(recentLimit);

    return {
      assistantDisplayName,
      templates: templateSummaries().map((template) => ({
        ...template,
        suggestedPrompt: proposedPrompt(template.kind as InterviewKind, assistantDisplayName),
      })),
      active,
      recent,
    };
  },
});

export const detailForBrain = queryGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    interviewId: v.id("interviews"),
  },
  handler: async (ctx, args) => interviewDetailForBrain(ctx.db, args),
});

export const startForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    kind: interviewKind,
    title: v.optional(v.string()),
    subjectLabel: v.optional(v.string()),
    subjectEntityRef: v.optional(entityRef),
    startedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    startInterviewForBrain(ctx.db, {
      ...args,
      actor: { actorType: "harness", actorId: optionalTrimmed(args.startedBy) ?? "skippy_mcp" },
    }),
});

export const answerCurrentQuestionForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    interviewId: v.id("interviews"),
    answerText: v.string(),
    answerValue: v.optional(v.any()),
    createMemoryCandidate: v.optional(v.boolean()),
    memoryType: v.optional(memoryType),
    answeredBy: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    answerCurrentQuestionForBrainCore(ctx.db, {
      ...args,
      actor: { actorType: "harness", actorId: optionalTrimmed(args.answeredBy) ?? "skippy_mcp" },
    }),
});

export const completeForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    interviewId: v.id("interviews"),
    summary: v.optional(v.string()),
    createSummaryMemoryCandidate: v.optional(v.boolean()),
    memoryType: v.optional(memoryType),
    completedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    completeInterviewForBrain(ctx.db, {
      ...args,
      actor: { actorType: "harness", actorId: optionalTrimmed(args.completedBy) ?? "skippy_mcp" },
    }),
});

export const archiveForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    interviewId: v.id("interviews"),
    archiveReason: v.optional(v.string()),
    archivedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    archiveInterviewForBrain(ctx.db, {
      ...args,
      actor: { actorType: "harness", actorId: optionalTrimmed(args.archivedBy) ?? "skippy_mcp" },
    }),
});

export const listForViewer = queryGeneric({
  args: {
    recentLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const recentLimit = Math.min(Math.max(args.recentLimit ?? 12, 1), 50);

    const active = await ctx.db
      .query("interviews")
      .withIndex("by_brain_status", (q) => q.eq("brainInstanceId", brain._id))
      .filter((q) => q.eq(q.field("status"), "active"))
      .order("desc")
      .take(50);

    const recent = await ctx.db
      .query("interviews")
      .withIndex("by_brain_updated", (q) => q.eq("brainInstanceId", brain._id))
      .order("desc")
      .take(recentLimit);

    return {
      templates: templateSummaries(),
      active,
      recent,
    };
  },
});

export const detailForViewer = queryGeneric({
  args: {
    interviewId: v.id("interviews"),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const interview = await ctx.db.get(args.interviewId);
    if (!interview || interview.brainInstanceId !== brain._id) {
      return null;
    }

    const template = interviewTemplates[interview.templateKind as InterviewKind];
    const responses = await responsesForInterview(ctx.db, interview._id);
    const currentQuestion =
      interview.status === "active" ? template.questions[interview.currentQuestionIndex] : undefined;

    return {
      interview,
      template: {
        kind: template.kind,
        title: template.title,
        description: template.description,
        questions: template.questions,
      },
      responses,
      currentQuestion,
      progress: {
        answered: responses.length,
        total: template.questions.length,
      },
    };
  },
});

export const start = mutationGeneric({
  args: {
    kind: interviewKind,
    title: v.optional(v.string()),
    subjectLabel: v.optional(v.string()),
    subjectEntityRef: v.optional(entityRef),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const now = Date.now();
    const template = interviewTemplates[args.kind];
    const subjectEntityRef = await requireEntityRefForBrain(ctx.db, brain._id, args.subjectEntityRef as any);
    const subjectLabel = optionalTrimmed(args.subjectLabel);
    const interviewId = await ctx.db.insert("interviews", {
      brainInstanceId: brain._id,
      templateKind: args.kind,
      title: titleForInterview(args.kind, subjectLabel, args.title),
      status: "active",
      currentQuestionIndex: 0,
      questionCount: template.questions.length,
      ...(subjectEntityRef ? { subjectEntityRef } : {}),
      ...(subjectLabel ? { subjectLabel } : {}),
      startedBy: user._id,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: "interview_started",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Interview started: ${titleForInterview(args.kind, subjectLabel, args.title)}`,
      metadata: { interviewId, templateKind: args.kind, subjectLabel },
    });

    return { interviewId };
  },
});

export const answerCurrentQuestion = mutationGeneric({
  args: {
    interviewId: v.id("interviews"),
    answerText: v.string(),
    answerValue: v.optional(v.any()),
    createMemoryCandidate: v.optional(v.boolean()),
    memoryType: v.optional(memoryType),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const interview = await requireInterviewForBrain(ctx.db, brain._id, args.interviewId);
    if (interview.status !== "active") {
      throw new Error("only active interviews can be answered");
    }

    const template = interviewTemplates[interview.templateKind as InterviewKind];
    const question = template.questions[interview.currentQuestionIndex];
    if (!question) {
      throw new Error("interview has no current question");
    }

    const answerText = args.answerText.trim();
    if (!answerText) {
      throw new Error("answer is required");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("interviewResponses")
      .withIndex("by_interview_order", (q) => q.eq("interviewId", interview._id))
      .filter((q) => q.eq(q.field("questionIndex"), interview.currentQuestionIndex))
      .first();

    let memoryCandidateId = existing?.memoryCandidateId;
    if (args.createMemoryCandidate && question.captureMemoryAs) {
      memoryCandidateId = await createMemoryReviewCandidate(ctx.db, {
        brainInstanceId: brain._id,
        userId: user._id,
        memoryType: args.memoryType ?? question.captureMemoryAs,
        title: memoryTitleFor(args.memoryType ?? question.captureMemoryAs, question.prompt, answerText),
        body: answerText,
        summary: question.prompt,
        captureReason: `Explicitly submitted from ${template.title}: ${question.prompt}`,
        ...(interview.subjectEntityRef ? { relatedEntityRefs: [interview.subjectEntityRef] } : {}),
        now,
      });
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        answerText,
        ...(args.answerValue !== undefined ? { answerValue: args.answerValue } : {}),
        ...(memoryCandidateId ? { memoryCandidateId } : {}),
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("interviewResponses", {
        brainInstanceId: brain._id,
        interviewId: interview._id,
        questionId: question.id,
        questionIndex: interview.currentQuestionIndex,
        prompt: question.prompt,
        answerText,
        ...(args.answerValue !== undefined ? { answerValue: args.answerValue } : {}),
        ...(memoryCandidateId ? { memoryCandidateId } : {}),
        createdAt: now,
        updatedAt: now,
      });
    }

    const nextQuestionIndex = Math.min(interview.currentQuestionIndex + 1, template.questions.length);
    await ctx.db.patch(interview._id, {
      currentQuestionIndex: nextQuestionIndex,
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: "interview_question_answered",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Interview question answered: ${question.prompt}`,
      metadata: { interviewId: interview._id, questionId: question.id, memoryCandidateId },
    });

    return {
      interviewId: interview._id,
      nextQuestionIndex,
      isLastAnswer: nextQuestionIndex >= template.questions.length,
      memoryCandidateId,
    };
  },
});

export const complete = mutationGeneric({
  args: {
    interviewId: v.id("interviews"),
    summary: v.optional(v.string()),
    createSummaryMemoryCandidate: v.optional(v.boolean()),
    memoryType: v.optional(memoryType),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const interview = await requireInterviewForBrain(ctx.db, brain._id, args.interviewId);
    const template = interviewTemplates[interview.templateKind as InterviewKind];
    const responses = await responsesForInterview(ctx.db, interview._id);
    const now = Date.now();
    const summary = optionalTrimmed(args.summary);
    let memoryCandidateId: string | undefined;

    if (args.createSummaryMemoryCandidate) {
      const body = buildSummaryBody(interview, template, responses);
      if (body) {
        const defaultMemoryType =
          interview.templateKind === "decision"
            ? "decision"
            : interview.templateKind === "weekly_review"
              ? "insight"
              : "memory";
        memoryCandidateId = await createMemoryReviewCandidate(ctx.db, {
          brainInstanceId: brain._id,
          userId: user._id,
          memoryType: args.memoryType ?? defaultMemoryType,
          title: `${template.title}${interview.subjectLabel ? `: ${interview.subjectLabel}` : ""}`,
          body,
          ...(summary ? { summary } : {}),
          captureReason: `Explicitly submitted from completed ${template.title}`,
          ...(interview.subjectEntityRef ? { relatedEntityRefs: [interview.subjectEntityRef] } : {}),
          now,
        });
      }
    }

    await ctx.db.patch(interview._id, {
      status: "completed",
      currentQuestionIndex: template.questions.length,
      ...(summary ? { summary } : {}),
      completedAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: "interview_completed",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Interview completed: ${interview.title}`,
      metadata: { interviewId: interview._id, templateKind: interview.templateKind, memoryCandidateId },
    });

    return { interviewId: interview._id, memoryCandidateId };
  },
});

export const archive = mutationGeneric({
  args: {
    interviewId: v.id("interviews"),
    archiveReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const interview = await requireInterviewForBrain(ctx.db, brain._id, args.interviewId);
    const now = Date.now();
    const archiveReason = optionalTrimmed(args.archiveReason);

    await ctx.db.patch(interview._id, {
      status: "archived",
      archivedAt: now,
      ...(archiveReason ? { archiveReason } : {}),
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: "interview_archived",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Interview archived: ${interview.title}`,
      metadata: { interviewId: interview._id, archiveReason },
    });

    return { interviewId: interview._id };
  },
});
