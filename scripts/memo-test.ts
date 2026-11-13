// Memo test, step 2 (owner: Nizar). Needs the app running with ENABLE_MEMO_TEST_SELLER=1
// (e.g. `npm run build && npx next start -p 3456`) and scripts/memo-test-setup.ts passing.
//
//   npx tsx scripts/memo-test.ts [--base http://localhost:3456] [--only positive|wrong-memo|no-memo]
//
// positive   : seller quotes extra.memo = order_id; gateway guard allows; pay; verify on-chain.
// wrong-memo : seller quotes a different memo; gateway guard must refuse BEFORE signing.
// no-memo    : seller quotes no memo; guard deliberately bypassed (test only) to record what
//              memo the x402 client actually puts on-chain. Spends $0.10.

import { randomUUID } from "node:crypto";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { memoGuardHook } from "../lib/gateway/memo-guard";
import { parsePayment, type PaymentFacts } from "../lib/solana/parse-payment";
import {
  env,
  explorerUrl,
  getParsedTransaction,
  loadEnv,
  newestSignature,
  rpcUrl,
  signerFromEnv,
  tokenAccountOwner,
  tokenBalance,
} from "./lib/devnet";

const PRICE = "100000";
type Mode = "positive" | "wrong-memo" | "no-memo";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

