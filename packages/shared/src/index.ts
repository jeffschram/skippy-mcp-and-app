export const ENTITY_TYPES = [
  "goal",
  "project",
  "task",
  "note",
  "person",
  "company",
  "link",
  "knowledgeObject",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export type EntityRef = {
  entityType: EntityType;
  entityId: string;
};

export const PROCESSING_STATES = ["suggested", "accepted", "rejected", "archived"] as const;
export type ProcessingState = (typeof PROCESSING_STATES)[number];

export const GOAL_STATUSES = ["active", "paused", "achieved", "abandoned"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const PROJECT_STATUSES = [
  "idea",
  "planned",
  "in_progress",
  "paused",
  "completed",
  "cancelled",
  "archived",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TASK_STATUSES = ["todo", "in_progress", "waiting", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_OWNER_TYPES = ["owner", "agent"] as const;
export type TaskOwnerType = (typeof TASK_OWNER_TYPES)[number];

export const LINK_STATUSES = ["unread", "read", "saved", "discarded"] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Explicit read-later ("unread") links auto-age out of focus context after this many days.
 * They stay stored and searchable; they just stop feeding focus-summary generation (owner
 * principle: the link surface is for occasional management, not another queue to groom).
 * Ingested links default to "saved", which never ages and carries no attention hint.
 */
export const UNREAD_LINK_FOCUS_MAX_AGE_DAYS = 21;
export const UNREAD_LINK_FOCUS_MAX_AGE_MS = UNREAD_LINK_FOCUS_MAX_AGE_DAYS * DAY_MS;

export type LinkFocusFields = {
  status?: string;
  createdAt?: number;
};

/**
 * Whether a link should feed focus-summary context. Discarded links never qualify, and
 * explicit read-later ("unread") links older than the cutoff age out automatically.
 * "saved" links (the ingestion default) are passive reference: always candidates, never
 * aged, never flagged for attention.
 */
export function isLinkFocusCandidate(
  link: LinkFocusFields,
  now: number = Date.now(),
  maxUnreadAgeMs: number = UNREAD_LINK_FOCUS_MAX_AGE_MS,
): boolean {
  if (link.status === "discarded") {
    return false;
  }
  if (link.status === "unread" && typeof link.createdAt === "number" && now - link.createdAt >= maxUnreadAgeMs) {
    return false;
  }
  return true;
}

/** Whole days since the link was created, for age hints in LLM context. */
export function linkAgeDays(link: { createdAt?: number }, now: number = Date.now()): number | undefined {
  if (typeof link.createdAt !== "number") {
    return undefined;
  }
  return Math.max(0, Math.floor((now - link.createdAt) / DAY_MS));
}

export const RELATIONSHIP_TYPES = [
  "belongs_to",
  "supports",
  "related_to",
  "mentions",
  "assigned_to",
  "works_at",
  "client_of",
  "depends_on",
  "blocked_by",
  "waiting_on",
  "unblocks",
  "follow_up_with",
  "spawned_from",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const ACTOR_TYPES = ["user", "harness", "skippy_ai", "system"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const TRIAGE_STATUSES = ["pending", "approved", "rejected", "merged", "corrected"] as const;
export type TriageStatus = (typeof TRIAGE_STATUSES)[number];

export const REJECTED_BY = ["user", "ai", "system"] as const;
export type RejectedBy = (typeof REJECTED_BY)[number];

export const SOURCE_REF_RELATIONSHIPS = [
  "created_from",
  "updated_from",
  "mentioned_in",
  "evidence_for",
] as const;
export type SourceRefRelationship = (typeof SOURCE_REF_RELATIONSHIPS)[number];

export const KNOWN_SOURCE_SYSTEMS = [
  "gmail",
  "imessage",
  "calendar",
  "apple_reminders",
  "hermes",
  "claude",
  "chatgpt",
  "manual_conversation",
] as const;
export type KnownSourceSystem = (typeof KNOWN_SOURCE_SYSTEMS)[number];

export const PENDING_ACTION_STATUSES = [
  "drafted",
  "pending_approval",
  "approved",
  "rejected",
  "sent",
  "failed",
  "completed",
] as const;
export type PendingActionStatus = (typeof PENDING_ACTION_STATUSES)[number];

export const PENDING_ACTION_TYPES = [
  "send_email",
  "send_message",
  "complete_external_reminder",
] as const;
export type PendingActionType = (typeof PENDING_ACTION_TYPES)[number] | (string & {});

export const LLM_PROVIDER_MODES = ["none", "openai", "anthropic", "openrouter", "local"] as const;
export type LlmProviderMode = (typeof LLM_PROVIDER_MODES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type Timestamps = {
  createdAt: number;
  updatedAt: number;
};

export type ProcessingMetadata = {
  processingState: ProcessingState;
  rejectedAt?: number;
  rejectionReason?: string;
  rejectedBy?: RejectedBy;
  confidence?: number;
  reviewReason?: string;
};

export type PriorityMetadata = {
  priorityScore?: number;
  urgencyScore?: number;
  importanceScore?: number;
  priorityReason?: string;
  priorityComputedAt?: number;
  priorityPolicyVersion?: string;
};

export type SourceRefInput = {
  sourceSystem: KnownSourceSystem | (string & {});
  externalId?: string;
  threadId?: string;
  messageId?: string;
  eventId?: string;
  reminderId?: string;
  sourceTimestamp?: number;
  participants?: string[];
  url?: string;
  deepLink?: string;
  excerpt?: string;
  summary?: string;
};

export type SourceRef = SourceRefInput & Timestamps;

export type GoalInput = {
  title: string;
  description?: string;
  processingState?: ProcessingState;
  status?: GoalStatus;
};

export type ProjectInput = PriorityMetadata & {
  title: string;
  summary?: string;
  processingState?: ProcessingState;
  status?: ProjectStatus;
};

export type TaskInput = PriorityMetadata & {
  title: string;
  description?: string;
  processingState?: ProcessingState;
  status?: TaskStatus;
  ownerType?: TaskOwnerType;
  dueAt?: number;
  startedAt?: number;
  startedBy?: string;
  completedAt?: number;
};

export type NoteInput = {
  title?: string;
  body: string;
  processingState?: ProcessingState;
};

export type LinkInput = {
  url: string;
  normalizedUrl?: string;
  title?: string;
  summary?: string;
  whyItMatters?: string;
  processingState?: ProcessingState;
  status?: LinkStatus;
  enrichmentStatus?: "none" | "queued" | "completed" | "failed";
  enrichedAt?: number;
  enrichmentMethod?: string;
};

export type PersonInput = {
  name: string;
  emails?: string[];
  phoneNumbers?: string[];
  addresses?: string[];
  roleTitle?: string;
  relationshipContext?: string;
  notes?: string;
  processingState?: ProcessingState;
};

export type CompanyInput = {
  name: string;
  website?: string;
  domain?: string;
  notes?: string;
  relationshipLabel?: "client" | "vendor" | "employer" | "partner" | "prospect" | "other";
  processingState?: ProcessingState;
};

export type KnowledgeObjectInput = {
  objectType: string;
  title: string;
  summary?: string;
  properties?: JsonObject;
  processingState?: ProcessingState;
};

export type EntityInputMap = {
  goal: GoalInput;
  project: ProjectInput;
  task: TaskInput;
  note: NoteInput;
  person: PersonInput;
  company: CompanyInput;
  link: LinkInput;
  knowledgeObject: KnowledgeObjectInput;
};

export type CandidateObjectInput<T extends EntityType = EntityType> = {
  candidateEntityType: T;
  candidatePayload: EntityInputMap[T];
  confidence?: number;
  reviewReason?: string;
  sourceRefs?: SourceRefInput[];
  sourceRefIds?: string[];
  ingestionRunId?: string;
};

export type RelationshipInput = {
  from: EntityRef;
  to: EntityRef;
  type: RelationshipType;
  confidence?: number;
  reason?: string;
  createdBy: ActorType;
};

export type FocusSummary = {
  generatedAt: number;
  validUntil?: number;
  summaryText: string;
  topItems: Array<{
    entityRef: EntityRef;
    reason: string;
    priorityScore?: number;
    urgencyScore?: number;
    importanceScore?: number;
  }>;
  sourceRunId?: string;
  policyVersion?: string;
};

export type PendingActionInput = {
  actionType: PendingActionType;
  status?: PendingActionStatus;
  recipients?: JsonValue;
  subject?: string;
  body?: string;
  messageBody?: string;
  relatedEntities?: EntityRef[];
  sourceRefIds?: string[];
};

export function isOneOf<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function isEntityType(value: unknown): value is EntityType {
  return isOneOf(ENTITY_TYPES, value);
}

export function isProcessingState(value: unknown): value is ProcessingState {
  return isOneOf(PROCESSING_STATES, value);
}

export function isRelationshipType(value: unknown): value is RelationshipType {
  return isOneOf(RELATIONSHIP_TYPES, value);
}

export function makeEntityRef(entityType: EntityType, entityId: string): EntityRef {
  return {
    entityType,
    entityId: normalizeRequiredString(entityId, "entityId"),
  };
}

export function normalizeRequiredString(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new Error(`${fieldName} is required`);
  }

  return normalizedValue;
}

export function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();
  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

export function normalizeConfidence(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("confidence must be a number between 0 and 1");
  }

  return value;
}

export function normalizeProcessingState(value: ProcessingState | undefined): ProcessingState {
  return value ?? "suggested";
}

export function normalizeEntityInput<T extends EntityType>(
  entityType: T,
  payload: EntityInputMap[T],
): EntityInputMap[T] {
  switch (entityType) {
    case "goal":
    case "project":
    case "task":
    case "knowledgeObject": {
      const withTitle = payload as { title: string };
      return { ...payload, title: normalizeRequiredString(withTitle.title, "title") };
    }
    case "note": {
      const note = payload as NoteInput;
      return { ...note, body: normalizeRequiredString(note.body, "body") } as EntityInputMap[T];
    }
    case "person": {
      const person = payload as PersonInput;
      return { ...person, name: normalizeRequiredString(person.name, "name") } as EntityInputMap[T];
    }
    case "company": {
      const company = payload as CompanyInput;
      return { ...company, name: normalizeRequiredString(company.name, "name") } as EntityInputMap[T];
    }
    case "link": {
      const link = payload as LinkInput;
      return { ...link, url: normalizeRequiredString(link.url, "url") } as EntityInputMap[T];
    }
  }
}

export function normalizeCandidateObject<T extends EntityType>(
  input: CandidateObjectInput<T>,
): CandidateObjectInput<T> {
  const normalizedInput: CandidateObjectInput<T> = {
    ...input,
    candidatePayload: normalizeEntityInput(input.candidateEntityType, input.candidatePayload),
  };

  const confidence = normalizeConfidence(input.confidence);
  if (confidence !== undefined) {
    normalizedInput.confidence = confidence;
  } else {
    delete normalizedInput.confidence;
  }

  const reviewReason = normalizeOptionalString(input.reviewReason);
  if (reviewReason !== undefined) {
    normalizedInput.reviewReason = reviewReason;
  } else {
    delete normalizedInput.reviewReason;
  }

  return normalizedInput;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? normalizeOptionalString(value) : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const normalizedValues = value.map(stringValue).filter((item): item is string => item !== undefined);
    return normalizedValues.length > 0 ? normalizedValues : undefined;
  }

  const singleValue = stringValue(value);
  return singleValue ? [singleValue] : undefined;
}

function oneOfValue<const T extends readonly string[]>(values: T, value: unknown): T[number] | undefined {
  return isOneOf(values, value) ? value : undefined;
}

function timestampValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    const numericValue = numberValue(value);
    if (numericValue !== undefined) {
      return numericValue;
    }

    const textValue = stringValue(value);
    if (textValue) {
      const parsedValue = Date.parse(textValue);
      if (Number.isFinite(parsedValue)) {
        return parsedValue;
      }
    }
  }

  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalizedValue = stringValue(value);
    if (normalizedValue) {
      return normalizedValue;
    }
  }

  return undefined;
}

function withAdditionalContext(description: string | undefined, payload: Record<string, unknown>) {
  const context: Record<string, unknown> = {};
  const contextKeys = [
    "sourceSummary",
    "start",
    "end",
    "amountDue",
    "currency",
    "location",
    "attendees",
    "companyName",
    "personName",
  ];

  for (const key of contextKeys) {
    if (payload[key] !== undefined) {
      context[key] = payload[key];
    }
  }

  if (Object.keys(context).length === 0) {
    return description;
  }

  const contextText = `Source context: ${JSON.stringify(context)}`;
  return description ? `${description}\n\n${contextText}` : contextText;
}

function normalizedUrlValue(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url).toString();
  } catch {
    return undefined;
  }
}

