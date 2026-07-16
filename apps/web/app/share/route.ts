import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { combineSharedCaptureText, validateQuickCaptureFileInput } from "@skippy/shared";

/* ------------------------------------------------------------------ */
/* Web Share Target endpoint (manifest share_target → POST /share).    */
/* Chromium PWA installs (Android/desktop Chrome) post the share sheet */
/* payload here as multipart form data. The handler requires a Clerk   */
/* session (unauthenticated shares bounce to the home page — losing    */
/* the share is acceptable), performs any file upload server-side via  */
/* the same viewer flow the quick-capture box uses, and lands back on  */
/* the home page with ?shared=ok|err for a toast.                      */
/* ------------------------------------------------------------------ */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const generateUploadUrlRef = makeFunctionReference<"mutation">(
  "knowledge:generateQuickCaptureUploadUrlForViewer",
);
const createCaptureRef = makeFunctionReference<"mutation">("knowledge:createQuickCaptureForViewer");

function redirect(request: Request, path: string) {
  return Response.redirect(new URL(path, request.url), 303);
}

export async function POST(request: Request) {
  const { userId, getToken } = await auth();
  if (!userId) {
    // No session: send the browser to the home page, which shows sign-in.
    return redirect(request, "/");
  }

  try {
    const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) {
      throw new Error("CONVEX_URL is not configured");
    }
    // Mint a Convex-audience JWT from the Clerk session — the same "convex"
    // template ConvexProviderWithClerk uses client-side — so the server-side
    // mutations run as the signed-in viewer.
    const convexToken = await getToken({ template: "convex" });
    if (!convexToken) {
      throw new Error("could not mint a Convex token for the session");
    }
    const convex = new ConvexHttpClient(convexUrl);
    convex.setAuth(convexToken);

    const form = await request.formData();
    const title = form.get("title");
    const text = form.get("text");
    const sharedUrl = form.get("url");
    const file = form.get("files");

    const combinedText = combineSharedCaptureText(
      typeof title === "string" ? title : undefined,
      typeof text === "string" ? text : undefined,
    );
    // Explicit url param wins; otherwise the backend infers a URL from the
    // text (Android commonly puts shared links in `text`).
    const explicitUrl =
      typeof sharedUrl === "string" && sharedUrl.trim() ? sharedUrl.trim() : undefined;

    let fileArgs: Record<string, unknown> = {};
    if (file && typeof file !== "string" && file.size > 0) {
      const checked = validateQuickCaptureFileInput({
        fileName: file.name || "shared-file",
        mimeType: file.type || "",
        sizeBytes: file.size,
      });
      // Same flow as the quick-capture box: upload URL → POST bytes → create.
      const uploadUrl = (await convex.mutation(generateUploadUrlRef, {})) as string;
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": checked.mimeType },
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error(`upload failed (HTTP ${uploadResponse.status})`);
      }
      const { storageId } = (await uploadResponse.json()) as { storageId: string };
      fileArgs = {
        storageId,
        fileName: checked.fileName,
        mimeType: checked.mimeType,
        sizeBytes: checked.sizeBytes,
      };
    }

    // A URL-only share still needs capture text (the backend requires text
    // or a file), so the URL doubles as the text.
    const captureText = combinedText ?? explicitUrl;
    if (!captureText && !("storageId" in fileArgs)) {
      throw new Error("empty share payload");
    }

    await convex.mutation(createCaptureRef, {
      ...(captureText ? { text: captureText } : {}),
      ...(explicitUrl ? { url: explicitUrl } : {}),
      ...fileArgs,
      intent: "remember",
    });

    return redirect(request, "/?shared=ok");
  } catch {
    return redirect(request, "/?shared=err");
  }
}
