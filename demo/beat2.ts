// Beat 2, empty delivery (SPEC.md section 9). The buyer agent buys from CheapData, which
// takes the payment and returns nothing, so a nothing_delivered exception appears. After a
// human clicks Block Seller, the agent tries again and is denied: "seller blocked".
//
// Run from the repo root with the app running (reads .env.local):
//   node --conditions=react-server --import ./scripts/ts-resolve.mjs demo/beat2.ts
// Each run calls Claude twice (about two cents) and pays CheapData $0.10 once.
// Exits 0 only if both steps happen. To retake the video, un-block CheapData first.

import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { getDb } from "../lib/booking-db";
import { postOrder, runBuyerAgent } from "../lib/buyer-agent";
import { oneOrderPerRun, runBeat2 } from "./lib/beat2";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile); // never overrides variables already set

const ok = await runBeat2({
  runAgent: (task) => runBuyerAgent(task, { fileOrder: oneOrderPerRun((order) => postOrder(order)) }),
  waitForEnter: async (prompt) => {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    await terminal.question(`\n${prompt} `);
    terminal.close();
  },
  orderStatus: async (order_id) => (await getDb().getOrder(order_id))?.status ?? null,
  log: (line) => console.log(line),
});

console.log(ok ? "BEAT 2 PASS" : "BEAT 2 FAIL");
process.exitCode = ok ? 0 : 1;
