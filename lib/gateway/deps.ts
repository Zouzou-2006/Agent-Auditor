// Real dependencies for the gateway routes (owner: Nizar). Server only.

import "server-only";
import { randomUUID } from "node:crypto";
import { recordDelivery } from "./delivery";
import { getGatewayDb } from "./gateway-db";
import { createX402Pay } from "./pay";
import type { GatewayDeps } from "./purchase";

let pay: ReturnType<typeof createX402Pay> | null = null;

export function gatewayDeps(): GatewayDeps {
  const gatewayWallet = process.env.GATEWAY_WALLET_ADDRESS;
  if (!gatewayWallet) throw new Error("GATEWAY_WALLET_ADDRESS must be set");
  pay ??= createX402Pay();
  return {
    db: getGatewayDb(),
    pay,
    recordDelivery,
    gatewayWallet,
    newOrderId: randomUUID,
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    bookingWaitMs: 20_000,
    pollMs: 1_000,
  };
}
