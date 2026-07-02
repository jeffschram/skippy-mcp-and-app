import { describe, expect, it } from "vitest";
import {
  UNREAD_LINK_FOCUS_MAX_AGE_DAYS,
  UNREAD_LINK_FOCUS_MAX_AGE_MS,
  isLinkFocusCandidate,
  linkAgeDays,
} from "./index";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-07-02T12:00:00Z");

describe("link focus auto-aging", () => {
  it("defaults the unread cutoff to 21 days", () => {
    expect(UNREAD_LINK_FOCUS_MAX_AGE_DAYS).toBe(21);
    expect(UNREAD_LINK_FOCUS_MAX_AGE_MS).toBe(21 * DAY_MS);
  });

  it("keeps fresh unread links as focus candidates", () => {
    expect(isLinkFocusCandidate({ status: "unread", createdAt: NOW - 2 * DAY_MS }, NOW)).toBe(true);
    expect(isLinkFocusCandidate({ status: "unread", createdAt: NOW - 20 * DAY_MS }, NOW)).toBe(true);
  });

  it("ages unread links out of focus once they pass the cutoff", () => {
    expect(isLinkFocusCandidate({ status: "unread", createdAt: NOW - 21 * DAY_MS }, NOW)).toBe(false);
    expect(isLinkFocusCandidate({ status: "unread", createdAt: NOW - 90 * DAY_MS }, NOW)).toBe(false);
  });

  it("keeps unread links just inside the cutoff", () => {
    expect(isLinkFocusCandidate({ status: "unread", createdAt: NOW - 21 * DAY_MS + 1 }, NOW)).toBe(true);
  });

  it("never ages out read or saved links", () => {
    expect(isLinkFocusCandidate({ status: "read", createdAt: NOW - 400 * DAY_MS }, NOW)).toBe(true);
    expect(isLinkFocusCandidate({ status: "saved", createdAt: NOW - 400 * DAY_MS }, NOW)).toBe(true);
  });

  it("always excludes discarded links", () => {
    expect(isLinkFocusCandidate({ status: "discarded", createdAt: NOW }, NOW)).toBe(false);
    expect(isLinkFocusCandidate({ status: "discarded" }, NOW)).toBe(false);
  });

  it("keeps unread links without a createdAt timestamp", () => {
    expect(isLinkFocusCandidate({ status: "unread" }, NOW)).toBe(true);
  });

  it("supports a custom cutoff", () => {
    const link = { status: "unread", createdAt: NOW - 5 * DAY_MS };
    expect(isLinkFocusCandidate(link, NOW, 4 * DAY_MS)).toBe(false);
    expect(isLinkFocusCandidate(link, NOW, 6 * DAY_MS)).toBe(true);
  });

  it("computes whole-day link ages for context hints", () => {
    expect(linkAgeDays({ createdAt: NOW }, NOW)).toBe(0);
    expect(linkAgeDays({ createdAt: NOW - 3 * DAY_MS - 5000 }, NOW)).toBe(3);
    expect(linkAgeDays({}, NOW)).toBeUndefined();
  });
});
