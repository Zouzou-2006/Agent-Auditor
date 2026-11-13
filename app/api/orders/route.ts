// POST /api/orders: the gateway (owner: Nizar). SPEC.md section 10.
// 200 for every order outcome (denied is a normal answer), 400 for an invalid body,
// 502 if a payment was signed but its outcome is unknown, 500 for anything unexpected.
import { gatewayDeps } from "@/lib/gateway/deps";
import { placeOrder } from "@/lib/gateway/purchase";
import { parseOrderRequest } from "@/lib/gateway/validate";

export const dynamic = "force-dynamic";
// A purchase can take a while: seller call, settlement, then up to ~20 s waiting for booking.
export const maxDuration = 120;

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  const parsed = parseOrderRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  try {
    const result = await placeOrder(parsed.value, gatewayDeps());
    return Response.json(result.body, { status: result.http });
  } catch (cause) {
    // Full detail goes to the server log only; the response never carries messages, stacks or keys.
    console.error("POST /api/orders failed:", cause);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
