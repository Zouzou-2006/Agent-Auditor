// Beat 1, clean purchase (SPEC.md section 9): the buyer agent buys today's SOL price quote.
//
// Run from the repo root (reads ANTHROPIC_API_KEY and GATEWAY_URL from .env.local):
//   node --import ./scripts/ts-resolve.mjs demo/beat1.ts            # files the order with the gateway
//   node --import ./scripts/ts-resolve.mjs demo/beat1.ts --dry-run  # prints the order instead of sending it
//
// --dry-run still calls Claude (about a cent) to build the order; it just doesn't POST it.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gatewayUrl, runBuyerAgent, type Order, type ToolOutcome } from "../lib/buyer-agent";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile); // never overrides variables already set

const dryRun = process.argv.includes("--dry-run");
const today = new Date().toISOString().slice(0, 10);
const task = "Get today's SOL price for the treasury report.";

async function dryRunFileOrder(order: Order): Promise<ToolOutcome> {
  console.log(`DRY RUN: would POST ${gatewayUrl()}/api/orders with body:`);
  console.log(JSON.stringify(order, null, 2));
  return { content: JSON.stringify({ dry_run: true, note: "Order not sent (dry run)." }), isError: false };
}

console.log(`Task: ${task} (today is ${today}, UTC)`);
const run = await runBuyerAgent(task, { today, ...(dryRun ? { fileOrder: dryRunFileOrder } : {}) });

for (const [i, call] of run.calls.entries()) {
  if (!dryRun && call.order) {
    console.log(`Order ${i + 1} sent to ${gatewayUrl()}/api/orders:`);
    console.log(JSON.stringify(call.order, null, 2));
  }
  if (!call.order) console.log(`Tool call ${i + 1} rejected before sending: ${call.outcome.content}`);
  else if (!dryRun) console.log(`Gateway reply${call.outcome.isError ? " (error)" : ""}: ${call.outcome.content}`);
}
if (run.calls.length === 0) console.log("The agent didn't file an order.");
console.log(`Agent (${run.stopReason}): ${run.finalText || "(no text)"}`);

process.exitCode = run.calls.some((call) => call.order && !call.outcome.isError) ? 0 : 1;
