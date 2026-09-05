"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  Eye,
  File as FileIcon,
  FileText,
  Inbox,
  Link as LinkIcon,
  Paperclip,
  PenLine,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { activeSourceSyncStatus, type QuickCaptureIntent } from "@skippy/shared";
import { api } from "../../lib/skippy-api";
import { agentRoleDisplayName, agentRoleFromMetadata, formatRelative } from "../../lib/display";
import { focusItemKey, parseFocusSummary } from "../focus-summary";
import { LiveGate } from "../live-auth";
import { Badge, Button, Card, IconButton, InlineMarkdown, LoadingRow, Section, TextArea, useToast } from "../components";
import { AgendaSection } from "./agenda";
import { useViewerReady } from "./use-viewer";
import { formatFileSize } from "./project-library-helpers";
import { QUICK_CAPTURE_INTENT_STORAGE_KEY, checkQuickCaptureFile, parseStoredIntent } from "./quick-capture-helpers";
import { cn } from "@/lib/utils";
import {
  cardClass,
  eyebrowClass,
  itemClass,
  itemIconClass,
  itemMetaClass,
  itemTitleClass,
  mutedClass,
  projectRowClass,
  sectionClass,
  textButtonClass,
  textButtonCompactClass,
} from "../page-classes";

type AnyRecord = Record<string, any>;

/* Focus hero + sync status classes (translated from the legacy globals.css
   focus-summary / sync-status families). */
const focusSummaryClass = "grid min-h-[260px] content-between gap-[18px] border-l-4 border-l-blue";
const focusSummaryHeadClass = "mb-1.5 flex items-center gap-2.5";
const focusHeadingClass = "mb-[18px] max-w-[760px] text-[clamp(28px,4vw,44px)] leading-[1.08]";
const focusSummaryListClass =
  "grid max-w-[680px] gap-3 pl-[1.15em] text-xl leading-[1.42] text-foreground marker:text-green [&_li]:pl-0.5 [&_li>span:first-child]:mr-2.5";
/* Paragraphs inside the focus hero (legacy `.focus-summary p:not(.eyebrow)`). */
const focusSummaryParagraphClass = "mb-0 max-w-[680px] text-xl leading-[1.42] text-foreground";
const focusItemActionsClass = "inline-flex gap-1.5 align-middle [&_button]:h-[30px] [&_button]:min-h-[30px]";
const syncStatusPillClass =
  "inline-flex min-h-[26px] items-center gap-1.5 rounded-lg border bg-blue/10 px-[9px] text-xs font-extrabold text-blue [&_svg]:animate-spin";
const syncStatusCopyClass = "m-0 mb-3 max-w-[680px] text-sm text-muted-foreground";

/* ------------------------------------------------------------------ */
/* Quick capture: a quiet inbox slot on the home page — one inbox, two */
/* intents. "Remember" items land as pending quickCaptures for the     */
/* ingestion harnesses; "Hold" items are private device-to-device      */
/* transfers that harnesses never see and that expire after 7 days.    */
/* The card doubles as a dropzone/paste target for files.              */
/* ------------------------------------------------------------------ */


const CAPTURE_LIST_LIMIT = 6;

/* Shared row classes for the capture lists — an aligned grid table so
   type-indicator / label / meta / actions line up across rows. */
const captureListHeadingClass =
  "mx-0 mb-0 mt-1 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground";
const captureListClass = "grid overflow-x-auto border-t";
const captureRowClass =
  "grid min-w-0 grid-cols-[36px_minmax(0,1fr)_auto_auto] items-center gap-2.5 border-b py-2";
/* 36px square holding either a thumbnail or an icon, so icon rows line up
   with image rows; overflow-hidden clips the thumb to the rounded square. */
const captureTypeClass =
  "inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border text-muted-foreground";
