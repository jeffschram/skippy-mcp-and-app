import Link from "next/link";
import {
  Archive,
  Bell,
  BookOpen,
  Brain,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  CircleCheck,
  Clock3,
  Contact,
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
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <nav className="nav" aria-label="Primary">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <item.icon size={16} aria-hidden />
                {item.label}
              </Link>
            ))}
          </nav>
          {isLiveConfigured() ? (
            <AuthStatus />
          ) : (
            <span className="badge">Static preview</span>
          )}
        </div>
      </header>
      <main className="page">{children}</main>
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
    <div className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
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
  Check,
  ChevronRight,
  CircleCheck,
  Clock3,
  LinkIcon,
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
