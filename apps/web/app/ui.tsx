import Link from "next/link";
import {
  Archive,
  Bell,
  Brain,
  BriefcaseBusiness,
  Check,
  CircleCheck,
  Clock3,
  Contact,
  Home,
  Inbox,
  LinkIcon,
  MessageSquareText,
  Settings,
  ShieldCheck,
  Shuffle,
  UserRound,
  X,
} from "lucide-react";
import { isLiveConfigured } from "../lib/skippy-api";
import { AuthStatus } from "./live-auth";

export const navItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/projects", label: "Projects", icon: BriefcaseBusiness },
  { href: "/contacts", label: "Contacts", icon: Contact },
  { href: "/triage", label: "Triage", icon: Inbox },
  { href: "/pending-actions", label: "Actions", icon: ShieldCheck },
  { href: "/settings", label: "Settings", icon: Settings },
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
  Check,
  CircleCheck,
  Clock3,
  LinkIcon,
  MessageSquareText,
  Shuffle,
  UserRound,
  X,
};
