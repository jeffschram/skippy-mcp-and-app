/**
 * Shell and prose primitives for the public legal pages (/privacy, /tos).
 *
 * Why these bypass AppShell (2026-11): Google's OAuth verification reviewer
 * fetches the privacy policy and terms URLs anonymously, before any consent is
 * granted. AppShell pulls in Clerk + Convex and falls back to <NotConfigured />
 * when `isLiveConfigured()` is false, so a reviewer — or anyone hitting the
 * marketing domain without env vars — could have been served a sign-in wall or
 * an empty state instead of the policy. These pages are therefore pure server
 * components with no auth, no Convex, and no env dependency: they must render
 * from a cold static build, always.
 *
 * Keep them that way. Adding a hook or a `useQuery` here reintroduces the
 * failure mode that blocks OAuth verification.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { cardClass, eyebrowClass, mutedClass } from "../page-classes";

/**
 * Owner contact for privacy and terms enquiries.
 *
 * Google requires a reachable address on the consent screen; a bouncing inbox
 * is a verification rejection, so this is kept as a single constant rather than
 * inlined into both documents.
 */
export const LEGAL_CONTACT_EMAIL = "schramindustries@gmail.com";

/** The jurisdiction whose law governs the terms. */
export const LEGAL_GOVERNING_LAW = "the State of Connecticut, United States";

export const LEGAL_LAST_UPDATED = "November 9, 2026";

export function LegalPage({
  title,
  lede,
  children,
}: Readonly<{ title: string; lede: string; children: ReactNode }>) {
  return (
    <main className="mx-auto grid max-w-[760px] gap-5 px-5 py-10">
      <header>
        <p className={eyebrowClass}>Skippy</p>
        <h1 className="m-0 text-[30px] leading-tight">{title}</h1>
        <p className={`m-0 mt-2.5 ${mutedClass}`}>{lede}</p>
        <p className={`m-0 mt-1.5 text-[13px] ${mutedClass}`}>
          Last updated: {LEGAL_LAST_UPDATED}
        </p>
      </header>

      <div className={`${cardClass} grid gap-6 p-6`}>{children}</div>

      <footer className={`flex flex-wrap gap-4 text-[13px] ${mutedClass}`}>
        <Link href="/privacy" className="text-blue">
          Privacy Policy
        </Link>
        <Link href="/tos" className="text-blue">
          Terms of Service
        </Link>
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="text-blue">
          {LEGAL_CONTACT_EMAIL}
        </a>
      </footer>
    </main>
  );
}

export function LegalSection({
  heading,
  children,
}: Readonly<{ heading: string; children: ReactNode }>) {
  return (
    <section className="grid gap-2.5">
      <h2 className="m-0 text-[19px]">{heading}</h2>
      {children}
    </section>
  );
}

/** Body copy. `[overflow-wrap:anywhere]` keeps long URLs from forcing a scroll. */
export function LegalText({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="m-0 leading-relaxed [overflow-wrap:anywhere]">{children}</p>;
}

export function LegalList({ children }: Readonly<{ children: ReactNode }>) {
  return <ul className="m-0 grid list-disc gap-1.5 pl-5 leading-relaxed">{children}</ul>;
}

/**
 * Callout for the disclosures a reader must not skim past — the Google Limited
 * Use statement and the "this is not advice" warning.
 */
export function LegalCallout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <p className="m-0 rounded-lg border border-gold/40 bg-gold/10 px-3.5 py-3 leading-relaxed text-gold">
      {children}
    </p>
  );
}
