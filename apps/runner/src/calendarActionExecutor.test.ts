import { describe, expect, it, vi } from "vitest";
import { executeCalendarAction, runCalendarActionOnce, toCreateEventInput } from "./calendarActionExecutor.js";
import type { ClaimedCalendarAction } from "./controlPlane.js";

const START = 1_756_000_000_000;

const action: ClaimedCalendarAction = {
  pendingActionId: "pa1",
  claimToken: "claim1",
  externalId: "n7ovditi010opehrc0s9gsrdtk",
  calendarId: "primary",
  summary: "Lunch with Helen",
  start: START,
  end: START + 3_600_000,
  isAllDay: false,
};

const tokens = { getAccessToken: async () => "ya29.fake" };

describe("toCreateEventInput", () => {
  it("passes the minted id through as eventId", () => {
    expect(toCreateEventInput(action).eventId).toBe(action.externalId);
  });
});

describe("executeCalendarAction", () => {
  it("blocks even a previously claimed write without touching credentials or Google", async () => {
    const getAccessToken = vi.fn();
    const fetchImpl = vi.fn();
    const result = await executeCalendarAction(action, { tokens: { getAccessToken }, fetchImpl });
    expect(result).toMatchObject({ outcome: "failed", error: expect.stringContaining("read-only") });
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("runCalendarActionOnce", () => {
  it("does nothing when no action is claimable", async () => {
    const plane = {
      claimNextCalendarAction: vi.fn().mockResolvedValue(null),
      recordCalendarActionResult: vi.fn(),
    };
    expect(await runCalendarActionOnce(plane, { tokens })).toBe(false);
    expect(plane.recordCalendarActionResult).not.toHaveBeenCalled();
  });

  it("reports the outcome back with the claim token that authorized it", async () => {
    const plane = {
      claimNextCalendarAction: vi.fn().mockResolvedValue(action),
      recordCalendarActionResult: vi.fn().mockResolvedValue({ status: "completed" }),
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: action.externalId }), { status: 200 }),
    );
    expect(await runCalendarActionOnce(plane, { tokens, fetchImpl: fetchImpl as never })).toBe(true);
    expect(plane.recordCalendarActionResult).toHaveBeenCalledWith(
      "pa1",
      "claim1",
      expect.objectContaining({ outcome: "failed" }),
    );
  });

  it("still returns true when reporting fails, so the lease can expire and retry", async () => {
    const plane = {
      claimNextCalendarAction: vi.fn().mockResolvedValue(action),
      recordCalendarActionResult: vi.fn().mockRejectedValue(new Error("convex down")),
    };
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await runCalendarActionOnce(plane, { tokens, fetchImpl: fetchImpl as never })).toBe(true);
  });
});
