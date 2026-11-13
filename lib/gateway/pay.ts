// x402 payment for the gateway (owner: Nizar). Server only: holds the gateway wallet key.
//
// The gateway is the x402 CLIENT. It calls the seller with X-Order-Id, gets the 402 quote, asks
// `decide` (checkQuote + memo guard) whether to pay, and only then signs. `decide` runs in
// x402Client.onBeforePaymentCreation, i.e. BEFORE the transaction is built or signed, so a refusal
// can never move money. The seller (not us) talks to the facilitator.

import { createKeyPairSignerFromBytes, getBase58Encoder, type KeyPairSigner } from "@solana/kit";
import type { PaymentRequirements } from "@x402/core/types";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import rules from "../../config/rules.json";
import type { Quote } from "../rules";
import { toQuote } from "./validate";

export type Decision = { ok: true } | { ok: false; reason: string };

export interface PayRequest {
  url: string;
  orderId: string;
  /** Called with the seller's quote before anything is signed. */
  decide: (requirements: PaymentRequirements, quote: Quote | null) => Promise<Decision>;
}

export type PayOutcome =
  /** decide() said no. Nothing was signed. */
  | { kind: "refused"; reason: string; quote: Quote | null }
  /** Something failed before anything was signed (seller error, bad 402, network). No money moved. */
  | { kind: "failed"; error: string; quote: Quote | null }
  /** A payment WAS signed but settlement wasn't confirmed. Money may or may not move. */
  | { kind: "unknown"; error: string; quote: Quote | null; signature: string | null }
  /** Settled: `signature` is the on-chain transaction, `body` exactly what the seller returned. */
  | { kind: "paid"; signature: string; body: string; httpStatus: number; quote: Quote };

export type Pay = (request: PayRequest) => Promise<PayOutcome>;

const SELLER_TIMEOUT_MS = 90_000;

/** "$1.000000" from integer base units, without floating point. */
export function usdFromBaseUnits(units: number): string {
  return `$${Math.floor(units / 1_000_000)}.${String(units % 1_000_000).padStart(6, "0")}`;
}

let signerPromise: Promise<KeyPairSigner> | null = null;

function gatewaySigner(): Promise<KeyPairSigner> {
  signerPromise ??= (async () => {
    const secret = process.env.GATEWAY_WALLET_SECRET;
    const address = process.env.GATEWAY_WALLET_ADDRESS;
    if (!secret || !address) throw new Error("GATEWAY_WALLET_SECRET and GATEWAY_WALLET_ADDRESS must be set");
    const signer = await createKeyPairSignerFromBytes(new Uint8Array(getBase58Encoder().encode(secret)));
    if (signer.address !== address) throw new Error("GATEWAY_WALLET_SECRET does not match GATEWAY_WALLET_ADDRESS");
    return signer;
  })().catch((error: unknown) => {
    signerPromise = null;
    throw error;
  });
  return signerPromise;
}

export function createX402Pay(): Pay {
  return async ({ url, orderId, decide }) => {
    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) throw new Error("SOLANA_RPC_URL must be set");

    const client = new x402Client();
    client.register("solana:*", new ExactSvmScheme(await gatewaySigner(), { rpcUrl }));
    // Defence in depth: never sign more than the per-purchase cap, whatever decide() says.
    client.setSpendControls({ maxAmountPerPayment: usdFromBaseUnits(rules.max_per_purchase) });

    // Filled in by the hooks below (an object, so TypeScript doesn't narrow it away).
    const state: { quote: Quote | null; refusal: string | null; signed: boolean } = {
      quote: null,
      refusal: null,
      signed: false,
    };
    client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
      state.quote = toQuote(selectedRequirements);
      const decision = await decide(selectedRequirements, state.quote);
      if (!decision.ok) {
        state.refusal = decision.reason;
        return { abort: true, reason: decision.reason };
      }
      return undefined;
    });
    client.onAfterPaymentCreation(async () => {
      state.signed = true;
    });

    let response: Response;
    try {
      response = await wrapFetchWithPayment(fetch, client)(url, {
        method: "GET",
        headers: { "X-Order-Id": orderId },
        signal: AbortSignal.timeout(SELLER_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (state.refusal !== null) return { kind: "refused", reason: state.refusal, quote: state.quote };
      if (state.signed) return { kind: "unknown", error: message, quote: state.quote, signature: null };
      return { kind: "failed", error: message, quote: state.quote };
    }

    const body = await response.text();
    let settle: { success?: boolean; transaction?: string; errorReason?: string } | null = null;
    try {
      settle = new x402HTTPClient(client).getPaymentSettleResponse((name) => response.headers.get(name));
    } catch {
      settle = null;
    }

    if (!state.signed) {
      return { kind: "failed", error: `seller answered HTTP ${response.status} without taking payment`, quote: state.quote };
    }
    if (response.ok && settle?.success === true && typeof settle.transaction === "string" && state.quote) {
      return { kind: "paid", signature: settle.transaction, body, httpStatus: response.status, quote: state.quote };
    }
    return {
      kind: "unknown",
      error: `seller answered HTTP ${response.status}${settle?.errorReason ? ` (${settle.errorReason})` : ""}`,
      quote: state.quote,
      signature: typeof settle?.transaction === "string" && settle.transaction !== "" ? settle.transaction : null,
    };
  };
}
