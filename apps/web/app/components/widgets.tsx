"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import styles from "./widgets.module.css";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

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
    <div className={styles.tabs} role="tablist">
      {items.map((item) => (
        <button
          key={item.key}
          role="tab"
          aria-selected={active === item.key}
          className={cx(styles.tab, active === item.key && styles.active)}
          onClick={() => onChange(item.key)}
          type="button"
        >
          {item.label}
          {typeof item.count === "number" ? <span className={styles.tabCount}>{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

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
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className={styles.scrim} onClick={onClose} aria-hidden />
      <aside className={styles.drawer} role="dialog" aria-modal="true">
        <div className={styles.drawerHead}>
          <div>
            {eyebrow ? <p className={styles.drawerEyebrow}>{eyebrow}</p> : null}
            <h2>{title}</h2>
          </div>
          <button className={styles.chip} onClick={onClose} type="button" aria-label="Close" style={{ minHeight: 32 }}>
            <X size={15} aria-hidden /> Close
          </button>
        </div>
        <div className={styles.drawerBody}>{children}</div>
        {footer ? <div className={styles.drawerFoot}>{footer}</div> : null}
      </aside>
    </>
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
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.dialogScrim} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className={styles.dialogHead}>
          <h2>{title}</h2>
          <button className={styles.chip} onClick={onClose} type="button" aria-label="Close" style={{ minHeight: 32 }}>
            <X size={15} aria-hidden />
          </button>
        </div>
        <div className={styles.dialogBody}>{children}</div>
      </div>
    </div>
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
      {type ? <span className={styles.chipType}>{type}</span> : null}
      <span className={styles.chipLabel}>{label}</span>
    </>
  );
  if (href) {
    return (
      <Link className={styles.chip} href={href} title={title}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button className={styles.chip} onClick={onClick} type="button" title={title}>
        {inner}
      </button>
    );
  }
  return (
    <span className={styles.chip} title={title}>
      {inner}
    </span>
  );
}

export function ChipGroup({ children }: { children: ReactNode }) {
  return <div className={styles.chipGroup}>{children}</div>;
}

/* ---------------- Toast ---------------- */
type ToastTone = "info" | "success" | "error";
type ToastEntry = { id: number; tone: ToastTone; message: string };

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

let toastSeq = 0;

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
        <div className={styles.toastWrap}>
          {toasts.map((toast) => (
            <div key={toast.id} className={cx(styles.toast, styles[toast.tone])}>
              <span className={styles.toastIcon}>
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
