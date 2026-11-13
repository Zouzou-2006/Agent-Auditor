// Small devnet helpers shared by the memo-test scripts. Devnet only. Never prints secrets.

import { existsSync } from "node:fs";
import { createKeyPairSignerFromBytes, getBase58Encoder, type KeyPairSigner } from "@solana/kit";
import type { ParsedTransaction } from "../../lib/solana/parse-payment";

export const DEVNET_GENESIS_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

export function loadEnv(): void {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
}

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in .env.local (run scripts/create-wallets.ts first)`);
  return value;
}

export function rpcUrl(): string {
  const url = env("SOLANA_RPC_URL");
  if (!/devnet/i.test(url)) throw new Error(`SOLANA_RPC_URL must be a devnet endpoint, got ${new URL(url).host}`);
  return url;
}

export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await response.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result as T;
}

export async function signerFromEnv(name: string): Promise<KeyPairSigner> {
  return createKeyPairSignerFromBytes(new Uint8Array(getBase58Encoder().encode(env(name))));
}

export async function lamports(address: string): Promise<bigint> {
  const result = await rpc<{ value: number }>("getBalance", [address, { commitment: "confirmed" }]);
  return BigInt(result.value);
}

interface TokenAccountsResult {
  value: { pubkey: string; account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[];
}

/** Total USDC (base units) held by `owner` across its token accounts for `mint`. */
export async function tokenBalance(owner: string, mint: string): Promise<{ accounts: string[]; amount: bigint }> {
  const result = await rpc<TokenAccountsResult>("getTokenAccountsByOwner", [
    owner,
    { mint },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  return {
    accounts: result.value.map((v) => v.pubkey),
    amount: result.value.reduce((sum, v) => sum + BigInt(v.account.data.parsed.info.tokenAmount.amount), 0n),
  };
}

/** Owner wallet of an SPL token account, looked up independently via RPC. */
export async function tokenAccountOwner(tokenAccount: string): Promise<string | null> {
  const result = await rpc<{ value: { data: { parsed?: { info?: { owner?: string } } } } | null }>(
    "getAccountInfo",
    [tokenAccount, { encoding: "jsonParsed", commitment: "confirmed" }],
  );
  return result.value?.data.parsed?.info?.owner ?? null;
}

export async function newestSignature(address: string): Promise<string | null> {
  const result = await rpc<{ signature: string }[]>("getSignaturesForAddress", [
    address,
    { limit: 1, commitment: "confirmed" },
  ]);
  return result[0]?.signature ?? null;
}

/** getTransaction(jsonParsed, v0), retried until the RPC node has indexed it. */
export async function getParsedTransaction(signature: string, timeoutMs = 60_000): Promise<ParsedTransaction> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const tx = await rpc<ParsedTransaction | null>("getTransaction", [
      signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
    ]);
    if (tx) return tx;
    if (Date.now() > deadline) throw new Error(`transaction ${signature} not found on devnet after ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

export function explorerUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}
