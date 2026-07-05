/* ------------------------------------------------------------------ */
/* Project folder paths (assets/output)                                */
/* ------------------------------------------------------------------ */

/**
 * Format-only check that a value looks like an absolute path: '/', '~', or a
 * Windows drive letter ("C:\" / "C:/"). The app (browser PWA + cloud Convex)
 * cannot see the user's disk, so existence checks and `mkdir -p` on first
 * write are the harness's job, never the app's.
 */
export function isValidFolderPathFormat(path: string): boolean {
  return /^(?:\/|~|[A-Za-z]:[\\/])/.test(path);
}

/**
 * Normalize a user-entered folder path for storage: trim, strip trailing
 * slashes, and treat empty input as "clear the override" (undefined).
 * Throws when a non-empty value does not look like an absolute path.
 */
export function normalizeFolderPathInput(value: string, label = "folder path"): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!isValidFolderPathFormat(trimmed)) {
    throw new Error(`${label} must be an absolute path starting with '/', '~', or a drive letter like 'C:\\'`);
  }
  const stripped = trimmed.replace(/[\\/]+$/, "");
  return stripped || trimmed;
}

export type ProjectFolderPathFields = {
  localPath?: string;
  assetsFolderPath?: string;
  outputFolderPath?: string;
};

export type EffectiveProjectPaths = {
  effectiveAssetsPath: string | undefined;
  effectiveOutputPath: string | undefined;
};

/**
 * Lazy read-time derivation of a project's assets (inputs) and output
 * (artifacts) folders. An unset override IS the derived state — defaults
 * automatically track localPath edits, so there is no backfill/migration.
 */
export function effectiveProjectPaths(project: ProjectFolderPathFields): EffectiveProjectPaths {
  return {
    effectiveAssetsPath:
      project.assetsFolderPath ?? (project.localPath ? `${project.localPath}/_library` : undefined),
    effectiveOutputPath:
      project.outputFolderPath ?? (project.localPath ? `${project.localPath}/_output` : undefined),
  };
}

/* ------------------------------------------------------------------ */
/* Project library files (Convex file storage)                         */
/* ------------------------------------------------------------------ */

/** Maximum size for a single project library file: 25 MiB. */
export const PROJECT_FILE_MAX_BYTES = 25 * 1024 * 1024;

/**
 * MIME types allowed into the project library. Patterns ending in "/*" allow
 * a whole top-level type; everything else is an exact match. Executables and
 * arbitrary binaries (application/octet-stream, application/x-msdownload,
 * archives of unknown content, etc.) are deliberately NOT on this list.
 */
export const PROJECT_FILE_ALLOWED_MIME_PATTERNS = [
  // Images (png, jpeg, gif, webp, svg, ...).
  "image/*",
  // Documents.
  "application/pdf",
  // Text (text/plain, text/markdown, text/csv, text/html, ...).
  "text/*",
  // Structured data.
  "application/json",
  "application/csv",
  // Common office documents.
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
] as const;

export function isAllowedProjectFileMimeType(mimeType: string): boolean {
  const normalized = mimeType.trim().toLowerCase().split(";")[0]!.trim();
  if (!normalized) return false;
  return PROJECT_FILE_ALLOWED_MIME_PATTERNS.some((pattern) => {
    if (pattern.endsWith("/*")) {
      return normalized.startsWith(pattern.slice(0, -1));
    }
    return normalized === pattern;
  });
}

export type ProjectFileInput = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

/**
 * Validate a project library file before registering it. Throws with a clear
 * message when the file name is empty, the size exceeds PROJECT_FILE_MAX_BYTES,
 * or the MIME type is not on the allowlist (executables/unknown binaries are
 * rejected). Returns the normalized fileName and mimeType on success.
 */
export function validateProjectFileInput(input: ProjectFileInput): {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
} {
  const fileName = input.fileName.trim();
  if (!fileName) {
    throw new Error("fileName cannot be empty");
  }

  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes < 0) {
    throw new Error("sizeBytes must be a non-negative number");
  }
  if (input.sizeBytes > PROJECT_FILE_MAX_BYTES) {
    throw new Error(
      `file is too large: ${input.sizeBytes} bytes exceeds the ${PROJECT_FILE_MAX_BYTES} byte (25 MB) project library cap`,
    );
  }

  const mimeType = input.mimeType.trim().toLowerCase().split(";")[0]!.trim();
  if (!mimeType) {
    throw new Error("mimeType cannot be empty");
  }
  if (!isAllowedProjectFileMimeType(mimeType)) {
    throw new Error(
      `mimeType '${mimeType}' is not allowed in the project library. Executables and arbitrary binaries are rejected; allowed types: images, PDFs, text (plain/markdown/csv), JSON, and common office documents.`,
    );
  }

  return { fileName, mimeType, sizeBytes: input.sizeBytes };
}

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
 * FIXED transaction taxonomy — Conscious Spending Plan (CSP) buckets.
 * Transaction types and their ONLY valid categories. Every write path
 * (Convex mutations, MCP tools) must enforce this pairing via
 * isValidTxTypeCategory / assertValidTxTypeCategory.
 */
export const TX_TYPES = ["Fixed Costs", "Investments", "Savings", "Guilt-Free", "Income", "Transfer"] as const;
export type TxType = (typeof TX_TYPES)[number];

export const TX_TYPE_CATEGORIES = {
  "Fixed Costs": [
    "Mortgage, HOA, Mortgage Loan",
    "Recurring Bills",
    "Debt Payments",
    "Groceries",
    "Subscriptions",
  ],
  Investments: ["Retirement", "Brokerage"],
  Savings: ["Emergency Fund", "Goals"],
  "Guilt-Free": ["Restaurants", "Gas, Amazon, Home Depot, Etc", "Misc."],
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
  "Debt Payments",
  "Groceries",
  "Subscriptions",
  "Retirement",
  "Brokerage",
  "Emergency Fund",
  "Goals",
  "Restaurants",
  "Gas, Amazon, Home Depot, Etc",
  "Misc.",
  "Jeff",
  "Holly",
  "Transfers In",
  "Transfers Out",
] as const satisfies readonly TxCategory[];

/** Transaction types that count toward money going out. Transfer is excluded. */
export const OUTGOING_TX_TYPES = ["Fixed Costs", "Investments", "Savings", "Guilt-Free"] as const;
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

