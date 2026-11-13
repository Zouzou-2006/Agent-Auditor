// Unit tests for the Supabase Db in lib/booking-db.ts, against a fake client that
// records each query. Never imports lib/db.ts (server-only); the real database is
// exercised by scripts/check-booking-db.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSupabaseDb, getDb, type BookingDatabase } from "../lib/booking-db";

type Result = { data: unknown; error: { message: string; code?: string } | null };
type Query = { table: string; calls: [string, unknown[]][] };

const METHODS = ["select", "insert", "update", "eq", "limit", "maybeSingle", "single"];

/** A client whose queries resolve, in order, to `results`, recording every builder call. */
function fakeSupabase(...results: Result[]) {
  const queries: Query[] = [];
  const client = {
    from(table: string) {
      const query: Query = { table, calls: [] };
      queries.push(query);
      const result = results.shift();
      if (!result) throw new Error(`unexpected query on ${table}`);
      const builder: Record<string, unknown> = {
        then: (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject),
      };
      for (const m of METHODS) {
        builder[m] = (...args: unknown[]) => {
          query.calls.push([m, args]);
          return builder;
        };
      }
      return builder;
    },
  };
  const db = createSupabaseDb(async () => client as unknown as SupabaseClient<BookingDatabase>);
  return { db, queries };
}

const ok = (data: unknown): Result => ({ data, error: null });
const err = (message: string, code: string): Result => ({ data: null, error: { message, code } });

describe("updateOrderStatusIf", () => {
  it("is one conditional update on order_id AND status, returning the changed rows", async () => {
    const { db, queries } = fakeSupabase(ok([{ order_id: "o1" }]));

    expect(await db.updateOrderStatusIf("o1", "paid", "booked")).toBe(true);

    expect(queries).toEqual([
      {
        table: "orders",
        calls: [
          ["update", [{ status: "booked" }]],
          ["eq", ["order_id", "o1"]],
          ["eq", ["status", "paid"]],
          ["select", ["order_id"]],
        ],
      },
    ]);
  });

  it("returns false when no row changed (status was no longer `from`)", async () => {
    const { db } = fakeSupabase(ok([]));
    expect(await db.updateOrderStatusIf("o1", "paid", "booked")).toBe(false);
  });

  it("throws on a Supabase error instead of returning false", async () => {
    const { db } = fakeSupabase(err("permission denied for table orders", "42501"));
    await expect(db.updateOrderStatusIf("o1", "paid", "booked")).rejects.toThrow(
      "booking-db: update orders o1 status paid -> booked failed [42501]: permission denied for table orders",
    );
  });
});

describe("updateExceptionStatusIf", () => {
  it("filters on exception_id AND status", async () => {
    const { db, queries } = fakeSupabase(ok([{ exception_id: "e1" }]));

    expect(await db.updateExceptionStatusIf("e1", "open", "approved")).toBe(true);

    expect(queries[0].table).toBe("exceptions");
    expect(queries[0].calls).toEqual([
      ["update", [{ status: "approved" }]],
      ["eq", ["exception_id", "e1"]],
      ["eq", ["status", "open"]],
      ["select", ["exception_id"]],
    ]);
  });
});

describe("reads", () => {
  it("getOrder returns null only when there's no row and no error", async () => {
    const { db } = fakeSupabase(ok(null));
    expect(await db.getOrder("o1")).toBeNull();
  });

  it("getOrder throws on a Supabase error instead of returning null", async () => {
    const { db } = fakeSupabase(err('invalid input syntax for type uuid: "o1"', "22P02"));
    await expect(db.getOrder("o1")).rejects.toThrow("booking-db: getOrder o1 failed [22P02]");
  });

  it("getPaymentForOrder throws if an order has two payments", async () => {
    const { db } = fakeSupabase(ok([{ tx_signature: "a" }, { tx_signature: "b" }]));
    await expect(db.getPaymentForOrder("o1")).rejects.toThrow("order o1 has more than one payment");
  });

  it("getExceptionByTx returns the first match or null", async () => {
    const { db } = fakeSupabase(ok([{ exception_id: "e1" }]), ok([]));
    expect(await db.getExceptionByTx("sig")).toEqual({ exception_id: "e1" });
    expect(await db.getExceptionByTx("sig")).toBeNull();
  });
});

describe("writes", () => {
  it("insertJournalEntry throws on a Supabase error (e.g. a second entry for the same order)", async () => {
    const { db } = fakeSupabase(err("duplicate key value violates unique constraint", "23505"));
    await expect(
      db.insertJournalEntry({
        order_id: "o1", tx_signature: "sig", entry_date: "2026-11-13", debit_account: "Data purchases expense",
        credit_account: "USDC - agent wallet", amount: 100000, description: "SOL price quote from DataCo",
      }),
    ).rejects.toThrow("booking-db: insertJournalEntry for order o1 failed [23505]");
  });

  it("setSellerStatus throws if the seller doesn't exist", async () => {
    const { db } = fakeSupabase(ok([]));
    await expect(db.setSellerStatus("nobody", "blocked")).rejects.toThrow("seller nobody not found");
  });
});

describe("getDb", () => {
  it("returns the Supabase Db without loading lib/db.ts (server-only) until a query runs", () => {
    expect(() => getDb()).not.toThrow();
    expect(getDb()).toBe(getDb());
  });
});
