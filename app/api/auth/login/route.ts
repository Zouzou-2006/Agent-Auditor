// POST /api/auth/login { "password": "..." } -> sets the team session cookie (owner: Nizar).
// 204 on success, 401 wrong password, 429 too many failures, 503 auth not configured, 400 bad body.
// The password is compared in constant time and never logged or echoed.
import {
  clearLoginFailures,
  createSessionToken,
  loginThrottled,
  readAuthConfig,
  recordLoginFailure,
  safeEqual,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: Request): Promise<Response> {
  const config = readAuthConfig();
  if (!config) return Response.json({ error: "authentication is not configured on this server" }, { status: 503 });

  const now = Date.now();
  const ip = clientIp(req);
  if (loginThrottled(ip, now)) return Response.json({ error: "too many attempts, try again later" }, { status: 429 });

  let password: unknown;
  try {
    password = ((await req.json()) as { password?: unknown }).password;
  } catch {
    password = undefined;
  }
  if (typeof password !== "string" || password.length === 0 || password.length > 512) {
    return Response.json({ error: 'body must be {"password": "..."}' }, { status: 400 });
  }
  if (!safeEqual(password, config.dashboardPassword)) {
    recordLoginFailure(ip, now);
    return Response.json({ error: "invalid credentials" }, { status: 401 });
  }

  clearLoginFailures(ip);
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const cookie = [
    `${SESSION_COOKIE}=${createSessionToken(config.sessionSecret, "team", now)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
  return new Response(null, { status: 204, headers: { "set-cookie": cookie, "cache-control": "no-store" } });
}
