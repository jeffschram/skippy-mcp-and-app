import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import styles from "./ui.module.css";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ---------------- Button ---------------- */
type ButtonVariant = "default" | "primary" | "danger" | "ghost";

export function Button({
  variant = "default",
  small,
  block,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  small?: boolean;
  block?: boolean;
}) {
  return (
    <button
      className={cx(
        styles.button,
        variant === "primary" && styles.primary,
        variant === "danger" && styles.danger,
        variant === "ghost" && styles.ghost,
        small && styles.small,
        block && styles.block,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconButton({
  small,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { small?: boolean }) {
  return (
    <button className={cx(styles.iconButton, small && styles.small, className)} {...rest}>
      {children}
    </button>
  );
}

/* ---------------- Card / Section ---------------- */
export function Card({
  pad = true,
  interactive,
  className,
  children,
  ...rest
}: {
  pad?: boolean;
  interactive?: boolean;
  className?: string | undefined;
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(styles.card, pad && styles.cardPad, interactive && styles.cardInteractive, className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Section({
  title,
  action,
  children,
  className,
  pad,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
  pad?: boolean;
}) {
  return (
    <Card pad={pad ?? true} className={className}>
      {title ? (
        <div className={styles.sectionTitle}>
          <h2>{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </Card>
  );
}

/* ---------------- Badge ---------------- */
export type BadgeTone = "neutral" | "blue" | "green" | "gold" | "red";

export function Badge({
  tone = "neutral",
  dot,
  className,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return <span className={cx(styles.badge, styles[tone], dot && styles.dot, className)}>{children}</span>;
}

/* ---------------- EmptyState ---------------- */
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      {icon ? <span className={styles.emptyIcon}>{icon}</span> : null}
      <p className={styles.emptyTitle}>{title}</p>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

/* ---------------- Spinner / Loading ---------------- */
export function Spinner() {
  return <span className={styles.spinner} aria-hidden />;
}

export function LoadingRow({ label = "Loading…" }: { label?: string }) {
  return (
    <span className={styles.loadingRow}>
      <Spinner /> {label}
    </span>
  );
}

/* ---------------- ProgressBar ---------------- */
export function ProgressBar({ value, tone }: { value: number; tone?: "blue" | "green" }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={styles.progress} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx(styles.progressFill, tone === "green" && styles.green)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ---------------- ActivityBar ---------------- */
/** Skinny indeterminate progress bar — shows that background work (brief generation, agent execution) is running. */
export function ActivityBar({ label = "Working…", className }: { label?: string; className?: string }) {
  return <div className={cx(styles.activity, className)} role="progressbar" aria-label={label} />;
}

/* ---------------- Fields ---------------- */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(styles.input, className)} {...rest} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(styles.textarea, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(styles.select, className)} {...rest}>
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cx(styles.checkbox, className)}>
      <input type="checkbox" {...rest} />
      {label}
    </label>
  );
}

/* ---------------- Layout helpers ---------------- */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(styles.toolbar, className)}>{children}</div>;
}

export function Stack({ children, className, gap }: { children: ReactNode; className?: string; gap?: number }) {
  return (
    <div className={cx(styles.stack, className)} style={gap != null ? { gap } : undefined}>
      {children}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <p className={styles.errorText}>{children}</p>;
}
