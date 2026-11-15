// The x402 flow every fake seller shares (SPEC.md section 6). Owner: Fabi.
//
//   no payment            -> 402 with the quote (amount, payTo, USDC mint, devnet, memo = order_id)
//   payment that settles  -> 200 with whatever the seller chooses to deliver
//   payment that doesn't  -> 402 again, and nothing is delivered
// A bad request (missing wallet, bad ticker/date, no X-Order-Id) is refused BEFORE any quote,
// so nobody is charged for a request the seller can't serve.

import { parseParams } from "./dataco";
import {
  ORDER_ID_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  buildRequirements,
  encodeHeader,
  paymentRequiredResponse,
  verifyAndSettle,
} from "./x402";

// orders.order_id is a uuid.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a seller hands over once paid: a body and its content type. */
export interface Delivery {
  body: string;
  contentType: string;
}

export interface PaidSeller {
  /** Shown in the quote's description, e.g. "DataCo". */
  name: string;
  /** Env var holding the seller's owner wallet (the quote's payTo). */
  walletEnv: string;
  /** USDC base units. */
  price: number;
  deliver(ticker: string, date: string): Delivery;
}

export async function sellPaid(req: Request, seller: PaidSeller): Promise<Response> {
  const wallet = process.env[seller.walletEnv];
  if (!wallet) {
    return Response.json({ error: `${seller.walletEnv} is not set (see .env.example)` }, { status: 500 });
  }

  const url = new URL(req.url);
  const parsed = parseParams(url.searchParams);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  // The memo must be the gateway's order_id, the same value on the 402 and on the paid retry.
  const orderId = req.headers.get(ORDER_ID_HEADER);
  if (!orderId || !UUID.test(orderId)) {
    return Response.json({ error: `${ORDER_ID_HEADER} header with the order_id is required` }, { status: 400 });
  }

  const requirements = await buildRequirements(seller.price, wallet, orderId);
  const resource = {
    url: url.toString(),
    description: `${seller.name} ${parsed.ticker} price quote for ${parsed.date}`,
    mimeType: "application/json",
  };

  const payment = req.headers.get(PAYMENT_SIGNATURE_HEADER);
  if (!payment) return paymentRequiredResponse(requirements, resource);

  const settled = await verifyAndSettle(payment, requirements);
  if (!settled.ok) return paymentRequiredResponse(requirements, resource, settled.reason);

  const delivery = seller.deliver(parsed.ticker, parsed.date);
  return new Response(delivery.body, {
    status: 200,
    headers: {
      "content-type": delivery.contentType,
      [PAYMENT_RESPONSE_HEADER]: encodeHeader({
        success: true,
        transaction: settled.transaction,
        network: settled.network,
        payer: settled.payer,
      }),
    },
  });
}
