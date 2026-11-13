import { describe, expect, it } from "vitest";
import { EMPTY_DATA, type DashboardData } from "@/lib/dashboard/model";
import { detectScenes } from "@/lib/dashboard/scenes";
import { cleanSummary, exceptionsNeedingSummary, orderFacts, ordersNeedingSummary } from "@/lib/summaries";
import type { ExceptionRow, OrderRow } from "@/lib/db-types";

const order = (id: string, o: Partial<OrderRow> = {}): OrderRow => ({
  order_id: `${id}-0000-4000-8000-000000000000`,
  created_at: "2026-11-14T14:00:00Z",
  seller_id: "dataco",
  item: "price_quote",
  params: {},
  max_amount: 100000,
  purpose: "p",
  status: "booked",
  deny_reason: null,
  quote_amount: 100000,
  quote_wallet: "W",
  summary: null,
  ...o,
});

const exc = (id: string, o: Partial<ExceptionRow>): ExceptionRow => ({
  exception_id: id,
  created_at: "2026-11-14T14:00:00Z",
  order_id: null,
  tx_signature: null,
  type: "no_order",
  severity: "critical",
  summary: null,
  status: "open",
  ...o,
});

const state = (data: DashboardData) => Object.fromEntries(detectScenes(data).map((s) => [s.id, s.state]));

describe("detectScenes (from real rows only)", () => {
  it("shows nothing proven on an empty database", () => {
    expect(state(EMPTY_DATA)).toEqual({ clean: "not_yet", empty: "not_yet", injection: "not_yet", stolen: "not_yet" });
  });

  it("treats a paid-but-unbooked purchase as in progress, a booked one as proven", () => {
    expect(state({ ...EMPTY_DATA, orders: [order("aaaaaaaa", { status: "paid" })] }).clean).toBe("in_progress");
    expect(state({ ...EMPTY_DATA, orders: [order("aaaaaaaa")] }).clean).toBe("proven");
  });

  it("proves injection only with a 'seller not approved' denial", () => {
    const denied = order("bbbbbbbb", { status: "denied", deny_reason: "seller not approved", seller_id: "premiumreports" });
    const other = order("cccccccc", { status: "denied", deny_reason: "over daily limit" });
    expect(state({ ...EMPTY_DATA, orders: [other] }).injection).toBe("not_yet");
    expect(state({ ...EMPTY_DATA, orders: [denied] }).injection).toBe("proven");
  });

  it("needs Block Seller to prove the empty-delivery scene", () => {
    const open = exc("e1", { type: "nothing_delivered", severity: "high" });
    expect(state({ ...EMPTY_DATA, exceptions: [open] }).empty).toBe("in_progress");
    expect(state({ ...EMPTY_DATA, exceptions: [{ ...open, status: "seller_blocked" }] }).empty).toBe("proven");
  });

  it("proves the stolen key from a no_order exception and links to it", () => {
    const scene = detectScenes({ ...EMPTY_DATA, exceptions: [exc("e9", {})] }).find((s) => s.id === "stolen");
    expect(scene).toMatchObject({ state: "proven", target: { kind: "exception", id: "e9" } });
  });
});

describe("summaries helpers", () => {
  const data: DashboardData = {
    ...EMPTY_DATA,
    orders: [
      order("aaaaaaaa", { status: "denied", deny_reason: "seller not approved", seller_id: "premiumreports", quote_amount: null }),
      order("bbbbbbbb", { status: "paying" }),
      order("cccccccc", { summary: "already written" }),
    ],
    exceptions: [exc("e1", {}), exc("e2", { summary: "done" })],
  };

  it("only picks rows with no summary, and skips orders still paying", () => {
    expect(ordersNeedingSummary(data, 10).map((o) => o.order_id.slice(0, 8))).toEqual(["aaaaaaaa"]);
    expect(exceptionsNeedingSummary(data, 10).map((e) => e.exception_id)).toEqual(["e1"]);
  });

  it("builds facts with the exact reason and dollar amounts", () => {
    const facts = orderFacts(data.orders[0], data);
    expect(facts).toContain('deny reason "seller not approved"');
    expect(facts).toContain("not in the sellers table");
    expect(facts).toContain("$0.10");
  });

  it("cleans a model reply into one line", () => {
    expect(cleanSummary('  "Denied because the seller\nis unknown."  ')).toBe("Denied because the seller is unknown.");
    expect(cleanSummary("   ")).toBeNull();
    expect(cleanSummary("x".repeat(400))?.length).toBe(278);
  });
});
