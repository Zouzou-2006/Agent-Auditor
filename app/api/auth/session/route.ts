// GET /api/auth/session -> { "signedIn": boolean } (owner: Nizar). Lets the dashboard show a
// "Sign in" prompt before a human action instead of waiting for a 401. Reveals nothing secret.
import { readAuthConfig, SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  const config = readAuthConfig();
  const cookie = req.headers.get("cookie") ?? "";
  const token = cookie
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  const signedIn = !!config && verifySessionToken(config.sessionSecret, token ? decodeURIComponent(token) : undefined, Date.now()) === "team";
  return Response.json({ signedIn, configured: !!config }, { headers: { "cache-control": "no-store" } });
}
