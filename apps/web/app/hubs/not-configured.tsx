import { Card } from "../components";
import { codeClass, mutedClass } from "../page-classes";

export function NotConfigured() {
  return (
    <Card>
      <h2>Connect Skippy</h2>
      <p className={`${mutedClass} max-w-[560px]`}>
        This is a static preview. Set <span className={codeClass}>NEXT_PUBLIC_CONVEX_URL</span> and{" "}
        <span className={codeClass}>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</span> to load your live second brain.
      </p>
    </Card>
  );
}
