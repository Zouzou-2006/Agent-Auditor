// Beat 4, stolen key (SPEC.md section 9). Sends 0.10 USDC from the gateway wallet straight to
// the attacker address, with no memo and no gateway, the way a thief holding the key would.
// Streams should then deliver the payment and a critical no_order exception should appear.
//
// Run from the repo root on the machine that holds the gateway key (reads .env.local:
// GATEWAY_WALLET_SECRET, GATEWAY_WALLET_ADDRESS, ATTACKER_WALLET_ADDRESS, USDC_MINT, SOLANA_RPC_URL):
//   node --import ./scripts/ts-resolve.mjs demo/beat4.ts
// Devnet only (the RPC and the mint are both checked). Never prints a private key.

import {
  appendTransactionMessageInstructions,
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
} from "@solana/kit";
import { parsePayment } from "../lib/solana/parse-payment";
import {
  env,
  explorerUrl,
  getParsedTransaction,
  lamports,
  loadEnv,
  rpc,
  rpcUrl,
  signerFromEnv,
  tokenAccountOwner,
  tokenBalance,
} from "../scripts/lib/devnet";
import { buildStolenKeyTransfer, preflightProblems, STOLEN_AMOUNT, verifySent } from "./lib/stolen-key";

async function main(): Promise<number> {
  loadEnv();
  const url = rpcUrl(); // throws unless SOLANA_RPC_URL is a devnet endpoint
  const sender = await signerFromEnv("GATEWAY_WALLET_SECRET");
  if (sender.address !== env("GATEWAY_WALLET_ADDRESS")) {
    console.error("GATEWAY_WALLET_SECRET does not match GATEWAY_WALLET_ADDRESS");
    return 1;
  }
  const attacker = env("ATTACKER_WALLET_ADDRESS");
  const mint = env("USDC_MINT");

  const transfer = await buildStolenKeyTransfer(sender, attacker, mint);
  const attackerAta = await rpc<{ value: unknown }>("getAccountInfo", [transfer.attackerAta, { encoding: "base64" }]);
  const facts = {
    sender: sender.address,
    attacker,
    mint,
    senderLamports: await lamports(sender.address),
    senderUsdc: (await tokenBalance(sender.address, mint)).amount,
    attackerAtaExists: attackerAta.value !== null,
  };
  console.log(`From (gateway): ${facts.sender}  ${facts.senderUsdc} USDC base units, ${facts.senderLamports} lamports`);
  console.log(`To (attacker):  ${attacker}`);
  console.log(`Amount:         ${STOLEN_AMOUNT} base units (0.10 USDC), no memo, no gateway`);
  const problems = preflightProblems(facts);
  if (problems.length > 0) {
    console.error(`Not sent:\n  - ${problems.join("\n  - ")}`);
    return 1;
  }

  const solanaRpc = createSolanaRpc(url);
  const subscriptions = createSolanaRpcSubscriptions(url.replace(/^http/, "ws"));
  const { value: blockhash } = await solanaRpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(sender, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(transfer.instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(signed);
  await sendAndConfirmTransactionFactory({ rpc: solanaRpc, rpcSubscriptions: subscriptions })(signed, {
    commitment: "confirmed",
  });
  const signature = getSignatureFromTransaction(signed);
  console.log(`\nSignature: ${signature}`);
  console.log(`Explorer:  ${explorerUrl(signature)}`);

  const sent = parsePayment(await getParsedTransaction(signature));
  for (const t of sent.transfers) t.destinationOwner ??= await tokenAccountOwner(t.destination);
  const wrong = verifySent(sent, attacker, mint);
  if (wrong.length > 0) {
    console.error(`On-chain check FAILED:\n  - ${wrong.join("\n  - ")}`);
    return 1;
  }
  console.log("On-chain check: one 0.10 USDC transfer to the attacker, no memo.");
  console.log("Now watch the dashboard: a critical no_order exception should appear within seconds.");
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
