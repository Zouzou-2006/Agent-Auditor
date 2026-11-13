// Throwaway x402 seller for the memo test (owner: Nizar). NOT one of Fabi's sellers.
//
// GET /api/sellers/memo-test   headers: X-Order-Id: <uuid>
// Charges 100000 base units of devnet USDC to TEST_SELLER_WALLET_ADDRESS and returns {"ok":true}
// after the payment settles. The 402 quote carries extra.memo = X-Order-Id.
//
// Test-only header X-Memo-Test-Mode switches the quote for the negative tests:
//   "wrong-memo" -> extra.memo is a different, fresh UUID
//   "no-memo"    -> no extra.memo at all
// Disabled (404) unless ENABLE_MEMO_TEST_SELLER=1, so it never runs in a deployed app.

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { withX402 } from "@x402/next";
import { ExactSvmScheme } from "@x402/svm/exact/server";

export const dynamic = "force-dynamic";

const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const PRICE_BASE_UNITS = "100000"; // $0.10 USDC, integer base units
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let server: x402ResourceServer | null = null;
let ready: Promise<void> | null = null;

/** One resource server per process; facilitator /supported is fetched once. */
function getServer(): { server: x402ResourceServer; ready: Promise<void> } {
  if (!server || !ready) {
    const facilitator = new HTTPFacilitatorClient({ url: requireEnv("X402_FACILITATOR_URL") });
    server = new x402ResourceServer(facilitator).register(
      SOLANA_DEVNET,
      new ExactSvmScheme({ rpcUrl: requireEnv("SOLANA_RPC_URL") }),
    );
    ready = server.initialize().catch((error: unknown) => {
      server = null;
      ready = null;
      throw error;
    });
  }
  return { server, ready };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function paidHandler(): Promise<NextResponse<{ ok: true }>> {
  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest): Promise<Response> {
  if (process.env.ENABLE_MEMO_TEST_SELLER !== "1") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const orderId = request.headers.get("x-order-id") ?? "";
  if (!UUID.test(orderId)) {
    return NextResponse.json({ error: "X-Order-Id must be a UUID" }, { status: 400 });
  }

  const mode = request.headers.get("x-memo-test-mode") ?? "normal";
  let extra: Record<string, unknown>;
  if (mode === "normal") extra = { memo: orderId };
  else if (mode === "wrong-memo") extra = { memo: randomUUID() };
  else if (mode === "no-memo") extra = {};
  else return NextResponse.json({ error: "unknown X-Memo-Test-Mode" }, { status: 400 });

  const { server: resourceServer, ready: initialized } = getServer();
  await initialized;

  // Built per request because extra.memo depends on the request (x402 route config only
  // supports per-request price/payTo functions, not per-request extra).
  const handler = withX402(
    paidHandler,
    {
      accepts: {
        scheme: "exact",
        network: SOLANA_DEVNET,
        payTo: requireEnv("TEST_SELLER_WALLET_ADDRESS"),
        price: { amount: PRICE_BASE_UNITS, asset: requireEnv("USDC_MINT") },
        maxTimeoutSeconds: 120,
        extra,
      },
      description: "Agent Auditor memo test",
      mimeType: "application/json",
    },
    resourceServer,
    undefined,
    undefined,
    false, // already initialized above
  );
  return handler(request);
}
