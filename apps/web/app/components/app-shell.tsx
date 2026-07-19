"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import {
  Brain,
  CalendarCheck,
  FolderKanban,
  Inbox,
  ScrollText,
  Settings,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { api } from "../../lib/skippy-api";
import { AuthStatus } from "../live-auth";
import { ToastProvider } from "./widgets";
import { ViewerContextTracker } from "./viewer-context-tracker";
import styles from "./app-shell.module.css";

type NavProject = {
  _id: string;
  title: string;
  status?: string;
};

type Hub = {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (path: string) => boolean;
};

export const primaryHubs: Hub[] = [
  { href: "/", label: "Today", icon: CalendarCheck, match: (p) => p === "/" },
  {
    href: "/finances",
    label: "Finances",
    icon: Wallet,
    match: (p) => p.startsWith("/finances"),
  },
  {
    href: "/review",
    label: "Review",
    icon: Inbox,
    match: (p) => p.startsWith("/review"),
  },
  {
    href: "/projects",
    label: "Projects",
    icon: FolderKanban,
    match: (p) => p.startsWith("/projects"),
  },
];

export const secondaryHubs: Hub[] = [
  {
    href: "/brain",
    label: "Brain",
    icon: Brain,
    match: (p) => p.startsWith("/brain"),
  },
  {
    href: "/skills",
    label: "Skills",
    icon: ScrollText,
    match: (p) => p.startsWith("/skills"),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    match: (p) => p.startsWith("/settings"),
  },
];

export const hubs = [...primaryHubs, ...secondaryHubs];

function NavLinks({
  pathname,
  projects = [],
  hubs,
  mobile,
  alwaysShowProjects,
}: {
  pathname: string;
  projects?: NavProject[];
  hubs: Hub[];
  mobile?: boolean;
  alwaysShowProjects?: boolean;
}) {
  return (
    <>
      {hubs.map((hub) => {
        const active = hub.match(pathname);
        const showProjectSubmenu = !mobile && hub.href === "/projects" && projects.length > 0;
        const projectSubmenuOpen = showProjectSubmenu && (alwaysShowProjects || active);
        if (showProjectSubmenu) {
          return (
            <div className={`${styles.navItem} ${projectSubmenuOpen ? styles.navItemOpen : ""}`} key={hub.href}>
              <Link
                href={hub.href}
                className={`${styles.navLink} ${active ? styles.active : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <hub.icon size={18} aria-hidden />
                {hub.label}
              </Link>
              <div className={styles.navSubmenu} aria-label="Active projects">
                {projects.map((project) => (
                  <Link
                    key={project._id}
                    href={`/projects/${project._id}`}
                    className={`${styles.navSubLink} ${pathname === `/projects/${project._id}` ? styles.activeSubLink : ""}`}
                  >
                    {project.title}
                  </Link>
                ))}
              </div>
            </div>
          );
        }
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
  const { isAuthenticated } = useConvexAuth();
  const activeProjects = useQuery(api.projects.activeProjectsForViewer, isAuthenticated ? {} : "skip") as
    | NavProject[]
    | undefined;

  return (
    <ToastProvider>
      <ViewerContextTracker />
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <div className={styles.brand}>
            <span className={styles.brandMark}>
              <Brain size={19} aria-hidden />
            </span>
            Skippy
          </div>
          <nav className={styles.nav} aria-label="Primary">
            <NavLinks pathname={pathname} hubs={primaryHubs} projects={activeProjects ?? []} alwaysShowProjects />
          </nav>
          <div className={styles.sidebarBottom}>
            <nav className={styles.nav} aria-label="Secondary">
              <NavLinks pathname={pathname} hubs={secondaryHubs} />
            </nav>
            <div className={styles.sidebarFoot}>
              <AuthStatus />
            </div>
          </div>
        </aside>

        <div className={styles.content}>
          <header className={styles.mobileBar}>
            <AuthStatus />
            <nav className={styles.mobileNav} aria-label="Primary">
              <NavLinks pathname={pathname} hubs={hubs} mobile />
            </nav>
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
        {description ? (
          <p className="muted" style={{ marginTop: 8, maxWidth: 640 }}>
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
