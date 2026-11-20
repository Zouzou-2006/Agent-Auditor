// Authentication and authorization for the action endpoints (owner: Nizar). Pure functions only:
// proxy.ts applies `authorize` to every /api request, and each protected route re-checks with
// `assertAuthorized` (defense in depth, as the Next.js proxy docs recommend).
//
// Two callers, two roles:
// - "team": a human who signed in at /login with DASHBOARD_PASSWORD. Gets an HttpOnly, SameSite=Strict
//   session cookie signed with AUTH_SESSION_SECRET. May do every action.
// - "agent": the buyer agent, sending `Authorization: Bearer <AGENT_API_KEY>`. May only file orders
//   (POST /api/orders). It may NOT approve orders, resolve exceptions or write summaries: an
//   agent must never approve its own over-limit order (separation of duties) -> 403.
//
// The dashboard copilot (POST /api/assistant) is public so visitors can try it without signing in.
// That is safe because it is read-only: its tools read an anon-key snapshot (RLS: SELECT only) and
// it has no tool that pays, approves, blocks or writes. Its own route rate-limits each IP.
//
// No secret ever reaches the browser: none of these variables has a NEXT_PUBLIC_ prefix, the cookie
// holds only a signed role + expiry, and error bodies never echo a credential.

import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export type Role = "team" | "agent";
export const SESSION_COOKIE = "aa_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
/** Minimum lengths so a weak or placeholder secret fails closed instead of "working". */
const MIN_PASSWORD = 12;
const MIN_SECRET = 32;

export interface AuthConfig {
  dashboardPassword: string;
  sessionSecret: string;
  agentApiKey: string;
}

/** Reads the three variables; null (fail closed) if any is missing or too short. */
export function readAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig | null {
  const dashboardPassword = env.DASHBOARD_PASSWORD ?? "";
  const sessionSecret = env.AUTH_SESSION_SECRET ?? "";
  const agentApiKey = env.AGENT_API_KEY ?? "";
  if (dashboardPassword.length < MIN_PASSWORD || sessionSecret.length < MIN_SECRET || agentApiKey.length < MIN_SECRET) return null;
  return { dashboardPassword, sessionSecret, agentApiKey };
}

/** Constant-time string equality: hashing first makes both inputs the same length. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

const sign = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");

/** Session token: `v1.<role>.<expiresAtSeconds>.<hmac>`. Holds no secret, only what the HMAC vouches for. */
export function createSessionToken(secret: string, role: Role, nowMs: number, ttlSeconds = SESSION_TTL_SECONDS): string {
  const payload = `v1.${role}.${Math.floor(nowMs / 1000) + ttlSeconds}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function verifySessionToken(secret: string, token: string | undefined, nowMs: number): Role | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [, role, exp, mac] = parts;
  if (role !== "team" || !/^\d{1,12}$/.test(exp)) return null; // sessions are only ever issued to humans
  if (!safeEqual(mac, sign(secret, `v1.${role}.${exp}`))) return null;
  if (Number(exp) * 1000 <= nowMs) return null;
  return role;
}

/** Which roles may call which action. Anything under /api not listed here and not public is team-only. */
const POLICY: { method: string; path: RegExp; roles: Role[] }[] = [
  { method: "POST", path: /^\/api\/orders\/?$/, roles: ["team", "agent"] },
  { method: "POST", path: /^\/api\/orders\/[^/]+\/approve\/?$/, roles: ["team"] },
  { method: "POST", path: /^\/api\/exceptions\/[^/]+\/?$/, roles: ["team"] },
  { method: "POST", path: /^\/api\/summaries\/?$/, roles: ["team"] },
];

/**
 * Public by design: sellers are paid with x402 (the payment is the authorization), the Streams
 * webhook verifies QuickNode's HMAC signature itself, /api/auth is how a human signs in, and the
 * read-only copilot (/api/assistant) can't change anything.
 */
export function isPublicApiPath(pathname: string): boolean {
  return (
    /^\/api\/sellers(\/|$)/.test(pathname) ||
    /^\/api\/webhooks\/streams\/?$/.test(pathname) ||
    /^\/api\/auth(\/|$)/.test(pathname) ||
    /^\/api\/assistant\/?$/.test(pathname)
  );
}

export function rolesFor(method: string, pathname: string): Role[] {
  const rule = POLICY.find((r) => r.method === method && r.path.test(pathname));
  return rule ? rule.roles : ["team"]; // default deny: unknown routes need a signed-in human
}

export interface AuthRequest {
  method: string;
  pathname: string;
  /** Value of the Authorization header, if any. */
  authorization: string | null;
  /** Value of the session cookie, if any. */
  sessionCookie: string | undefined;
  /** Origin header (browsers send it on POST) and the host the request was sent to. */
  origin: string | null;
  host: string | null;
}

export type AuthDecision =
  | { ok: true; role: Role | null }
  | { ok: false; status: 401 | 403 | 503; error: string };

export function authorize(req: AuthRequest, config: AuthConfig | null, nowMs: number): AuthDecision {
  if (isPublicApiPath(req.pathname)) return { ok: true, role: null };
  if (!config) return { ok: false, status: 503, error: "authentication is not configured on this server" };

  let role: Role | null = null;
  const bearer = /^Bearer\s+(.+)$/i.exec(req.authorization ?? "")?.[1]?.trim();
  if (bearer !== undefined) {
    if (!safeEqual(bearer, config.agentApiKey)) return { ok: false, status: 401, error: "invalid credentials" };
    role = "agent";
  } else if (req.sessionCookie) {
    role = verifySessionToken(config.sessionSecret, req.sessionCookie, nowMs);
    if (!role) return { ok: false, status: 401, error: "session expired or invalid, sign in again at /login" };
    // Cookie auth is the only CSRF-able path: a browser's cross-site POST carries a foreign Origin.
    // SameSite=Strict already withholds the cookie cross-site; this is the second lock.
    if (req.origin && req.host && !sameHost(req.origin, req.host)) return { ok: false, status: 403, error: "cross-site request refused" };
  } else {
    return { ok: false, status: 401, error: "authentication required: sign in at /login" };
  }

  if (!rolesFor(req.method, req.pathname).includes(role)) return { ok: false, status: 403, error: "not allowed for this caller" };
  return { ok: true, role };
}

function sameHost(origin: string, host: string): boolean {
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/** Best-effort login throttle (per server instance): 10 failed attempts per IP per 15 minutes. */
const failures = new Map<string, { count: number; resetAt: number }>();
export function loginThrottled(ip: string, nowMs: number): boolean {
  const f = failures.get(ip);
  return !!f && f.resetAt > nowMs && f.count >= 10;
}
export function recordLoginFailure(ip: string, nowMs: number): void {
  const f = failures.get(ip);
  if (!f || f.resetAt <= nowMs) failures.set(ip, { count: 1, resetAt: nowMs + 15 * 60 * 1000 });
  else f.count += 1;
}
export function clearLoginFailures(ip: string): void {
  failures.delete(ip);
}
