import { AppShell, PageHeader } from "../ui";
import { isLiveConfigured } from "../../lib/skippy-api";
import { LiveSettingsContent } from "../live-pages";

const settings = [
  ["Assistant name", "Skippy"],
  ["LLM provider", "none"],
  ["Link enrichment", "off"],
  ["Notifications", "off"],
  ["MCP tokens", "managed here"],
];

export default function SettingsPage() {
  if (isLiveConfigured()) {
    return (
      <AppShell>
        <PageHeader eyebrow="Settings" title="Brain configuration and access." />
        <LiveSettingsContent />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader eyebrow="Settings" title="Brain configuration and access." />
      <section className="card section">
        {settings.map(([label, value]) => (
          <div className="settings-row" key={label}>
            <div>
              <h3>{label}</h3>
              <p className="muted">{value}</p>
            </div>
            <span className="badge">Configured</span>
          </div>
        ))}
      </section>
    </AppShell>
  );
}
