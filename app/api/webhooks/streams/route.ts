// POST /api/webhooks/streams (QuickNode Streams webhook + matcher). Owner: Nizar; built by Fabi
// as backup back-end coder. See SPEC.md sections 3 and 8.
//
// 1. Check the QuickNode signature (QUICKNODE_STREAMS_SECRET = the Stream's security token).
// 2. Keep only outgoing USDC payments from GATEWAY_WALLET_ADDRESS, save them to `payments`.
// 3. Memo = a known order -> tryBook(order_id). Otherwise -> flagUnmatchedPayment (stolen key).
import { gunzipSync } from "node:zlib";
import { flagUnmatchedPayment, tryBook } from "@/lib/booking";
import { matchPayments } from "@/lib/streams/matcher";
import { supabaseMatcherDeps } from "@/lib/streams/matcher-db";
import { verifyStreamsSignature } from "@/lib/streams/signature";

export const dynamic = "force-dynamic";
// A block can carry several payments, each matched and booked with database round trips.
export const maxDuration = 60;

async function readBody(req: Request): Promise<string> {
  const bytes = Buffer.from(await req.arrayBuffer());
  // Streams may gzip the body. If the platform already inflated it, gunzip fails and we use it as is.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      return gunzipSync(bytes).toString("utf8");
    } catch {
      // not actually gzip
    }
  }
  return bytes.toString("utf8");
}

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.QUICKNODE_STREAMS_SECRET;
  const gatewayWallet = process.env.GATEWAY_WALLET_ADDRESS;
  if (!secret || !gatewayWallet) {
    console.error("streams webhook: QUICKNODE_STREAMS_SECRET and GATEWAY_WALLET_ADDRESS must be set");
    return Response.json({ error: "webhook not configured" }, { status: 500 });
  }

  const body = await readBody(req);
  const signed = verifyStreamsSignature(
    secret,
    {
      nonce: req.headers.get("x-qn-nonce"),
      timestamp: req.headers.get("x-qn-timestamp"),
      signature: req.headers.get("x-qn-signature"),
    },
    body,
  );
  if (!signed) return Response.json({ error: "bad signature" }, { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return Response.json({ error: "body is not JSON" }, { status: 400 });
  }

  try {
    const results = await matchPayments(payload, gatewayWallet, {
      ...supabaseMatcherDeps(),
      tryBook: (order_id) => tryBook(order_id),
      flagUnmatchedPayment: (payment) => flagUnmatchedPayment(payment),
    });
    return Response.json({ ok: true, results });
  } catch (error) {
    // 500 makes Streams retry; every step is safe to repeat.
    console.error("streams webhook failed:", error);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
