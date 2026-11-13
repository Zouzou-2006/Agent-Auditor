// Generates the devnet wallets for the gateway and the memo test.
//
//   npx tsx scripts/create-wallets.ts
//
// - Gateway keypair        -> GATEWAY_WALLET_SECRET / GATEWAY_WALLET_ADDRESS
// - Throwaway test seller  -> TEST_SELLER_WALLET_SECRET / TEST_SELLER_WALLET_ADDRESS
// - Attacker (address only; its secret is discarded) -> ATTACKER_WALLET_ADDRESS
//
// Secrets are written ONLY to .env.local (gitignored) and are never printed.
// If any of these variables already has a value, the script refuses to run, so
// existing wallets (and their devnet funds) are never overwritten.
// Owner: Nizar. Devnet only.

import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createKeyPairSignerFromBytes, getBase58Decoder } from "@solana/kit";

export const WALLET_KEYS = [
  "GATEWAY_WALLET_SECRET",
  "GATEWAY_WALLET_ADDRESS",
  "TEST_SELLER_WALLET_SECRET",
  "TEST_SELLER_WALLET_ADDRESS",
  "ATTACKER_WALLET_ADDRESS",
] as const;

/** Defaults filled in only when the variable is missing or empty. */
export const DEVNET_DEFAULTS: Record<string, string> = {
  SOLANA_RPC_URL: "https://api.devnet.solana.com",
  X402_FACILITATOR_URL: "https://x402.org/facilitator",
  USDC_MINT: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

export interface GeneratedWallet {
  address: string;
  /** base58 of the 64-byte Solana keypair (32-byte seed + 32-byte public key) */
  secret: string;
}

/** Create a new ed25519 keypair and return it in Solana's 64-byte base58 format. */
export async function generateWallet(): Promise<GeneratedWallet> {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = Buffer.from(privateKey.export({ format: "jwk" }).d as string, "base64url");
  const pub = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url");
  const bytes = new Uint8Array(Buffer.concat([seed, pub]));
  // Round-trip through @solana/kit: this verifies the public key matches the seed.
  const signer = await createKeyPairSignerFromBytes(bytes);
  return { address: signer.address, secret: getBase58Decoder().decode(bytes) };
}

/** Value of KEY=value lines (last one wins). Comments and blank lines are ignored. */
export function parseEnv(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (match) values.set(match[1], match[2].trim());
  }
  return values;
}

/**
 * Set KEY=value in an env file's text: replace the existing line, or append one.
 * Every other line is left exactly as it was.
 */
export function setEnvValues(text: string, updates: Record<string, string>): string {
  const lines = text.length > 0 ? text.replace(/\r?\n$/, "").split(/\r?\n/) : [];
  const pending = new Map(Object.entries(updates));
  const out = lines.map((line) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match && pending.has(match[1])) {
      const value = pending.get(match[1]) as string;
      pending.delete(match[1]);
      return `${match[1]}=${value}`;
    }
    return line;
  });
  for (const [key, value] of pending) out.push(`${key}=${value}`);
  return `${out.join("\n")}\n`;
}

/** Wallet variables that already have a value (these must never be overwritten). */
export function existingWalletKeys(env: Map<string, string>): string[] {
  return WALLET_KEYS.filter((key) => (env.get(key) ?? "") !== "");
}

function isGitIgnored(path: string): boolean {
  return spawnSync("git", ["check-ignore", "-q", path]).status === 0;
}

async function main(): Promise<void> {
  const envPath = ".env.local";

  if (!isGitIgnored(envPath)) {
    console.error(`Refusing to run: ${envPath} is not ignored by git. Fix .gitignore first.`);
    process.exit(1);
  }

  let text = "";
  if (existsSync(envPath)) text = readFileSync(envPath, "utf8");
  else if (existsSync(".env.example")) text = readFileSync(".env.example", "utf8");

  const current = parseEnv(existsSync(envPath) ? text : "");
  const already = existingWalletKeys(current);
  if (already.length > 0) {
    console.error(
      `Refusing to overwrite existing wallet values in ${envPath}: ${already.join(", ")}.\n` +
        "Those wallets may hold devnet funds. Remove them yourself only if you really mean to replace them.",
    );
    process.exit(1);
  }

  const gateway = await generateWallet();
  const seller = await generateWallet();
  const attacker = await generateWallet(); // only the address is kept

  const updates: Record<string, string> = {
    GATEWAY_WALLET_SECRET: gateway.secret,
    GATEWAY_WALLET_ADDRESS: gateway.address,
    TEST_SELLER_WALLET_SECRET: seller.secret,
    TEST_SELLER_WALLET_ADDRESS: seller.address,
    ATTACKER_WALLET_ADDRESS: attacker.address,
  };
  const template = parseEnv(text);
  for (const [key, value] of Object.entries(DEVNET_DEFAULTS)) {
    if ((template.get(key) ?? "") === "") updates[key] = value;
  }

  writeFileSync(envPath, setEnvValues(text, updates), { encoding: "utf8", mode: 0o600 });

  console.log(`Wrote ${envPath} (secrets are not printed). Public addresses:`);
  console.log(`  Gateway wallet:      ${gateway.address}`);
  console.log(`  Test seller wallet:  ${seller.address}`);
  console.log(`  Attacker address:    ${attacker.address}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