/**
 * Who funded an OFF-LEDGER contribution (e.g. a payroll-deducted 401k).
 * The two sources have ASYMMETRIC percent-of-income semantics:
 * - 'employee': pre-tax pay the owner earned but never saw in checking. It
 *   grosses up the percent-of-income denominator (incomeDenominatorCents).
 * - 'employer': match money that was never the owner's income. It counts in
 *   Investments totals but NEVER grosses up the denominator.
 */
export const CONTRIBUTION_SOURCES = ["employee", "employer"] as const;
export type ContributionSource = (typeof CONTRIBUTION_SOURCES)[number];

export function isContributionSource(value: unknown): value is ContributionSource {
  return isOneOf(CONTRIBUTION_SOURCES, value);
}

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
 * OFF-LEDGER rows record money that never touched the account (pre-tax payroll
 * deductions such as 401k contributions). They are restricted to txType
 * 'Investments' — the only bucket with defined off-ledger semantics — and must
 * carry a contributionSource ('employee' | 'employer'). contributionSource is
 * meaningless (and rejected) on on-ledger rows. Enforced on every write path
 * and again in aggregation.
 */
export function assertValidOffLedgerFields(input: {
  txType: string;
  offLedger?: boolean | undefined;
  contributionSource?: string | undefined;
}): void {
  if (input.offLedger) {
    if (input.txType !== "Investments") {
      throw new Error(`off-ledger rows must be txType "Investments" (got "${input.txType}")`);
    }
    if (!isContributionSource(input.contributionSource)) {
      throw new Error(
        `off-ledger rows require contributionSource ${CONTRIBUTION_SOURCES.map((s) => `"${s}"`).join(" or ")} (got ${JSON.stringify(input.contributionSource)})`,
      );
    }
  } else if (input.contributionSource !== undefined) {
    throw new Error("contributionSource is only valid on off-ledger rows (set offLedger: true)");
  }
}

/* ------------------------------------------------------------------ */
/* Finances: legacy (pre-CSP) taxonomy migration                       */
/* ------------------------------------------------------------------ */

/** The pre-CSP transaction types (Fixed/Spending/Food era). */
export const LEGACY_TX_TYPES = ["Fixed", "Spending", "Food", "Income", "Transfer"] as const;
export type LegacyTxType = (typeof LEGACY_TX_TYPES)[number];

export const LEGACY_TX_TYPE_CATEGORIES: Record<LegacyTxType, readonly string[]> = {
  Fixed: ["Mortgage, HOA, Mortgage Loan", "Recurring Bills"],
  Spending: ["Subscriptions", "Gas, Amazon, Home Depot, Etc", "Misc."],
  Food: ["Groceries", "Restaurants"],
  Income: ["Jeff", "Holly"],
  Transfer: ["Transfers In", "Transfers Out"],
};

/**
 * Legacy 'Recurring Bills' rows whose description matches this pattern are
 * credit-card / loan payments: they migrate to Fixed Costs / 'Debt Payments'
 * instead of Fixed Costs / 'Recurring Bills'.
 */
export const DEBT_PAYMENT_DESCRIPTION_PATTERN =
  /CHASE CREDIT CRD|DISCOVER|CAPITAL ONE|APPLE ?CARD|APPLECARD|LIBERTY BANK|FIDELITY/i;

/**
 * Complete legacy -> CSP mapping: every pre-CSP (type, category) pair and the
 * CSP pair it becomes. Income and Transfer pairs are identity mappings (they
 * are unchanged under CSP). The one description-driven exception — legacy
 * Fixed / 'Recurring Bills' rows matching DEBT_PAYMENT_DESCRIPTION_PATTERN
 * become Fixed Costs / 'Debt Payments' — is applied by
 * migrateLegacyTransaction, not encoded here.
 */
export const LEGACY_CSP_MAPPING: Record<
  LegacyTxType,
  Record<string, { txType: TxType; category: TxCategory }>
> = {
  Fixed: {
    "Mortgage, HOA, Mortgage Loan": { txType: "Fixed Costs", category: "Mortgage, HOA, Mortgage Loan" },
    "Recurring Bills": { txType: "Fixed Costs", category: "Recurring Bills" },
  },
  Spending: {
    Subscriptions: { txType: "Fixed Costs", category: "Subscriptions" },
    "Gas, Amazon, Home Depot, Etc": { txType: "Guilt-Free", category: "Gas, Amazon, Home Depot, Etc" },
    "Misc.": { txType: "Guilt-Free", category: "Misc." },
  },
  Food: {
    Groceries: { txType: "Fixed Costs", category: "Groceries" },
    Restaurants: { txType: "Guilt-Free", category: "Restaurants" },
  },
  Income: {
    Jeff: { txType: "Income", category: "Jeff" },
    Holly: { txType: "Income", category: "Holly" },
  },
  Transfer: {
    "Transfers In": { txType: "Transfer", category: "Transfers In" },
    "Transfers Out": { txType: "Transfer", category: "Transfers Out" },
  },
};

/**
 * Legacy budget TYPE keys -> CSP type keys (typeTargets / typePercentTargets).
 * 'Food' has NO direct successor — its transactions split across Fixed Costs
 * (Groceries) and Guilt-Free (Restaurants) — so Food targets are DROPPED
 * (null), never silently folded into another bucket. Category budget keys are
 * unchanged: every legacy category name survives verbatim under CSP.
 */
export const LEGACY_CSP_BUDGET_TYPE_MAPPING: Record<LegacyTxType, TxType | null> = {
  Fixed: "Fixed Costs",
  Spending: "Guilt-Free",
  Food: null,
  Income: "Income",
  Transfer: "Transfer",
};

/**
 * Pure migration of one transaction's (txType, category) pair from the legacy
 * taxonomy to CSP. Returns the new pair, or null when the input is already a
 * valid CSP pair (idempotent: re-running the migration is a no-op). Applies
 * the debt-payment description override for legacy Fixed / 'Recurring Bills'.
 * Throws loudly on pairs that belong to neither vocabulary.
 */
