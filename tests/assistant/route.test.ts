// POST /api/assistant is public (no sign-in) but read-only. Claude and Supabase are mocked: no real
// API call, no real database. Also checks, through the same proxy logic, that the human actions
// (Approve, Block Seller, summaries) are still locked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardData } from "@/lib/dashboard/model";

// Test-only values. Not real credentials.
const FAKE_CLAUDE_KEY = "sk-ant-test-not-a-real-key-0000000000";
const AUTH_ENV = {
  DASHBOARD_PASSWORD: "test-team-password-123",
  AUTH_SESSION_SECRET: "s".repeat(40),
  AGENT_API_KEY: "a".repeat(40),
};

type Turn = { stop_reason: string; content: Record<string, unknown>[]; text?: string };
const claude = vi.hoisted(() => ({
  turns: [] as Turn[],
  requests: [] as Record<string, unknown>[],
  apiKeys: [] as (string | undefined)[],
}));

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  class RateLimitError extends APIError {}
  class AuthenticationError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static RateLimitError = RateLimitError;
    static AuthenticationError = AuthenticationError;
    beta = {
      messages: {
        stream: (params: Record<string, unknown>) => {
          claude.requests.push(structuredClone(params));
          const turn = claude.turns.shift() ?? { stop_reason: "end_turn", content: [], text: "" };
          let onText: (d: string) => void = () => {};
          return {
            on: (_event: "text", cb: (d: string) => void) => {
              onText = cb;
            },
            finalMessage: async () => {
              if (turn.text) onText(turn.text);
              return { stop_reason: turn.stop_reason, content: turn.content };
            },
          };
        },
      },
    };
    constructor(opts: { apiKey?: string }) {
      claude.apiKeys.push(opts.apiKey);
    }
  }
  return { default: Anthropic };
});

const EMPTY: DashboardData = { sellers: [], orders: [], payments: [], deliveries: [], journal_entries: [], exceptions: [] };
vi.mock("@/lib/db-browser", () => ({ getBrowserClient: () => ({}) }));
vi.mock("@/lib/dashboard/load", () => ({ loadDashboardData: async () => EMPTY }));

const { POST } = await import("@/app/api/assistant/route");
const { decide } = await import("@/lib/auth-http");
const { ASSISTANT_LIMIT, resetAssistantLimits } = await import("@/lib/assistant/rate-limit");

const URL_ = "https://agentauditor-kappa.vercel.app/api/assistant";
const ask = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.50", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const question = { messages: [{ role: "user", content: "How much did we spend today?" }] };

async function events(res: Response): Promise<{ t: string; v?: string; a?: string }[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { t: string; v?: string; a?: string });
}

