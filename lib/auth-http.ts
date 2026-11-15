// HTTP glue for lib/auth.ts (owner: Nizar). Used by proxy.ts for every /api request and by each
// protected route as a second check, so a future proxy matcher change can't silently open a route.

import { authorize, readAuthConfig, SESSION_COOKIE, type AuthDecision, type AuthRequest } from "./auth";

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function toAuthRequest(req: Request): AuthRequest {
  return {
    method: req.method.toUpperCase(),
    pathname: new URL(req.url).pathname,
    authorization: req.headers.get("authorization"),
    sessionCookie: readCookie(req.headers.get("cookie"), SESSION_COOKIE),
    origin: req.headers.get("origin"),
    host: req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
  };
}

export function decide(req: Request, nowMs = Date.now()): AuthDecision {
  return authorize(toAuthRequest(req), readAuthConfig(), nowMs);
}

export function deniedResponse(decision: Extract<AuthDecision, { ok: false }>): Response {
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (decision.status === 401) headers["www-authenticate"] = 'Bearer realm="agent-auditor"';
  return Response.json({ error: decision.error }, { status: decision.status, headers });
}

/** For route handlers: null when the caller may proceed, otherwise the 401/403/503 response to return. */
export function assertAuthorized(req: Request): Response | null {
  const decision = decide(req);
  return decision.ok ? null : deniedResponse(decision);
}