export function migrateLegacyTransaction(input: {
  txType: string;
  category: string;
  description: string;
}): { txType: TxType; category: TxCategory } | null {
  // Already CSP (includes unchanged Income/* and Transfer/* pairs): no-op.
  if (isValidTxTypeCategory(input.txType, input.category)) return null;

  const byCategory = (LEGACY_CSP_MAPPING as Record<string, Record<string, { txType: TxType; category: TxCategory }> | undefined>)[
    input.txType
  ];
  const mapped = byCategory?.[input.category];
  if (!mapped) {
    throw new Error(
      `no CSP migration mapping for legacy pair "${input.txType}" / "${input.category}"`,
    );
  }
  if (
    input.txType === "Fixed" &&
    input.category === "Recurring Bills" &&
    DEBT_PAYMENT_DESCRIPTION_PATTERN.test(input.description)
  ) {
    return { txType: "Fixed Costs", category: "Debt Payments" };
  }
  return mapped;
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
  /**
   * OFF-LEDGER contribution (e.g. payroll-deducted 401k): the money never
   * entered the account. Must be txType 'Investments' with a contributionSource.
   */
  offLedger?: boolean;
  contributionSource?: ContributionSource;
};

/** Off-ledger Investments contribution totals for a month, split by who funded them. */
export type OffLedgerInvestments = {
  employeeCents: number;
  employerCents: number;
  totalCents: number;
};

