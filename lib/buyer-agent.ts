// The buyer agent (Cooper). A small Claude agent that turns a plain-English task into an
// order for the gateway. Its only tool is file_order, which POSTs to /api/orders (SPEC.md
// section 10). It never holds a wallet key or pays anyone: the gateway checks the rules and
// pays (SPEC.md section 3). All amounts are integers in USDC base units ($0.10 = 100000).

import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-haiku-5-5";
export const MAX_TOOL_CALLS = 3;
const DEFAULT_GATEWAY_URL = "http://localhost:3000";
const GATEWAY_TIMEOUT_MS = 60_000; // the gateway quotes, pays and checks delivery before it replies
const MAX_REPLY_CHARS = 4000; // keep a runaway error page from flooding the agent's context

/** The POST /api/orders body, field for field (SPEC.md section 10). */
export interface Order {
  seller_id: string;
  item: string;
  params: Record<string, unknown>;
  max_amount: number;
  purpose: string;
}

/** What a tool call produced: the text the agent sees, and whether it's an error. */
export interface ToolOutcome {
  content: string;
  isError: boolean;
}

export interface ToolCall {
  input: unknown; // exactly what Claude sent
  order: Order | null; // null if the input was invalid and nothing was filed
  outcome: ToolOutcome;
}

export interface AgentRun {
  calls: ToolCall[];
  finalText: string;
  stopReason: Anthropic.Message["stop_reason"] | "tool_limit";
}

/** The one method of the Anthropic client the agent uses (so tests can pass a fake). */
export interface ClaudeClient {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming): PromiseLike<Anthropic.Message>;
  };
}

export const SYSTEM_PROMPT = `You are the buyer agent for a company's finance team. You buy small data products from other agents through the company's payment gateway.

You can't pay anyone yourself. To buy something, call the file_order tool once. The gateway checks the company's finance rules, pays the seller if the order passes, and replies with the result.

Sellers you can use:
- dataco: DataCo, market data. Use dataco unless the task names a different seller.
- cheapdata: CheapData, a budget data seller.

Items:
- price_quote: the price of a crypto asset on a date. params: {"ticker": "<symbol, e.g. SOL>", "date": "<YYYY-MM-DD>"}.

Amounts are integers in USDC base units: 1 USDC = 1000000, so $0.10 = 100000. A price quote costs 100000; set max_amount to 100000 unless the task says otherwise. Never use decimals.

In purpose, say in one sentence why the company is buying, based on the task.

After the gateway replies, report the result in one or two sentences. If the order was denied or failed, say so and give the gateway's reason. Don't retry an order the gateway denied.`;

export const FILE_ORDER_TOOL: Anthropic.Tool = {
  name: "file_order",
  description:
    "File a purchase order with the company's payment gateway. The gateway checks the finance rules, pays the seller if the order passes, and returns the result: the order_id, a status of booked, denied, exception or pending_review, a reason, and the data bought. Call it once per purchase.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      seller_id: { type: "string", description: "The seller's id, e.g. dataco." },
      item: { type: "string", description: "What to buy, e.g. price_quote." },
      params: {
        type: "object",
        description: "The item's parameters. For price_quote: ticker and date.",
        properties: {
          ticker: { type: "string", description: "Asset symbol, e.g. SOL." },
          date: { type: "string", description: "Date in YYYY-MM-DD form." },
        },
        required: ["ticker", "date"],
        additionalProperties: false,
      },
      max_amount: {
        type: "integer",
        description: "The most to pay, in USDC base units (integer; $0.10 = 100000).",
      },
      purpose: { type: "string", description: "One sentence on why the company is buying." },
    },
    required: ["seller_id", "item", "params", "max_amount", "purpose"],
    additionalProperties: false,
  },
};

/** Checks Claude's tool input and builds the exact POST body, or says what's wrong. */
export function parseOrder(input: unknown): { order: Order } | { error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { error: "file_order input must be an object" };
  }
  const { seller_id, item, params, max_amount, purpose } = input as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof seller_id !== "string" || seller_id === "") problems.push("seller_id must be a non-empty string");
  if (typeof item !== "string" || item === "") problems.push("item must be a non-empty string");
  if (typeof params !== "object" || params === null || Array.isArray(params)) problems.push("params must be an object");
  if (typeof max_amount !== "number" || !Number.isSafeInteger(max_amount) || max_amount <= 0) {
    problems.push("max_amount must be a positive integer in USDC base units ($0.10 = 100000)");
  }
  if (typeof purpose !== "string" || purpose === "") problems.push("purpose must be a non-empty string");
  if (problems.length > 0) return { error: `Order not filed: ${problems.join("; ")}.` };

  return {
    order: {
      seller_id: seller_id as string,
      item: item as string,
      params: params as Record<string, unknown>,
      max_amount: max_amount as number,
      purpose: purpose as string,
    },
  };
}

