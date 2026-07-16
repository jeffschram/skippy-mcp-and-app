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

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function formString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

const http = httpRouter();

http.route({
  path: "/capture",
  method: "POST",
  handler: capture,
});

export default http;
