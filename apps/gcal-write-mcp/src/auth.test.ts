import { describe, expect, it, vi } from "vitest";

import { CALENDAR_WRITE_SCOPE, type StoredToken } from "./config.js";
import {
  buildAuthUrl,
  createTokenSource,
  mergeTokenResponse,
  pkcePair,
  statesMatch,
} from "./auth.js";

describe("pkcePair", () => {
  it("derives a url-safe S256 challenge from the verifier", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).not.toBe(verifier);
  });

  it("is fresh per call", () => {
    expect(pkcePair().verifier).not.toBe(pkcePair().verifier);
  });
});

describe("statesMatch", () => {
  it("accepts only the exact state", () => {
    expect(statesMatch("abc123", "abc123")).toBe(true);
    expect(statesMatch("abc123", "abc124")).toBe(false);
    expect(statesMatch("abc123", "abc")).toBe(false);
    expect(statesMatch("abc123", null)).toBe(false);
  });
});

describe("buildAuthUrl", () => {
  it("requests exactly one scope, offline access, and PKCE", () => {
    const url = new URL(
      buildAuthUrl({
        clientId: "cid",
        redirectUri: "http://127.0.0.1:5321",
        challenge: "chal",
        state: "st",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    // The blast radius of this connector is this one string.
    expect(url.searchParams.get("scope")).toBe(CALENDAR_WRITE_SCOPE);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:5321");
  });
});

describe("mergeTokenResponse", () => {
  const previous: StoredToken = { refreshToken: "old-refresh" };

  it("carries the refresh token forward when Google omits it", () => {
    // Refresh responses have no refresh_token; dropping it would break the
    // next unattended run with no visible cause.
    const merged = mergeTokenResponse(previous, { access_token: "a", expires_in: 3600 }, 1000);
    expect(merged.refreshToken).toBe("old-refresh");
    expect(merged.expiresAt).toBe(1000 + 3_600_000);
  });

  it("prefers a newly issued refresh token", () => {
    const merged = mergeTokenResponse(previous, { access_token: "a", refresh_token: "new" }, 0);
    expect(merged.refreshToken).toBe("new");
  });

  it("rejects a response with no access token", () => {
    expect(() => mergeTokenResponse(previous, { expires_in: 3600 }, 0)).toThrow(/no access_token/);
  });

  it("refuses when there is no refresh token from either side", () => {
    expect(() => mergeTokenResponse(null, { access_token: "a" }, 0)).toThrow(/--authorize/);
  });
});

function stubStore(initial: StoredToken) {
  let current = initial;
  return {
    saved: [] as StoredToken[],
    store: {
      load: async () => current,
      save: async (token: StoredToken) => {
        current = token;
      },
    },
  };
}

describe("createTokenSource", () => {
  const credentials = async () => ({ clientId: "cid", clientSecret: "secret" });

  it("reuses a still-valid access token without a network call", async () => {
    const fetchImpl = vi.fn();
    const { store } = stubStore({ refreshToken: "r", accessToken: "live", expiresAt: 10_000_000 });
    const source = createTokenSource({
      credentials,
      store,
      fetchImpl: fetchImpl as never,
      now: () => 1_000,
    });
    expect(await source.getAccessToken()).toBe("live");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes an expired token and persists the result", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: "fresh", expires_in: 3600 }),
    }));
    const { store } = stubStore({ refreshToken: "r", accessToken: "stale", expiresAt: 0 });
    const source = createTokenSource({
      credentials,
      store,
      fetchImpl: fetchImpl as never,
      now: () => 1_000,
    });
    expect(await source.getAccessToken()).toBe("fresh");
    expect((await store.load()).accessToken).toBe("fresh");
  });

  it("collapses concurrent refreshes into one round trip", async () => {
    // Two tool calls landing together must not each burn a refresh; Google
    // rate-limits them.
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: "fresh", expires_in: 3600 }),
    }));
    const { store } = stubStore({ refreshToken: "r" });
    const source = createTokenSource({
      credentials,
      store,
      fetchImpl: fetchImpl as never,
      now: () => 0,
    });
    await Promise.all([source.getAccessToken(), source.getAccessToken()]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never leaks the response body into the error", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: "invalid_grant", client_id: "cid.apps" }),
    }));
    const { store } = stubStore({ refreshToken: "r" });
    const source = createTokenSource({
      credentials,
      store,
      fetchImpl: fetchImpl as never,
      now: () => 0,
    });
    await expect(source.getAccessToken()).rejects.toThrow(/HTTP 400.*--authorize/);
    await expect(source.getAccessToken()).rejects.not.toThrow(/cid\.apps/);
  });
});
