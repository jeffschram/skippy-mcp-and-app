import Link from "next/link";
import {
  Archive,
  Bell,
  BookOpen,
  Brain,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronRight,
  CircleCheck,
  Clock3,
  Contact,
  MapPin,
  Home,
  Inbox,
  Info,
  LinkIcon,
  ListTodo,
  Map,
  MessageSquareText,
  Play,
  RefreshCw,
  Settings,
  ShieldCheck,
  Shuffle,
  Star,
  Target,
  UserRound,
  X,
} from "lucide-react";
import { isLiveConfigured } from "../lib/skippy-api";
import { AuthStatus } from "./live-auth";
import { badgeClass, eyebrowClass, pageHeaderClass } from "./page-classes";

const appShellClass = "min-h-screen";
const topbarClass = "sticky top-0 z-10 border-b bg-background backdrop-blur-2xl";
const topbarInnerClass =
  "mx-auto grid w-[min(1180px,calc(100%-32px))] items-center justify-between gap-[18px] py-3 wide:flex wide:min-h-[68px] wide:py-0";
const navClass = "flex flex-wrap items-center gap-1 min-w-0 wide:flex-nowrap wide:overflow-x-auto";
const navLinkClass =
  "inline-flex items-center gap-[7px] min-h-[38px] px-2.5 rounded-lg text-muted-foreground text-sm whitespace-nowrap hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none";
const pageClass =
  "mx-auto w-[min(100%-24px,720px)] pb-14 pt-[22px] wide:w-[min(1180px,calc(100%-32px))] wide:pt-[30px]";

export const navItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/projects", label: "Projects", icon: BriefcaseBusiness },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/interviews", label: "Interviews", icon: MessageSquareText },
  { href: "/contacts", label: "Contacts", icon: Contact },
  { href: "/memory-inbox", label: "Inbox", icon: Brain },
  { href: "/memory", label: "Memory", icon: BookOpen },
  { href: "/context-map", label: "Map", icon: Map },
  { href: "/triage", label: "Review", icon: Inbox },
  { href: "/resurfacing", label: "Routines", icon: RefreshCw },
  { href: "/pending-actions", label: "Actions", icon: ShieldCheck },
  { href: "/ingestion-logs", label: "Logs", icon: Archive },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/about", label: "About", icon: Info },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={appShellClass}>
      <header className={topbarClass}>
        <div className={topbarInnerClass}>
          <nav className={navClass} aria-label="Primary">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className={navLinkClass}>
                <item.icon size={16} aria-hidden />
                {item.label}
              </Link>
            ))}
          </nav>
          {isLiveConfigured() ? (
            <AuthStatus />
          ) : (
            <span className={badgeClass}>Static preview</span>
          )}
        </div>
      </header>
      <main className={pageClass}>{children}</main>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={pageHeaderClass}>
      <div>
        <p className={eyebrowClass}>{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {action}
    </div>
  );
}

export const icons = {
  Archive,
  Bell,
  BookOpen,
  Brain,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronRight,
  CircleCheck,
  Clock3,
  LinkIcon,
  MapPin,
  MessageSquareText,
  Map,
  Play,
  RefreshCw,
  Shuffle,
  Star,
  Target,
  UserRound,
  X,
};
