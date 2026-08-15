"use client";

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api } from "../../lib/skippy-api";
import { Button, IconButton, Card, LoadingRow, Spinner, useToast } from "../components";
import { cn } from "@/lib/utils";
import { useViewerReady } from "./use-viewer";
import { textButtonClass, textButtonCompactClass } from "../page-classes";
import {
  PROJECT_FILE_ACCEPT,
  checkProjectFile,
  formatFileSize,
  formatUploadDate,
  iconKindForMimeType,
} from "./project-library-helpers";

/* ------------------------------------------------------------------ */
/* Project Library: cloud file storage per project (and per task).     */
/* Upload flow: generateUploadUrl mutation → POST bytes → register.    */
/* The reactive listFilesForViewer query picks up new rows on its own. */
/* ------------------------------------------------------------------ */

type LibraryFile = {
  _id: string;
  projectId: string;
  taskId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: "user" | "harness";
  note?: string;
  createdAt: number;
  /** Time-limited download URL resolved at read time — never persisted. */
  url: string | null;
};

function FileTypeIcon({ mimeType, size = 18 }: { mimeType: string; size?: number }) {
  const kind = iconKindForMimeType(mimeType);
  if (kind === "image") return <ImageIcon size={size} aria-hidden />;
  if (kind === "spreadsheet") return <FileSpreadsheet size={size} aria-hidden />;
  if (kind === "text") return <FileText size={size} aria-hidden />;
  return <FileIcon size={size} aria-hidden />;
}

/* ---------------- Upload machinery ---------------- */

type UploadEntry = {
  id: number;
  fileName: string;
  status: "uploading" | "done" | "failed";
  reason?: string;
};

let uploadSeq = 0;

/**
 * Shared uploader: client pre-check with the shared validation, then
 * generateUploadUrl → POST bytes (Content-Type = file type) → register row.
 * Works project-scoped or task-scoped (taskId set at hook time, or per
 * call via uploadFiles' override — used when the task is created in the
 * same gesture, e.g. proposal attachments).
 */
export function useProjectFileUploader(projectId: string, taskId?: string) {
  const generateUploadUrl = useMutation(api.projectFiles.generateUploadUrlForViewer);
  const registerFile = useMutation(api.projectFiles.registerFileForViewer);
  const toast = useToast();
  const [entries, setEntries] = useState<UploadEntry[]>([]);

  const patchEntry = (id: number, patch: Partial<UploadEntry>) =>
    setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  const removeEntry = (id: number) => setEntries((current) => current.filter((entry) => entry.id !== id));

  const uploadFiles = async (files: File[], overrideTaskId?: string) => {
    const targetTaskId = overrideTaskId ?? taskId;
    let done = 0;
    let failed = 0;
    for (const file of files) {
      uploadSeq += 1;
      const id = uploadSeq;
      const check = checkProjectFile({ fileName: file.name, mimeType: file.type, sizeBytes: file.size });
      if (!check.ok) {
        setEntries((current) => [
          ...current,
          { id, fileName: file.name || "unnamed file", status: "failed", reason: check.reason },
        ]);
        failed += 1;
        continue;
      }
      setEntries((current) => [...current, { id, fileName: check.fileName, status: "uploading" }]);
      try {
        const uploadUrl = (await generateUploadUrl({})) as string;
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": check.mimeType },
          body: file,
        });
        if (!response.ok) throw new Error(`upload failed (HTTP ${response.status})`);
        const { storageId } = (await response.json()) as { storageId: string };
        await registerFile({
          projectId: projectId as any,
          ...(targetTaskId ? { taskId: targetTaskId as any } : {}),
          storageId: storageId as any,
          fileName: check.fileName,
          mimeType: check.mimeType,
          sizeBytes: check.sizeBytes,
        });
        patchEntry(id, { status: "done" });
        done += 1;
        // The reactive file list shows the registered row; clear the transient status.
        window.setTimeout(() => removeEntry(id), 2500);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "upload failed";
        patchEntry(id, { status: "failed", reason });
        failed += 1;
        toast(`Could not upload ${check.fileName}: ${reason}`, "error");
      }
    }
    return { done, failed };
  };

  return { entries, uploadFiles, removeEntry };
}

