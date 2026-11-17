import { describe, expect, it } from "vitest";
import {
  authorize,
  createSessionToken,
  isPublicApiPath,
  loginThrottled,
  readAuthConfig,
  recordLoginFailure,
  rolesFor,
  safeEqual,
  verifySessionToken,
  type AuthConfig,
  type AuthRequest,
} from "@/lib/auth";

// Test-only values. Not real credentials.
const config: AuthConfig = {
  dashboardPassword: "test-team-password-123",
  sessionSecret: "s".repeat(40),
  agentApiKey: "a".repeat(40),
};
const NOW = Date.UTC(2026, 10, 15, 12);
const team = createSessionToken(config.sessionSecret, "team", NOW);

const req = (o: Partial<AuthRequest>): AuthRequest => ({
  method: "POST",
  pathname: "/api/orders",
  authorization: null,
  sessionCookie: undefined,
  origin: null,
  host: "agentauditor-kappa.vercel.app",
  ...o,
});

const PROTECTED = ["/api/orders", "/api/orders/11111111-1111-4111-8111-111111111111/approve", "/api/exceptions/e1", "/api/assistant", "/api/summaries"];

describe("readAuthConfig fails closed", () => {
  it("is null when any variable is missing or too short", () => {
    expect(readAuthConfig({})).toBeNull();
    expect(readAuthConfig({ DASHBOARD_PASSWORD: "short", AUTH_SESSION_SECRET: "s".repeat(40), AGENT_API_KEY: "a".repeat(40) })).toBeNull();
    expect(readAuthConfig({ DASHBOARD_PASSWORD: "long-enough-pw", AUTH_SESSION_SECRET: "too-short", AGENT_API_KEY: "a".repeat(40) })).toBeNull();
  });
  it("accepts strong values", () => {
    expect(readAuthConfig({ DASHBOARD_PASSWORD: "long-enough-pw", AUTH_SESSION_SECRET: "s".repeat(32), AGENT_API_KEY: "a".repeat(32) })).not.toBeNull();
  });
  it("returns 503 for protected routes when not configured, but keeps public routes open", () => {
    expect(authorize(req({ authorization: `Bearer ${config.agentApiKey}` }), null, NOW)).toMatchObject({ ok: false, status: 503 });
    expect(authorize(req({ pathname: "/api/webhooks/streams" }), null, NOW)).toEqual({ ok: true, role: null });
  });
});

describe("authorize: every protected action endpoint", () => {
  it.each(PROTECTED)("%s: 401 without credentials", (pathname) => {
    expect(authorize(req({ pathname }), config, NOW)).toEqual({ ok: false, status: 401, error: "authentication required: sign in at /login" });
  });

  it.each(PROTECTED)("%s: 401 with a wrong bearer key", (pathname) => {
    expect(authorize(req({ pathname, authorization: "Bearer wrong-key" }), config, NOW)).toMatchObject({ ok: false, status: 401 });
  });

  it.each(PROTECTED)("%s: 401 with a forged session cookie", (pathname) => {
    const forged = createSessionToken("x".repeat(40), "team", NOW);
    expect(authorize(req({ pathname, sessionCookie: forged }), config, NOW)).toMatchObject({ ok: false, status: 401 });
  });

  it.each(PROTECTED)("%s: allowed for a signed-in team member", (pathname) => {
    expect(authorize(req({ pathname, sessionCookie: team }), config, NOW)).toEqual({ ok: true, role: "team" });
  });

  it("lets the agent key file orders", () => {
    expect(authorize(req({ authorization: `Bearer ${config.agentApiKey}` }), config, NOW)).toEqual({ ok: true, role: "agent" });
  });

  it.each(PROTECTED.slice(1))("%s: 403 for the agent key (it may only file orders)", (pathname) => {
    expect(authorize(req({ pathname, authorization: `Bearer ${config.agentApiKey}` }), config, NOW)).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses a cookie-authenticated request from another site (CSRF)", () => {
    expect(authorize(req({ sessionCookie: team, origin: "https://evil.example" }), config, NOW)).toMatchObject({ ok: false, status: 403 });
    expect(authorize(req({ sessionCookie: team, origin: "https://agentauditor-kappa.vercel.app" }), config, NOW)).toMatchObject({ ok: true });
  });

  it("treats unknown /api routes as team-only (default deny)", () => {
    expect(rolesFor("POST", "/api/something-new")).toEqual(["team"]);
    expect(authorize(req({ pathname: "/api/something-new", authorization: `Bearer ${config.agentApiKey}` }), config, NOW)).toMatchObject({ status: 403 });
    expect(authorize(req({ method: "GET", pathname: "/api/orders" }), config, NOW)).toMatchObject({ status: 401 });
  });
});

describe("public paths stay public", () => {
  it.each(["/api/sellers/dataco", "/api/sellers/cheapdata", "/api/webhooks/streams", "/api/auth/login", "/api/auth/session"])("%s", (p) => {
    expect(isPublicApiPath(p)).toBe(true);
  });
  it.each(["/api/orders", "/api/webhooks/other", "/api/sellersX", "/api/assistant"])("%s is not public", (p) => {
    expect(isPublicApiPath(p)).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips and expires", () => {
    expect(verifySessionToken(config.sessionSecret, team, NOW)).toBe("team");
    expect(verifySessionToken(config.sessionSecret, team, NOW + 13 * 3600 * 1000)).toBeNull();
  });
  it("rejects tampering, including a self-promoted agent session", () => {
    const [v, , exp, mac] = team.split(".");
    expect(verifySessionToken(config.sessionSecret, `${v}.agent.${exp}.${mac}`, NOW)).toBeNull();
    expect(verifySessionToken(config.sessionSecret, `${v}.team.${Number(exp) + 999}.${mac}`, NOW)).toBeNull();
    expect(verifySessionToken(config.sessionSecret, "garbage", NOW)).toBeNull();
    expect(verifySessionToken(config.sessionSecret, undefined, NOW)).toBeNull();
  });
  it("holds no secret", () => {
    expect(team).not.toContain(config.sessionSecret);
    expect(team).not.toContain(config.dashboardPassword);
  });
});

describe("safeEqual and login throttle", () => {
  it("compares exactly, any lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
  it("throttles after 10 failures per IP", () => {
    for (let i = 0; i < 10; i++) recordLoginFailure("203.0.113.9", NOW);
    expect(loginThrottled("203.0.113.9", NOW)).toBe(true);
    expect(loginThrottled("203.0.113.9", NOW + 16 * 60 * 1000)).toBe(false);
    expect(loginThrottled("198.51.100.1", NOW)).toBe(false);
  });
});
