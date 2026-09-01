// Credential locations and the pure parsing/expiry rules around them.
//
// Secrets live ONLY on this host, chmod 600, outside any git repo — the same
// posture as the audited read-only Google servers (docs/google-source.md).
// Nothing here ever logs a token value.

/**
 * The single scope this server requests. Hardcoded, not configurable: the
 * write capability is bounded by what the token can do, and a config knob
 * would move that boundary out of code review.
 *
 * `calendar.events` grants create/update/delete on events in calendars the
 * owner can already edit. This server only ever calls insert (see google.ts);
 * the scope is the outer bound, the absent code paths are the inner one.
 */
export const CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export const OAUTH_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

/** Refresh this far before real expiry so an in-flight request cannot race it. */
export const TOKEN_REFRESH_SKEW_MS = 60_000;

export function configDir(home: string, override?: string | undefined): string {
  return override && override.trim() ? override.trim() : `${home}/.config/gcal-write-mcp`;
}

export function credentialsPath(dir: string): string {
  return `${dir}/credentials.json`;
}

export function tokenPath(dir: string): string {
  return `${dir}/token.json`;
}

export type ClientCredentials = {
  clientId: string;
  clientSecret: string;
};

/**
 * Accepts a Google Cloud Desktop-app OAuth client JSON. Google nests the keys
 * under "installed" (desktop) or "web"; a bare object is accepted too so a
 * hand-written file works.
 */
export function parseClientCredentials(raw: unknown): ClientCredentials {
  if (!raw || typeof raw !== "object") {
    throw new Error("credentials.json is not a JSON object");
  }
  const record = raw as Record<string, unknown>;
  const nested = (record["installed"] ?? record["web"] ?? record) as Record<string, unknown>;
  const clientId = nested["client_id"];
  const clientSecret = nested["client_secret"];
  if (typeof clientId !== "string" || !clientId) {
    throw new Error("credentials.json is missing client_id");
  }
  if (typeof clientSecret !== "string" || !clientSecret) {
    throw new Error("credentials.json is missing client_secret");
  }
  return { clientId, clientSecret };
}

export type StoredToken = {
  refreshToken: string;
  accessToken?: string | undefined;
  /** Epoch ms. */
  expiresAt?: number | undefined;
};

export function parseStoredToken(raw: unknown): StoredToken {
  if (!raw || typeof raw !== "object") {
    throw new Error("token.json is not a JSON object");
  }
  const record = raw as Record<string, unknown>;
  const refreshToken = record["refresh_token"];
  if (typeof refreshToken !== "string" || !refreshToken) {
    // Without a refresh token the server cannot run unattended, which is the
    // whole point — say so rather than failing later inside an HTTP call.
    throw new Error("token.json is missing refresh_token; re-run --authorize");
  }
  const accessToken = record["access_token"];
  const expiresAt = record["expires_at"];
  return {
    refreshToken,
    accessToken: typeof accessToken === "string" && accessToken ? accessToken : undefined,
    expiresAt: typeof expiresAt === "number" && Number.isFinite(expiresAt) ? expiresAt : undefined,
  };
}

export function serializeStoredToken(token: StoredToken): string {
  return `${JSON.stringify(
    {
      refresh_token: token.refreshToken,
      access_token: token.accessToken,
      expires_at: token.expiresAt,
    },
    null,
    2,
  )}\n`;
}

export function isAccessTokenUsable(token: StoredToken, now: number): boolean {
  if (!token.accessToken || token.expiresAt === undefined) return false;
  return token.expiresAt - TOKEN_REFRESH_SKEW_MS > now;
}
