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

/* ------------------------------------------------------------------ */
/* Finances: fixed taxonomy, month keys, report math, bulk ingestion   */
/* ------------------------------------------------------------------ */

/**
 * FIXED transaction taxonomy. Transaction types and their ONLY valid categories.
 * Every write path (Convex mutations, MCP tools) must enforce this pairing via
 * isValidTxTypeCategory / assertValidTxTypeCategory.
 */
export const TX_TYPES = ["Fixed", "Spending", "Food", "Income", "Transfer"] as const;
export type TxType = (typeof TX_TYPES)[number];

export const TX_TYPE_CATEGORIES = {
  Fixed: ["Mortgage, HOA, Mortgage Loan", "Recurring Bills"],
  Spending: ["Subscriptions", "Gas, Amazon, Home Depot, Etc", "Misc."],
  Food: ["Groceries", "Restaurants"],
  Income: ["Jeff", "Holly"],
  // Transfers between the owner's own accounts (tracked or untracked). Amounts
  // are positive magnitudes — direction IS the category. Visible in the grid
  // but excluded from outgoing/incoming/net and every budget total.
  Transfer: ["Transfers In", "Transfers Out"],
} as const;

export type TxCategory = (typeof TX_TYPE_CATEGORIES)[TxType][number];

/** All valid categories across every transaction type, in taxonomy order. */
export const TX_CATEGORIES = [
  "Mortgage, HOA, Mortgage Loan",
  "Recurring Bills",
  "Subscriptions",
  "Gas, Amazon, Home Depot, Etc",
  "Misc.",
  "Groceries",
  "Restaurants",
  "Jeff",
  "Holly",
  "Transfers In",
  "Transfers Out",
] as const satisfies readonly TxCategory[];

/** Transaction types that count toward money going out. Transfer is excluded. */
export const OUTGOING_TX_TYPES = ["Fixed", "Spending", "Food"] as const;
/** Transaction types that count toward money coming in. Transfer is excluded. */
export const INCOMING_TX_TYPES = ["Income"] as const;

/**
 * The transfer type and its categories are excluded from budget math entirely:
 * transfers move money between the owner's own accounts, so they are neither
 * income nor spending and never count toward budget totals or targets.
 */
export const TRANSFER_TX_TYPE = "Transfer" as const;
export const TRANSFER_IN_CATEGORY = "Transfers In" as const;
export const TRANSFER_OUT_CATEGORY = "Transfers Out" as const;

export const FINANCIAL_ACCOUNT_TYPES = ["Jeff Personal", "Family Shared"] as const;
export type FinancialAccountType = (typeof FINANCIAL_ACCOUNT_TYPES)[number];

export const TX_SOURCES = ["plaid", "manual", "harness"] as const;
export type TxSource = (typeof TX_SOURCES)[number];

export function isTxType(value: unknown): value is TxType {
  return isOneOf(TX_TYPES, value);
}

export function isTxCategory(value: unknown): value is TxCategory {
  return isOneOf(TX_CATEGORIES, value);
}

export function isFinancialAccountType(value: unknown): value is FinancialAccountType {
  return isOneOf(FINANCIAL_ACCOUNT_TYPES, value);
}

export function isTxSource(value: unknown): value is TxSource {
  return isOneOf(TX_SOURCES, value);
}

/** Whether `category` is a valid category for transaction type `type` under the fixed taxonomy. */
export function isValidTxTypeCategory(type: string, category: string): boolean {
  const categories = (TX_TYPE_CATEGORIES as Record<string, readonly string[] | undefined>)[type];
  return categories !== undefined && categories.includes(category);
}

/** Throws a clear error when the type/category pairing is invalid. */
export function assertValidTxTypeCategory(type: string, category: string): void {
  if (!isTxType(type)) {
    throw new Error(`invalid transaction type "${type}". Valid types: ${TX_TYPES.join(" | ")}`);
  }
  if (!isValidTxTypeCategory(type, category)) {
    throw new Error(
      `invalid category "${category}" for transaction type "${type}". Valid categories for ${type}: ${TX_TYPE_CATEGORIES[type].join(" | ")}`,
    );
  }
}

/**
 * All financial amounts are INTEGER CENTS to avoid float drift. Throws when the
 * value is not a finite integer.
 */
