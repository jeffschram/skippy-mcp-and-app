import { AppShell, PageHeader, icons } from "../ui";
import { companies, people } from "../sample-data";
import { isLiveConfigured } from "../../lib/skippy-api";
import { LiveContactsContent } from "../live-pages";

export default function ContactsPage() {
  if (isLiveConfigured()) {
    return (
      <AppShell>
        <PageHeader eyebrow="Contacts" title="People and companies in the graph." />
        <LiveContactsContent />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader eyebrow="Contacts" title="People and companies in the graph." />
      <div className="split-list">
        <section>
          <h2>People</h2>
          <div className="item-list">
            {people.map((person) => (
              <article className="item" key={person.name}>
                <span className="item-icon">
                  <icons.UserRound size={17} aria-hidden />
                </span>
                <div>
                  <p className="item-title">{person.name}</p>
                  <p className="item-meta">{person.context}</p>
                </div>
                <span className="badge">{person.badge}</span>
              </article>
            ))}
          </div>
        </section>
        <section>
          <h2>Companies</h2>
          <div className="item-list">
            {companies.map((company) => (
              <article className="item" key={company.name}>
                <span className="item-icon">
                  <icons.LinkIcon size={17} aria-hidden />
                </span>
                <div>
                  <p className="item-title">{company.name}</p>
                  <p className="item-meta">{company.context}</p>
                </div>
                <span className="badge blue">{company.badge}</span>
              </article>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