let failures = 0;
function check(label: string, pass: boolean, detail: string): void {
  if (!pass) failures += 1;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}: ${detail}`);
}

async function payingClient(orderId: string, guard: boolean) {
  const signer = await signerFromEnv("GATEWAY_WALLET_SECRET");
  const client = new x402Client();
  client.register("solana:*", new ExactSvmScheme(signer, { rpcUrl: rpcUrl() }));
  client.setSpendControls({ maxAmountPerPayment: "$0.10" });
  const seen: { requirements?: PaymentRequirements; signed: boolean } = { signed: false };
  client.onBeforePaymentCreation(async (ctx) => {
    seen.requirements = ctx.selectedRequirements;
  });
  if (guard) client.onBeforePaymentCreation(memoGuardHook(orderId));
  client.onAfterPaymentCreation(async () => {
    seen.signed = true;
  });
  return { client, seen, signer };
}

/** Resolve owners from the tx's token balances, falling back to an independent RPC lookup. */
async function withOwners(facts: PaymentFacts): Promise<PaymentFacts> {
  for (const t of facts.transfers) {
    t.sourceOwner ??= await tokenAccountOwner(t.source);
    t.destinationOwner ??= await tokenAccountOwner(t.destination);
  }
  return facts;
}

async function pay(base: string, mode: Mode, orderId: string, guard: boolean) {
  const { client, seen } = await payingClient(orderId, guard);
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  const headers: Record<string, string> = { "X-Order-Id": orderId };
  if (mode !== "positive") headers["X-Memo-Test-Mode"] = mode;
  const response = await fetchWithPayment(`${base}/api/sellers/memo-test`, { headers });
  const body = await response.text();
  let settle: ReturnType<x402HTTPClient["getPaymentSettleResponse"]> | null = null;
  try {
    settle = new x402HTTPClient(client).getPaymentSettleResponse((name) => response.headers.get(name));
  } catch {
    settle = null;
  }
  return { response, body, settle, seen };
}

async function rawQuote(base: string, orderId: string): Promise<void> {
  const response = await fetch(`${base}/api/sellers/memo-test`, { headers: { "X-Order-Id": orderId } });
  const header = response.headers.get("PAYMENT-REQUIRED");
  console.log(`\nRaw 402 quote (HTTP ${response.status}) for order ${orderId}:`);
  console.log(header ? JSON.stringify(decodePaymentRequiredHeader(header), null, 2) : "(no PAYMENT-REQUIRED header)");
}

async function positive(base: string): Promise<void> {
  const orderId = randomUUID();
  const gateway = env("GATEWAY_WALLET_ADDRESS");
  const seller = env("TEST_SELLER_WALLET_ADDRESS");
  const mint = env("USDC_MINT");
  console.log(`\n=== POSITIVE: memo = order_id ${orderId}`);
  await rawQuote(base, orderId);

  const { response, body, settle, seen } = await pay(base, "positive", orderId, true);
  check("seller response", response.status === 200 && body.includes('"ok":true'), `HTTP ${response.status} ${body}`);
  check("quote memo", seen.requirements?.extra?.memo === orderId, String(seen.requirements?.extra?.memo));
  console.log(`  facilitator fee payer (from quote): ${String(seen.requirements?.extra?.feePayer)}`);
  check("settlement response", settle?.success === true && !!settle.transaction, JSON.stringify(settle));
  if (!settle?.transaction) return;

  const signature = settle.transaction;
  console.log(`  signature: ${signature}\n  explorer:  ${explorerUrl(signature)}`);
  const facts = await withOwners(parsePayment(await getParsedTransaction(signature)));
  console.log(`  instruction layout: ${facts.instructionLayout.join(" -> ")}`);

  check("transaction succeeded on-chain", facts.succeeded, `meta.err ${facts.succeeded ? "null" : "set"}`);
  check("SPL Memo == order_id", facts.memos.length === 1 && facts.memos[0] === orderId, JSON.stringify(facts.memos));
  check("exactly one token transfer", facts.transfers.length === 1, `${facts.transfers.length}`);
  const t = facts.transfers[0];
  if (!t) return;
  check("TransferChecked", t.type === "transferChecked", t.type);
  check("amount == 100000", t.amount === PRICE, t.amount);
  check("mint == USDC_MINT", t.mint === mint, String(t.mint));
  check("destination token account owner == test seller", t.destinationOwner === seller, `${t.destination} owned by ${t.destinationOwner}`);
  check("source token account owner == gateway", t.sourceOwner === gateway, `${t.source} owned by ${t.sourceOwner}`);
  check("transfer authority == gateway", t.authority === gateway, String(t.authority));
}

async function wrongMemo(base: string): Promise<void> {
  const orderId = randomUUID();
  const gateway = env("GATEWAY_WALLET_ADDRESS");
  console.log(`\n=== NEGATIVE A: seller quotes a different memo (order ${orderId})`);
  const beforeSig = await newestSignature(gateway);
  const beforeUsdc = (await tokenBalance(gateway, env("USDC_MINT"))).amount;

  let error: unknown = null;
  let seen: { requirements?: PaymentRequirements; signed: boolean } = { signed: false };
  try {
    const result = await pay(base, "wrong-memo", orderId, true);
    seen = result.seen;
  } catch (e) {
    error = e;
  }
  const message = error instanceof Error ? error.message : String(error);
  check("gateway refused the quote", /aborted/i.test(message), message);
  check("nothing was signed", !seen.signed, `signed=${seen.signed}`);

  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const afterSig = await newestSignature(gateway);
  const afterUsdc = (await tokenBalance(gateway, env("USDC_MINT"))).amount;
  check("no new transaction for the gateway", afterSig === beforeSig, `newest signature unchanged: ${afterSig === beforeSig}`);
  check("gateway USDC unchanged", afterUsdc === beforeUsdc, `${beforeUsdc} -> ${afterUsdc}`);
}

async function noMemo(base: string): Promise<void> {
  const orderId = randomUUID();
  console.log(`\n=== NEGATIVE B: seller quotes NO memo, guard bypassed for this test (order ${orderId})`);
  const { response, settle, seen } = await pay(base, "no-memo", orderId, false);
  check("quote had no memo", seen.requirements?.extra?.memo === undefined, JSON.stringify(seen.requirements?.extra));
  check("settled anyway (facilitator only checks memo when extra.memo is set)", settle?.success === true, `HTTP ${response.status}`);
  if (!settle?.transaction) return;

  const facts = parsePayment(await getParsedTransaction(settle.transaction));
  console.log(`  signature: ${settle.transaction}\n  explorer:  ${explorerUrl(settle.transaction)}`);
  console.log(`  instruction layout: ${facts.instructionLayout.join(" -> ")}`);
  const memo = facts.memos[0] ?? "";
  console.log(`  on-chain memo: ${JSON.stringify(facts.memos)}`);
  check("memo is a random 16-byte hex nonce", facts.memos.length === 1 && /^[0-9a-f]{32}$/.test(memo), memo);
  check("memo is NOT the order_id (unmatchable)", memo !== orderId, `${memo} != ${orderId}`);
}

async function main(): Promise<void> {
  loadEnv();
  const base = (arg("base") ?? "http://localhost:3456").replace(/\/$/, "");
  const only = arg("only") as Mode | undefined;
  // The SELLER chooses the facilitator; its fee payer shows up in each quote's extra.feePayer.
  console.log(`Seller base URL: ${base}\nGateway: ${env("GATEWAY_WALLET_ADDRESS")}`);

  if (!only || only === "positive") await positive(base);
  if (!only || only === "wrong-memo") await wrongMemo(base);
  if (!only || only === "no-memo") await noMemo(base);

  console.log(failures === 0 ? "\nALL ASSERTIONS PASSED" : `\n${failures} ASSERTION(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
