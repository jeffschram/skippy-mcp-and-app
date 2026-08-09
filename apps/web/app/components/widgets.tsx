"use client";

import Link from "next/link";
import { createContext, useContext, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "./ui/sheet";
import {
  Dialog as ShadDialog,
  DialogContent,
  DialogTitle,
} from "./ui/dialog";

/* ---------------- Tabs ---------------- */
export type TabItem = { key: string; label: ReactNode; count?: number };

export function Tabs({
  items,
  active,
  onChange,
}: {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-[11px] border bg-card p-1" role="tablist">
      {items.map((item) => (
        <button
          key={item.key}
          role="tab"
          aria-selected={active === item.key}
          className={cn(
            "inline-flex min-h-9 cursor-pointer items-center gap-[7px] whitespace-nowrap rounded-lg border-0 bg-transparent px-[13px] text-sm font-bold text-muted-foreground hover:text-foreground",
            active === item.key && "bg-secondary text-foreground shadow-sm",
          )}
          onClick={() => onChange(item.key)}
          type="button"
        >
          {item.label}
          {typeof item.count === "number" ? (
            <span
              className={cn(
                "inline-grid h-5 min-w-5 place-items-center rounded-full bg-muted px-[5px] text-[11px] font-extrabold text-muted-foreground",
                active === item.key && "bg-primary text-primary-foreground",
              )}
            >
              {item.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Chip (shared styling) ---------------- */
const chipClass =
  "inline-flex max-w-full min-h-[26px] cursor-pointer items-center gap-1.5 rounded-lg border bg-secondary px-[9px] text-[12.5px] font-semibold text-foreground no-underline hover:border-primary [&_svg]:shrink-0 [&_svg]:text-primary";

/* ---------------- Drawer ---------------- */
export function Drawer({
  open,
  onClose,
  eyebrow,
  title,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: ReactNode;
  title: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent
        side="right"
        className="flex w-full max-w-full flex-col gap-0 border-l bg-background p-0 sm:max-w-[560px] [&>button]:hidden"
        aria-describedby={undefined}
      >
        <div className="flex items-start justify-between gap-3.5 border-b px-5 py-[18px]">
          <div>
            {eyebrow ? (
              <SheetDescription className="m-0 mb-1 text-xs font-bold uppercase tracking-wide text-green">
                {eyebrow}
              </SheetDescription>
            ) : null}
            <SheetTitle asChild>
              <h2 className="m-0 text-xl">{title}</h2>
            </SheetTitle>
          </div>
          <button className={cn(chipClass, "min-h-8")} onClick={onClose} type="button" aria-label="Close">
            <X size={15} aria-hidden /> Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer ? <div className="flex gap-2 border-t px-5 py-3.5">{footer}</div> : null}
      </SheetContent>
    </Sheet>
  );
}

/* ---------------- Dialog (centered modal) ---------------- */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <ShadDialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        className="max-h-[calc(100dvh-40px)] w-full max-w-[520px] gap-0 overflow-y-auto rounded-[14px] bg-background p-0 [&>button]:hidden"
        aria-describedby={undefined}
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-[18px]">
          <DialogTitle asChild>
            <h2 className="m-0 text-xl">{title}</h2>
          </DialogTitle>
          <button className={cn(chipClass, "min-h-8")} onClick={onClose} type="button" aria-label="Close">
            <X size={15} aria-hidden />
          </button>
        </div>
        <div className="px-5 pb-5 pt-4">{children}</div>
      </DialogContent>
    </ShadDialog>
  );
}

/* ---------------- Chips ---------------- */
export function Chip({
  icon,
  label,
  type,
  href,
  onClick,
  title,
}: {
  icon?: ReactNode;
  label: ReactNode;
  type?: string;
  href?: string;
  onClick?: () => void;
  title?: string;
}) {
  const inner = (
    <>
      {icon}
      {type ? <span className="text-[11px] font-bold uppercase text-muted-foreground">{type}</span> : null}
      <span className="truncate">{label}</span>
    </>
  );
  if (href) {
    return (
      <Link className={chipClass} href={href} title={title}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button className={chipClass} onClick={onClick} type="button" title={title}>
        {inner}
      </button>
    );
  }
  return (
    <span className={cn(chipClass, "cursor-default")} title={title}>
      {inner}
    </span>
  );
}

export function ChipGroup({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

/* ---------------- Toast ---------------- */
type ToastTone = "info" | "success" | "error";
type ToastEntry = { id: number; tone: ToastTone; message: string };

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

let toastSeq = 0;

const toastToneBorder: Record<ToastTone, string> = {
  info: "",
  success: "border-green",
  error: "border-red/50",
};

const toastToneIcon: Record<ToastTone, string> = {
  info: "text-primary",
  success: "text-[#2f7d4a]",
  error: "text-destructive",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const push = (message: string, tone: ToastTone = "info") => {
    toastSeq += 1;
    const id = toastSeq;
    // Newest first: the wrap is anchored to the top of the screen, so the
    // first item in the stack is the most visible.
    setToasts((current) => [{ id, tone, message }, ...current]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  };

  return (
    <ToastContext.Provider value={push}>
      {children}
      {toasts.length > 0 ? (
        <div className="fixed right-[18px] top-[68px] z-[60] grid max-w-[min(380px,calc(100%-36px))] gap-2 desk:top-[18px]">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={cn(
                "flex items-start gap-2.5 rounded-[10px] border bg-secondary px-3.5 py-3 text-sm shadow-md",
                toastToneBorder[toast.tone],
              )}
            >
              <span className={cn("mt-px shrink-0", toastToneIcon[toast.tone])}>
                {toast.tone === "success" ? (
                  <CheckCircle2 size={17} aria-hidden />
                ) : toast.tone === "error" ? (
                  <AlertTriangle size={17} aria-hidden />
                ) : (
                  <Info size={17} aria-hidden />
                )}
              </span>
              <span>{toast.message}</span>
            </div>
          ))}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}