function UploadStatusList({
  entries,
  onDismiss,
}: {
  entries: UploadEntry[];
  onDismiss: (id: number) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="flex items-center gap-2 text-[13px] text-muted-foreground data-[status=failed]:text-red"
          data-status={entry.status}
        >
          {entry.status === "uploading" ? (
            <Spinner />
          ) : entry.status === "done" ? (
            <CheckCircle2 size={15} aria-hidden />
          ) : (
            <AlertTriangle size={15} aria-hidden />
          )}
          <span className="font-bold [overflow-wrap:anywhere]">{entry.fileName}</span>
          <span className="[overflow-wrap:anywhere]">
            {entry.status === "uploading" ? "Uploading…" : entry.status === "done" ? "Uploaded" : entry.reason}
          </span>
          {entry.status === "failed" ? (
            <IconButton small aria-label={`Dismiss ${entry.fileName}`} onClick={() => onDismiss(entry.id)}>
              <X size={13} aria-hidden />
            </IconButton>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * Drag-and-drop zone that is also a tap/click target for the file picker
 * (mobile photo picker/camera works via the accept allowlist). The compact
 * variant renders as an 'Attach file' text button for the task sidepanel.
 */
function UploadZone({ onFiles, compact }: { onFiles: (files: File[]) => void; compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const openPicker = () => inputRef.current?.click();
  const takeFiles = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length) onFiles(files);
  };
  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    takeFiles(event.dataTransfer?.files ?? null);
  };
  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    setDragOver(true);
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept={PROJECT_FILE_ACCEPT}
      style={{ display: "none" }}
      onChange={(event) => {
        takeFiles(event.target.files);
        event.target.value = "";
      }}
    />
  );

  if (compact) {
    return (
      <span onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={() => setDragOver(false)}>
        <button type="button" className={cn(textButtonClass, textButtonCompactClass)} onClick={openPicker}>
          <Paperclip size={14} aria-hidden /> Attach file
        </button>
        {input}
      </span>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Add files to the project library"
      className={cn(
        "flex cursor-pointer flex-wrap items-center justify-center gap-2.5 rounded-[10px] border-[1.5px] border-dashed border-border bg-card px-3.5 py-[18px] text-center text-sm text-muted-foreground transition-colors hover:border-primary focus-visible:border-primary focus-visible:outline-none",
        dragOver && "border-primary bg-[light-dark(#eef6ff,#18293a)]",
      )}
      onClick={openPicker}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPicker();
        }
      }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
    >
      <span className="inline-flex items-center gap-2">
        <Upload size={16} aria-hidden /> Drag &amp; drop files here, or
      </span>
      <Button
        small
        onClick={(event) => {
          event.stopPropagation();
          openPicker();
        }}
      >
        Add files
      </Button>
      {input}
    </div>
  );
}

/* ---------------- File rows ---------------- */

