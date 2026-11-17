// Demo reset: run before every take so the dashboard starts clean.
//   npm run reset
// 1. Deletes every row from journal_entries, exceptions, deliveries, payments and orders
//    (children first). A copy of the deleted rows is saved to a temp file outside the repo.
// 2. Sets cheapdata back to 'approved' (beat 2 blocks it). Nothing else in sellers changes,
//    so the sellers keep their production urls.
// 3. Prints the agent (gateway) wallet's devnet USDC and SOL, and warns if either is low.
// It runs only against the Supabase project in .env.local, and stops before deleting if the
// tables don't have SPEC.md's columns. Never prints a key. Deletes are not one transaction:
// if one fails it stops, and rerunning finishes the job.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "../lib/db";
import { lamports, rpcUrl, tokenBalance } from "../scripts/lib/devnet";
import { balanceWarnings, formatUnits, RESET_TABLES, SPEC_COLUMNS, targetProblems } from "./lib/reset";
import { DEVNET_USDC_MINT } from "./lib/stolen-key";

function fail(message: string): number {
  console.error(`\nRESET STOPPED: ${message}`);
  return 1;
}

async function main(): Promise<number> {
  const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
  if (!existsSync(envFile)) return fail(`missing ${envFile}`);
  process.loadEnvFile(envFile); // never overrides variables already set
  const fileEnv = parseEnv(readFileSync(envFile, "utf8"));

  console.log(`Supabase project: ${fileEnv.NEXT_PUBLIC_SUPABASE_URL ?? "(not set)"}`);
  const problems = targetProblems(fileEnv, process.env);
  if (problems.length > 0) return fail(`nothing was deleted.\n  - ${problems.join("\n  - ")}`);

  // Untyped view of Nizar's service client, so the table loop below can name tables by string.
  const client: SupabaseClient = getServiceClient();

  // Every SPEC.md column must exist before anything is deleted.
  for (const [table, columns] of Object.entries(SPEC_COLUMNS)) {
    const { error } = await client.from(table).select(columns.join(",")).limit(1);
    if (error) return fail(`table ${table} doesn't match SPEC.md section 4 (${error.message}). Nothing was deleted.`);
  }

  // Back up every row we are about to delete.
  const backup: Record<string, unknown[]> = {};
  for (const { table } of RESET_TABLES) {
    const { data, count, error } = await client.from(table).select("*", { count: "exact" });
    if (error) return fail(`reading ${table} failed (${error.message}). Nothing was deleted.`);
    if (count !== data.length) return fail(`${table} has ${count} rows, more than one read returns. Nothing was deleted.`);
    backup[table] = data;
  }
  const backupFile = join(tmpdir(), `agent-auditor-reset-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  console.log(`Backup of the rows below: ${backupFile}`);

  const deleted: Record<string, number> = {};
  for (const { table, key } of RESET_TABLES) {
    const { count, error } = await client.from(table).delete({ count: "exact" }).not(key, "is", null);
    if (error) return fail(`deleting from ${table} failed (${error.message}). Tables before it are already empty; rerun.`);
    deleted[table] = count ?? 0;
  }

  const before = await client.from("sellers").select("status").eq("seller_id", "cheapdata").maybeSingle();
  if (before.error) return fail(`reading cheapdata failed (${before.error.message})`);
  if (!before.data) return fail("cheapdata isn't in sellers");
  const after = await client
    .from("sellers")
    .update({ status: "approved" })
    .eq("seller_id", "cheapdata")
    .select("status")
    .single();
  if (after.error) return fail(`un-blocking cheapdata failed (${after.error.message})`);

  const wallet = process.env.GATEWAY_WALLET_ADDRESS;
  const mint = process.env.USDC_MINT;
  let balances: string;
  let warnings: string[];
  try {
    if (!wallet) throw new Error("GATEWAY_WALLET_ADDRESS is not set in .env.local");
    if (mint !== DEVNET_USDC_MINT) throw new Error(`USDC_MINT must be the devnet mint ${DEVNET_USDC_MINT}`);
    rpcUrl(); // throws unless SOLANA_RPC_URL is a devnet endpoint
    const usdc = (await tokenBalance(wallet, mint)).amount;
    const sol = await lamports(wallet);
    balances = `${formatUnits(usdc, 6)} USDC, ${formatUnits(sol, 9)} SOL (${wallet})`;
    warnings = balanceWarnings(usdc, sol);
  } catch (error) {
    balances = "unknown";
    warnings = [`couldn't read the wallet balances: ${error instanceof Error ? error.message : String(error)}`];
  }

  console.log("\nReset summary");
  for (const { table } of RESET_TABLES) console.log(`  ${table.padEnd(16)} ${deleted[table]} rows deleted`);
  console.log(`  cheapdata        ${before.data.status} -> ${after.data.status}`);
  console.log(`  agent wallet     ${balances}`);
  if (warnings.length > 0) {
    console.error(`\n!!!!!!!!!! WARNING: DON'T RECORD YET !!!!!!!!!!\n  - ${warnings.join("\n  - ")}`);
    return 1;
  }
  console.log("\nReady to record.");
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`\nRESET FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