const captureMetaClass = "inline-flex items-center justify-end gap-2";
const captureRowActionsClass = "inline-flex shrink-0 items-center justify-end gap-0.5";
/* Remember | Hold segmented control buttons — compact, gold when checked. */
const intentButtonClass =
  "cursor-pointer rounded-full border-0 bg-transparent px-2.5 py-0.5 [font-family:inherit] text-xs font-[620] text-muted-foreground aria-checked:bg-gold/[0.14] aria-checked:text-gold disabled:cursor-default disabled:opacity-60";

function captureLabel(capture: AnyRecord): string {
  return capture.text ?? capture.fileName ?? capture.url ?? "File";
}

// Where an "Actions taken" item points once Skippy has filed the capture as an
// entity. Projects have their own page; links/notes live on the Brain "Links"
// tab (deep-linked by row anchor); everything else lands on its Brain sub-page.
function captureEntityHref(entityType: string, entityId: string): string | undefined {
  const id = encodeURIComponent(entityId);
  switch (entityType) {
    case "project":
      return `/projects/${id}`;
    case "task":
      return `/tasks#task-${id}`;
    case "link":
      return `/brain/links#link-${id}`;
    case "note":
      return `/brain/links#note-${id}`;
    case "goal":
      return `/brain/goals#goal-${id}`;
    case "person":
    case "company":
      return `/brain/contacts`;
    case "knowledgeObject":
      return `/brain/memory`;
    // Life-layer primitives. These are NOT entityType members — keeping
    // calendar events and recurrences out of that union is what stops them
    // flowing through triage — so they arrive as plain strings and are matched
    // here rather than widening the union just to get a link.
    case "recurrence":
      return `/tasks#recurrence-${id}`;
    case "calendarEvent":
    case "calendar_event":
      return `/`;
    default:
      return undefined;
  }
}

