import type { Metadata } from "next";
import {
  LEGAL_CONTACT_EMAIL,
  LegalCallout,
  LegalList,
  LegalPage,
  LegalSection,
  LegalText,
} from "../components/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Skippy handles personal data, including data from Google APIs.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      lede="Skippy is a private, single-owner personal assistant. This policy explains what it stores, where that data lives, and who can reach it."
    >
      <LegalSection heading="Who operates Skippy">
        <LegalText>
          Skippy (&ldquo;Skippy&rdquo;, &ldquo;we&rdquo;, &ldquo;the service&rdquo;) is operated by
          Jeff Schram as a personal, non-commercial project at{" "}
          <a className="text-blue" href="https://skippy.jeffschram.com">
            skippy.jeffschram.com
          </a>
          . Questions about this policy can be sent to{" "}
          <a className="text-blue" href={`mailto:${LEGAL_CONTACT_EMAIL}`}>
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </LegalText>
        <LegalText>
          Skippy is not a multi-tenant product and is not offered to the public. It serves a single
          owner account. If you are reading this without having been given access, none of your
          data is in the system.
        </LegalText>
      </LegalSection>

      <LegalSection heading="Data Skippy handles">
        <LegalText>
          Skippy is a &ldquo;second brain&rdquo;: it reads the owner&rsquo;s own accounts and turns
          them into tasks, notes, and an agenda. The categories it handles are:
        </LegalText>
        <LegalList>
          <li>
            <strong>Google account data.</strong> Gmail messages (read-only) and Google Calendar
            events (read, plus creating new events at the owner&rsquo;s direction).
          </li>
          <li>
            <strong>Content the owner enters.</strong> Tasks, projects, goals, notes, decisions,
            contacts, and saved links.
          </li>
          <li>
            <strong>Financial data.</strong> Account balances and transactions, retrieved through
            Plaid when the owner connects an institution.
          </li>
          <li>
            <strong>Local message and reminder data.</strong> Read on the owner&rsquo;s own Mac from
            local databases, never from a third-party server.
          </li>
          <li>
            <strong>Authentication and operational records.</strong> Sign-in identifiers and logs of
            what the system synced and when.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="Google user data: scopes and use">
        <LegalText>
          Skippy requests the narrowest scopes that make its features work:
        </LegalText>
        <LegalList>
          <li>
            <code>gmail.readonly</code> &mdash; to detect deadlines, commitments, and bills in the
            owner&rsquo;s mail and surface them as tasks. Skippy cannot send, modify, or delete
            email.
          </li>
          <li>
            <code>calendar.events</code> &mdash; to mirror upcoming events into the agenda, warn
            about double-bookings before scheduling, and add events the owner asks for. The
            calendar connector implements only &ldquo;list&rdquo; and &ldquo;insert&rdquo;; it has
            no update, patch, or delete code path.
          </li>
        </LegalList>
        <LegalText>
          Google data is used <strong>only</strong> to provide these owner-facing features. It is
          never used for advertising, never sold, never shared with data brokers, and never used to
          train generalized AI or machine-learning models.
        </LegalText>
        <LegalCallout>
          Skippy&rsquo;s use and transfer to any other app of information received from Google APIs
          will adhere to the{" "}
          <a
            className="underline"
            href="https://developers.google.com/terms/api-services-user-data-policy"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </LegalCallout>
      </LegalSection>

      <LegalSection heading="Where data is stored, and how credentials are protected">
        <LegalText>
          Google OAuth tokens are stored <strong>only on the owner&rsquo;s own computer</strong>, in
          files readable solely by the owner&rsquo;s account. They are never written to the cloud
          database, never committed to source control, and never logged. A compromise of the hosted
          application therefore does not expose access to the owner&rsquo;s Google account.
        </LegalText>
        <LegalText>
          Derived content &mdash; the tasks, notes, and calendar entries Skippy creates &mdash; is
          stored in a hosted Convex database in the United States and transmitted over TLS. Where
          Skippy records why an item exists, it keeps a short excerpt and a link back to the
          original message rather than a copy of the full body.
        </LegalText>
      </LegalSection>

      <LegalSection heading="Service providers">
        <LegalText>
          Skippy relies on a small number of processors, each handling data only to run the service:
        </LegalText>
        <LegalList>
          <li>
            <strong>Convex</strong> &mdash; application database and backend.
          </li>
          <li>
            <strong>Vercel</strong> &mdash; web hosting.
          </li>
          <li>
            <strong>Clerk</strong> &mdash; owner authentication.
          </li>
          <li>
            <strong>Anthropic and OpenAI</strong> &mdash; language-model processing for
            summarization and question answering. Content derived from Gmail and Calendar may be
            sent to these providers to generate summaries for the owner. Under their API terms this
            content is not used to train their models.
          </li>
          <li>
            <strong>Plaid</strong> &mdash; connecting financial institutions, when used.
          </li>
        </LegalList>
        <LegalText>
          Skippy does not sell personal data, does not serve advertising, and does not disclose data
          to anyone else except where required by law.
        </LegalText>
      </LegalSection>

      <LegalSection heading="Retention, revocation, and deletion">
        <LegalText>
          Data is retained until the owner deletes it or asks for the system to be torn down. Access
          can be withdrawn at any time:
        </LegalText>
        <LegalList>
          <li>
            Revoke Skippy&rsquo;s access to Google data at{" "}
            <a className="text-blue" href="https://myaccount.google.com/permissions">
              myaccount.google.com/permissions
            </a>
            . Revocation takes effect immediately and stops all further syncing.
          </li>
          <li>
            Stored Google-derived content can be deleted from within the application, or in bulk on
            request to{" "}
            <a className="text-blue" href={`mailto:${LEGAL_CONTACT_EMAIL}`}>
              {LEGAL_CONTACT_EMAIL}
            </a>
            .
          </li>
          <li>Locally stored OAuth tokens are removed by deleting the connector config directory.</li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="Children&rsquo;s privacy">
        <LegalText>
          Skippy is a private tool for a single adult owner and is not directed to children. It does
          not knowingly collect data from anyone under 13.
        </LegalText>
      </LegalSection>

      <LegalSection heading="Changes to this policy">
        <LegalText>
          If this policy changes, the &ldquo;last updated&rdquo; date above will change with it.
          Material changes to how Google user data is handled will be reflected here before taking
          effect.
        </LegalText>
      </LegalSection>
    </LegalPage>
  );
}