export function assertIntegerCents(value: number, fieldName: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer number of cents (no fractional or non-finite values)`);
  }
}

export const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidMonthKey(value: unknown): value is string {
  return typeof value === "string" && MONTH_KEY_PATTERN.test(value);
}

/** 'YYYY-MM' month key for an epoch-ms timestamp, computed in UTC. */
export function monthKeyFromDate(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The month key immediately before `monthKey` (e.g. '2026-01' -> '2025-12'). */
export function previousMonthKey(monthKey: string): string {
  if (!isValidMonthKey(monthKey)) {
    throw new Error(`invalid monthKey "${monthKey}". Expected 'YYYY-MM'.`);
  }
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

export type MonthTransactionInput = {
  txType: string;
  category: string;
  amountCents: number;
};

export type FinancialMonthAggregates = {
  transactionCount: number;
  categoryTotalsCents: Record<TxCategory, number>;
  typeTotalsCents: Record<TxType, number>;
  /** Sum of Fixed + Spending + Food amounts (integer cents). Transfers are excluded. */
  totalOutgoingCents: number;
  /** Sum of Income amounts (integer cents). Transfers are excluded. */
  totalIncomingCents: number;
  /** totalIncomingCents - totalOutgoingCents. Transfers are excluded. */
  netCents: number;
  /** Transfers In minus Transfers Out (integer cents, signed). Not part of netCents. */
  transferNetCents: number;
  /** Percent of total outgoing per category (0-100, one decimal). Income and Transfer categories are 0. */
  categoryPercentOfOutgoing: Record<TxCategory, number>;
  /** Percent of total outgoing per type (0-100, one decimal). Income and Transfer are 0. */
  typePercentOfOutgoing: Record<TxType, number>;
};

function zeroCategoryRecord(): Record<TxCategory, number> {
  return Object.fromEntries(TX_CATEGORIES.map((category) => [category, 0])) as Record<TxCategory, number>;
}

function zeroTypeRecord(): Record<TxType, number> {
  return Object.fromEntries(TX_TYPES.map((type) => [type, 0])) as Record<TxType, number>;
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Pure month aggregation used by monthlyReport: totals per category and type,
 * outgoing/incoming/net, and share of outgoing per category and type.
 * Transactions with invalid type/category pairs are rejected loudly.
 * Transfer rows appear in category/type totals (so the grid renders them) but
 * are excluded from outgoing/incoming/net and every percent-of-outgoing
 * numerator and denominator; their net movement is reported separately as
 * transferNetCents.
 */
export function aggregateMonthTransactions(transactions: MonthTransactionInput[]): FinancialMonthAggregates {
  const categoryTotalsCents = zeroCategoryRecord();
  const typeTotalsCents = zeroTypeRecord();

  for (const transaction of transactions) {
    assertValidTxTypeCategory(transaction.txType, transaction.category);
    assertIntegerCents(transaction.amountCents, "amountCents");
    const txType = transaction.txType as TxType;
    const category = transaction.category as TxCategory;
    categoryTotalsCents[category] += transaction.amountCents;
    typeTotalsCents[txType] += transaction.amountCents;
  }

  const totalOutgoingCents = OUTGOING_TX_TYPES.reduce((sum, type) => sum + typeTotalsCents[type], 0);
  const totalIncomingCents = INCOMING_TX_TYPES.reduce((sum, type) => sum + typeTotalsCents[type], 0);

  const categoryPercentOfOutgoing = zeroCategoryRecord();
  const typePercentOfOutgoing = zeroTypeRecord();
  if (totalOutgoingCents !== 0) {
    for (const type of OUTGOING_TX_TYPES) {
      typePercentOfOutgoing[type] = roundPercent((typeTotalsCents[type] / totalOutgoingCents) * 100);
      for (const category of TX_TYPE_CATEGORIES[type]) {
        categoryPercentOfOutgoing[category] = roundPercent(
          (categoryTotalsCents[category] / totalOutgoingCents) * 100,
        );
      }
    }
  }

  return {
    transactionCount: transactions.length,
    categoryTotalsCents,
    typeTotalsCents,
    totalOutgoingCents,
    totalIncomingCents,
    netCents: totalIncomingCents - totalOutgoingCents,
    transferNetCents: categoryTotalsCents[TRANSFER_IN_CATEGORY] - categoryTotalsCents[TRANSFER_OUT_CATEGORY],
    categoryPercentOfOutgoing,
    typePercentOfOutgoing,
  };
}

export type FinancialBudgetTargets = {
  monthKey?: string;
  /** category -> target integer cents. */
  categoryTargets?: Record<string, number>;
  /** transaction type -> target integer cents. */
  typeTargets?: Record<string, number>;
  targetOutgoingCents?: number;
  targetIncomingCents?: number;
  targetNetCents?: number;
};

export type BudgetTargetDelta = {
  targetCents: number;
  actualCents: number;
  /** actualCents - targetCents. Positive = over target. */
  deltaCents: number;
};

export type FinancialBudgetComparison = {
  categoryDeltas: Record<string, BudgetTargetDelta>;
  typeDeltas: Record<string, BudgetTargetDelta>;
  outgoing?: BudgetTargetDelta;
  incoming?: BudgetTargetDelta;
  net?: BudgetTargetDelta;
};

function targetDelta(targetCents: number, actualCents: number): BudgetTargetDelta {
  return { targetCents, actualCents, deltaCents: actualCents - targetCents };
}

/**
 * Per-target deltas between a budget and a month's actual aggregates.
 * Budgets never target transfers: any Transfer type/category targets are
 * silently ignored so transfers stay out of budget math end to end.
 */
export function compareBudgetToAggregates(
  budget: FinancialBudgetTargets,
  aggregates: FinancialMonthAggregates,
): FinancialBudgetComparison {
  const transferCategories: readonly string[] = TX_TYPE_CATEGORIES[TRANSFER_TX_TYPE];

  const categoryDeltas: Record<string, BudgetTargetDelta> = {};
  for (const [category, target] of Object.entries(budget.categoryTargets ?? {})) {
    if (transferCategories.includes(category)) continue;
    const actual = (aggregates.categoryTotalsCents as Record<string, number | undefined>)[category] ?? 0;
    categoryDeltas[category] = targetDelta(target, actual);
  }

  const typeDeltas: Record<string, BudgetTargetDelta> = {};
  for (const [type, target] of Object.entries(budget.typeTargets ?? {})) {
    if (type === TRANSFER_TX_TYPE) continue;
    const actual = (aggregates.typeTotalsCents as Record<string, number | undefined>)[type] ?? 0;
    typeDeltas[type] = targetDelta(target, actual);
  }

  const comparison: FinancialBudgetComparison = { categoryDeltas, typeDeltas };
  if (budget.targetOutgoingCents !== undefined) {
    comparison.outgoing = targetDelta(budget.targetOutgoingCents, aggregates.totalOutgoingCents);
  }
  if (budget.targetIncomingCents !== undefined) {
    comparison.incoming = targetDelta(budget.targetIncomingCents, aggregates.totalIncomingCents);
  }
  if (budget.targetNetCents !== undefined) {
    comparison.net = targetDelta(budget.targetNetCents, aggregates.netCents);
  }
  return comparison;
}

export type MonthlyFinancialReportInput = {
  monthKey: string;
  transactions: MonthTransactionInput[];
  previousTransactions?: MonthTransactionInput[];
  /** The applicable budget: month-specific if present, else the default/recurring budget. */
  budget?: FinancialBudgetTargets;
  /** True when `budget` is the default/recurring budget rather than a month-specific one. */
  budgetIsDefault?: boolean;
};

export type MonthlyFinancialReport = {
  monthKey: string;
  previousMonthKey: string;
  current: FinancialMonthAggregates;
  previous: FinancialMonthAggregates;
  /** current - previous, for delta display. */
  monthOverMonth: {
    totalOutgoingCents: number;
    totalIncomingCents: number;
    netCents: number;
    /** Change in Transfers In minus Transfers Out (signed integer cents). */
    transferNetCents: number;
    categoryTotalsCents: Record<TxCategory, number>;
    typeTotalsCents: Record<TxType, number>;
  };
  budget: (FinancialBudgetTargets & { isDefault: boolean; comparison: FinancialBudgetComparison }) | null;
};

/**
 * Pure monthly report computation (computed at read time; nothing is stored).
 * Given this month's and the previous month's transactions plus the applicable
 * budget, returns totals, percentages, previous-month deltas, and budget deltas.
 */
export function computeMonthlyFinancialReport(input: MonthlyFinancialReportInput): MonthlyFinancialReport {
  const current = aggregateMonthTransactions(input.transactions);
  const previous = aggregateMonthTransactions(input.previousTransactions ?? []);

  const categoryTotalsCents = zeroCategoryRecord();
  for (const category of TX_CATEGORIES) {
    categoryTotalsCents[category] = current.categoryTotalsCents[category] - previous.categoryTotalsCents[category];
  }
  const typeTotalsCents = zeroTypeRecord();
  for (const type of TX_TYPES) {
    typeTotalsCents[type] = current.typeTotalsCents[type] - previous.typeTotalsCents[type];
  }

  return {
    monthKey: input.monthKey,
    previousMonthKey: previousMonthKey(input.monthKey),
    current,
    previous,
    monthOverMonth: {
      totalOutgoingCents: current.totalOutgoingCents - previous.totalOutgoingCents,
      totalIncomingCents: current.totalIncomingCents - previous.totalIncomingCents,
      netCents: current.netCents - previous.netCents,
      transferNetCents: current.transferNetCents - previous.transferNetCents,
      categoryTotalsCents,
      typeTotalsCents,
    },
    budget: input.budget
      ? {
          ...input.budget,
          isDefault: input.budgetIsDefault ?? false,
          comparison: compareBudgetToAggregates(input.budget, current),
        }
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* Finances: daily end-of-day balance snapshots                        */
/* ------------------------------------------------------------------ */

/**
 * Where a daily balance snapshot came from. Balances are NEVER derived from
 * financialTransactions (recorded transactions may not cover every raw feed
 * row, so running sums drift): the harness computes end-of-day balances
 * externally from the full raw Plaid feed anchored to the live current balance.
 */
export const BALANCE_SOURCES = ["plaid_derived", "manual"] as const;
export type BalanceSource = (typeof BALANCE_SOURCES)[number];

export function isBalanceSource(value: unknown): value is BalanceSource {
  return isOneOf(BALANCE_SOURCES, value);
}

/** Epoch ms of UTC midnight for the day containing `epochMs`. */
export function dayStartUtc(epochMs: number): number {
  const date = new Date(epochMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export type DailyBalanceInput = {
  /** Snapshot day: epoch ms at UTC midnight. */
  date: number;
  /** End-of-day balance in integer cents; may be negative. */
  endOfDayBalanceCents: number;
};

export type MonthBalanceSummary = {
  /** The month's snapshots sorted ascending by date. */
  balances: DailyBalanceInput[];
  /**
   * The balance entering the month: latest end-of-day balance from the
   * previous month's rows, or null when the previous month has none.
   */
  startingBalanceCents: number | null;
  /** Latest end-of-day balance within the month, or null when the month has none. */
  endingBalanceCents: number | null;
};

function latestBalance(rows: readonly DailyBalanceInput[]): DailyBalanceInput | null {
  let latest: DailyBalanceInput | null = null;
  for (const row of rows) {
    if (!latest || row.date > latest.date) latest = row;
  }
  return latest;
}

/**
 * Pure selection of a month's balance summary from stored daily snapshots:
 * the month's rows sorted ascending, the starting balance (entering the month,
 * from the previous month's latest snapshot), and the ending balance (the
 * month's latest snapshot). Missing data yields nulls, never fabricated sums.
 */
export function summarizeMonthBalances(
  monthRows: readonly DailyBalanceInput[],
  previousMonthRows: readonly DailyBalanceInput[] = [],
): MonthBalanceSummary {
  const balances = monthRows
    .map((row) => ({ date: row.date, endOfDayBalanceCents: row.endOfDayBalanceCents }))
    .sort((a, b) => a.date - b.date);
  return {
    balances,
    startingBalanceCents: latestBalance(previousMonthRows)?.endOfDayBalanceCents ?? null,
    endingBalanceCents: latestBalance(monthRows)?.endOfDayBalanceCents ?? null,
  };
}

export type BulkTransactionWritePlan<T> = {
  /** Rows with no externalId, or an externalId not seen before. */
  inserts: T[];
  /** Rows whose externalId already exists in storage: update in place, never duplicate. */
  updates: Array<{ externalId: string; row: T }>;
  /** Rows repeating an externalId already handled earlier in the same batch. */
  skipped: number;
};

/**
 * Pure idempotency planning for bulk transaction ingestion. Rows carrying an
 * externalId (Plaid transaction_id) that already exists become updates instead of
 * duplicates; repeats of the same externalId within one batch are skipped.
 */
export function planBulkTransactionWrites<T extends { externalId?: string | undefined }>(
  rows: T[],
  existingExternalIds: ReadonlySet<string>,
): BulkTransactionWritePlan<T> {
  const inserts: T[] = [];
  const updates: Array<{ externalId: string; row: T }> = [];
  const seenInBatch = new Set<string>();
  let skipped = 0;

  for (const row of rows) {
    const externalId = row.externalId?.trim();
    if (!externalId) {
      inserts.push(row);
      continue;
    }
    if (seenInBatch.has(externalId)) {
      skipped += 1;
      continue;
    }
    seenInBatch.add(externalId);
    if (existingExternalIds.has(externalId)) {
      updates.push({ externalId, row });
    } else {
      inserts.push(row);
    }
  }

  return { inserts, updates, skipped };
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
