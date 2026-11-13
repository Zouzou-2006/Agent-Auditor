// The buyer agent with the Claude API and the gateway both faked: no network, no API key.
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FILE_ORDER_TOOL,
  MAX_TOOL_CALLS,
  MODEL,
  createClaudeClient,
  parseOrder,
  runBuyerAgent,
  type ClaudeClient,
} from "../lib/buyer-agent";

const TODAY = "2026-11-13";
const ORDER_INPUT = {
  seller_id: "dataco",
  item: "price_quote",
  params: { ticker: "SOL", date: TODAY },
  max_amount: 100000,
  purpose: "Daily SOL price for the treasury report",
};
const BOOKED = { order_id: "f85a9daf-7955-4a18-90aa-04cba49b76a6", status: "booked", reason: "", data: { price_usd: 142.1 } };

let nextId = 1;
const toolUse = (input: unknown = ORDER_INPUT, name = "file_order"): Anthropic.ToolUseBlock =>
  ({ type: "tool_use", id: `toolu_${nextId++}`, name, input }) as Anthropic.ToolUseBlock;
const text = (t: string) => ({ type: "text", text: t }) as Anthropic.TextBlock;

function message(content: Anthropic.ContentBlock[], stop_reason: Anthropic.Message["stop_reason"]): Anthropic.Message {
  return { id: `msg_${nextId++}`, type: "message", role: "assistant", model: MODEL, content, stop_reason } as Anthropic.Message;
}
const callsTool = (...blocks: Anthropic.ContentBlock[]) => message(blocks, "tool_use");
const ends = (t = "Bought the SOL price: $142.10.") => message([text(t)], "end_turn");

/** A Claude client that replies with `script` in order (the last reply repeats), recording each request. */
function fakeClaude(...script: Anthropic.Message[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: ClaudeClient = {
    messages: {
      create: async (body) => {
        requests.push(structuredClone(body));
        return script.length > 1 ? script.shift()! : script[0];
      },
    },
  };
  return { client, requests };
}

/** A gateway that answers with `respond`, recording each request. */
function fakeGateway(respond: () => Promise<Response> | Response = () => Response.json(BOOKED)) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    return respond();
  }) as unknown as typeof globalThis.fetch;
  return { fetch, requests };
}

/** The tool_result blocks in the last user message Claude was sent. */
function lastToolResults(requests: Anthropic.MessageCreateParamsNonStreaming[]) {
  const last = requests.at(-1)!.messages.at(-1)!;
  return last.content as Anthropic.ToolResultBlockParam[];
}

afterEach(() => vi.unstubAllEnvs());

