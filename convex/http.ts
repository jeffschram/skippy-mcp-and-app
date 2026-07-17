import { httpActionGeneric, httpRouter, makeFunctionReference } from "convex/server";
import {
  normalizeQuickCaptureIntentInput,
  parseBearerToken,
  validateQuickCaptureFileInput,
} from "@skippy/shared";

/* ------------------------------------------------------------------ */
/* POST /capture — phone-friendly quick capture over plain HTTP.       */
/* iOS Safari has no Web Share Target support, so an Apple Shortcut    */
/* posts here directly (served from https://<deployment>.convex.site). */
/* Auth reuses the MCP bearer tokens: same tokens, same validation.    */
/* Accepts JSON { text?, url?, intent? } or multipart form data with a */
/* "file" field plus optional text/url/intent fields.                  */
/* ------------------------------------------------------------------ */

// Same source of truth as the remote MCP transport (apps/mcp-server).
const authenticateMcpTokenRef = makeFunctionReference<"mutation">("mcpTokens:authenticate");
// Internal-only writer that funnels into the shared insertQuickCapture helper.
const createCaptureRef = makeFunctionReference<"mutation">(
  "knowledge:createQuickCaptureFromCaptureEndpoint",
);
// Structured ingestion, reused by the /ingest endpoint (same mutations the MCP
// ingest_object / record_ingestion_run / update_source_sync_status tools call).
const ingestObjectRef = makeFunctionReference<"mutation">("knowledge:ingestObject");
const recordIngestionRunRef = makeFunctionReference<"mutation">("knowledge:recordIngestionRun");
const updateSourceSyncStatusRef = makeFunctionReference<"mutation">(
  "knowledge:updateSourceSyncStatus",
);

const INGEST_ENTITY_TYPES = new Set([
  "goal",
  "project",
  "task",
  "note",
  "person",
  "company",
  "link",
  "knowledgeObject",
]);

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function formString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const TEXT_UPLOAD_MAX_BYTES = 100_000;

/**
 * The iOS Shortcut posts the raw shared item as the `file` field with no
 * client-side branching (Shortcuts' Get Text / Get Images actions both coerce
 * their input, so they can't reliably tell a photo from a note). Instead we
 * decide here: a small, valid-UTF-8, NUL-free upload IS a text/URL share and
 * becomes a text capture; anything binary (photos, PDFs, video) stays a file.
 * Returns the decoded text, or undefined to keep treating it as a file.
 */
async function decodeTextUpload(file: Blob & { name?: string }): Promise<string | undefined> {
  if (file.size === 0 || file.size > TEXT_UPLOAD_MAX_BYTES) return undefined;
  const mime = (file.type || "").toLowerCase();
  const looksTextByType =
    mime.startsWith("text/") || mime === "application/json" || mime === "application/xml";
  const unknownType = mime === "" || mime === "application/octet-stream";
  // image/*, application/pdf, video/*, etc. are declared binary — never text.
  if (!looksTextByType && !unknownType) return undefined;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.includes(0)) return undefined; // NUL byte ⇒ binary
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
    return decoded || undefined;
  } catch {
    return undefined; // not valid UTF-8 ⇒ binary
  }
}

export const capture = httpActionGeneric(async (ctx, request) => {
  const token = parseBearerToken(request.headers.get("authorization"));
  if (!token) {
    return json(401, { error: "missing bearer token" });
  }

  let brainInstanceId: string;
  try {
    const auth = (await ctx.runMutation(authenticateMcpTokenRef, { token })) as {
      brainInstanceId: string;
    };
    brainInstanceId = auth.brainInstanceId;
  } catch {
    return json(401, { error: "invalid bearer token" });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let text: string | undefined;
  let url: string | undefined;
  let rawIntent: unknown;
  let file: Blob & { name?: string } | undefined;

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json(400, { error: "could not parse multipart form data" });
    }
    const fileEntry = form.get("file");
    if (fileEntry !== null && typeof fileEntry !== "string" && fileEntry.size > 0) {
      file = fileEntry;
    }
    text = formString(form.get("text"));
    url = formString(form.get("url"));
    rawIntent = formString(form.get("intent"));
  } else {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: "expected JSON or multipart/form-data" });
    }
    if (typeof body !== "object" || body === null) {
      return json(400, { error: "expected a JSON object" });
    }
    const record = body as Record<string, unknown>;
    text = typeof record.text === "string" && record.text.trim() ? record.text.trim() : undefined;
    url = typeof record.url === "string" && record.url.trim() ? record.url.trim() : undefined;
    rawIntent = record.intent;
  }

  const intent = normalizeQuickCaptureIntentInput(rawIntent);
  if (intent === null) {
    return json(400, { error: "intent must be 'remember' or 'hold'" });
  }

  // Branchless-shortcut support: when the only payload is a `file` that is
  // actually text (a shared note or URL), reclassify it as a text capture so
  // it doesn't get stored as a junk .txt attachment. Photos stay files.
  if (file && !text && !url) {
    const decoded = await decodeTextUpload(file);
    if (decoded) {
      text = decoded;
      file = undefined;
    }
  }

  // A URL-only share still needs capture text (the write path requires text
  // or a file), so the URL doubles as the text — matching how a pasted URL
  // behaves in the web quick-capture box.
  if (!text && url) {
    text = url;
  }
  if (!text && !file) {
    return json(400, { error: "empty payload: provide text, url, or a file" });
  }

  let fileArgs: Record<string, unknown> = {};
  if (file) {
    let checked: { fileName: string; mimeType: string; sizeBytes: number };
    try {
      checked = validateQuickCaptureFileInput({
        fileName: file.name || "shared-file",
        mimeType: file.type || "",
        sizeBytes: file.size,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "file rejected";
      return json(/too large/.test(message) ? 413 : 400, { error: message });
    }
    const storageId = await ctx.storage.store(file);
    fileArgs = {
      storageId,
      fileName: checked.fileName,
      mimeType: checked.mimeType,
      sizeBytes: checked.sizeBytes,
    };
  }

  const result = (await ctx.runMutation(createCaptureRef, {
    brainInstanceId,
    ...(text ? { text } : {}),
    ...(url ? { url } : {}),
    ...fileArgs,
    intent,
  })) as { captureId: string };

  return json(200, { captureId: result.captureId });
});

