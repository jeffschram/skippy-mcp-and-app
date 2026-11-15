import { expect, it, vi } from "vitest";
vi.mock("./agentWorkbench", () => ({
  requireHost: async () => ({ _id: "host", brainInstanceId: "brain", capabilities: { harnesses: ["claude", "codex"] } }),
}));
import { claimNextAgentPass } from "./agentConfigs";

it("ignores a persisted due Agenda schedule without changing its audit history", async () => {
  const patch = vi.fn();
  const chain: any = {
    withIndex: () => chain,
    collect: async () => [{ _id: "old-agenda", roleKey: "agenda", enabled: true,
      nextDueAt: 1, schedule: { kind: "interval", everyMinutes: 60 }, claimVersion: 3 }],
  };
  const result = await (claimNextAgentPass as any)._handler({
    db: { query: () => chain, patch },
  }, { hostToken: "host" });
  expect(result).toBeNull();
  expect(patch).not.toHaveBeenCalled();
});