describe("a tool call becomes the exact POST body", () => {
  it("POSTs exactly the five SPEC.md fields as JSON to GATEWAY_URL/api/orders", async () => {
    const claude = fakeClaude(callsTool(toolUse()), ends());
    const gateway = fakeGateway();

    const run = await runBuyerAgent("Get today's SOL price for the treasury report.", {
      client: claude.client, fetch: gateway.fetch, today: TODAY, gatewayUrl: "http://localhost:3000",
    });

    expect(gateway.requests).toHaveLength(1);
    const { url, init } = gateway.requests[0];
    expect(url).toBe("http://localhost:3000/api/orders");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(init.body).toBe(
      '{"seller_id":"dataco","item":"price_quote","params":{"ticker":"SOL","date":"2026-11-13"},' +
        '"max_amount":100000,"purpose":"Daily SOL price for the treasury report"}',
    );
    expect(run).toMatchObject({ stopReason: "end_turn", finalText: "Bought the SOL price: $142.10." });
    expect(run.calls).toEqual([
      { input: ORDER_INPUT, order: ORDER_INPUT, outcome: { content: JSON.stringify(BOOKED), isError: false } },
    ]);
  });

  it("drops any extra fields Claude adds", async () => {
    const claude = fakeClaude(callsTool(toolUse({ ...ORDER_INPUT, wallet: "AttackerWa11et", pay_now: true })), ends());
    const gateway = fakeGateway();

    await runBuyerAgent("task", { client: claude.client, fetch: gateway.fetch, today: TODAY });

    expect(Object.keys(JSON.parse(String(gateway.requests[0].init.body)))).toEqual([
      "seller_id", "item", "params", "max_amount", "purpose",
    ]);
  });

  it("uses GATEWAY_URL from the environment, without a trailing slash", async () => {
    vi.stubEnv("GATEWAY_URL", "https://auditor.example.dev/");
    const gateway = fakeGateway();

    await runBuyerAgent("task", { client: fakeClaude(callsTool(toolUse()), ends()).client, fetch: gateway.fetch });

    expect(gateway.requests[0].url).toBe("https://auditor.example.dev/api/orders");
  });

  it("sends the gateway's reply back to Claude as the tool result", async () => {
    const claude = fakeClaude(callsTool(toolUse()), ends());

    await runBuyerAgent("task", { client: claude.client, fetch: fakeGateway().fetch, today: TODAY });

    const [result] = lastToolResults(claude.requests);
    expect(result).toEqual({ type: "tool_result", tool_use_id: expect.any(String), content: JSON.stringify(BOOKED) });
  });

  it.each([
    ["a decimal amount", { ...ORDER_INPUT, max_amount: 0.1 }],
    ["a string amount", { ...ORDER_INPUT, max_amount: "100000" }],
    ["a zero amount", { ...ORDER_INPUT, max_amount: 0 }],
    ["a negative amount", { ...ORDER_INPUT, max_amount: -100000 }],
    ["no seller", { ...ORDER_INPUT, seller_id: "" }],
    ["params as an array", { ...ORDER_INPUT, params: ["SOL"] }],
  ])("%s is never POSTed; the agent gets an error instead", async (_label, input) => {
    const claude = fakeClaude(callsTool(toolUse(input)), ends());
    const gateway = fakeGateway();

    const run = await runBuyerAgent("task", { client: claude.client, fetch: gateway.fetch, today: TODAY });

    expect(gateway.requests).toHaveLength(0);
    expect(run.calls[0]).toMatchObject({ order: null, outcome: { isError: true } });
    expect(lastToolResults(claude.requests)[0]).toMatchObject({ is_error: true });
  });
});

describe("the agent stops after 3 tool calls", () => {
  it("a model that keeps calling file_order is cut off after the third call", async () => {
    const claude = fakeClaude(callsTool(toolUse())); // replies with a tool call forever
    const gateway = fakeGateway();

    const run = await runBuyerAgent("task", { client: claude.client, fetch: gateway.fetch, today: TODAY });

    expect(MAX_TOOL_CALLS).toBe(3);
    expect(gateway.requests).toHaveLength(3);
    expect(claude.requests).toHaveLength(3); // no fourth request to Claude after the cap
    expect(run.calls).toHaveLength(3);
    expect(run.stopReason).toBe("tool_limit");
  });

  it("several tool calls in one reply still count toward the cap", async () => {
    const claude = fakeClaude(callsTool(toolUse(), toolUse()), callsTool(toolUse(), toolUse()));
    const gateway = fakeGateway();

    const run = await runBuyerAgent("task", { client: claude.client, fetch: gateway.fetch, today: TODAY });

    expect(gateway.requests).toHaveLength(3);
    expect(run).toMatchObject({ stopReason: "tool_limit" });
  });
});

