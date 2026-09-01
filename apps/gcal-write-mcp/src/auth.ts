// OAuth for the write connector: refresh-token exchange at runtime, plus a
// one-time owner-driven consent flow behind `--authorize`.
//
// Implemented against `fetch` and node:crypto rather than the googleapis SDK on
// purpose. This package exists to be audited line-by-line like the third-party
// read-only servers it sits beside (docs/google-source.md); a dependency that
// can reach the network on its own defeats that. The only hosts contacted
// anywhere in this package are accounts.google.com and www.googleapis.com.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { AddressInfo } from "node:net";

import {
  CALENDAR_WRITE_SCOPE,
  OAUTH_AUTH_ENDPOINT,
  OAUTH_TOKEN_ENDPOINT,
  credentialsPath,
  isAccessTokenUsable,
  parseClientCredentials,
  parseStoredToken,
  serializeStoredToken,
  tokenPath,
  type ClientCredentials,
  type StoredToken,
} from "./config.js";

export type FetchLike = typeof fetch;

/* ------------------------------------------------------------------ */
/* Pure pieces                                                         */
/* ------------------------------------------------------------------ */

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type PkcePair = { verifier: string; challenge: string };

export function pkcePair(random: (size: number) => Buffer = randomBytes): PkcePair {
  const verifier = base64url(random(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/**
 * The read-only calendar server we audited uses a static `state` value. Low
 * risk for a localhost consent, but there is no reason to copy the weakness:
 * this flow mints a fresh state per run and compares it in constant time.
 */
export function statesMatch(expected: string, received: unknown): boolean {
  if (typeof received !== "string" || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export function buildAuthUrl(options: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const url = new URL(OAUTH_AUTH_ENDPOINT);
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", CALENDAR_WRITE_SCOPE);
  url.searchParams.set("code_challenge", options.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", options.state);
  // Unattended refresh is the point; consent forces Google to re-issue a
  // refresh token even if this client was authorized before.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

/**
 * Folds a Google token response into the stored shape. Google omits
 * `refresh_token` on refresh responses, so the existing one is carried
 * forward — dropping it would silently break the next unattended run.
 */
export function mergeTokenResponse(
  previous: StoredToken | null,
  raw: unknown,
  now: number,
): StoredToken {
  if (!raw || typeof raw !== "object") throw new Error("token endpoint returned a non-object");
  const record = raw as Record<string, unknown>;
  const accessToken = record["access_token"];
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("token endpoint returned no access_token");
  }
  const refreshToken =
    typeof record["refresh_token"] === "string" && record["refresh_token"]
      ? (record["refresh_token"] as string)
      : previous?.refreshToken;
  if (!refreshToken) {
    throw new Error("no refresh_token available; re-run --authorize");
  }
  const expiresIn = typeof record["expires_in"] === "number" ? record["expires_in"] : 3600;
  return { refreshToken, accessToken, expiresAt: now + expiresIn * 1000 };
}

/* ------------------------------------------------------------------ */
/* Token source                                                        */
/* ------------------------------------------------------------------ */

export type TokenStore = {
  load: () => Promise<StoredToken>;
  save: (token: StoredToken) => Promise<void>;
};

export type TokenSourceOptions = {
  credentials: () => Promise<ClientCredentials>;
  store: TokenStore;
  fetchImpl?: FetchLike | undefined;
  now?: (() => number) | undefined;
};

export type TokenSource = { getAccessToken: () => Promise<string> };

export function createTokenSource(options: TokenSourceOptions): TokenSource {
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  // Collapse concurrent refreshes; two tools firing at once must not each burn
  // a round trip (and Google rate-limits repeated refreshes).
  let inFlight: Promise<string> | null = null;

  async function refresh(): Promise<string> {
    const token = await options.store.load();
    if (isAccessTokenUsable(token, now())) return token.accessToken as string;

    const creds = await options.credentials();
    const response = await doFetch(OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: token.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    const text = await response.text();
    if (!response.ok) {
      // Never echo the body verbatim: it can contain the client_id and, on
      // some error paths, fragments of the submitted credentials.
      throw new Error(`token refresh failed (HTTP ${response.status}); re-run --authorize`);
    }
    const merged = mergeTokenResponse(token, JSON.parse(text), now());
    await options.store.save(merged);
    return merged.accessToken as string;
  }

  return {
    async getAccessToken() {
      inFlight ??= refresh().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Disk-backed store                                                   */
/* ------------------------------------------------------------------ */

export function createDiskStore(dir: string): TokenStore {
  return {
    async load() {
      return parseStoredToken(JSON.parse(await readFile(tokenPath(dir), "utf8")));
    },
    async save(token) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const path = tokenPath(dir);
      // Mode on open only applies to a fresh file, so chmod unconditionally —
      // the audited Gmail server's umask finding, fixed at the source here.
      await writeFile(path, serializeStoredToken(token), { mode: 0o600 });
      await chmod(path, 0o600);
    },
  };
}

export function createCredentialLoader(dir: string): () => Promise<ClientCredentials> {
  let cached: ClientCredentials | null = null;
  return async () => {
    cached ??= parseClientCredentials(JSON.parse(await readFile(credentialsPath(dir), "utf8")));
    return cached;
  };
}

/* ------------------------------------------------------------------ */
/* One-time consent                                                    */
/* ------------------------------------------------------------------ */

const CONSENT_TIMEOUT_MS = 5 * 60_000;

/** Waits for Google's loopback redirect and returns the authorization code. */
function awaitAuthorizationCode(state: string): {
  redirectUri: Promise<string>;
  code: Promise<string>;
} {
  let resolveRedirect!: (value: string) => void;
  let resolveCode!: (value: string) => void;
  let rejectCode!: (error: Error) => void;
  const redirectUri = new Promise<string>((resolve) => (resolveRedirect = resolve));
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const received = url.searchParams.get("code");
    const respond = (message: string) => {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end(message);
    };
    if (!statesMatch(state, url.searchParams.get("state"))) {
      respond("State mismatch — nothing was authorized. Close this tab and retry.");
      return;
    }
    if (!received) {
      respond("No authorization code returned. Close this tab and retry.");
      return;
    }
    respond("Skippy calendar write access authorized. You can close this tab.");
    resolveCode(received);
    server.close();
  });

  const timer = setTimeout(() => {
    rejectCode(new Error("timed out waiting for consent"));
    server.close();
  }, CONSENT_TIMEOUT_MS);
  timer.unref();
  void code.finally(() => clearTimeout(timer)).catch(() => {});

  // Port 0: the OS picks a free loopback port, which Google's desktop-client
  // rules allow and which avoids colliding with the read-only server's :8089.
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address() as AddressInfo;
    resolveRedirect(`http://127.0.0.1:${port}`);
  });

  return { redirectUri, code };
}

/**
 * Runs the owner-driven consent and writes token.json. Interactive by design:
 * nothing in the MCP surface can trigger this.
 */
export async function authorize(dir: string, fetchImpl: FetchLike = fetch): Promise<void> {
  const creds = await createCredentialLoader(dir)();
  const { verifier, challenge } = pkcePair();
  const state = base64url(randomBytes(24));
  const { redirectUri: redirectUriPromise, code: codePromise } = awaitAuthorizationCode(state);
  const redirectUri = await redirectUriPromise;

  const authUrl = buildAuthUrl({ clientId: creds.clientId, redirectUri, challenge, state });
  // Google's consent screen leaves permission checkboxes UNTICKED by default.
  // Clicking through without ticking yields a token that is missing the scope,
  // which surfaces later as an opaque 403 on the first insert — hence the loud
  // reminder rather than a bare URL.
  process.stderr.write(
    "\nAuthorize Skippy calendar writes.\n" +
      'Verify the consent screen lists ONLY "View and edit events on all your\n' +
      'calendars" — and TICK its checkbox; Google leaves it unchecked.\n\n' +
      `${authUrl}\n\n`,
  );
  spawn("open", [authUrl], { stdio: "ignore", detached: true }).unref();

  const code = await codePromise;
  const response = await fetchImpl(OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`authorization exchange failed (HTTP ${response.status})`);
  }
  const token = mergeTokenResponse(null, await response.json(), Date.now());
  await createDiskStore(dir).save(token);
  process.stderr.write(`Wrote ${tokenPath(dir)} (mode 600).\n`);
}
