// POST /api/orders/[id]/approve: approve a pending_review order (owner: Nizar). SPEC.md section 10.
// Re-runs checkOrder (not needsReview), then the normal flow: 402 quote, checkQuote, pay.
// 200 with the same body as POST /api/orders, 404 unknown order, 409 not pending_review.
import { gatewayDeps } from "@/lib/gateway/deps";
import { approveOrder } from "@/lib/gateway/purchase";

export const dynamic = "force-dynamic";
// Same payment path as POST /api/orders: up to 90 s seller call + settlement + 20 s booking wait.
export const maxDuration = 300;

type Context = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_req: Request, { params }: Context): Promise<Response> {
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "order not found" }, { status: 404 });

  try {
    const result = await approveOrder(id, gatewayDeps());
    return Response.json(result.body, { status: result.http });
  } catch (cause) {
    console.error(`POST /api/orders/${id}/approve failed:`, cause);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
