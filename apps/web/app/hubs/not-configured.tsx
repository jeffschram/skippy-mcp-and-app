import { Card } from "../components";

export function NotConfigured() {
  return (
    <Card>
      <h2>Connect Skippy</h2>
      <p className="muted" style={{ maxWidth: 560 }}>
        This is a static preview. Set <span className="code">NEXT_PUBLIC_CONVEX_URL</span> and{" "}
        <span className="code">NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</span> to load your live second brain.
      </p>
    </Card>
  );
}
