// Memo test, step 1 (owner: Nizar). Run after the gateway wallet is funded:
//
//   npx tsx scripts/memo-test-setup.ts
//
// 1. Checks the gateway has devnet SOL + USDC (prints balances, never secrets).
// 2. Verifies the USDC mint on-chain (SPL Token program, 6 decimals).
// 3. Calls the facilitator's /supported and confirms x402 v2 `exact` on Solana devnet.
// 4. Creates the test seller's USDC associated token account if it doesn't exist.
//    x402 transfers to the seller's ATA but never creates it, and the facilitator's
//    simulation fails without it. The gateway pays the rent (~0.00204 SOL). Idempotent.

import {
  appendTransactionMessageInstruction,
  assertIsTransactionWithBlockhashLifetime,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  address,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  DEVNET_GENESIS_NETWORK,
  env,
  explorerUrl,
  lamports,
  loadEnv,
  rpc,
  rpcUrl,
  signerFromEnv,
  tokenBalance,
} from "./lib/devnet";

const MIN_SOL_LAMPORTS = 3_000_000n; // ATA rent (~2,039,280) + fee headroom
const MIN_USDC = 200_000n; // positive test + no-memo test, $0.10 each

async function main(): Promise<void> {
  loadEnv();
  const gateway = await signerFromEnv("GATEWAY_WALLET_SECRET");
  if (gateway.address !== env("GATEWAY_WALLET_ADDRESS")) {
    throw new Error("GATEWAY_WALLET_SECRET does not match GATEWAY_WALLET_ADDRESS");
  }
  const seller = address(env("TEST_SELLER_WALLET_ADDRESS"));
  const mint = address(env("USDC_MINT"));
  let ok = true;

  // 1. Balances
  const sol = await lamports(gateway.address);
  const usdc = await tokenBalance(gateway.address, mint);
  console.log(`Gateway ${gateway.address}`);
  console.log(`  SOL:  ${sol} lamports ${sol >= MIN_SOL_LAMPORTS ? "OK" : `NEED >= ${MIN_SOL_LAMPORTS}`}`);
  console.log(`  USDC: ${usdc.amount} base units ${usdc.amount >= MIN_USDC ? "OK" : `NEED >= ${MIN_USDC}`}`);
  if (sol < MIN_SOL_LAMPORTS || usdc.amount < MIN_USDC) ok = false;

  // 2. Mint
  const mintInfo = await rpc<{ value: { owner: string; data: { parsed: { info: { decimals: number } } } } | null }>(
    "getAccountInfo",
    [mint, { encoding: "jsonParsed" }],
  );
  const mintOk = mintInfo.value?.owner === TOKEN_PROGRAM_ADDRESS && mintInfo.value.data.parsed.info.decimals === 6;
  console.log(`Mint ${mint}: program=${mintInfo.value?.owner} decimals=${mintInfo.value?.data.parsed.info.decimals} ${mintOk ? "OK" : "UNEXPECTED"}`);
  if (!mintOk) ok = false;

  // 3. Facilitator
  const facilitatorUrl = env("X402_FACILITATOR_URL").replace(/\/$/, "");
  const supported = (await (await fetch(`${facilitatorUrl}/supported`)).json()) as {
    kinds: { x402Version: number; scheme: string; network: string; extra?: { feePayer?: string } }[];
  };
  const kind = supported.kinds.find(
    (k) => k.x402Version === 2 && k.scheme === "exact" && k.network === DEVNET_GENESIS_NETWORK,
  );
  console.log(`Facilitator ${facilitatorUrl}: ${kind ? `exact v2 on ${kind.network}, feePayer ${kind.extra?.feePayer}` : "does NOT support exact v2 on Solana devnet"}`);
  if (!kind) ok = false;

  // 4. Seller ATA
  const [sellerAta] = await findAssociatedTokenPda({ owner: seller, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const existing = await rpc<{ value: unknown }>("getAccountInfo", [sellerAta, { encoding: "base64" }]);
  if (existing.value) {
    console.log(`Seller USDC ATA ${sellerAta}: exists`);
  } else if (sol < MIN_SOL_LAMPORTS) {
    console.log(`Seller USDC ATA ${sellerAta}: MISSING (fund the gateway with SOL, then rerun)`);
    ok = false;
  } else {
    const solanaRpc = createSolanaRpc(rpcUrl());
    const subscriptions = createSolanaRpcSubscriptions(rpcUrl().replace(/^http/, "ws"));
    const { value: blockhash } = await solanaRpc.getLatestBlockhash().send();
    const instruction = await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: gateway, owner: seller, mint });
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(gateway, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstruction(instruction, m),
    );
    const signed = await signTransactionMessageWithSigners(message);
    assertIsTransactionWithBlockhashLifetime(signed);
    await sendAndConfirmTransactionFactory({ rpc: solanaRpc, rpcSubscriptions: subscriptions })(signed, {
      commitment: "confirmed",
    });
    const signature = getSignatureFromTransaction(signed);
    console.log(`Seller USDC ATA ${sellerAta}: CREATED ${explorerUrl(signature)}`);
  }

  console.log(ok ? "\nSETUP OK: run scripts/memo-test.ts" : "\nSETUP INCOMPLETE: see above");
  process.exit(ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
