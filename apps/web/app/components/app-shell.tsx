"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import {
  Brain,
  CalendarDays,
  FolderKanban,
  House,
  Inbox,
  ScrollText,
  Settings,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "../../lib/skippy-api";
import { AuthStatus } from "../live-auth";
import { ToastProvider } from "./widgets";
import { ViewerContextTracker } from "./viewer-context-tracker";
import { ChatPanel } from "./chat-panel";

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
  { href: "/", label: "Home", icon: House, match: (p) => p === "/" },
  // Second slot deliberately: checking the day is the most frequent reason to
  // open the app. The mobile nav scrolls and the desktop nav is a vertical
  // sidebar, so a fifth primary hub costs no layout.
  //
  // The route stays /tasks on purpose. "Actions taken" deep-links use
  // /tasks#task-<id>, and a server-side redirect would drop the hash — it is
  // never sent to the server — silently breaking every one of those links.
  {
    href: "/tasks",
    label: "Agenda",
    icon: CalendarDays,
    match: (p) => p.startsWith("/tasks"),
  },
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

const navLinkClass =
  "flex min-h-[42px] items-center gap-[11px] overflow-hidden rounded-[10px] px-3 text-[15px] font-bold text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none";
const navLinkActiveClass = "bg-secondary text-foreground shadow-sm [&_svg]:text-primary";
const navSubLinkClass =
  "block truncate rounded-lg px-2.5 py-[7px] text-[13px] font-semibold leading-tight text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none";
const mobileLinkClass =
  "inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-[11px] text-sm font-bold text-muted-foreground hover:text-foreground";

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
            <div className="group grid gap-[3px]" key={hub.href}>
              <Link
                href={hub.href}
                className={cn(navLinkClass, active && navLinkActiveClass)}
                aria-current={active ? "page" : undefined}
                title={hub.label}
              >
                <hub.icon className="shrink-0" size={18} aria-hidden />
                <span className="whitespace-nowrap hidden transition-opacity group-hover/sidebar:block">{hub.label}</span>
              </Link>
              <div
                className={cn(
                  "hidden gap-0.5 pb-2 pl-8 pt-0.5 group-focus-within:grid group-hover/sidebar:grid",
                  projectSubmenuOpen && "group-hover/sidebar:grid",
                )}
                aria-label="Active projects"
              >
                {projects.map((project) => (
                  <Link
                    key={project._id}
                    href={`/projects/${project._id}`}
                    className={cn(
                      navSubLinkClass,
                      pathname === `/projects/${project._id}` && "bg-secondary text-foreground",
                    )}
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
            className={cn(
              mobile ? mobileLinkClass : navLinkClass,
              active && (mobile ? "bg-secondary text-foreground" : navLinkActiveClass),
            )}
            aria-current={active ? "page" : undefined}
            title={hub.label}
          >
            <hub.icon className="shrink-0" size={mobile ? 15 : 18} aria-hidden />
            {mobile ? hub.label : <span className="whitespace-nowrap hidden transition-opacity group-hover/sidebar:block">{hub.label}</span>}
          </Link>
        );
      })}
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const projectDetail = /^\/projects\/[^/]+/.test(pathname);
  const { isAuthenticated } = useConvexAuth();
  const activeProjects = useQuery(api.projects.activeProjectsForViewer, isAuthenticated ? {} : "skip") as
    | NavProject[]
    | undefined;

  return (
    <ToastProvider>
      <ViewerContextTracker />
      <div className="grid min-h-screen grid-cols-1 desk:grid-cols-[64px_minmax(0,1fr)]">
        <aside className="group/sidebar sticky top-0 z-40 hidden h-screen w-16 flex-col gap-1.5 self-start overflow-hidden border-r bg-card px-2.5 py-[18px] shadow-none transition-[width,box-shadow] duration-200 hover:w-[248px] hover:shadow-xl focus-within:w-[248px] desk:flex">
          <div className="flex items-center gap-2.5 px-1 pb-3.5 pt-1.5 text-lg font-extrabold">
            <span className="grid size-[34px] place-items-center rounded-[9px] border bg-secondary text-primary shadow-sm">
              <Brain size={19} aria-hidden />
            </span>
            <span className="whitespace-nowrap hidden transition-opacity group-hover/sidebar:block">Skippy</span>
          </div>
          <nav className="grid gap-[3px]" aria-label="Primary">
            <NavLinks pathname={pathname} hubs={primaryHubs} projects={activeProjects ?? []} alwaysShowProjects />
          </nav>
          <div className="mt-auto grid gap-2.5">
            <nav className="grid gap-[3px]" aria-label="Secondary">
              <NavLinks pathname={pathname} hubs={secondaryHubs} />
            </nav>
            <div className="grid gap-1.5 overflow-hidden border-t pt-3 hidden transition-opacity group-hover/sidebar:block">
              <div className="w-[220px]"><AuthStatus /></div>
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-20 grid items-center gap-2.5 border-b bg-background/90 px-4 py-2.5 backdrop-blur-lg desk:hidden">
            <AuthStatus />
            <nav className="flex flex-1 gap-1 overflow-x-auto" aria-label="Primary">
              <NavLinks pathname={pathname} hubs={hubs} mobile />
            </nav>
          </header>
          <main className={cn("w-full", projectDetail ? "p-0" : "mx-auto px-[30px] pb-16 pt-[22px] desk:pt-[30px]")}>{children}</main>
        </div>
      </div>
      <ChatPanel />
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
    <div className="mb-[22px] grid items-end justify-between gap-5 wide:flex">
      <div>
        {eyebrow ? <p className="m-0 mb-[5px] text-[13px] font-bold uppercase text-green">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="mt-2 max-w-[640px] text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
