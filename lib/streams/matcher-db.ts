// Supabase side of the Streams matcher. Server only: lib/db.ts (service role) is loaded on the
// first query, not on import, so unit tests never load `server-only`.
import type { PaymentRow } from "../db-types";
import type { MatcherDeps } from "./matcher";

async function client() {
  return (await import("../db")).getServiceClient();
}

export function supabaseMatcherDeps(): Pick<MatcherDeps, "orderExists" | "insertPayment"> {
  return {
    async orderExists(order_id) {
      const { data, error } = await (await client()).from("orders").select("order_id").eq("order_id", order_id).maybeSingle();
      if (error) throw new Error(`streams: orderExists ${order_id} failed [${error.code}]: ${error.message}`);
      return data !== null;
    },
    async insertPayment(payment: PaymentRow) {
      // Streams retries deliveries: ignore a tx_signature we already saved.
      // `as never`: supabase-js types reject interface rows on insert (see lib/booking-db.ts).
      const { data, error } = await (await client())
        .from("payments")
        .upsert(payment as never, { onConflict: "tx_signature", ignoreDuplicates: true })
        .select("tx_signature");
      if (error) throw new Error(`streams: insertPayment ${payment.tx_signature} failed [${error.code}]: ${error.message}`);
      return (data ?? []).length > 0;
    },
  };
}
