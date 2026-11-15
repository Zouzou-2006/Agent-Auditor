// CheapData: the seller that takes the money and delivers nothing (beat 2). Owner: Fabi.
// See SPEC.md section 6.
//
// It quotes exactly like DataCo ($0.10, memo = order_id), so every rule passes and the gateway
// pays. Once paid, it answers 200 with an EMPTY body. The delivery checks then fail "received",
// booking raises a high-severity `nothing_delivered` exception, and a human can Block Seller.

import { sellPaid } from "./paid";

export const CHEAPDATA_PRICE = 100000; // $0.10 in USDC base units

export function handleCheapData(req: Request): Promise<Response> {
  return sellPaid(req, {
    name: "CheapData",
    walletEnv: "CHEAPDATA_WALLET",
    price: CHEAPDATA_PRICE,
    deliver: () => ({ body: "", contentType: "application/json" }),
  });
}