beforeEach(() => {
  for (const [k, v] of Object.entries(AUTH_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("ANTHROPIC_API_KEY", FAKE_CLAUDE_KEY);
  claude.turns = [];
  claude.requests = [];
  claude.apiKeys = [];
  resetAssistantLimits();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/assistant without signing in", () => {
  it("passes the proxy with no cookie and no key (public)", () => {
    expect(decide(ask(question))).toEqual({ ok: true, role: null });
  });

  it("answers a visitor's question and streams it back", async () => {
    claude.turns = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name: "get_overview", input: {} }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Nothing spent today." }], text: "Nothing spent today." },
    ];
    const res = await POST(ask(question));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const ev = await events(res);
    expect(ev).toEqual([{ t: "tool", v: "get_overview" }, { t: "text", v: "Nothing spent today." }, { t: "done" }]);
    // The tool ran for real against the snapshot and its result went back to Claude.
    const second = claude.requests[1].messages as { role: string; content: unknown }[];
    expect(JSON.stringify(second.at(-1))).toContain("tool_result");
  });

  it("uses the server-side key and never sends it to the browser", async () => {
    claude.turns = [{ stop_reason: "end_turn", content: [], text: "ok" }];
    const res = await POST(ask(question));
    const body = await res.text();
    expect(claude.apiKeys).toEqual([FAKE_CLAUDE_KEY]);
    expect(body).not.toContain(FAKE_CLAUDE_KEY);
    expect(JSON.stringify([...res.headers])).not.toContain(FAKE_CLAUDE_KEY);
  });

  it("503 without ANTHROPIC_API_KEY, without echoing anything secret", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await POST(ask(question));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "copilot is not configured (ANTHROPIC_API_KEY)" });
  });

  it.each([["not json"], [{}], [{ messages: [] }], [{ messages: [{ role: "assistant", content: "hi" }] }], [{ messages: [{ role: "system", content: "x" }] }]])(
    "400 for a bad body: %j",
    async (body) => {
      const res = await POST(ask(body));
      expect(res.status).toBe(400);
      expect(claude.requests).toHaveLength(0);
    },
  );

  it("caps each message's length before it reaches Claude", async () => {
    claude.turns = [{ stop_reason: "end_turn", content: [], text: "ok" }];
    await POST(ask({ messages: [{ role: "user", content: "x".repeat(10000) }] }));
    const sent = claude.requests[0].messages as { content: string }[];
    expect(sent[0].content).toHaveLength(4000);
  });

  it(`429 after ${ASSISTANT_LIMIT} questions from one IP; other IPs unaffected`, async () => {
    for (let i = 0; i < ASSISTANT_LIMIT; i++) {
      const res = await POST(ask(question));
      expect(res.status).toBe(200);
      await res.text();
    }
    const limited = await POST(ask(question));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await limited.json()) as { error: string }).toHaveProperty("error");
    const other = await POST(ask(question, { "x-forwarded-for": "198.51.100.7" }));
    expect(other.status).toBe(200);
  });
});

describe("the assistant stays read-only", () => {
  it("offers Claude only read tools: nothing that pays, approves, blocks or writes", async () => {
    claude.turns = [{ stop_reason: "end_turn", content: [], text: "ok" }];
    await (await POST(ask(question))).text();
    const names = (claude.requests[0].tools as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual(["daily_spend", "get_order", "get_overview", "list_exceptions", "list_orders", "list_payments", "list_sellers"]);
    for (const n of names) expect(n).not.toMatch(/approve|block|pay(?!ments)|transfer|sign|update|insert|delete|write|resolve|create/);
  });

  it("refuses a tool Claude asks for that doesn't exist (e.g. block_seller)", async () => {
    claude.turns = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name: "block_seller", input: { seller_id: "dataco" } }] },
      { stop_reason: "end_turn", content: [], text: "I can't do that." },
    ];
    await (await POST(ask(question))).text();
    const results = (claude.requests[1].messages as { content: unknown }[]).at(-1)?.content as { is_error?: boolean }[];
    expect(results[0].is_error).toBe(true);
  });
});

describe("human actions are still locked (same proxy logic)", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  const LOCKED = [`/api/orders/${ID}/approve`, `/api/exceptions/${ID}`, "/api/summaries", "/api/orders"];
  const post = (path: string, headers: Record<string, string> = {}) =>
    new Request(`https://agentauditor-kappa.vercel.app${path}`, { method: "POST", headers });

  it.each(LOCKED)("%s: 401 with no credentials", (path) => {
    expect(decide(post(path))).toMatchObject({ ok: false, status: 401 });
  });

  it.each(LOCKED.slice(0, 3))("%s: 403 for the agent key", (path) => {
    expect(decide(post(path, { authorization: `Bearer ${AUTH_ENV.AGENT_API_KEY}` }))).toMatchObject({ ok: false, status: 403 });
  });

  it("Block Seller and Approve still fail closed (503) when auth isn't configured", () => {
    vi.stubEnv("AUTH_SESSION_SECRET", "");
    expect(decide(post(`/api/exceptions/${ID}`))).toMatchObject({ ok: false, status: 503 });
    expect(decide(post(`/api/orders/${ID}/approve`))).toMatchObject({ ok: false, status: 503 });
    // ...while the read-only assistant keeps working.
    expect(decide(ask(question))).toEqual({ ok: true, role: null });
  });
});