describe("gateway errors are returned to the agent instead of crashing it", () => {
  it.each([
    ["gateway down", () => Promise.reject(new TypeError("fetch failed")), "Gateway unreachable at http://localhost:3000/api/orders: fetch failed"],
    ["HTTP 500", () => Response.json({ error: "internal error" }, { status: 500 }), 'Gateway error HTTP 500: {"error":"internal error"}'],
    ["HTTP 501 stub", () => Response.json({ error: "not_implemented" }, { status: 501 }), 'Gateway error HTTP 501: {"error":"not_implemented"}'],
    ["non-JSON reply", () => new Response("<html>Bad Gateway</html>", { status: 200 }), "Gateway reply (HTTP 200) wasn't JSON: <html>Bad Gateway</html>"],
  ])("%s → an is_error tool result, and the agent carries on", async (_label, respond, content) => {
    const claude = fakeClaude(callsTool(toolUse()), ends("The gateway is down, so nothing was bought."));

    const run = await runBuyerAgent("task", {
      client: claude.client, fetch: fakeGateway(respond).fetch, today: TODAY, gatewayUrl: "http://localhost:3000",
    });

    expect(claude.requests).toHaveLength(2); // Claude saw the error and answered
    expect(lastToolResults(claude.requests)[0]).toMatchObject({ is_error: true, content });
    expect(run).toMatchObject({ stopReason: "end_turn", finalText: "The gateway is down, so nothing was bought." });
  });

  it("a denied order is a normal reply, not an error", async () => {
    const denied = { order_id: "o1", status: "denied", reason: "seller not approved", data: null };
    const claude = fakeClaude(callsTool(toolUse()), ends());

    await runBuyerAgent("task", { client: claude.client, fetch: fakeGateway(() => Response.json(denied)).fetch, today: TODAY });

    const [result] = lastToolResults(claude.requests);
    expect(result.is_error).toBeUndefined();
    expect(result.content).toBe(JSON.stringify(denied));
  });

  it("an unknown tool name is refused, not run", async () => {
    const claude = fakeClaude(callsTool(toolUse({}, "pay_seller")), ends());
    const gateway = fakeGateway();

    await runBuyerAgent("task", { client: claude.client, fetch: gateway.fetch, today: TODAY });

    expect(gateway.requests).toHaveLength(0);
    expect(lastToolResults(claude.requests)[0]).toMatchObject({ is_error: true });
  });
});

describe("the request to Claude", () => {
  it("uses Haiku 5.5, exactly one tool (file_order), one call at a time, and today's date", async () => {
    const claude = fakeClaude(ends());

    await runBuyerAgent("Get today's SOL price for the treasury report.", { client: claude.client, today: TODAY });

    const [request] = claude.requests;
    expect(request.model).toBe("claude-haiku-5-5");
    expect(request.tools).toEqual([FILE_ORDER_TOOL]);
    expect(request.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    expect(request.messages).toEqual([
      { role: "user", content: "Get today's SOL price for the treasury report.\n\nToday's date (UTC) is 2026-11-13." },
    ]);
    expect(request.system).toEqual(expect.stringContaining("dataco"));
    expect(request.system).toEqual(expect.stringContaining("cheapdata"));
    expect(request.system).toEqual(expect.stringContaining("price_quote"));
    expect(request.system).toEqual(expect.stringContaining("$0.10 = 100000"));
  });

  it("the tool schema has the five POST /api/orders fields, all required", () => {
    expect(FILE_ORDER_TOOL.input_schema.required).toEqual(["seller_id", "item", "params", "max_amount", "purpose"]);
    expect(Object.keys(FILE_ORDER_TOOL.input_schema.properties ?? {})).toEqual([
      "seller_id", "item", "params", "max_amount", "purpose",
    ]);
  });

  it("a refusal or max_tokens stop ends the run without filing anything", async () => {
    for (const stop of ["refusal", "max_tokens"] as const) {
      const gateway = fakeGateway();
      const run = await runBuyerAgent("task", { client: fakeClaude(message([], stop)).client, fetch: gateway.fetch });
      expect(run).toEqual({ calls: [], finalText: "", stopReason: stop });
      expect(gateway.requests).toHaveLength(0);
    }
  });

  it("a custom fileOrder (the dry run) replaces the POST", async () => {
    const gateway = fakeGateway();
    const fileOrder = vi.fn(async () => ({ content: '{"dry_run":true}', isError: false }));

    await runBuyerAgent("task", {
      client: fakeClaude(callsTool(toolUse()), ends()).client, fetch: gateway.fetch, fileOrder, today: TODAY,
    });

    expect(fileOrder).toHaveBeenCalledWith(ORDER_INPUT);
    expect(gateway.requests).toHaveLength(0);
  });
});

describe("setup", () => {
  it("createClaudeClient needs ANTHROPIC_API_KEY", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(() => createClaudeClient()).toThrow("ANTHROPIC_API_KEY is not set");
  });

  it("parseOrder builds the order from valid input", () => {
    expect(parseOrder(ORDER_INPUT)).toEqual({ order: ORDER_INPUT });
  });
});
