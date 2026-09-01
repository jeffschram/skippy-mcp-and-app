import { describe, expect, it } from "vitest";

import {
  configDir,
  credentialsPath,
  isAccessTokenUsable,
  parseClientCredentials,
  parseStoredToken,
  serializeStoredToken,
  tokenPath,
  TOKEN_REFRESH_SKEW_MS,
} from "./config.js";

describe("paths", () => {
  it("defaults under ~/.config and honours an override", () => {
    expect(configDir("/Users/skippy")).toBe("/Users/skippy/.config/gcal-write-mcp");
    expect(configDir("/Users/skippy", "/tmp/cfg")).toBe("/tmp/cfg");
    expect(configDir("/Users/skippy", "   ")).toBe("/Users/skippy/.config/gcal-write-mcp");
    expect(credentialsPath("/c")).toBe("/c/credentials.json");
    expect(tokenPath("/c")).toBe("/c/token.json");
  });
});

describe("parseClientCredentials", () => {
  it("reads a desktop-app client JSON", () => {
    expect(
      parseClientCredentials({ installed: { client_id: "id", client_secret: "secret" } }),
    ).toEqual({ clientId: "id", clientSecret: "secret" });
  });

  it("reads a web client JSON and a flat object", () => {
    expect(parseClientCredentials({ web: { client_id: "i", client_secret: "s" } }).clientId).toBe(
      "i",
    );
    expect(parseClientCredentials({ client_id: "i", client_secret: "s" }).clientSecret).toBe("s");
  });

  it("names the missing field", () => {
    expect(() => parseClientCredentials({ installed: { client_id: "id" } })).toThrow(
      /missing client_secret/,
    );
    expect(() => parseClientCredentials("nope")).toThrow(/not a JSON object/);
  });
});

describe("parseStoredToken", () => {
  it("requires a refresh token and points at the fix", () => {
    // Unattended operation is the entire point; an access-token-only file is a
    // dead end that must surface as setup guidance, not an HTTP 401 later.
    expect(() => parseStoredToken({ access_token: "a" })).toThrow(/re-run --authorize/);
  });

  it("keeps the access token and expiry when present", () => {
    expect(
      parseStoredToken({ refresh_token: "r", access_token: "a", expires_at: 1234 }),
    ).toEqual({ refreshToken: "r", accessToken: "a", expiresAt: 1234 });
  });

  it("drops an unusable expiry rather than trusting it", () => {
    const t = parseStoredToken({ refresh_token: "r", access_token: "a", expires_at: "soon" });
    expect(t.expiresAt).toBeUndefined();
  });

  it("round-trips through serialize", () => {
    const token = { refreshToken: "r", accessToken: "a", expiresAt: 99 };
    expect(parseStoredToken(JSON.parse(serializeStoredToken(token)))).toEqual(token);
  });
});

describe("isAccessTokenUsable", () => {
  const now = 1_000_000;

  it("refreshes early so an in-flight request cannot race expiry", () => {
    const token = { refreshToken: "r", accessToken: "a", expiresAt: now + TOKEN_REFRESH_SKEW_MS };
    expect(isAccessTokenUsable(token, now)).toBe(false);
    expect(isAccessTokenUsable({ ...token, expiresAt: now + TOKEN_REFRESH_SKEW_MS + 1 }, now)).toBe(
      true,
    );
  });

  it("treats a missing access token or expiry as unusable", () => {
    expect(isAccessTokenUsable({ refreshToken: "r" }, now)).toBe(false);
    expect(isAccessTokenUsable({ refreshToken: "r", accessToken: "a" }, now)).toBe(false);
  });
});