function FileRow({ file, compact }: { file: LibraryFile; compact?: boolean }) {
  const deleteFile = useMutation(api.projectFiles.deleteFileForViewer);
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Two-click delete: the 'Confirm?' state resets on its own after a moment.
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 3500);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteFile({ fileId: file._id as any });
      toast(`Deleted ${file.fileName}.`, "info");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not delete file", "error");
      setDeleting(false);
      setConfirming(false);
    }
  };

  const isImage = iconKindForMimeType(file.mimeType) === "image";
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-[10px] border border-border bg-secondary px-2.5 py-2">
      {isImage && file.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- ephemeral storage URL, not optimizable
        <img
          className={cn("shrink-0 rounded-lg border border-border object-cover", compact ? "h-8 w-8" : "h-11 w-11")}
          src={file.url}
          alt={file.fileName}
          loading="lazy"
        />
      ) : (
        <span
          className={cn(
            "grid shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground",
            compact ? "h-8 w-8" : "h-11 w-11",
          )}
        >
          <FileTypeIcon mimeType={file.mimeType} size={compact ? 15 : 18} />
        </span>
      )}
      <div className="grid min-w-0 flex-[1_1_160px] gap-0.5">
        {file.url ? (
          <a
            className="text-sm font-bold text-inherit no-underline [overflow-wrap:anywhere] hover:text-primary hover:underline focus-visible:text-primary focus-visible:underline"
            href={file.url}
            target="_blank"
            rel="noreferrer"
            title="Download"
          >
            {file.fileName}
          </a>
        ) : (
          <span className="text-sm font-bold text-inherit [overflow-wrap:anywhere]">{file.fileName}</span>
        )}
        <span className="text-[12.5px] text-muted-foreground">
          {formatFileSize(file.sizeBytes)} · {formatUploadDate(file.createdAt)}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        {confirming ? (
          <button
            type="button"
            className="cursor-pointer rounded-lg border border-red bg-transparent px-2.5 py-1 text-[13px] font-bold text-red disabled:cursor-default disabled:opacity-60"
            disabled={deleting}
            onClick={() => void remove()}
          >
            {deleting ? "Deleting…" : "Confirm?"}
          </button>
        ) : (
          <IconButton small aria-label={`Delete ${file.fileName}`} title="Delete" onClick={() => setConfirming(true)}>
            <Trash2 size={14} aria-hidden />
          </IconButton>
        )}
      </div>
    </div>
  );
}

/* ---------------- Project-level library section ---------------- */

export function ProjectLibrarySection({
  projectId,
  alwaysOpen = false,
}: {
  projectId: string;
  alwaysOpen?: boolean;
}) {
  const viewerReady = useViewerReady();
  const files = useQuery(
    api.projectFiles.listFilesForViewer,
    viewerReady ? { projectId: projectId as any } : "skip",
  ) as LibraryFile[] | undefined;
  const { entries, uploadFiles, removeEntry } = useProjectFileUploader(projectId);
  const [openState, setOpenState] = useState(false);
  const open = alwaysOpen || openState;

  return (
    <Card pad={false} className="mt-4">
      {!alwaysOpen ? (
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-4 py-3.5 text-left text-[15px] font-bold text-inherit focus-visible:rounded-xl focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-primary"
          aria-expanded={open}
          onClick={() => setOpenState((current) => !current)}
        >
          {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
          <span>Library</span>
          {files !== undefined ? (
            <span className="inline-grid h-[22px] min-w-[22px] place-items-center rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
              {files.length}
            </span>
          ) : null}
        </button>
      ) : null}
      {open ? (
        <div className="grid gap-3 px-4 pb-4">
          <UploadZone onFiles={(dropped) => void uploadFiles(dropped)} />
          <UploadStatusList entries={entries} onDismiss={removeEntry} />
          {files === undefined ? (
            <LoadingRow label="Loading files…" />
          ) : files.length === 0 ? (
            entries.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">
                Upload project files from any device — agents read these when working on tasks.
              </p>
            ) : null
          ) : (
            <div className="grid gap-2">
              {files.map((file) => (
                <FileRow key={file._id} file={file} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}

/* ---------------- Task attachments (sidepanel) ---------------- */

export function TaskAttachments({ projectId, taskId }: { projectId: string; taskId: string }) {
  const viewerReady = useViewerReady();
  const files = useQuery(
    api.projectFiles.listFilesForViewer,
    viewerReady ? { projectId: projectId as any, taskId: taskId as any } : "skip",
  ) as LibraryFile[] | undefined;
  const { entries, uploadFiles, removeEntry } = useProjectFileUploader(projectId, taskId);

  return (
    <section>
      <h3 style={{ marginBottom: 8 }}>Attachments</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {files?.length ? (
          <div className="grid gap-2">
            {files.map((file) => (
              <FileRow key={file._id} file={file} compact />
            ))}
          </div>
        ) : null}
        <UploadStatusList entries={entries} onDismiss={removeEntry} />
        <UploadZone compact onFiles={(dropped) => void uploadFiles(dropped)} />
      </div>
    </section>
  );
}
