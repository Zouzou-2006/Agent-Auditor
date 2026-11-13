// POST /api/assistant: the dashboard copilot (owner: Nizar). Read-only Q&A over the six tables.
// Body: { "messages": [{ "role": "user" | "assistant", "content": "..." }] } (last one is the user's).
// Streams newline-delimited JSON events: {"t":"text","v":"..."} | {"t":"tool","v":"get_overview"}
// | {"t":"error","v":"..."} | {"t":"done"}. 400 for a bad body, 503 if the Claude key is missing.
// The tools can only read (lib/assistant/tools.ts), and the data comes from the anon client.

import Anthropic from "@anthropic-ai/sdk";
import rulesJson from "@/config/rules.json";
import { runTool, SYSTEM_PROMPT, ToolInputError, TOOLS, type ToolContext } from "@/lib/assistant/tools";
import type { Rules } from "@/lib/dashboard/model";
import { loadDashboardData } from "@/lib/dashboard/load";
import { getBrowserClient } from "@/lib/db-browser";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MODEL = "claude-opus-5-5";
const MAX_TURNS = 8; // tool round-trips per question
const MAX_HISTORY = 20;
const MAX_CHARS = 4000;

type ChatTurn = { role: "user" | "assistant"; content: string };

function parseBody(body: unknown): ChatTurn[] | null {
  if (!body || typeof body !== "object" || !("messages" in body) || !Array.isArray(body.messages)) return null;
  const turns: ChatTurn[] = [];
  for (const m of body.messages as unknown[]) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim()) return null;
    turns.push({ role, content: content.slice(0, MAX_CHARS) });
  }
  const recent = turns.slice(-MAX_HISTORY);
  while (recent.length && recent[0].role !== "user") recent.shift();
  return recent.length && recent[recent.length - 1].role === "user" ? recent : null;
}

export async function POST(req: Request): Promise<Response> {
  let turns: ChatTurn[] | null = null;
  try {
    turns = parseBody(await req.json());
  } catch {
    turns = null;
  }
  if (!turns) return Response.json({ error: 'body must be {"messages": [...]} ending with a user message' }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "copilot is not configured (ANTHROPIC_API_KEY)" }, { status: 503 });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();
  const history = turns;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: { t: string; v?: string }) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const ctx: ToolContext = {
          data: await loadDashboardData(getBrowserClient()),
          rules: rulesJson as Rules,
          gatewayWallet: process.env.GATEWAY_WALLET_ADDRESS ?? null,
          now: new Date(),
        };
        const messages: Anthropic.Beta.BetaMessageParam[] = history.map((t) => ({ role: t.role, content: t.content }));

        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const response = client.beta.messages.stream({
            model: MODEL,
            max_tokens: 16000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: { effort: "low" },
            system: SYSTEM_PROMPT,
            tools: TOOLS,
            messages,
          });
          response.on("text", (delta) => send({ t: "text", v: delta }));
          const message = await response.finalMessage();

          if (message.stop_reason === "refusal") {
            send({ t: "error", v: "The copilot declined to answer that question." });
            break;
          }
          const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
          if (message.stop_reason !== "tool_use" || toolUses.length === 0) {
            if (message.stop_reason === "max_tokens") send({ t: "error", v: "The answer was cut off (too long)." });
            break;
          }

          messages.push({ role: "assistant", content: message.content });
          const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((use) => {
            send({ t: "tool", v: use.name });
            try {
              return { type: "tool_result", tool_use_id: use.id, content: JSON.stringify(runTool(use.name, use.input, ctx)) };
            } catch (err) {
              const msg = err instanceof ToolInputError ? err.message : "tool failed";
              return { type: "tool_result", tool_use_id: use.id, content: msg, is_error: true };
            }
          });
          messages.push({ role: "user", content: results });
          if (turn === MAX_TURNS - 1) send({ t: "error", v: "Stopped after too many lookups. Try a narrower question." });
        }
      } catch (err) {
        console.error("POST /api/assistant failed:", err);
        const v =
          err instanceof Anthropic.RateLimitError
            ? "The copilot is rate limited. Try again in a moment."
            : err instanceof Anthropic.AuthenticationError
              ? "The copilot's Claude API key was rejected."
              : err instanceof Anthropic.APIError
                ? `Claude API error (${err.status ?? "network"}).`
                : "The copilot couldn't load the data.";
        send({ t: "error", v });
      }
      send({ t: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
