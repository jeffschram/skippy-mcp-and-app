import { afterEach, describe, expect, it, vi } from "vitest";
import { canCloseCompletedCard, startCardCloseCountdown } from "./card-close";
afterEach(() => vi.useRealTimers());
describe("completed card closing", () => {
  const reply = { role: "assistant", status: "complete" };
  it("requires confirmed done status and the final successful reply", () => {
    expect(canCloseCompletedCard("done", [reply], false)).toBe(true);
    for (const status of [undefined, "todo", "cancelled", "archived"]) expect(canCloseCompletedCard(status, [reply], false)).toBe(false);
    expect(canCloseCompletedCard("done", [reply], true)).toBe(false);
    expect(canCloseCompletedCard("done", [reply, {role: "user", status: "complete"}], false)).toBe(false);
    for (const status of ["pending", "error"]) expect(canCloseCompletedCard("done", [{role: "assistant", status}], false)).toBe(false);
  });
  it("allows five full seconds to read the reply and closes once", () => {
    vi.useFakeTimers(); const close = vi.fn(); const tick = vi.fn();
    startCardCloseCountdown(tick, close);
    expect(tick).toHaveBeenLastCalledWith(5);
    vi.advanceTimersByTime(4999); expect(close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(close).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10000); expect(close).toHaveBeenCalledTimes(1);
  });
  it("cancels pending closure when kept open, typing starts, or the card unmounts", () => {
    vi.useFakeTimers(); const close = vi.fn();
    const cancel = startCardCloseCountdown(() => {}, close);
    vi.advanceTimersByTime(2000); cancel(); vi.advanceTimersByTime(10000);
    expect(close).not.toHaveBeenCalled();
  });
});
