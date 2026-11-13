import { describe, expect, it } from "vitest";
import { runTool, ToolInputError, TOOLS, type ToolContext } from "@/lib/assistant/tools";
import { EMPTY_DATA } from "@/lib/dashboard/model";
import type { OrderRow } from "@/lib/db-types";

const order = (id: string, overrides: Partial<OrderRow> = {}): OrderRow => ({
  order_id: id,
  created_at: "2026-11-14T14:00:00Z",
  seller_id: "dataco",
  item: "price_quote",
  params: { ticker: "SOL" },
  max_amount: 100000,
  purpose: "p",
  status: "booked",
  deny_reason: null,
  quote_amount: 100000,
  quote_wallet: "W",
  summary: null,
  ...overrides,
});

const ctx: ToolContext = {
  data: {
    ...EMPTY_DATA,
    orders: [
      order("aaaa1111-0000-4000-8000-000000000000"),
      order("aaaa2222-0000-4000-8000-000000000000", { status: "denied", deny_reason: "seller not approved", seller_id: "premiumreports" }),
    ],
  },
  rules: { network: "n", asset: "USDC", usdc_mint: "m", max_per_purchase: 1000000, max_per_day: 5000000, human_review_over: 500000 },
  gatewayWallet: "G",
  now: new Date("2026-11-14T15:00:00Z"),
};

describe("copilot tools", () => {
  it("exposes only read tools", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(
      ["daily_spend", "get_order", "get_overview", "list_exceptions", "list_orders", "list_payments", "list_sellers"].sort(),
    );
  });

  it("filters orders by status", () => {
    const r = runTool("list_orders", { status: "denied" }, ctx) as { total_matching: number };
    expect(r.total_matching).toBe(1);
  });

  it("finds an order by unique prefix and reports ambiguity", () => {
    expect(runTool("get_order", { order_id: "aaaa1111" }, ctx)).toMatchObject({ order: { status: "booked" } });
    expect(runTool("get_order", { order_id: "aaaa" }, ctx)).toMatchObject({ error: "ambiguous id" });
  });

  it("counts orders for sellers that aren't in the table", () => {
    expect(runTool("list_sellers", {}, ctx)).toMatchObject({ orders_for_unknown_sellers: 2 });
  });

  it("rejects bad input instead of guessing", () => {
    expect(() => runTool("list_orders", { status: "lost" }, ctx)).toThrow(ToolInputError);
    expect(() => runTool("list_orders", { limit: 1.5 }, ctx)).toThrow(ToolInputError);
    expect(() => runTool("approve_order", {}, ctx)).toThrow(ToolInputError);
  });
});
