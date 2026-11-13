// POST /api/summaries: fill missing one-sentence AI summaries (owner: Nizar, for the dashboard).
// Body (optional): { "order_id": "<uuid>" } to summarize one order, otherwise up to 8 orders and
// 8 exceptions whose summary is null. Writes ONLY the `summary` column, and only where it is still
// null, so it never overwrites a summary or touches a status. The decision itself is never AI-made.
// -> 200 { "orders": n, "exceptions": n }, 503 without ANTHROPIC_API_KEY, 500 { "error": "internal error" }.

import Anthropic from "@anthropic-ai/sdk";
import { loadDashboardData } from "@/lib/dashboard/load";
import { getServiceClient } from "@/lib/db";
import { cleanSummary, exceptionFacts, exceptionsNeedingSummary, orderFacts, ordersNeedingSummary, SUMMARY_SYSTEM } from "@/lib/summaries";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MODEL = "claude-opus-5-5";
const BATCH = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function summarize(client: Anthropic, facts: string): Promise<string | null> {
  const message = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: SUMMARY_SYSTEM,
    messages: [{ role: "user", content: facts }],
  });
  if (message.stop_reason === "refusal") return null;
  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return cleanSummary(text);
}

export async function POST(req: Request): Promise<Response> {
  let orderId: string | null = null;
  try {
    const body = (await req.json().catch(() => ({}))) as { order_id?: unknown };
    if (body.order_id !== undefined) {
      if (typeof body.order_id !== "string" || !UUID.test(body.order_id)) {
        return Response.json({ error: "order_id must be a uuid" }, { status: 400 });
      }
      orderId = body.order_id;
    }
  } catch {
    orderId = null;
  }
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "summaries are not configured (ANTHROPIC_API_KEY)" }, { status: 503 });

  try {
    const db = await getServiceClient();
    const data = await loadDashboardData(db);
    const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const orders = orderId
      ? data.orders.filter((o) => o.order_id === orderId && o.summary === null)
      : ordersNeedingSummary(data, BATCH);
    const exceptions = orderId
      ? data.exceptions.filter((e) => e.order_id === orderId && e.summary === null)
      : exceptionsNeedingSummary(data, BATCH);

    const orderResults = await Promise.all(
      orders.map(async (o) => {
        const summary = await summarize(claude, orderFacts(o, data));
        if (!summary) return 0;
        const { data: rows, error } = await db.from("orders").update({ summary }).eq("order_id", o.order_id).is("summary", null).select("order_id");
        if (error) throw new Error(`orders summary update failed: ${error.message}`);
        return rows.length;
      }),
    );
    const exceptionResults = await Promise.all(
      exceptions.map(async (e) => {
        const summary = await summarize(claude, exceptionFacts(e, data));
        if (!summary) return 0;
        const { data: rows, error } = await db.from("exceptions").update({ summary }).eq("exception_id", e.exception_id).is("summary", null).select("exception_id");
        if (error) throw new Error(`exceptions summary update failed: ${error.message}`);
        return rows.length;
      }),
    );

    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    return Response.json({ orders: sum(orderResults), exceptions: sum(exceptionResults) });
  } catch (cause) {
    console.error("POST /api/summaries failed:", cause);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