/* ------------------------------------------------------------------ */
/* POST /ingest — token-authed structured ingestion for scheduled      */
/* harnesses that can't attach the Skippy MCP (e.g. the claude.ai cloud */
/* routine that reads Gmail/Calendar). One batch call: ingest N objects,*/
/* record the run, and update the source-sync status pill. Auth reuses  */
/* the same MCP bearer tokens as /capture — a SCOPED token, never a     */
/* Convex admin key. Body (JSON):                                       */
/*   { harness?, statusKey?, sourceSystemsChecked?: string[],           */
/*     message?, items: [{ candidateEntityType, candidatePayload,       */
/*                         rubricDecision, confidence?, sourceRefs? }] } */
/* ------------------------------------------------------------------ */
export const ingest = httpActionGeneric(async (ctx, request) => {
  const token = parseBearerToken(request.headers.get("authorization"));
  if (!token) {
    return json(401, { error: "missing bearer token" });
  }

  let brainInstanceId: string;
  try {
    const auth = (await ctx.runMutation(authenticateMcpTokenRef, { token })) as {
      brainInstanceId: string;
    };
    brainInstanceId = auth.brainInstanceId;
  } catch {
    return json(401, { error: "invalid bearer token" });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "expected a JSON body" });
  }
  if (typeof body !== "object" || body === null || !Array.isArray(body.items)) {
    return json(400, { error: "body must be an object with an items array" });
  }

  const harness = typeof body.harness === "string" && body.harness.trim() ? body.harness.trim() : "http-ingest";
  const statusKey =
    typeof body.statusKey === "string" && body.statusKey.trim() ? body.statusKey.trim() : "http-ingest";
  const sourceSystemsChecked = Array.isArray(body.sourceSystemsChecked)
    ? body.sourceSystemsChecked.filter((s: unknown): s is string => typeof s === "string")
    : [];

  const errors: string[] = [];
  const created: Array<{ index: number; entityType: string }> = [];

  for (let i = 0; i < body.items.length; i++) {
    const item = body.items[i];
    if (typeof item !== "object" || item === null) {
      errors.push(`item ${i}: not an object`);
      continue;
    }
    const entityType = item.candidateEntityType;
    if (!INGEST_ENTITY_TYPES.has(entityType)) {
      errors.push(`item ${i}: invalid candidateEntityType '${entityType}'`);
      continue;
    }
    if (typeof item.candidatePayload !== "object" || item.candidatePayload === null) {
      errors.push(`item ${i}: candidatePayload must be an object`);
      continue;
    }
    if (typeof item.rubricDecision !== "string" || !item.rubricDecision.trim()) {
      errors.push(`item ${i}: rubricDecision is required`);
      continue;
    }
    try {
      await ctx.runMutation(ingestObjectRef, {
        brainInstanceId,
        candidateEntityType: entityType,
        candidatePayload: item.candidatePayload,
        rubricDecision: item.rubricDecision.trim(),
        ...(typeof item.confidence === "number" ? { confidence: item.confidence } : {}),
        ...(Array.isArray(item.sourceRefs) ? { sourceRefs: item.sourceRefs } : {}),
      });
      created.push({ index: i, entityType });
    } catch (error) {
      errors.push(`item ${i}: ${error instanceof Error ? error.message : "ingest failed"}`);
    }
  }

  // Record the run and settle the "Updating" pill — best-effort, never fail the
  // whole request over bookkeeping.
  try {
    await ctx.runMutation(recordIngestionRunRef, {
      brainInstanceId,
      harness,
      status: errors.length && !created.length ? "failed" : "completed",
      sourceSystemsChecked,
      objectsCreated: created.length,
      ...(errors.length ? { errors } : {}),
    });
    await ctx.runMutation(updateSourceSyncStatusRef, {
      brainInstanceId,
      statusKey,
      harness,
      status: errors.length && !created.length ? "failed" : "completed",
      sourceSystemsChecked,
      ...(typeof body.message === "string" && body.message.trim()
        ? { message: body.message.trim() }
        : {}),
      ...(errors.length ? { errors } : {}),
    });
  } catch {
    // Ignore bookkeeping errors; the ingested objects are what matter.
  }

  return json(200, { objectsCreated: created.length, created, errors });
});

const http = httpRouter();

http.route({
  path: "/capture",
  method: "POST",
  handler: capture,
});

http.route({
  path: "/ingest",
  method: "POST",
  handler: ingest,
});

export default http;