export interface PostOrderOptions {
  gatewayUrl?: string;
  fetch?: typeof fetch;
}

/** The gateway's address: GATEWAY_URL, or http://localhost:3000. */
export function gatewayUrl(override?: string): string {
  return (override ?? process.env.GATEWAY_URL ?? DEFAULT_GATEWAY_URL).replace(/\/+$/, "");
}

/**
 * POSTs an order to the gateway and returns its reply as tool output. Never throws: an
 * unreachable gateway, an HTTP error or a non-JSON reply comes back as an error outcome,
 * so the agent can report it instead of crashing.
 */
export async function postOrder(order: Order, options: PostOrderOptions = {}): Promise<ToolOutcome> {
  const url = `${gatewayUrl(options.gatewayUrl)}/api/orders`;
  const doFetch = options.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(order),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: `Gateway unreachable at ${url}: ${message}`, isError: true };
  }

  let text: string;
  try {
    text = await res.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: `Gateway reply (HTTP ${res.status}) could not be read: ${message}`, isError: true };
  }
  const body = text.length > MAX_REPLY_CHARS ? `${text.slice(0, MAX_REPLY_CHARS)}… [truncated]` : text;

  if (!res.ok) return { content: `Gateway error HTTP ${res.status}: ${body}`, isError: true };
  try {
    JSON.parse(text);
  } catch {
    return { content: `Gateway reply (HTTP ${res.status}) wasn't JSON: ${body}`, isError: true };
  }
  return { content: body, isError: false }; // a "denied" order is a normal reply, not an error
}

/** A client for the real API, using ANTHROPIC_API_KEY. */
export function createClaudeClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set (put it in .env.local; see .env.example)");
  return new Anthropic({ apiKey });
}

export interface AgentOptions {
  client?: ClaudeClient;
  /** Today's date (YYYY-MM-DD, UTC). Defaults to the real date. */
  today?: string;
  /** Replaces the gateway POST, e.g. for a dry run. Defaults to postOrder. */
  fileOrder?: (order: Order) => Promise<ToolOutcome>;
  gatewayUrl?: string;
  fetch?: typeof fetch;
}

/**
 * Runs the buyer agent on one task. It stops when Claude stops calling tools, or after
 * MAX_TOOL_CALLS calls, whichever comes first.
 */
export async function runBuyerAgent(task: string, options: AgentOptions = {}): Promise<AgentRun> {
  const client = options.client ?? createClaudeClient();
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const fileOrder =
    options.fileOrder ?? ((order: Order) => postOrder(order, { gatewayUrl: options.gatewayUrl, fetch: options.fetch }));

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `${task}\n\nToday's date (UTC) is ${today}.` },
  ];
  const calls: ToolCall[] = [];

  for (;;) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: [FILE_ORDER_TOOL],
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      output_config: { effort: "low" },
      messages,
    });

    const finalText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    const toolUses = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      return { calls, finalText, stopReason: response.stop_reason };
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      let outcome: ToolOutcome;
      let order: Order | null = null;
      if (calls.length >= MAX_TOOL_CALLS) {
        outcome = { content: `Tool call limit reached (${MAX_TOOL_CALLS} per run). Nothing was filed.`, isError: true };
      } else if (toolUse.name !== FILE_ORDER_TOOL.name) {
        outcome = { content: `Unknown tool ${toolUse.name}. The only tool is file_order.`, isError: true };
      } else {
        const parsed = parseOrder(toolUse.input);
        if ("error" in parsed) {
          outcome = { content: parsed.error, isError: true };
        } else {
          order = parsed.order;
          outcome = await fileOrder(order);
        }
      }
      if (calls.length < MAX_TOOL_CALLS) calls.push({ input: toolUse.input, order, outcome });
      results.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: outcome.content,
        ...(outcome.isError ? { is_error: true } : {}),
      });
    }

    // The cap is hard: after the third call the run ends without asking Claude again.
    if (calls.length >= MAX_TOOL_CALLS) return { calls, finalText, stopReason: "tool_limit" };
    messages.push({ role: "user", content: results });
  }
}
