// Loads the six tables for the dashboard and the copilot (owner: Nizar). Always called with the
// anon (read-only) client from lib/db-browser.ts, never the service-role client.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db-types";
import type { DashboardData } from "./model";

const LIMIT = 500;

export async function loadDashboardData(client: SupabaseClient<Database>): Promise<DashboardData> {
  const [sellers, orders, payments, deliveries, journal, exceptions] = await Promise.all([
    client.from("sellers").select("*").order("seller_id"),
    client.from("orders").select("*").order("created_at", { ascending: false }).limit(LIMIT),
    client.from("payments").select("*").order("block_time", { ascending: false }).limit(LIMIT),
    client.from("deliveries").select("*").order("received_at", { ascending: false }).limit(LIMIT),
    client.from("journal_entries").select("*").order("entry_date", { ascending: false }).limit(LIMIT),
    client.from("exceptions").select("*").order("created_at", { ascending: false }).limit(LIMIT),
  ]);
  const failed = [sellers, orders, payments, deliveries, journal, exceptions].find((r) => r.error);
  if (failed?.error) throw new Error(`Supabase read failed: ${failed.error.message}`);
  return {
    sellers: sellers.data ?? [],
    orders: orders.data ?? [],
    payments: payments.data ?? [],
    deliveries: deliveries.data ?? [],
    journal_entries: journal.data ?? [],
    exceptions: exceptions.data ?? [],
  };
}
