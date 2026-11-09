import type { Metadata } from "next";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_GOVERNING_LAW,
  LegalCallout,
  LegalList,
  LegalPage,
  LegalSection,
  LegalText,
} from "../components/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern use of Skippy.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      lede="Skippy is a private personal project, offered with no warranty and no uptime promise. These terms govern its use."
    >
      <LegalSection heading="Acceptance">
        <LegalText>
          By accessing Skippy at{" "}
          <a className="text-blue" href="https://skippy.jeffschram.com">
            skippy.jeffschram.com
          </a>{" "}
          you agree to these Terms of Service and to the{" "}
          <a className="text-blue" href="/privacy">
            Privacy Policy
          </a>
          . If you do not agree, do not use the service.
        </LegalText>
      </LegalSection>

      <LegalSection heading="What Skippy is">
        <LegalText>
          Skippy is a personal &ldquo;second brain&rdquo; operated by Jeff Schram for his own use. It
          reads the owner&rsquo;s connected accounts and organizes them into tasks, notes, and an
          agenda.
        </LegalText>
        <LegalText>
          It is <strong>not</strong> a commercial product. There is no paid plan, no public sign-up,
          and no service-level commitment. Access is limited to the owner and anyone the owner
          explicitly authorizes, and may be withdrawn at any time without notice.
        </LegalText>
      </LegalSection>

      <LegalSection heading="Automated and AI-generated output">
        <LegalText>
          Skippy uses language models to summarize, prioritize, and answer questions about the
          owner&rsquo;s data. This output is probabilistic. It can be incomplete, out of date, or
          simply wrong &mdash; it may miss a deadline that exists, or assert one that does not.
        </LegalText>
        <LegalCallout>
          Nothing Skippy produces is professional advice. Do not rely on it for financial, legal,
          medical, tax, or employment decisions. Always confirm anything that matters against the
          original source.
        </LegalCallout>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <LegalText>When using Skippy, you agree not to:</LegalText>
        <LegalList>
          <li>Access it, or any account or data within it, without authorization.</li>
          <li>
            Attempt to defeat its authentication, rate limits, token scoping, or other security
            controls.
          </li>
          <li>Use it to break the law or to infringe anyone&rsquo;s rights.</li>
          <li>
            Interfere with its operation, including probing, scraping, or overloading the service or
            its infrastructure.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="Connected third-party services">
        <LegalText>
          Skippy connects to services including Google, Plaid, Convex, Clerk, Vercel, Anthropic, and
          OpenAI. Use of those services remains subject to their own terms, and their availability is
          outside the owner&rsquo;s control. Skippy is not responsible for a third party changing,
          degrading, or discontinuing its service &mdash; including revoking API access, which may
          stop features from working without warning.
        </LegalText>
      </LegalSection>

      <LegalSection heading="Intellectual property">
        <LegalText>
          The Skippy source code, design, and documentation remain the property of their author. Data
          the owner puts into Skippy, and data retrieved from the owner&rsquo;s connected accounts,
          remains the owner&rsquo;s.
        </LegalText>
      </LegalSection>

      <LegalSection heading="No warranty">
        <LegalText>
          Skippy is provided <strong>&ldquo;as is&rdquo; and &ldquo;as available&rdquo;</strong>,
          without warranty of any kind, express or implied, including any implied warranties of
          merchantability, fitness for a particular purpose, and non-infringement. There is no
          guarantee that the service will be available, accurate, uninterrupted, secure, or free of
          errors, or that data will not be lost.
        </LegalText>
      </LegalSection>

      <LegalSection heading="Limitation of liability">
        <LegalText>
          To the maximum extent permitted by law, the operator of Skippy will not be liable for any
          indirect, incidental, special, consequential, exemplary, or punitive damages, nor for lost
          profits, lost revenue, lost data, or missed obligations, arising from use of or inability
          to use the service. Because Skippy is provided free of charge, total aggregate liability
          for any claim relating to the service is limited to zero United States dollars.
        </LegalText>
        <LegalText>
          Some jurisdictions do not allow certain limitations of liability or exclusions of implied
          warranties. Where that is the case, the limitations above apply only to the extent
          permitted.
        </LegalText>
      </LegalSection>

      <LegalSection heading="Suspension and termination">
        <LegalText>
          Access may be suspended or terminated at any time, for any reason, with or without notice.
          The service itself may be discontinued entirely. The sections on intellectual property, no
          warranty, and limitation of liability survive termination.
        </LegalText>
      </LegalSection>

      <LegalSection heading="Governing law">
        <LegalText>
          These terms are governed by the laws of {LEGAL_GOVERNING_LAW}, without regard to its
          conflict-of-law rules.
        </LegalText>
      </LegalSection>

      <LegalSection heading="Changes to these terms">
        <LegalText>
          These terms may be updated; the &ldquo;last updated&rdquo; date above will change when they
          are. Continuing to use Skippy after a change means accepting the revised terms. Questions
          can go to{" "}
          <a className="text-blue" href={`mailto:${LEGAL_CONTACT_EMAIL}`}>
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </LegalText>
      </LegalSection>
    </LegalPage>
  );
}
