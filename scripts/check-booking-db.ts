// Live check of the Supabase Db (lib/booking-db.ts) against the real database.
//
// Run from the repo root, with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local:
//   node --conditions=react-server --import ./scripts/ts-resolve.mjs scripts/check-booking-db.ts
//
// It inserts a test seller, order (status "paid"), payment and delivery, runs tryBook, prints the
// journal entry it got, checks a second tryBook is "skipped", then deletes every row it created,
// even if a step failed. Exits 1 on any failure. Never prints keys.

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tryBook } from "../lib/booking";
import { getDb, type BookingDatabase } from "../lib/booking-db";
import { getServiceClient } from "../lib/db";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (!existsSync(envFile)) {
  console.error(`Missing ${envFile}. Copy .env.example to .env.local and fill in the Supabase values.`);
  process.exit(1);
}
process.loadEnvFile(envFile); // never overrides variables already set in the environment

const run = randomUUID().slice(0, 8);
const SELLER_ID = `check-booking-db-${run}`;
const ORDER_ID = randomUUID();
const TX = `check-booking-db-${run}`;
const SELLER_WALLET = `CheckBookingDbSeller${run}`; // fake addresses: never a real wallet,
const FROM_WALLET = `CheckBookingDbBuyer${run}`; //   so the test payment can't count toward todaySpent
const today = new Date().toISOString().slice(0, 10);

// Nizar's client, typed with BookingDatabase so inserts are checked (see lib/booking-db.ts).
const client: SupabaseClient<BookingDatabase> = getServiceClient();

type QueryError = { code: string; message: string } | null;
const formatError = (e: NonNullable<QueryError>) => `${e.code ? `[${e.code}] ` : ""}${e.message}`;
let insertedAny = false;

function inserted(table: string, error: QueryError) {
  if (error) throw new Error(`insert into ${table} failed: ${formatError(error)}`);
  insertedAny = true;
  console.log(`inserted test ${table} row`);
}

function deleted(table: string, result: { data: unknown[] | null; error: QueryError }) {
  if (result.error) {
    console.error(`cleanup: delete from ${table} failed: ${formatError(result.error)}`);
    return false;
  }
  console.log(`cleanup: deleted ${result.data?.length ?? 0} ${table} row(s)`);
  return true;
}

async function cleanUp(): Promise<boolean> {
  // Children first: journal_entries, exceptions, deliveries and payments reference orders.
  // Every delete runs even if an earlier one failed.
  const results = [
    deleted("journal_entries", await client.from("journal_entries").delete().eq("order_id", ORDER_ID).select()),
    deleted("exceptions", await client.from("exceptions").delete().eq("order_id", ORDER_ID).select()),
    deleted("deliveries", await client.from("deliveries").delete().eq("order_id", ORDER_ID).select()),
    deleted("payments", await client.from("payments").delete().eq("tx_signature", TX).select()),
    deleted("orders", await client.from("orders").delete().eq("order_id", ORDER_ID).select()),
    deleted("sellers", await client.from("sellers").delete().eq("seller_id", SELLER_ID).select()),
  ];
  return results.every(Boolean);
}

let ok = false;
try {
  inserted("sellers", (await client.from("sellers").insert({
    seller_id: SELLER_ID, name: "Booking Check Seller", url: "http://localhost/check-booking-db",
    wallet: SELLER_WALLET, status: "approved",
  })).error);
  inserted("orders", (await client.from("orders").insert({
    order_id: ORDER_ID, seller_id: SELLER_ID, item: "price_quote", params: { ticker: "SOL", date: today },
    max_amount: 100000, purpose: "check-booking-db test row (deleted at the end)", status: "paid",
    quote_amount: 100000, quote_wallet: SELLER_WALLET,
  })).error);
  inserted("payments", (await client.from("payments").insert({
    tx_signature: TX, block_time: new Date().toISOString(), from_wallet: FROM_WALLET, to_wallet: SELLER_WALLET,
    amount: 100000, memo: ORDER_ID, order_id: ORDER_ID, raw: { source: "scripts/check-booking-db.ts" },
  })).error);
  inserted("deliveries", (await client.from("deliveries").insert({
    order_id: ORDER_ID,
    body: JSON.stringify({ ticker: "SOL", date: today, price_usd: 142.1, source: "Booking Check Seller" }),
    checks: { received: true, format: true, matches_order: true },
    passed: true,
  })).error);

  const first = await tryBook(ORDER_ID); // no db argument: uses getDb(), the real Supabase Db
  if (first.result !== "booked") throw new Error(`tryBook: expected "booked", got ${JSON.stringify(first)}`);
  console.log("tryBook -> booked. Journal entry:");
  console.log(JSON.stringify(first.entry, null, 2));

  const order = await getDb().getOrder(ORDER_ID);
  if (order?.status !== "booked") throw new Error(`order status: expected "booked", got ${order?.status}`);
  console.log('order status is now "booked"');

  const second = await tryBook(ORDER_ID);
  if (second.result !== "skipped") throw new Error(`second tryBook: expected "skipped", got ${second.result}`);
  console.log('second tryBook -> skipped (the conditional update changed no row)');
  ok = true;
} catch (error) {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  const clean = await cleanUp();
  if (!clean && insertedAny) {
    console.error(`Some test rows may remain: order_id ${ORDER_ID}, seller_id ${SELLER_ID}, tx ${TX}`);
  }
  console.log(ok && clean ? "PASS" : "FAIL");
  process.exitCode = ok && clean ? 0 : 1;
}