function priorityFields(payload: Record<string, unknown>): PriorityMetadata {
  const fields: PriorityMetadata = {};
  const priorityScore = numberValue(payload.priorityScore);
  const urgencyScore = numberValue(payload.urgencyScore);
  const importanceScore = numberValue(payload.importanceScore);
  const priorityReason = stringValue(payload.priorityReason);
  const priorityComputedAt = numberValue(payload.priorityComputedAt);
  const priorityPolicyVersion = stringValue(payload.priorityPolicyVersion);

  if (priorityScore !== undefined) fields.priorityScore = priorityScore;
  if (urgencyScore !== undefined) fields.urgencyScore = urgencyScore;
  if (importanceScore !== undefined) fields.importanceScore = importanceScore;
  if (priorityReason !== undefined) fields.priorityReason = priorityReason;
  if (priorityComputedAt !== undefined) fields.priorityComputedAt = priorityComputedAt;
  if (priorityPolicyVersion !== undefined) fields.priorityPolicyVersion = priorityPolicyVersion;

  return fields;
}

function stripUndefinedValues<T extends Record<string, unknown>>(payload: T): T {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)) as T;
}

export function normalizeAcceptedEntityPayload<T extends EntityType>(
  entityType: T,
  rawPayload: unknown,
): EntityInputMap[T] {
  const payload = asRecord(rawPayload);

  switch (entityType) {
    case "goal":
      return stripUndefinedValues({
        title: normalizeRequiredString(firstString(payload.title, payload.name, payload.summary) ?? "", "title"),
        description: firstString(payload.description, payload.summary, payload.sourceSummary),
        status: oneOfValue(GOAL_STATUSES, payload.status) ?? "active",
      }) as EntityInputMap[T];
    case "project":
      return stripUndefinedValues({
        title: normalizeRequiredString(firstString(payload.title, payload.name, payload.summary) ?? "", "title"),
        summary: firstString(payload.summary, payload.description, payload.sourceSummary),
        status: oneOfValue(PROJECT_STATUSES, payload.status) ?? "idea",
        ...priorityFields(payload),
      }) as EntityInputMap[T];
    case "task": {
      const description = withAdditionalContext(
        firstString(payload.description, payload.summary, payload.sourceSummary),
        payload,
      );

      return stripUndefinedValues({
        title: normalizeRequiredString(firstString(payload.title, payload.name, payload.summary) ?? "", "title"),
        description,
        status: oneOfValue(TASK_STATUSES, payload.status) ?? "todo",
        ownerType:
          oneOfValue(TASK_OWNER_TYPES, payload.ownerType) ??
          oneOfValue(TASK_OWNER_TYPES, payload.taskOwner) ??
          oneOfValue(TASK_OWNER_TYPES, payload.assignedTo) ??
          oneOfValue(TASK_OWNER_TYPES, payload.assignee),
        dueAt: timestampValue(payload.dueAt, payload.dueDate, payload.due, payload.start),
        completedAt: timestampValue(payload.completedAt),
        ...priorityFields(payload),
      }) as EntityInputMap[T];
    }
    case "note":
      return stripUndefinedValues({
        title: firstString(payload.title),
        body: normalizeRequiredString(
          firstString(payload.body, payload.text, payload.summary, payload.sourceSummary, payload.title) ?? "",
          "body",
        ),
      }) as EntityInputMap[T];
    case "person":
      return stripUndefinedValues({
        name: normalizeRequiredString(firstString(payload.name, payload.personName, payload.title) ?? "", "name"),
        emails: stringArrayValue(payload.emails ?? payload.email),
        phoneNumbers: stringArrayValue(payload.phoneNumbers ?? payload.phone),
        addresses: stringArrayValue(payload.addresses ?? payload.address),
        roleTitle: firstString(payload.roleTitle, payload.title),
        relationshipContext: firstString(payload.relationshipContext, payload.relationshipLabel, payload.sourceSummary),
        notes: firstString(payload.notes, payload.summary),
      }) as EntityInputMap[T];
    case "company":
      return stripUndefinedValues({
        name: normalizeRequiredString(firstString(payload.name, payload.companyName, payload.title) ?? "", "name"),
        website: firstString(payload.website, payload.url),
        domain: firstString(payload.domain),
        notes: firstString(payload.notes, payload.summary, payload.sourceSummary),
        relationshipLabel: oneOfValue(["client", "vendor", "employer", "partner", "prospect", "other"] as const, payload.relationshipLabel),
      }) as EntityInputMap[T];
    case "link": {
      const url = normalizeRequiredString(firstString(payload.url, payload.deepLink) ?? "", "url");
      return stripUndefinedValues({
        url,
        normalizedUrl: firstString(payload.normalizedUrl) ?? normalizedUrlValue(url),
        title: firstString(payload.title),
        summary: firstString(payload.summary, payload.sourceSummary),
        whyItMatters: firstString(payload.whyItMatters, payload.priorityReason),
        // Links are reference material, not a reading queue: ingested links default to
        // "saved" (passive, no user interaction expected). "unread" is reserved for
        // explicit read-later intent passed through by the harness.
        status: oneOfValue(LINK_STATUSES, payload.status) ?? "saved",
        enrichmentStatus: oneOfValue(["none", "queued", "completed", "failed"] as const, payload.enrichmentStatus),
        enrichedAt: timestampValue(payload.enrichedAt),
        enrichmentMethod: firstString(payload.enrichmentMethod),
      }) as EntityInputMap[T];
    }
    case "knowledgeObject":
      return stripUndefinedValues({
        objectType: firstString(payload.objectType, payload.type) ?? "general",
        title: normalizeRequiredString(firstString(payload.title, payload.name, payload.summary) ?? "", "title"),
        summary: firstString(payload.summary, payload.description, payload.sourceSummary),
        properties: asRecord(payload.properties ?? payload),
      }) as EntityInputMap[T];
  }
}

function canonicalFingerprintValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.trim().toLocaleLowerCase();
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalFingerprintValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, childValue]) => childValue !== undefined)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, childValue]) => [key, canonicalFingerprintValue(childValue)]),
    );
  }

  return undefined;
}

function fingerprintHash(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function canonicalCandidatePayload<T extends EntityType>(
  entityType: T,
  rawPayload: unknown,
): EntityInputMap[T] {
  return normalizeAcceptedEntityPayload(entityType, rawPayload);
}

export function candidateFingerprint(entityType: EntityType, rawPayload: unknown): string {
  const canonicalPayload = canonicalCandidatePayload(entityType, rawPayload);
  const canonicalText = JSON.stringify(canonicalFingerprintValue(canonicalPayload));
  return `${entityType}:${fingerprintHash(canonicalText)}`;
}

/**
 * A focus-summary topItem candidate that a dismissed bullet may resolve to. `reason` is the
 * stored topItem reason and `entityTitle` is the referenced entity's title/name/url.
 */
export type DismissedFocusItemCandidate = {
  entityRef: EntityRef;
  reason?: string;
  entityTitle?: string;
};

const FOCUS_MATCH_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "at", "with", "from", "by",
  "is", "are", "was", "be", "been", "it", "its", "this", "that", "these", "those", "your",
  "you", "their", "his", "her", "has", "have", "had", "will", "should", "can", "not", "new",
]);

function focusMatchTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2 && !FOCUS_MATCH_STOPWORDS.has(token)),
  );
}

/**
 * Best-match a dismissed focus bullet against a summary's topItems using normalized
 * token overlap between the bullet text and each candidate's reason + entity title.
 * Returns undefined unless there is one clear winner: a sufficiently strong overlap that
 * also clearly beats the runner-up. Ambiguous or weak matches are skipped on purpose so a
 * dismissal never mutates the wrong entity.
 */
export function matchDismissedFocusItem<T extends DismissedFocusItemCandidate>(
  itemText: string,
  candidates: T[],
): T | undefined {
  const itemTokens = focusMatchTokens(itemText);
  if (itemTokens.size === 0) {
    return undefined;
  }

  const scored = candidates
    .map((candidate) => {
      const candidateTokens = focusMatchTokens(
        [candidate.reason, candidate.entityTitle].filter(Boolean).join(" "),
      );
      let overlap = 0;
      for (const token of itemTokens) {
        if (candidateTokens.has(token)) {
          overlap += 1;
        }
      }
      return { candidate, overlap, score: overlap / Math.min(itemTokens.size, 8) };
    })
    .sort((left, right) => right.score - left.score);

  const best = scored[0];
  if (!best || best.overlap < 2 || best.score < 0.4) {
    return undefined;
  }

  const runnerUp = scored[1];
  if (runnerUp && runnerUp.overlap >= 2 && runnerUp.score * 2 > best.score) {
    return undefined;
  }

  return best.candidate;
}
