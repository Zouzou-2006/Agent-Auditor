import { describe, expect, it } from "vitest";
import type { ExceptionRow, OrderRow, PaymentRow, SellerRow } from "../../lib/db-types";
import {
  dollars,
  exceptionSentence,
  friendlyStatus,
  itemPhrase,
  orderSentence,
  reviewSentence,
  sellerName,
  timeShort,
} from "../../lib/dashboard/words";

const sellers: SellerRow[] = [
  { seller_id: "dataco", name: "DataCo", url: "", wallet: "W1", status: "approved" },
  { seller_id: "cheapdata", name: "CheapData", url: "", wallet: "W2", status: "blocked" },
];

const order = (o: Partial<OrderRow> = {}): OrderRow => ({
  order_id: "00000000-0000-4000-8000-000000000001",
  created_at: "2026-11-15T10:00:00Z",
  seller_id: "dataco",
  item: "price_quote",
  params: { ticker: "SOL", date: "2026-11-15" },
  max_amount: 100000,
  purpose: "test",
  status: "booked",
  deny_reason: null,
  quote_amount: 100000,
  quote_wallet: "W1",
  summary: null,
  ...o,
});
const exc = (type: ExceptionRow["type"]): ExceptionRow => ({
  exception_id: "e1",
  created_at: "2026-11-15T10:00:05Z",
  order_id: null,
  tx_signature: "tx1",
  type,
  severity: "high",
  summary: null,
  status: "open",
});
const payment = (amount: number): PaymentRow => ({
  tx_signature: "tx1",
  block_time: "2026-11-15T10:00:01Z",
  from_wallet: "G",
  to_wallet: "X",
  amount,
  memo: null,
  order_id: null,
  raw: {},
});

describe("dollars", () => {
  it("formats base units", () => {
    expect(dollars(100000)).toBe("$0.10");
    expect(dollars(5000000)).toBe("$5.00");
    expect(dollars(null)).toBe("—");
  });
});

describe("sellerName", () => {
  it("uses the display name, or the raw id marked not approved", () => {
    expect(sellerName("dataco", sellers)).toBe("DataCo");
    expect(sellerName("premiumreports", sellers)).toBe("premiumreports (not approved)");
  });
});

describe("itemPhrase / orderSentence", () => {
  it("reads like a person wrote it", () => {
    expect(itemPhrase(order())).toBe("a SOL price");
    expect(itemPhrase(order({ item: "premium_report", params: {} }))).toBe("a premium report");
    expect(orderSentence(order(), "DataCo")).toBe("Bought a SOL price from DataCo");
  });

  it("quotes the deny reason exactly", () => {
    const denied = order({ status: "denied", seller_id: "premiumreports", item: "premium_report", params: {}, deny_reason: "seller not approved" });
    expect(orderSentence(denied, sellerName("premiumreports", sellers))).toBe(
      "Blocked a premium report from premiumreports (not approved): seller not approved",
    );
  });

  it("writes the review line with the limit", () => {
    expect(reviewSentence(order({ status: "pending_review", max_amount: 600000 }), "DataCo", 500000)).toBe(
      "Your agent wants to buy a SOL price from DataCo for $0.60. Over your $0.50 review limit.",
    );
  });
});

describe("exceptionSentence", () => {
  it("has one sentence per type", () => {
    expect(exceptionSentence(exc("no_order"), null, payment(100000), null)).toBe(
      "$0.10 sent to an unknown wallet with no order behind it. Possible stolen key.",
    );
    expect(exceptionSentence(exc("wallet_mismatch"), order(), payment(100000), "DataCo")).toBe("Payment went to a different wallet than the order.");
    expect(exceptionSentence(exc("amount_mismatch"), order({ quote_amount: 100000 }), payment(150000), "DataCo")).toBe(
      "Paid $0.15 but the order was for $0.10.",
    );
    expect(exceptionSentence(exc("nothing_delivered"), order({ seller_id: "cheapdata" }), payment(100000), "CheapData")).toBe(
      "Paid CheapData $0.10 and got nothing back.",
    );
    expect(exceptionSentence(exc("bad_format"), order(), null, "DataCo")).toBe("The delivery arrived but the format was wrong.");
    expect(exceptionSentence(exc("wrong_data"), order(), null, "DataCo")).toBe("The delivery didn't match what was ordered.");
  });
});

describe("friendlyStatus", () => {
  it("maps every status", () => {
    expect(friendlyStatus("booked")).toBe("Completed");
    expect(friendlyStatus("denied")).toBe("Blocked");
    expect(friendlyStatus("paying")).toBe("Processing");
    expect(friendlyStatus("paid")).toBe("Processing");
    expect(friendlyStatus("pending_review")).toBe("Waiting for approval");
    expect(friendlyStatus("exception")).toBe("Problem found");
  });
});

describe("timeShort", () => {
  const now = Date.parse("2026-11-15T15:00:00Z");
  it("is short and relative, then an ET date", () => {
    expect(timeShort("2026-11-15T14:59:40Z", now)).toBe("just now");
    expect(timeShort("2026-11-15T14:55:00Z", now)).toBe("5m ago");
    expect(timeShort("2026-11-15T13:00:00Z", now)).toBe("2h ago");
    expect(timeShort("2026-11-13T15:00:00Z", now)).toBe("2d ago");
    expect(timeShort("2026-11-03T15:00:00Z", now)).toBe("Nov 3");
  });
});