function QuickCaptureBox({ captures }: { captures: AnyRecord[] | undefined }) {
  const generateUploadUrl = useMutation(api.knowledge.generateQuickCaptureUploadUrlForViewer);
  const createCapture = useMutation(api.knowledge.createQuickCaptureForViewer);
  const deleteCapture = useMutation(api.knowledge.deleteQuickCaptureForViewer);
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [intent, setIntent] = useState<QuickCaptureIntent>("remember");
  const [busyCaptureId, setBusyCaptureId] = useState<string | null>(null);

  // Sticky per device. Read in an effect so the server render and hydration
  // both see the "remember" default (localStorage is browser-only).
  useEffect(() => {
    setIntent(parseStoredIntent(window.localStorage.getItem(QUICK_CAPTURE_INTENT_STORAGE_KEY)));
  }, []);

  const chooseIntent = (next: QuickCaptureIntent) => {
    setIntent(next);
    try {
      window.localStorage.setItem(QUICK_CAPTURE_INTENT_STORAGE_KEY, next);
    } catch {
      // Private mode etc. — the toggle still works for this page view.
    }
  };

  const canSubmit = !submitting && (text.trim().length > 0 || file !== null);

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const selectFile = (candidate: File | null | undefined) => {
    if (!candidate) return;
    const check = checkQuickCaptureFile({
      fileName: candidate.name || "pasted-file",
      mimeType: candidate.type,
      sizeBytes: candidate.size,
    });
    if (!check.ok) {
      toast(check.reason, "error");
      return;
    }
    setFile(candidate);
  };

  /* Dropzone: depth counter so the highlight doesn't flicker while the drag
     moves over child elements (enter/leave fire per descendant). */
  const dragHasFiles = (event: DragEvent<HTMLDivElement>) =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");
  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault(); // required for the drop event to fire
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    // First file when several are dropped — the box holds one attachment.
    selectFile(event.dataTransfer?.files?.[0]);
  };

  /* Clipboard: pasting a file/image (e.g. a screenshot) attaches it. */
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const item = Array.from(event.clipboardData?.items ?? []).find((entry) => entry.kind === "file");
    const pasted = item?.getAsFile();
    if (!pasted) return;
    event.preventDefault();
    selectFile(pasted);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // Same upload flow as the project library: upload URL → POST bytes → register.
      let fileArgs: AnyRecord = {};
      if (file) {
        const check = checkQuickCaptureFile({
          fileName: file.name || "pasted-file",
          mimeType: file.type,
          sizeBytes: file.size,
        });
        if (!check.ok) throw new Error(check.reason);
        const uploadUrl = (await generateUploadUrl({})) as string;
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": check.mimeType },
          body: file,
        });
        if (!response.ok) throw new Error(`upload failed (HTTP ${response.status})`);
        const { storageId } = (await response.json()) as { storageId: string };
        fileArgs = { storageId, fileName: check.fileName, mimeType: check.mimeType, sizeBytes: check.sizeBytes };
      }
      const trimmed = text.trim();
      await createCapture({ ...(trimmed ? { text: trimmed } : {}), ...fileArgs, intent } as any);
      setText("");
      clearFile();
      toast(
        intent === "hold"
          ? "Held — grab it from any device within 7 days. Skippy won't ingest it."
          : "Captured — Skippy will pick it up on the next ingestion run.",
        "info",
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save capture", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const onTextKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  };

  const copyCapture = async (capture: AnyRecord) => {
    try {
      await navigator.clipboard.writeText(capture.text ?? capture.url ?? "");
      toast("Copied to clipboard.", "info");
    } catch {
      toast("Could not copy — clipboard unavailable.", "error");
    }
  };

  const downloadCapture = async (capture: AnyRecord) => {
    if (!capture.fileUrl) return;
    setBusyCaptureId(capture._id);
    try {
      // Convex file URLs are cross-origin, so an anchor download attribute
      // cannot rename the file — fetch to a blob and download the object URL
      // instead, preserving the real filename.
      const response = await fetch(capture.fileUrl);
      if (!response.ok) throw new Error(`download failed (HTTP ${response.status})`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = capture.fileName ?? "capture";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not download file", "error");
    } finally {
      setBusyCaptureId(null);
    }
  };

  const copyImageCapture = async (capture: AnyRecord) => {
    if (!capture.fileUrl) return;
    setBusyCaptureId(capture._id);
    try {
      const response = await fetch(capture.fileUrl);
      if (!response.ok) throw new Error(`fetch failed (HTTP ${response.status})`);
      let blob = await response.blob();
      // Browsers reliably accept image/png on the clipboard; anything else
      // (jpeg, webp, …) gets redrawn onto a canvas and re-encoded as PNG.
      if (blob.type !== "image/png") {
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas unavailable");
        ctx.drawImage(bitmap, 0, 0);
        const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!pngBlob) throw new Error("could not encode image");
        blob = pngBlob;
      }
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      toast("Image copied to clipboard.", "info");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not copy image", "error");
    } finally {
      setBusyCaptureId(null);
    }
  };

  const removeCapture = async (capture: AnyRecord) => {
    setBusyCaptureId(capture._id);
    try {
      await deleteCapture({ captureId: capture._id } as any);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not delete capture", "error");
    } finally {
      setBusyCaptureId(null);
    }
  };

  // Split the stream into the live inbox (pending) and what Skippy did with the
  // rest (processed → "actions taken"). Discarded rows stay out of sight;
  // expired holds never arrive from the server.
  const pendingCaptures = (captures ?? []).filter((capture) => capture.status === "pending");
  const processedCaptures = (captures ?? []).filter((capture) => capture.status === "processed");
  const recent = pendingCaptures.slice(0, CAPTURE_LIST_LIMIT);
  const moreCount = pendingCaptures.length - recent.length;
  const recentActions = processedCaptures.slice(0, CAPTURE_LIST_LIMIT);
  const moreActions = processedCaptures.length - recentActions.length;

  return (
    <Section
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <PenLine size={18} aria-hidden /> Quick capture
        </span>
      }
      action={
        <div className="inline-flex items-center gap-0.5 rounded-full border p-0.5" role="radiogroup" aria-label="Capture intent">
          <button
            type="button"
            role="radio"
            className={intentButtonClass}
            aria-checked={intent === "remember"}
            disabled={submitting}
            onClick={() => chooseIntent("remember")}
          >
            Remember
          </button>
          <button
            type="button"
            role="radio"
            className={intentButtonClass}
            aria-checked={intent === "hold"}
            disabled={submitting}
            onClick={() => chooseIntent("hold")}
          >
            Hold
          </button>
        </div>
      }
    >
      <div
        className={cn(
          "grid gap-2 rounded-[10px]",
          dragActive && "bg-gold/[0.07] outline-dashed outline-2 outline-offset-[6px] outline-gold",
        )}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onPaste={onPaste}
      >
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: "none" }}
          onChange={(event) => {
            selectFile(event.target.files?.[0]);
            if (event.target) event.target.value = "";
          }}
        />
        <div className="relative [&_textarea]:pr-[52px]">
          <TextArea
            rows={2}
            placeholder="Drop a thought, note, URL, or file…"
            aria-label="Quick capture text"
            value={text}
            disabled={submitting}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onTextKeyDown}
          />
          <IconButton
            small
            className="absolute bottom-3 right-3"
            title="Attach file"
            aria-label="Attach file"
            disabled={submitting}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip size={16} aria-hidden />
          </IconButton>
        </div>
        {file ? (
          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 self-start rounded-full border py-1 pl-2 pr-1.5 text-[13px]">
            <Paperclip size={13} aria-hidden />
            <span className="max-w-40 truncate">{file.name}</span>
            <span className={itemMetaClass}>{formatFileSize(file.size)}</span>
            <IconButton small aria-label={`Remove ${file.name}`} disabled={submitting} onClick={clearFile}>
              <X size={13} aria-hidden />
            </IconButton>
          </span>
        ) : null}
        <div className="flex justify-end max-[560px]:[&_button]:w-full">
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? "Capturing…" : "Capture"}
          </Button>
        </div>
        {recent.length ? (
          <>
          <h3 className={captureListHeadingClass}>Captures</h3>
          <div className={captureListClass}>
            {recent.map((capture) => {
              const label = captureLabel(capture);
              const busy = busyCaptureId === capture._id;
              const isImage =
                typeof capture.mimeType === "string" &&
                capture.mimeType.startsWith("image/") &&
                Boolean(capture.fileUrl);
              const isFile = Boolean(capture.fileName) && !isImage;
              const pending = capture.intent !== "hold" && capture.status === "pending";
              return (
                <div key={capture._id} className={captureRowClass}>
                  <span
                    className={cn(captureTypeClass, pending && "border-gold shadow-[0_0_0_1px_var(--gold)]")}
                    title={pending ? "Pending — awaiting the next ingestion run" : undefined}
                    aria-hidden
                  >
                    {isImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={capture.fileUrl} alt="" className="block h-full w-full object-cover" />
                    ) : isFile ? (
                      <FileIcon size={18} />
                    ) : capture.url ? (
                      <LinkIcon size={18} />
                    ) : (
                      <FileText size={18} />
                    )}
                  </span>
                  <span className="min-w-0 truncate text-[13px] text-muted-foreground" title={label}>
                    {label}
                  </span>
                  <span className={captureMetaClass}>
                    {!isImage && typeof capture.sizeBytes === "number" ? (
                      <span className={itemMetaClass}>{formatFileSize(capture.sizeBytes)}</span>
                    ) : null}
                    {capture.intent === "hold" ? <Badge tone="neutral">hold</Badge> : null}
                  </span>
                  <span className={captureRowActionsClass}>
                    {isImage ? (
                      <>
                        <IconButton
                          small
                          title="View image"
                          aria-label={`View ${label}`}
                          disabled={busy}
                          onClick={() => window.open(capture.fileUrl, "_blank", "noopener,noreferrer")}
                        >
                          <Eye size={13} aria-hidden />
                        </IconButton>
                        <IconButton
                          small
                          title="Copy image"
                          aria-label={`Copy ${label}`}
                          disabled={busy}
                          onClick={() => void copyImageCapture(capture)}
                        >
                          <Copy size={13} aria-hidden />
                        </IconButton>
                        <IconButton
                          small
                          title={`Download ${capture.fileName}`}
                          aria-label={`Download ${capture.fileName}`}
                          disabled={busy}
                          onClick={() => void downloadCapture(capture)}
                        >
                          <Download size={13} aria-hidden />
                        </IconButton>
                      </>
                    ) : isFile ? (
                      <IconButton
                        small
                        title={`Download ${capture.fileName}`}
                        aria-label={`Download ${capture.fileName}`}
                        disabled={busy}
                        onClick={() => void downloadCapture(capture)}
                      >
                        <Download size={13} aria-hidden />
                      </IconButton>
                    ) : (
                      <IconButton
                        small
                        title="Copy text"
                        aria-label={`Copy ${label}`}
                        disabled={busy}
                        onClick={() => void copyCapture(capture)}
                      >
                        <Copy size={13} aria-hidden />
                      </IconButton>
                    )}
                    <IconButton
                      small
                      title="Delete capture"
                      aria-label={`Delete ${label}`}
                      disabled={busy}
                      onClick={() => void removeCapture(capture)}
                    >
                      <X size={13} aria-hidden />
                    </IconButton>
                  </span>
                </div>
              );
            })}
            {moreCount > 0 ? (
              <p className={itemMetaClass} style={{ margin: 0 }}>
                +{moreCount} more
              </p>
            ) : null}
          </div>
          </>
        ) : null}
        {recentActions.length ? (
          <>
          <h3 className={captureListHeadingClass}>Actions taken</h3>
          <div className={captureListClass}>
            {recentActions.map((capture) => {
              const label = captureLabel(capture);
              const note = capture.processingNote || "Filed";
              const busy = busyCaptureId === capture._id;
              const relatedEntities: AnyRecord[] = Array.isArray(capture.relatedEntities)
                ? capture.relatedEntities
                : [];
              const links = relatedEntities
                .map((entity) => ({
                  entityType: String(entity.entityType),
                  entityId: String(entity.entityId),
                  label: String(entity.label ?? entity.entityId),
                  href: captureEntityHref(entity.entityType, entity.entityId),
                }))
                .filter((entity) => entity.href);
              return (
                <div key={capture._id} className={captureRowClass}>
                  <span className={captureTypeClass} aria-hidden>
                    <Sparkles size={18} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="min-w-0 truncate text-[13px]" title={note}>
                      {note}
                    </span>
                    <span className="min-w-0 truncate text-xs text-muted-foreground" title={label}>
                      {label}
                    </span>
                    {links.length ? (
                      <span className="mt-0.5 flex min-w-0 flex-wrap gap-x-2.5 gap-y-1">
                        {links.map((entity) => (
                          <Link
                            key={`${entity.entityType}:${entity.entityId}`}
                            href={entity.href as string}
                            className="inline-flex min-w-0 max-w-full items-center gap-[3px] text-xs text-gold no-underline hover:underline"
                            title={`Open ${entity.label}`}
                          >
                            <ArrowRight size={12} aria-hidden />
                            <span className="truncate">{entity.label}</span>
                          </Link>
                        ))}
                      </span>
                    ) : null}
                  </span>
                  <span className={captureMetaClass}>
                    {capture.processedAt ? (
                      <span className={itemMetaClass}>{formatRelative(capture.processedAt)}</span>
                    ) : null}
                  </span>
                  <span className={captureRowActionsClass}>
                    <IconButton
                      small
                      title="Dismiss"
                      aria-label={`Dismiss ${note}`}
                      disabled={busy}
                      onClick={() => void removeCapture(capture)}
                    >
                      <X size={13} aria-hidden />
                    </IconButton>
                  </span>
                </div>
              );
            })}
            {moreActions > 0 ? (
              <p className={itemMetaClass} style={{ margin: 0 }}>
                +{moreActions} more
              </p>
            ) : null}
          </div>
          </>
        ) : null}
      </div>
    </Section>
  );
}

