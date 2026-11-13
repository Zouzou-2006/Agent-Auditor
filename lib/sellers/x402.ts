// Seller side of x402 (v2) for the fake sellers. Owner: Fabi, paired with Nizar on the x402 part.
// See SPEC.md sections 3 and 6.
//
// How one paid call works:
//   1. The buyer calls the seller with no payment. We answer 402 with a quote: the amount, the
//      wallet to pay (`payTo`), the asset (the devnet USDC mint) and the network.
//   2. The buyer signs a USDC transfer and calls again with it in the PAYMENT-SIGNATURE header.
//   3. We ask the facilitator to verify the payment, then to settle it (put it on-chain).
//   4. Only after settlement succeeds does the seller hand over the data.
//
// No new dependency: the facilitator speaks plain JSON over HTTP, so this uses fetch.

import rules from "../../config/rules.json";

export const X402_VERSION = 2;

/** Request header carrying the buyer's signed payment (base64 JSON). */
export const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";
/** Response header carrying the quote on a 402 (base64 JSON). */
export const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
/** Response header carrying the settlement result on a paid response (base64 JSON). */
export const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";
/** Request header the gateway sends on every seller call; its value becomes the payment memo. */
export const ORDER_ID_HEADER = "X-Order-Id";

/** One way to pay, as x402 v2 sends it. `amount` is a string of USDC base units. */
export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { feePayer?: string; memo: string };
}

export interface PaymentRequired {
  x402Version: number;
  error?: string;
  resource: { url: string; description: string; mimeType: string };
  accepts: PaymentRequirements[];
}

export type SettleResult =
  | { ok: true; transaction: string; network: string; payer?: string }
  | { ok: false; reason: string };

export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeHeader(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

function facilitatorUrl(): string {
  const url = process.env.X402_FACILITATOR_URL;
  if (!url) throw new Error("X402_FACILITATOR_URL must be set (see .env.example)");
  return url.replace(/\/+$/, "");
}

let feePayerCache: { url: string; feePayer: string | undefined } | null = null;

/**
 * On Solana the facilitator pays the transaction fee, so the quote must name its fee-payer
 * address in `extra.feePayer`. We read it once from the facilitator's /supported list.
 */
async function facilitatorFeePayer(): Promise<string | undefined> {
  const url = facilitatorUrl();
  if (feePayerCache?.url === url) return feePayerCache.feePayer;
  const res = await fetch(`${url}/supported`);
  if (!res.ok) throw new Error(`facilitator /supported returned ${res.status}`);
  const body = (await res.json()) as {
    kinds?: { scheme?: string; network?: string; extra?: { feePayer?: string } }[];
  };
  const kind = body.kinds?.find((k) => k.scheme === "exact" && k.network === rules.network);
  feePayerCache = { url, feePayer: kind?.extra?.feePayer };
  return feePayerCache.feePayer;
}

/** Test helper: forget the cached fee payer. */
export function resetFeePayerCache(): void {
  feePayerCache = null;
}

/**
 * The quote: `amount` base units of devnet USDC, paid to `payTo`, on Solana devnet.
 * In x402 the seller picks the memo, so we put the gateway's order_id there. That memo is how the
 * Streams matcher links the on-chain payment to its order; without it every payment would look
 * like the stolen-key case (`no_order`).
 */
export async function buildRequirements(amount: number, payTo: string, memo: string): Promise<PaymentRequirements> {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`bad amount ${amount}`);
  return {
    scheme: "exact",
    network: rules.network,
    amount: String(amount),
    asset: rules.usdc_mint, // the mint address, not the word "USDC" (rule 6)
    payTo,
    maxTimeoutSeconds: 60,
    extra: { feePayer: await facilitatorFeePayer(), memo },
  };
}

/** HTTP 402 with the quote, both in the PAYMENT-REQUIRED header and as the JSON body. */
export function paymentRequiredResponse(
  requirements: PaymentRequirements,
  resource: PaymentRequired["resource"],
  error = "payment required",
): Response {
  const body: PaymentRequired = { x402Version: X402_VERSION, error, resource, accepts: [requirements] };
  return Response.json(body, {
    status: 402,
    headers: { [PAYMENT_REQUIRED_HEADER]: encodeHeader(body) },
  });
}

async function postFacilitator(path: "verify" | "settle", body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${facilitatorUrl()}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok && json.isValid === undefined && json.success === undefined) {
    return { isValid: false, success: false, errorReason: `facilitator /${path} returned ${res.status}` };
  }
  return json;
}

/**
 * Verify, then settle, the buyer's payment against our quote. Nothing is delivered unless this
 * returns ok, so a seller never gives data away for a payment that didn't land.
 */
export async function verifyAndSettle(
  paymentHeader: string,
  requirements: PaymentRequirements,
): Promise<SettleResult> {
  let paymentPayload: unknown;
  try {
    paymentPayload = decodeHeader(paymentHeader);
  } catch {
    return { ok: false, reason: "payment header is not base64 JSON" };
  }
  const request = { x402Version: X402_VERSION, paymentPayload, paymentRequirements: requirements };

  const verified = await postFacilitator("verify", request);
  if (verified.isValid !== true) {
    return { ok: false, reason: String(verified.invalidReason ?? verified.errorReason ?? "payment invalid") };
  }

  const settled = await postFacilitator("settle", request);
  if (settled.success !== true || typeof settled.transaction !== "string") {
    return { ok: false, reason: String(settled.errorReason ?? "settlement failed") };
  }
  return {
    ok: true,
    transaction: settled.transaction,
    network: String(settled.network ?? requirements.network),
    payer: typeof settled.payer === "string" ? settled.payer : undefined,
  };
}