export type FinancialMonthAggregates = {
  transactionCount: number;
  /** Includes off-ledger contribution amounts so grids/matrices show them. */
  categoryTotalsCents: Record<TxCategory, number>;
  /** Includes off-ledger contribution amounts so grids/matrices show them. */
  typeTotalsCents: Record<TxType, number>;
  /**
   * Sum of ON-LEDGER Fixed Costs + Investments + Savings + Guilt-Free amounts
   * (integer cents). Transfers and off-ledger contributions are excluded: an
   * off-ledger 401k deduction never left checking, so counting it here (without
   * also counting it as income) would corrupt netCents.
   */
  totalOutgoingCents: number;
  /** Sum of Income amounts (integer cents). Transfers are excluded. NOT grossed up by off-ledger rows. */
  totalIncomingCents: number;
  /** totalIncomingCents - totalOutgoingCents. Transfers and off-ledger rows are excluded. */
  netCents: number;
  /** Transfers In minus Transfers Out (integer cents, signed). Not part of netCents. */
  transferNetCents: number;
  /**
   * Off-ledger Investments contributions (e.g. payroll-deducted 401k). Present
   * in typeTotalsCents/categoryTotalsCents but excluded from outgoing/net and
   * every percent-of-outgoing number.
   */
  offLedgerInvestmentsCents: OffLedgerInvestments;
  /**
   * The denominator for percent-of-income (CSP) targets:
   * totalIncomingCents + EMPLOYEE off-ledger contributions. Employee 401k
   * deductions are pre-tax pay the owner earned but never saw in checking, so
   * they gross up the income base; the EMPLOYER match was never the owner's
   * income and does NOT.
   */
  incomeDenominatorCents: number;
  /** Percent of total ON-LEDGER outgoing per category (0-100, one decimal). Income, Transfer, and off-ledger amounts are 0/excluded. */
  categoryPercentOfOutgoing: Record<TxCategory, number>;
  /** Percent of total ON-LEDGER outgoing per type (0-100, one decimal). Income and Transfer are 0; off-ledger amounts are excluded. */
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
 *
 * OFF-LEDGER Investments rows (payroll-deducted 401k contributions) also
 * appear in category/type totals but are excluded from outgoing/incoming/net
 * and every percent-of-outgoing number (the money never entered checking).
 * They are reported separately in offLedgerInvestmentsCents, and EMPLOYEE
 * amounts gross up incomeDenominatorCents — the base for percent-of-income
 * (CSP) targets — while EMPLOYER match amounts do not.
 */
export function aggregateMonthTransactions(transactions: MonthTransactionInput[]): FinancialMonthAggregates {
  const categoryTotalsCents = zeroCategoryRecord();
  const typeTotalsCents = zeroTypeRecord();
  // On-ledger-only totals back the outgoing sum and percent-of-outgoing math.
  const onLedgerCategoryTotalsCents = zeroCategoryRecord();
  const onLedgerTypeTotalsCents = zeroTypeRecord();
  let offLedgerEmployeeCents = 0;
  let offLedgerEmployerCents = 0;

  for (const transaction of transactions) {
    assertValidTxTypeCategory(transaction.txType, transaction.category);
    assertIntegerCents(transaction.amountCents, "amountCents");
    assertValidOffLedgerFields(transaction);
    const txType = transaction.txType as TxType;
    const category = transaction.category as TxCategory;
    categoryTotalsCents[category] += transaction.amountCents;
    typeTotalsCents[txType] += transaction.amountCents;
    if (transaction.offLedger) {
      if (transaction.contributionSource === "employee") {
        offLedgerEmployeeCents += transaction.amountCents;
      } else {
        offLedgerEmployerCents += transaction.amountCents;
      }
    } else {
      onLedgerCategoryTotalsCents[category] += transaction.amountCents;
      onLedgerTypeTotalsCents[txType] += transaction.amountCents;
    }
  }

  const totalOutgoingCents = OUTGOING_TX_TYPES.reduce((sum, type) => sum + onLedgerTypeTotalsCents[type], 0);
  const totalIncomingCents = INCOMING_TX_TYPES.reduce((sum, type) => sum + typeTotalsCents[type], 0);

  const categoryPercentOfOutgoing = zeroCategoryRecord();
  const typePercentOfOutgoing = zeroTypeRecord();
  if (totalOutgoingCents !== 0) {
    for (const type of OUTGOING_TX_TYPES) {
      typePercentOfOutgoing[type] = roundPercent((onLedgerTypeTotalsCents[type] / totalOutgoingCents) * 100);
      for (const category of TX_TYPE_CATEGORIES[type]) {
        categoryPercentOfOutgoing[category] = roundPercent(
          (onLedgerCategoryTotalsCents[category] / totalOutgoingCents) * 100,
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
    offLedgerInvestmentsCents: {
      employeeCents: offLedgerEmployeeCents,
      employerCents: offLedgerEmployerCents,
      totalCents: offLedgerEmployeeCents + offLedgerEmployerCents,
    },
    incomeDenominatorCents: totalIncomingCents + offLedgerEmployeeCents,
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
  /**
   * category -> target as a percent of the month's ACTUAL income denominator
   * (incomeDenominatorCents: totalIncomingCents plus employee off-ledger 401k
   * contributions; plain number, 50 = 50%). Resolved to cents at read time, so
   * the same percent plan adapts to variable month-to-month income (Conscious
   * Spending Plan style). When both a cents and a percent target exist for the
   * same key, THE PERCENT TARGET WINS.
   */
  categoryPercentTargets?: Record<string, number>;
  /** transaction type -> percent of actual income. Same rules as categoryPercentTargets. */
  typePercentTargets?: Record<string, number>;
  targetOutgoingCents?: number;
  targetIncomingCents?: number;
  targetNetCents?: number;
  /** Net target as a percent of actual income. Wins over targetNetCents when both are set. */
  targetNetPercent?: number;
};

export type BudgetTargetDelta = {
  targetCents: number;
  actualCents: number;
  /** actualCents - targetCents. Positive = over target. */
  deltaCents: number;
  /**
   * Present when targetCents was derived from a percent-of-income target:
   * the source percent (50 = 50%), so UIs can label 'target (50% of income)'.
   */
  targetPercent?: number;
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

/** Percent of income (50 = 50%) -> integer cents against the month's actual income. */
export function percentOfIncomeCents(percent: number, totalIncomingCents: number): number {
  return Math.round((totalIncomingCents * percent) / 100);
}

/**
 * Per-target deltas between a budget and a month's actual aggregates.
 * Budgets never target transfers: any Transfer type/category targets are
 * silently ignored so transfers stay out of budget math end to end.
 *
 * Percent-of-income targets (categoryPercentTargets / typePercentTargets /
 * targetNetPercent) resolve against the aggregates' ACTUAL
 * incomeDenominatorCents (totalIncomingCents grossed up by EMPLOYEE off-ledger
 * 401k contributions — pre-tax pay is part of the CSP income base) at read
 * time:
 * - PRECEDENCE: when a key has both a cents target and a percent target, the
 *   PERCENT TARGET WINS (the cents target is ignored, it does not resurface).
 * - Percent-derived deltas carry `targetPercent` so UIs can label the source.
 * - Months with zero (or negative) income cannot resolve a percent target:
 *   those keys produce NO comparison row at all (absent, not a zero target).
 */
export function compareBudgetToAggregates(
  budget: FinancialBudgetTargets,
  aggregates: FinancialMonthAggregates,
): FinancialBudgetComparison {
  const transferCategories: readonly string[] = TX_TYPE_CATEGORIES[TRANSFER_TX_TYPE];
  const incomeCents = aggregates.incomeDenominatorCents;
  const percentResolvable = incomeCents > 0;
  const percentDelta = (percent: number, actualCents: number): BudgetTargetDelta => ({
    ...targetDelta(percentOfIncomeCents(percent, incomeCents), actualCents),
    targetPercent: percent,
  });

  const categoryDeltas: Record<string, BudgetTargetDelta> = {};
  const categoryKeys = new Set([
    ...Object.keys(budget.categoryTargets ?? {}),
    ...Object.keys(budget.categoryPercentTargets ?? {}),
  ]);
  for (const category of categoryKeys) {
    if (transferCategories.includes(category)) continue;
    const actual = (aggregates.categoryTotalsCents as Record<string, number | undefined>)[category] ?? 0;
    const percent = budget.categoryPercentTargets?.[category];
    if (percent !== undefined) {
      // Percent wins over a coexisting cents target for the same category.
      if (percentResolvable) categoryDeltas[category] = percentDelta(percent, actual);
      continue;
    }
    categoryDeltas[category] = targetDelta(budget.categoryTargets![category]!, actual);
  }

  const typeDeltas: Record<string, BudgetTargetDelta> = {};
  const typeKeys = new Set([
    ...Object.keys(budget.typeTargets ?? {}),
    ...Object.keys(budget.typePercentTargets ?? {}),
  ]);
  for (const type of typeKeys) {
    if (type === TRANSFER_TX_TYPE) continue;
    const actual = (aggregates.typeTotalsCents as Record<string, number | undefined>)[type] ?? 0;
    const percent = budget.typePercentTargets?.[type];
    if (percent !== undefined) {
      // Percent wins over a coexisting cents target for the same type.
      if (percentResolvable) typeDeltas[type] = percentDelta(percent, actual);
      continue;
    }
    typeDeltas[type] = targetDelta(budget.typeTargets![type]!, actual);
  }

  const comparison: FinancialBudgetComparison = { categoryDeltas, typeDeltas };
  if (budget.targetOutgoingCents !== undefined) {
    comparison.outgoing = targetDelta(budget.targetOutgoingCents, aggregates.totalOutgoingCents);
  }
  if (budget.targetIncomingCents !== undefined) {
    comparison.incoming = targetDelta(budget.targetIncomingCents, aggregates.totalIncomingCents);
  }
  if (budget.targetNetPercent !== undefined) {
    // Percent wins over targetNetCents; unresolvable (no income) -> no net row.
    if (percentResolvable) comparison.net = percentDelta(budget.targetNetPercent, aggregates.netCents);
  } else if (budget.targetNetCents !== undefined) {
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

/* ------------------------------------------------------------------ */
/* Finances: recurring off-ledger contributions (401k materialization) */
/* ------------------------------------------------------------------ */

/**
 * A recurring off-ledger contribution configured on a financial account
 * (e.g. the monthly payroll-deducted 401k employee contribution and employer
 * match). Materialized into off-ledger Investments transactions once per
 * month by materializeContributionsForBrain.
 */
export type RecurringContribution = {
  label: string;
  /** Positive integer cents. */
  amountCents: number;
  contributionSource: ContributionSource;
  /** Must be an Investments category ('Retirement' | 'Brokerage'). */
  category: string;
};

/**
 * Validates a recurringContributions config. At most ONE contribution per
 * source is supported: materialized externalIds are keyed on (source, month),
 * so a second contribution with the same source could never be idempotent.
 */
export function assertValidRecurringContributions(contributions: readonly RecurringContribution[]): void {
  const seenSources = new Set<string>();
  contributions.forEach((contribution, index) => {
    const field = `recurringContributions[${index}]`;
    if (!contribution.label.trim()) {
      throw new Error(`${field}.label is required`);
    }
    assertIntegerCents(contribution.amountCents, `${field}.amountCents`);
    if (contribution.amountCents <= 0) {
      throw new Error(`${field}.amountCents must be positive`);
    }
    if (!isContributionSource(contribution.contributionSource)) {
      throw new Error(
        `${field}.contributionSource must be ${CONTRIBUTION_SOURCES.map((s) => `"${s}"`).join(" or ")}`,
      );
    }
    if (!isValidTxTypeCategory("Investments", contribution.category)) {
      throw new Error(
        `${field}.category must be an Investments category (${TX_TYPE_CATEGORIES.Investments.join(" | ")})`,
      );
    }
    if (seenSources.has(contribution.contributionSource)) {
      throw new Error(
        `recurringContributions: at most one "${contribution.contributionSource}" contribution is supported (materialized externalIds are keyed per source+month)`,
      );
    }
    seenSources.add(contribution.contributionSource);
  });
}

/** Idempotency key for a materialized off-ledger contribution: one per source per month. */
export function contributionExternalId(source: ContributionSource, monthKey: string): string {
  return `401k-${source}-${monthKey}`;
}

export type ContributionInsert = {
  /** The 15th of the month at UTC midnight (mid-month anchor for payroll deductions). */
  date: number;
  monthKey: string;
  amountCents: number;
  description: string;
  txType: "Investments";
  category: TxCategory;
  externalId: string;
  offLedger: true;
  contributionSource: ContributionSource;
};

/**
 * Pure planning for materializeContributionsForBrain: one off-ledger
 * Investments transaction per configured recurring contribution, dated the
 * 15th of the month (UTC). Idempotent via contributionExternalId — a
 * contribution whose externalId already exists is skipped, never duplicated.
 */
export function planContributionMaterialization(
  contributions: readonly RecurringContribution[],
  monthKey: string,
  existingExternalIds: ReadonlySet<string>,
): { inserts: ContributionInsert[]; skipped: number } {
  if (!isValidMonthKey(monthKey)) {
    throw new Error(`invalid monthKey "${monthKey}". Expected 'YYYY-MM'.`);
  }
  assertValidRecurringContributions(contributions);

  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const date = Date.UTC(year, month - 1, 15);

  const inserts: ContributionInsert[] = [];
  let skipped = 0;
  for (const contribution of contributions) {
    const externalId = contributionExternalId(contribution.contributionSource, monthKey);
    if (existingExternalIds.has(externalId)) {
      skipped += 1;
      continue;
    }
    inserts.push({
      date,
      monthKey,
      amountCents: contribution.amountCents,
      description: contribution.label.trim(),
      txType: "Investments",
      category: contribution.category as TxCategory,
      externalId,
      offLedger: true,
      contributionSource: contribution.contributionSource,
    });
  }
  return { inserts, skipped };
}

/* ------------------------------------------------------------------ */
/* Finances: multi-window trend insights (12-mo / 6-mo / 2-mo, etc.)   */
/* ------------------------------------------------------------------ */

/**
 * One month's aggregates as consumed by computeFinancialInsights. Matches the
 * per-month rows produced by the insights queries (aggregateMonthTransactions
 * output plus the month key). Missing type/category keys are treated as zero.
 */
export type InsightsMonthRow = {
  monthKey: string;
  typeTotalsCents: Record<string, number>;
  categoryTotalsCents: Record<string, number>;
  totalOutgoingCents: number;
  totalIncomingCents: number;
  netCents: number;
};

export type InsightsStat = {
  /** Arithmetic mean of the window's monthly totals, rounded to integer cents. */
  meanCents: number;
  /** Median of the window's monthly totals (midpoint average when even), rounded to integer cents. */
  medianCents: number;
};

export type InsightsWindowStats = {
  /** The requested window size in months (e.g. 12). */
  windowMonths: number;
  /**
   * How many complete months actually informed this window. Less than
   * windowMonths when history is short — the UI labels these honestly,
   * e.g. '12-mo avg (9 mo)'.
   */
  monthsUsed: number;
  /** The complete month keys used, ascending. */
  monthKeys: string[];
  typeStats: Record<TxType, InsightsStat>;
  categoryStats: Record<TxCategory, InsightsStat>;
  outgoing: InsightsStat;
  incoming: InsightsStat;
  net: InsightsStat;
};

/**
 * Mean deltas between two adjacent windows: the shorter (more recent) window's
 * mean minus the longer window's mean. Positive = the recent pace is higher.
 */
export type InsightsWindowDelta = {
  fromWindowMonths: number;
  toWindowMonths: number;
  typeMeanDeltaCents: Record<TxType, number>;
  categoryMeanDeltaCents: Record<TxCategory, number>;
  outgoingMeanDeltaCents: number;
  incomingMeanDeltaCents: number;
  netMeanDeltaCents: number;
};

export type InsightsMover = {
  category: TxCategory;
  txType: TxType;
  /** Mean over the longest window (e.g. 12-mo). */
  longMeanCents: number;
  /** Mean over the shortest window (e.g. 2-mo). */
  shortMeanCents: number;
  /** shortMeanCents - longMeanCents. */
  deltaCents: number;
  /** Percent change vs the long-window mean (one decimal), or null when that mean is not > 0. */
  percentChange: number | null;
};

export type FinancialInsights = {
  currentMonthKey: string;
  /** Complete month keys included in window math, ascending. Excludes currentMonthKey. */
  completeMonthKeys: string[];
  /** One entry per requested window, in the order given (longest -> shortest). */
  windows: InsightsWindowStats[];
  /** Deltas between adjacent windows: windows[i] -> windows[i+1]. */
  deltas: InsightsWindowDelta[];
  /**
   * Categories ranked by |shortest-window mean - longest-window mean| desc.
   * Transfer categories are excluded (transfers are neither income nor
   * spending, consistent with the rest of the budget math). Zero-delta
   * categories are omitted.
   */
  biggestMovers: InsightsMover[];
};

export type FinancialInsightsOptions = {
  /** Window sizes in months, longest first. Default [12, 6, 2]. */
  windows?: number[];
  /** The in-progress month: its row (when present) is NEVER included in window math. */
  currentMonthKey: string;
  /** Maximum number of biggestMovers to return. Default 5. */
  topMoversCount?: number;
};

const CATEGORY_TX_TYPE: Record<TxCategory, TxType> = Object.fromEntries(
  TX_TYPES.flatMap((type) => TX_TYPE_CATEGORIES[type].map((category) => [category, type])),
) as Record<TxCategory, TxType>;

function meanCents(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function medianCents(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function insightsStat(values: readonly number[]): InsightsStat {
  return { meanCents: meanCents(values), medianCents: medianCents(values) };
}

/**
 * Pure multi-window trend math over monthly aggregate rows. For each window
 * (default 12/6/2 months) computes the mean AND median of the monthly totals
 * per type, per category, and for outgoing/incoming/net — medians are reported
 * alongside means so volatile series (e.g. income that switched sources
 * mid-year) stay visible instead of being smoothed away.
 *
 * The currentMonthKey row is ALWAYS excluded: partial months never contaminate
 * averages. When history is shorter than a window, stats are computed over the
 * available complete months and monthsUsed reports the honest count.
 */
export function computeFinancialInsights(
  monthlyRows: readonly InsightsMonthRow[],
  options: FinancialInsightsOptions,
): FinancialInsights {
  const windows = options.windows ?? [12, 6, 2];
  if (windows.length === 0) {
    throw new Error("windows must contain at least one window size");
  }
  for (const window of windows) {
    if (!Number.isInteger(window) || window < 1) {
      throw new Error(`invalid window size ${window}: windows must be positive integers (months)`);
    }
  }
  if (!isValidMonthKey(options.currentMonthKey)) {
    throw new Error(`invalid currentMonthKey "${options.currentMonthKey}". Expected 'YYYY-MM'.`);
  }
  const topMoversCount = options.topMoversCount ?? 5;

  // Complete months only: the in-progress month (and any future-dated rows)
  // never participates in window math. 'YYYY-MM' sorts lexicographically.
  const completeRows = monthlyRows
    .filter((row) => isValidMonthKey(row.monthKey) && row.monthKey < options.currentMonthKey)
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  const windowStats: InsightsWindowStats[] = windows.map((windowMonths) => {
    const rows = completeRows.slice(-windowMonths);
    const typeStats = Object.fromEntries(
      TX_TYPES.map((type) => [type, insightsStat(rows.map((row) => row.typeTotalsCents[type] ?? 0))]),
    ) as Record<TxType, InsightsStat>;
    const categoryStats = Object.fromEntries(
      TX_CATEGORIES.map((category) => [
        category,
        insightsStat(rows.map((row) => row.categoryTotalsCents[category] ?? 0)),
      ]),
    ) as Record<TxCategory, InsightsStat>;
    return {
      windowMonths,
      monthsUsed: rows.length,
      monthKeys: rows.map((row) => row.monthKey),
      typeStats,
      categoryStats,
      outgoing: insightsStat(rows.map((row) => row.totalOutgoingCents)),
      incoming: insightsStat(rows.map((row) => row.totalIncomingCents)),
      net: insightsStat(rows.map((row) => row.netCents)),
    };
  });

  const deltas: InsightsWindowDelta[] = [];
  for (let index = 0; index + 1 < windowStats.length; index += 1) {
    const from = windowStats[index]!;
    const to = windowStats[index + 1]!;
    deltas.push({
      fromWindowMonths: from.windowMonths,
      toWindowMonths: to.windowMonths,
      typeMeanDeltaCents: Object.fromEntries(
        TX_TYPES.map((type) => [type, to.typeStats[type].meanCents - from.typeStats[type].meanCents]),
      ) as Record<TxType, number>,
      categoryMeanDeltaCents: Object.fromEntries(
        TX_CATEGORIES.map((category) => [
          category,
          to.categoryStats[category].meanCents - from.categoryStats[category].meanCents,
        ]),
      ) as Record<TxCategory, number>,
      outgoingMeanDeltaCents: to.outgoing.meanCents - from.outgoing.meanCents,
      incomingMeanDeltaCents: to.incoming.meanCents - from.incoming.meanCents,
      netMeanDeltaCents: to.net.meanCents - from.net.meanCents,
    });
  }

  const longWindow = windowStats[0]!;
  const shortWindow = windowStats[windowStats.length - 1]!;
  const transferCategories: readonly string[] = TX_TYPE_CATEGORIES[TRANSFER_TX_TYPE];
  const biggestMovers = TX_CATEGORIES.filter((category) => !transferCategories.includes(category))
    .map((category) => {
      const longMean = longWindow.categoryStats[category].meanCents;
      const shortMean = shortWindow.categoryStats[category].meanCents;
      const deltaCents = shortMean - longMean;
      return {
        category,
        txType: CATEGORY_TX_TYPE[category],
        longMeanCents: longMean,
        shortMeanCents: shortMean,
        deltaCents,
        percentChange: longMean > 0 ? Math.round((deltaCents / longMean) * 1000) / 10 : null,
      };
    })
    .filter((mover) => mover.deltaCents !== 0)
    .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents))
    .slice(0, topMoversCount);

  return {
    currentMonthKey: options.currentMonthKey,
    completeMonthKeys: completeRows.map((row) => row.monthKey),
    windows: windowStats,
    deltas,
    biggestMovers,
  };
}

/* ------------------------------------------------------------------ */
/* Finances: debt payoff planning (avalanche / snowball)               */
/* ------------------------------------------------------------------ */

export const PAYOFF_STRATEGIES = ["avalanche", "snowball"] as const;
export type PayoffStrategy = (typeof PAYOFF_STRATEGIES)[number];

export function isPayoffStrategy(value: unknown): value is PayoffStrategy {
  return isOneOf(PAYOFF_STRATEGIES, value);
}

/** Hard cap on the payoff simulation length: 600 months (50 years). */
export const PAYOFF_MAX_MONTHS = 600;

export type PayoffDebtInput = {
  id: string;
  name: string;
  /** Current balance in integer cents (>= 0). */
  balanceCents: number;
  /** Annual percentage rate as a plain number (22.5 = 22.5%). */
  apr: number;
  /** Contractual minimum monthly payment in integer cents (>= 0). */
  minPaymentCents: number;
};

export type PayoffScheduleEntry = {
  monthKey: string;
  startingBalanceCents: number;
  /** Interest accrued this month: round(balance * apr / 100 / 12). */
  interestCents: number;
  /** Total paid against this debt this month (minimum + any extra/rollover). */
  paymentCents: number;
  endingBalanceCents: number;
};

export type PayoffDebtSchedule = {
  id: string;
  name: string;
  /** Month-by-month rows from startMonthKey until this debt hits zero (or the cap). */
  schedule: PayoffScheduleEntry[];
  /** The month this debt reaches zero, or null when it never does within the cap. */
  payoffMonthKey: string | null;
  /**
   * True when the debt's first-month interest meets or exceeds its minimum
   * payment: minimums alone can never retire it. Surfaced instead of looping
   * forever; extra payments may still pay it down when it becomes the target.
   */
  nonAmortizing: boolean;
  totalInterestCents: number;
  totalPaidCents: number;
};

export type PayoffPlan = {
  strategy: PayoffStrategy;
  startMonthKey: string;
  extraMonthlyCents: number;
  debts: PayoffDebtSchedule[];
  /** Every simulated month key, ascending (schedule rows align to this axis). */
  monthKeys: string[];
  /** The month every debt reaches zero, or null when the cap was hit first. */
  debtFreeMonthKey: string | null;
  /** Months simulated until debt-free (or PAYOFF_MAX_MONTHS when truncated). */
  totalMonths: number;
  totalInterestCents: number;
  /** Debts whose minimums cannot cover their own interest (see nonAmortizing). */
  nonAmortizingDebtIds: string[];
  /** True when the simulation hit PAYOFF_MAX_MONTHS with balances remaining. */
  truncated: boolean;
  /**
   * Interest saved vs the SAME simulation with extraMonthlyCents = 0, or null
   * when either simulation hit the cap (the baseline never finishes, so a
   * finite comparison would be dishonest).
   */
  interestSavedVsMinimumCents: number | null;
  /** Months saved vs the minimums-only simulation, or null when incomparable. */
  monthsSaved: number | null;
};

/** The month key immediately after `monthKey` (e.g. '2025-12' -> '2026-01'). */
export function nextMonthKey(monthKey: string): string {
  if (!isValidMonthKey(monthKey)) {
    throw new Error(`invalid monthKey "${monthKey}". Expected 'YYYY-MM'.`);
  }
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** One month of interest at an annual rate: round(balance * apr / 100 / 12). */
export function monthlyInterestCents(balanceCents: number, apr: number): number {
  return Math.round((balanceCents * apr) / 100 / 12);
}

function assertPayoffInputs(debts: readonly PayoffDebtInput[], extraMonthlyCents: number): void {
  assertIntegerCents(extraMonthlyCents, "extraMonthlyCents");
  if (extraMonthlyCents < 0) {
    throw new Error("extraMonthlyCents must be >= 0");
  }
  const seenIds = new Set<string>();
  debts.forEach((debt, index) => {
    const field = `debts[${index}]`;
    if (!debt.id) throw new Error(`${field}.id is required`);
    if (seenIds.has(debt.id)) throw new Error(`${field}.id "${debt.id}" is duplicated`);
    seenIds.add(debt.id);
    assertIntegerCents(debt.balanceCents, `${field}.balanceCents`);
    if (debt.balanceCents < 0) throw new Error(`${field}.balanceCents must be >= 0`);
    assertIntegerCents(debt.minPaymentCents, `${field}.minPaymentCents`);
    if (debt.minPaymentCents < 0) throw new Error(`${field}.minPaymentCents must be >= 0`);
    if (!Number.isFinite(debt.apr) || debt.apr < 0 || debt.apr > 100) {
      throw new Error(`${field}.apr must be a number between 0 and 100 (annual percent)`);
    }
  });
}

/**
 * Debts in target order for a strategy: avalanche pays the highest APR first,
 * snowball the smallest balance first (ties broken by the other dimension,
 * then by name for determinism).
 */
export function orderDebtsForStrategy<T extends PayoffDebtInput>(
  debts: readonly T[],
  strategy: PayoffStrategy,
): T[] {
  const sorted = [...debts];
  if (strategy === "avalanche") {
    sorted.sort((a, b) => b.apr - a.apr || a.balanceCents - b.balanceCents || a.name.localeCompare(b.name));
  } else {
    sorted.sort((a, b) => a.balanceCents - b.balanceCents || b.apr - a.apr || a.name.localeCompare(b.name));
  }
  return sorted;
}

type SimulatedDebt = {
  input: PayoffDebtInput;
  balanceCents: number;
  schedule: PayoffScheduleEntry[];
  payoffMonthKey: string | null;
  totalInterestCents: number;
  totalPaidCents: number;
};

/**
 * Core month-by-month payoff simulation.
 *
 * Each month, per open debt: interest = round(balance * apr/100/12) accrues,
 * then the minimum payment is applied (capped at the accrued balance). The
 * extra budget — extraMonthlyCents plus every ALREADY-RETIRED debt's freed-up
 * minimum — goes to the strategy's target debt (highest APR for avalanche,
 * smallest CURRENT balance for snowball); when the target retires mid-month,
 * the remainder cascades to the next target the same month. Capped at
 * PAYOFF_MAX_MONTHS so non-amortizing debts can never loop forever.
 */
function simulatePayoff(
  debts: readonly PayoffDebtInput[],
  extraMonthlyCents: number,
  strategy: PayoffStrategy,
  startMonthKey: string,
): { debts: SimulatedDebt[]; monthKeys: string[]; debtFreeMonthKey: string | null; truncated: boolean } {
  const simulated: SimulatedDebt[] = debts.map((input) => ({
    input,
    balanceCents: input.balanceCents,
    schedule: [],
    payoffMonthKey: null,
    totalInterestCents: 0,
    totalPaidCents: 0,
  }));

  const monthKeys: string[] = [];
  let monthKey = startMonthKey;
  let debtFreeMonthKey: string | null = null;
  let truncated = false;

  const open = () => simulated.filter((debt) => debt.balanceCents > 0);

  if (open().length === 0) {
    return { debts: simulated, monthKeys, debtFreeMonthKey: null, truncated: false };
  }

  for (let month = 0; month < PAYOFF_MAX_MONTHS; month += 1) {
    const openDebts = open();
    if (openDebts.length === 0) break;
    monthKeys.push(monthKey);

    // Freed-up minimums: every debt retired in a PREVIOUS month rolls its
    // minimum into this month's extra budget.
    const freedMinimumsCents = simulated
      .filter((debt) => debt.input.balanceCents > 0 && debt.balanceCents === 0)
      .reduce((sum, debt) => sum + debt.input.minPaymentCents, 0);
    let extraBudgetCents = extraMonthlyCents + freedMinimumsCents;

    // 1) Interest accrues and minimums are paid on every open debt.
    const rows = new Map<SimulatedDebt, PayoffScheduleEntry>();
    for (const debt of openDebts) {
      const startingBalanceCents = debt.balanceCents;
      const interestCents = monthlyInterestCents(startingBalanceCents, debt.input.apr);
      const accrued = startingBalanceCents + interestCents;
      const paymentCents = Math.min(debt.input.minPaymentCents, accrued);
      debt.balanceCents = accrued - paymentCents;
      debt.totalInterestCents += interestCents;
      debt.totalPaidCents += paymentCents;
      rows.set(debt, {
        monthKey,
        startingBalanceCents,
        interestCents,
        paymentCents,
        endingBalanceCents: debt.balanceCents,
      });
    }

    // 2) The extra budget hits the target debt; leftover cascades on retire.
    while (extraBudgetCents > 0) {
      const targets = orderDebtsForStrategy(
        open().map((debt) => ({ ...debt.input, balanceCents: debt.balanceCents, sim: debt })),
        strategy,
      );
      const target = targets[0]?.sim;
      if (!target) break;
      const extraPaymentCents = Math.min(extraBudgetCents, target.balanceCents);
      target.balanceCents -= extraPaymentCents;
      target.totalPaidCents += extraPaymentCents;
      extraBudgetCents -= extraPaymentCents;
      const row = rows.get(target)!;
      row.paymentCents += extraPaymentCents;
      row.endingBalanceCents = target.balanceCents;
    }

    // 3) Record rows and payoff months.
    for (const [debt, row] of rows) {
      debt.schedule.push(row);
      if (row.endingBalanceCents === 0 && debt.payoffMonthKey === null) {
        debt.payoffMonthKey = monthKey;
      }
    }

    if (open().length === 0) {
      debtFreeMonthKey = monthKey;
      break;
    }
    monthKey = nextMonthKey(monthKey);
  }

  if (debtFreeMonthKey === null && open().length > 0) {
    truncated = true;
  }
  return { debts: simulated, monthKeys, debtFreeMonthKey, truncated };
}

/**
 * Debt payoff plan: monthly simulation under a strategy plus totals, including
 * the savings vs a minimums-only baseline (the same simulation with extra = 0).
 *
 * - avalanche: extra money targets the highest-APR debt (mathematically optimal).
 * - snowball: extra money targets the smallest-balance debt (fastest wins).
 * - Retired debts' minimums roll into the extra budget for later months, and
 *   leftover extra cascades to the next target within the same month.
 * - A debt whose monthly interest >= its minimum payment is flagged
 *   nonAmortizing (minimums alone can never retire it); the simulation still
 *   runs but is hard-capped at PAYOFF_MAX_MONTHS and reports truncated.
 */
export function computePayoffPlan(
  debts: readonly PayoffDebtInput[],
  extraMonthlyCents: number,
  strategy: PayoffStrategy,
  startMonthKey: string,
): PayoffPlan {
  if (!isPayoffStrategy(strategy)) {
    throw new Error(`invalid strategy "${strategy}". Valid strategies: ${PAYOFF_STRATEGIES.join(" | ")}`);
  }
  if (!isValidMonthKey(startMonthKey)) {
    throw new Error(`invalid startMonthKey "${startMonthKey}". Expected 'YYYY-MM'.`);
  }
  assertPayoffInputs(debts, extraMonthlyCents);

  // Flagged from the ENTERED balance: at that balance, minimums never amortize.
  const nonAmortizingDebtIds = debts
    .filter(
      (debt) =>
        debt.balanceCents > 0 && monthlyInterestCents(debt.balanceCents, debt.apr) >= debt.minPaymentCents,
    )
    .map((debt) => debt.id);

  const run = simulatePayoff(debts, extraMonthlyCents, strategy, startMonthKey);
  const totalInterestCents = run.debts.reduce((sum, debt) => sum + debt.totalInterestCents, 0);

  // Baseline: the identical simulation with no extra payment. Comparisons are
  // only honest when BOTH simulations finish within the cap.
  let interestSavedVsMinimumCents: number | null = null;
  let monthsSaved: number | null = null;
  if (!run.truncated) {
    const baseline = simulatePayoff(debts, 0, strategy, startMonthKey);
    if (!baseline.truncated) {
      const baselineInterestCents = baseline.debts.reduce((sum, debt) => sum + debt.totalInterestCents, 0);
      interestSavedVsMinimumCents = baselineInterestCents - totalInterestCents;
      monthsSaved = baseline.monthKeys.length - run.monthKeys.length;
    }
  }

  return {
    strategy,
    startMonthKey,
    extraMonthlyCents,
    debts: run.debts.map((debt) => ({
      id: debt.input.id,
      name: debt.input.name,
      schedule: debt.schedule,
      payoffMonthKey: debt.payoffMonthKey,
      nonAmortizing: nonAmortizingDebtIds.includes(debt.input.id),
      totalInterestCents: debt.totalInterestCents,
      totalPaidCents: debt.totalPaidCents,
    })),
    monthKeys: run.monthKeys,
    debtFreeMonthKey: run.debtFreeMonthKey,
    totalMonths: run.monthKeys.length,
    totalInterestCents,
    nonAmortizingDebtIds,
    truncated: run.truncated,
    interestSavedVsMinimumCents,
    monthsSaved,
  };
}

export type DebtPaymentMatchTransaction = {
  description: string;
  txType: string;
  category: string;
  date: number;
  amountCents: number;
};

/**
 * Transactions that look like payments toward a debt: the debt's matchPattern
 * (case-insensitive regex when valid, else a plain case-insensitive substring)
 * is matched against transaction descriptions. Only Fixed Costs /
 * 'Debt Payments' rows are considered first; when NONE match there, the
 * pattern falls back to rows of any type/category (payments are sometimes
 * miscategorized). Returns matches sorted by date descending. A debt without
 * a matchPattern matches nothing.
 */
export function matchDebtPayments<T extends DebtPaymentMatchTransaction>(
  debt: { matchPattern?: string | null | undefined },
  transactions: readonly T[],
): T[] {
  const pattern = debt.matchPattern?.trim();
  if (!pattern) return [];

  let matches: (description: string) => boolean;
  try {
    const regex = new RegExp(pattern, "i");
    matches = (description) => regex.test(description);
  } catch {
    const lowered = pattern.toLowerCase();
    matches = (description) => description.toLowerCase().includes(lowered);
  }

  const debtPaymentRows = transactions.filter(
    (transaction) =>
      transaction.txType === "Fixed Costs" &&
      transaction.category === "Debt Payments" &&
      matches(transaction.description),
  );
  const matched =
    debtPaymentRows.length > 0
      ? debtPaymentRows
      : transactions.filter((transaction) => matches(transaction.description));
  return [...matched].sort((a, b) => b.date - a.date);
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