/**
 * One-shot toast for the Web Share Target round-trip: /share redirects to
 * /?shared=ok|err, we surface the result and strip the param. The query is
 * read from window.location in an effect (not useSearchParams) so the static
 * home page needs no Suspense boundary.
 */
function useSharedParamToast() {
  const toast = useToast();
  const router = useRouter();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    const params = new URLSearchParams(window.location.search);
    const shared = params.get("shared");
    if (!shared) return;
    handled.current = true;
    if (shared === "ok") {
      toast("Captured from share — Skippy will pick it up on the next ingestion run.", "info");
    } else {
      toast("Share failed — nothing was captured.", "error");
    }
    params.delete("shared");
    const query = params.toString();
    router.replace(query ? `/?${query}` : "/", { scroll: false });
  }, [router, toast]);
}

export function TodayContent() {
  const viewerReady = useViewerReady();
  useSharedParamToast();
  const data = useQuery(api.knowledge.dashboardForViewer, viewerReady ? {} : "skip") as AnyRecord | undefined;

  const recordFocusItemAction = useMutation(api.knowledge.recordFocusItemActionForViewer);
  const createTaskFromFocusItem = useMutation(api.knowledge.createTaskFromFocusItemForViewer);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const { headline, bullets } = useMemo(
    () => parseFocusSummary(data?.focusSummary?.summaryText),
    [data?.focusSummary?.summaryText],
  );
  // Stale running rows (dead harness, no heartbeat) read as inactive — the
  // "Updating" pill self-heals instead of pinning forever.
  const sync = useMemo(
    () => activeSourceSyncStatus<AnyRecord>(data?.sourceSyncStatuses, Date.now()),
    [data?.sourceSyncStatuses],
  );
  const actionedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const action of data?.focusItemActions ?? []) set.add(action.itemKey);
    // Dismissals from recent prior summaries: regenerated bullets with the exact same
    // text must never flash back.
    for (const dismissal of data?.recentFocusDismissals ?? []) {
      if (dismissal.itemKey) set.add(dismissal.itemKey);
    }
    return set;
  }, [data?.focusItemActions, data?.recentFocusDismissals]);
  const visibleBullets = useMemo(
    () => bullets.map((text) => ({ text, key: focusItemKey(text) })).filter((item) => !actionedKeys.has(item.key)),
    [bullets, actionedKeys],
  );

  const focusStale = Boolean(data?.focusSummaryStale);
  const unclear = data?.triageItems?.length ?? 0;
  const pending = data?.pendingActions?.length ?? 0;

  const recordAction = async (item: { text: string; key: string }, action: "dismissed" | "done") => {
    if (!data?.focusSummary?._id) return;
    setBusyKey(item.key);
    try {
      await recordFocusItemAction({
        focusSummaryId: data.focusSummary._id,
        itemKey: item.key,
        itemText: item.text,
        action,
      } as any);
    } finally {
      setBusyKey(null);
    }
  };
  const promote = async (item: { text: string; key: string }) => {
    if (!data?.focusSummary?._id) return;
    setBusyKey(item.key);
    try {
      await createTaskFromFocusItem({
        focusSummaryId: data.focusSummary._id,
        itemKey: item.key,
        itemText: item.text,
      } as any);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <LiveGate>
      {!data ? (
        <Card>
          <LoadingRow label="Loading your focus…" />
        </Card>
      ) : (
        <div className="grid gap-4">
          {/* Focus hero */}
          <section className={cn(cardClass, sectionClass, focusSummaryClass)} style={{ minHeight: 0 }}>
            <div>
              <div className={focusSummaryHeadClass}>
                <p className={cn(eyebrowClass, "mb-0")}>Now</p>
                {sync ? (
                  <span
                    className={syncStatusPillClass}
                    title={sync.message ?? `Source sync is running on ${sync.harness}`}
                  >
                    <RefreshCw size={14} aria-hidden />{" "}
                    {agentRoleDisplayName(agentRoleFromMetadata(sync.metadata)) ?? "Updating"}
                  </span>
                ) : null}
              </div>
              {sync ? (
                <p className={syncStatusCopyClass}>
                  {sync.message ?? `Checking ${(sync.sourceSystemsChecked ?? []).join(", ") || "connected sources"}.`}
                </p>
              ) : null}
              <h1 className={focusHeadingClass}>
                {visibleBullets.length ? (
                  <InlineMarkdown>{headline}</InlineMarkdown>
                ) : focusStale ? (
                  "Focus summary is out of date."
                ) : (
                  "Nothing new needs focus right now."
                )}
              </h1>
              {focusStale ? (
                <p className={cn(mutedClass, focusSummaryParagraphClass)}>
                  Last updated {formatRelative(data.focusSummary?.generatedAt ?? data.focusSummary?.createdAt)} — a
                  refresh is due on the next Skippy run.
                </p>
              ) : null}
              {visibleBullets.length ? (
                <ul className={focusSummaryListClass}>
                  {visibleBullets.map((item) => (
                    <li key={item.key}>
                      <span>
                        <InlineMarkdown>{item.text}</InlineMarkdown>
                      </span>
                      <span className={focusItemActionsClass}>
                        <IconButton
                          small
                          title="Dismiss from focus"
                          aria-label={`Dismiss ${item.text}`}
                          disabled={busyKey === item.key}
                          onClick={() => void recordAction(item, "dismissed")}
                        >
                          <X size={15} aria-hidden />
                        </IconButton>
                        <button
                          className={cn(textButtonClass, textButtonCompactClass)}
                          type="button"
                          title="Turn into task"
                          disabled={busyKey === item.key}
                          onClick={() => void promote(item)}
                        >
                          Task
                        </button>
                        <IconButton
                          small
                          title="Already done"
                          aria-label={`Mark ${item.text} already done`}
                          disabled={busyKey === item.key}
                          onClick={() => void recordAction(item, "done")}
                        >
                          <Check size={15} aria-hidden />
                        </IconButton>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={cn(mutedClass, focusSummaryParagraphClass)}>New source items and remaining focus bullets appear here when they need attention.</p>
              )}
            </div>
          </section>

          {/* Right rail */}
          <div className="grid content-start gap-4">
            <QuickCaptureBox captures={data?.quickCaptures} />

            {/* Calendar events, due tasks, and firing recurrences merged into
                one list — the answer to "what does my day look like". */}
            <AgendaSection />

            <Section title="Needs your review">
              {unclear === 0 && pending === 0 ? (
                <p className={mutedClass} style={{ margin: 0, fontSize: 14 }}>
                  Inbox zero — nothing waiting for a decision.
                </p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {unclear > 0 ? (
                    <Link
                      className={cn(itemClass, projectRowClass)}
                      href="/review?filter=finds"
                      style={{ gridTemplateColumns: "auto 1fr auto" }}
                    >
                      <span className={itemIconClass}>
                        <Inbox size={17} aria-hidden />
                      </span>
                      <div>
                        <p className={itemTitleClass}>{unclear} unclear signal{unclear === 1 ? "" : "s"}</p>
                        <p className={itemMetaClass}>Need a rubric decision.</p>
                      </div>
                      <Badge tone="gold">Review</Badge>
                    </Link>
                  ) : null}
                  {pending > 0 ? (
                    <Link
                      className={cn(itemClass, projectRowClass)}
                      href="/review?filter=approvals"
                      style={{ gridTemplateColumns: "auto 1fr auto" }}
                    >
                      <span className={itemIconClass}>
                        <ShieldCheck size={17} aria-hidden />
                      </span>
                      <div>
                        <p className={itemTitleClass}>{pending} pending action{pending === 1 ? "" : "s"}</p>
                        <p className={itemMetaClass}>External effects awaiting approval.</p>
                      </div>
                      <Badge tone="red">Approve</Badge>
                    </Link>
                  ) : null}
                </div>
              )}
            </Section>

          </div>
        </div>
      )}
    </LiveGate>
  );
}
