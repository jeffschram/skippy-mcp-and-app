"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain, CalendarCheck, FolderKanban, Inbox, Settings, type LucideIcon } from "lucide-react";
import { AuthStatus } from "../live-auth";
import { ToastProvider } from "./widgets";
import styles from "./app-shell.module.css";

export const hubs: Array<{ href: string; label: string; icon: LucideIcon; match: (path: string) => boolean }> = [
  { href: "/", label: "Today", icon: CalendarCheck, match: (p) => p === "/" },
  { href: "/projects", label: "Projects", icon: FolderKanban, match: (p) => p.startsWith("/projects") },
  { href: "/brain", label: "Brain", icon: Brain, match: (p) => p.startsWith("/brain") },
  { href: "/review", label: "Review", icon: Inbox, match: (p) => p.startsWith("/review") },
  { href: "/settings", label: "Settings", icon: Settings, match: (p) => p.startsWith("/settings") },
];

function NavLinks({ pathname, mobile }: { pathname: string; mobile?: boolean }) {
  return (
    <>
      {hubs.map((hub) => {
        const active = hub.match(pathname);
        return (
          <Link
            key={hub.href}
            href={hub.href}
            className={`${mobile ? "" : styles.navLink} ${active ? styles.active : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <hub.icon size={mobile ? 15 : 18} aria-hidden />
            {hub.label}
          </Link>
        );
      })}
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";

  return (
    <ToastProvider>
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <div className={styles.brand}>
            <span className={styles.brandMark}>
              <Brain size={19} aria-hidden />
            </span>
            Skippy
          </div>
          <nav className={styles.nav} aria-label="Primary">
            <NavLinks pathname={pathname} />
          </nav>
          <div className={styles.spacer} />
          <div className={styles.sidebarFoot}>
            <AuthStatus />
          </div>
        </aside>

        <div className={styles.content}>
          <header className={styles.mobileBar}>
            <nav className={styles.mobileNav} aria-label="Primary">
              <NavLinks pathname={pathname} mobile />
            </nav>
            <AuthStatus />
          </header>
          <main className={styles.page}>{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="muted" style={{ marginTop: 8, maxWidth: 640 }}>{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
