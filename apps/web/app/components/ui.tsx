import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button as ShadButton } from "./ui/button";
import { Badge as ShadBadge } from "./ui/badge";
import { Card as ShadCard } from "./ui/card";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Progress } from "./ui/progress";

/* ---------------- Button ---------------- */
type ButtonVariant = "default" | "primary" | "danger" | "ghost";

const buttonVariantMap = {
  default: "outline",
  primary: "default",
  danger: "destructive",
  ghost: "ghost",
} as const;

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
    <ShadButton
      variant={buttonVariantMap[variant]}
      size={small ? "sm" : "default"}
      className={cn("font-bold", block && "w-full", className)}
      {...rest}
    >
      {children}
    </ShadButton>
  );
}

export function IconButton({
  small,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { small?: boolean }) {
  return (
    <ShadButton
      variant="outline"
      size="icon"
      className={cn(small && "h-8 w-8", className)}
      {...rest}
    >
      {children}
    </ShadButton>
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
    <ShadCard
      className={cn(
        pad && "p-5",
        interactive &&
          "cursor-pointer text-left transition-[border-color,box-shadow,transform] hover:border-primary hover:shadow-md focus-visible:border-primary focus-visible:outline-none active:translate-y-px",
        className,
      )}
      {...rest}
    >
      {children}
    </ShadCard>
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
        <div className="mb-3.5 flex items-center justify-between gap-3.5">
          <h2 className="m-0 text-[19px]">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </Card>
  );
}

/* ---------------- Badge ---------------- */
export type BadgeTone = "neutral" | "blue" | "green" | "gold" | "red";

const badgeToneClasses: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  blue: "bg-blue/10 text-blue border-blue/30",
  green: "bg-green/20 text-[#2f7d4a] border-green/50",
  gold: "bg-gold/10 text-gold border-gold/30",
  red: "bg-red/10 text-red border-red/30",
};

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
  return (
    <ShadBadge
      variant="outline"
      className={cn(
        "min-h-6 gap-1.5 whitespace-nowrap rounded-full px-2.5 font-bold",
        badgeToneClasses[tone],
        className,
      )}
    >
      {dot ? <span className="size-[7px] rounded-full bg-current" aria-hidden /> : null}
      {children}
    </ShadBadge>
  );
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
    <div className="grid justify-items-center gap-2.5 px-5 py-10 text-center text-muted-foreground">
      {icon ? (
        <span className="grid size-[46px] place-items-center rounded-xl bg-accent text-primary">{icon}</span>
      ) : null}
      <p className="m-0 text-base font-bold text-foreground">{title}</p>
      {children ? <p className="m-0 max-w-[420px] text-sm">{children}</p> : null}
      {action}
    </div>
  );
}

/* ---------------- Spinner / Loading ---------------- */
export function Spinner() {
  return <Loader2 className="inline-block size-[18px] animate-spin text-primary" aria-hidden />;
}

export function LoadingRow({ label = "Loading…" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-sm text-muted-foreground">
      <Spinner /> {label}
    </span>
  );
}

/* ---------------- ProgressBar ---------------- */
export function ProgressBar({ value, tone }: { value: number; tone?: "blue" | "green" }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <Progress
      value={pct}
      className={cn("h-2", tone === "green" && "[&>div]:bg-[#4a9a68]")}
    />
  );
}

/* ---------------- ActivityBar ---------------- */
/** Skinny indeterminate progress bar — shows that background work (brief generation, agent execution) is running. */
export function ActivityBar({ label = "Working…", className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn("h-1 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-label={label}
    >
      <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/70" />
    </div>
  );
}

/* ---------------- Fields ---------------- */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <Label asChild>
        <span className="text-[13px] font-bold text-muted-foreground">{label}</span>
      </Label>
      {children}
    </label>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <Input className={cn("min-h-10 bg-secondary", className)} {...rest} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <Textarea className={cn("min-h-[110px] resize-y bg-secondary leading-[1.45]", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "w-full min-h-10 rounded-md border border-input bg-secondary px-2.5 text-sm shadow-sm transition-colors focus-visible:border-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...rest}
    >
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
    <label className={cn("inline-flex min-h-10 cursor-pointer items-center gap-2 font-bold text-foreground", className)}>
      <input type="checkbox" className="size-4 accent-primary" {...rest} />
      {label}
    </label>
  );
}

/* ---------------- Layout helpers ---------------- */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

export function Stack({ children, className, gap }: { children: ReactNode; className?: string; gap?: number }) {
  return (
    <div className={cn("grid gap-2.5", className)} style={gap != null ? { gap } : undefined}>
      {children}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <p className="m-0 text-[13px] font-bold text-destructive">{children}</p>;
}
