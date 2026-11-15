import { describe, expect, it } from "vitest";
import type { ExceptionRow, OrderRow, PaymentRow, SellerRow } from "../../lib/db-types";
import {
  deliveryText,
  dollars,
  EXCEPTION_STATUS_LABEL,
  EXCEPTION_TITLE,
  exceptionSentence,
  friendlyStatus,
  itemLabel,
  itemPhrase,
  longDate,
  networkLabel,
  orderSentence,
  paramsText,
  PROVENANCE_LABEL,
  readableSummary,
  reviewSentence,
  SELLER_STATUS_LABEL,
  sellerName,
  SEVERITY_LABEL,
  shortDate,
  statusLabel,
  timeShort,
  toolLabel,
} from "../../lib/dashboard/words";
import { ORDER_STATUSES } from "../../lib/dashboard/model";

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
      "$0.10 left the wallet with no order behind it. Possible stolen key.",
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
    expect(friendlyStatus("booked")).toBe("Booked");
    expect(friendlyStatus("denied")).toBe("Blocked");
    expect(friendlyStatus("paying")).toBe("Processing");
    expect(friendlyStatus("paid")).toBe("Processing");
    expect(friendlyStatus("pending_review")).toBe("Waiting for approval");
    expect(friendlyStatus("exception")).toBe("Problem found");
  });
});

describe("statusLabel", () => {
  it("words an order status from an API reply and passes anything else through", () => {
    expect(statusLabel("pending_review")).toBe("Waiting for approval");
    expect(statusLabel("booked")).toBe("Booked");
    expect(statusLabel("something_new")).toBe("something_new");
    expect(statusLabel("toString")).toBe("toString");
  });
});

describe("itemLabel / shortDate / paramsText", () => {
  it("writes a price quote as ticker, price and day", () => {
    expect(itemLabel(order({ params: { ticker: "sol", date: "2026-11-14" } }))).toBe("SOL price for Nov 14");
    expect(itemLabel(order({ params: { ticker: "SOL" } }))).toBe("SOL price");
    expect(itemLabel(order({ params: { ticker: "SOL", date: "yesterday" } }))).toBe("SOL price");
  });

  it("turns any other item name into words", () => {
    expect(itemLabel(order({ item: "premium_report", params: {} }))).toBe("premium report");
  });

  it("reads a calendar date without shifting it a day", () => {
    expect(shortDate("2026-11-14")).toBe("Nov 14");
    expect(shortDate("2026-01-01")).toBe("Jan 1");
    expect(shortDate("2026-02-30")).toBeNull();
    expect(shortDate("2026-11-14T12:00:00Z")).toBeNull();
  });

  it("lists what was asked for without JSON or snake_case", () => {
    expect(paramsText({ ticker: "SOL", date: "2026-11-14" })).toBe("Ticker SOL · Date Nov 14");
    expect(paramsText({ report_id: 7 })).toBe("Report id 7");
    expect(paramsText({})).toBe("—");
    expect(paramsText(null)).toBe("—");
  });
});

describe("readableSummary", () => {
  it("keeps plain business English", () => {
    expect(readableSummary("Bought a SOL price from DataCo for $0.10; the data arrived as ordered.", sellers)).toBe(
      "Bought a SOL price from DataCo for $0.10; the data arrived as ordered.",
    );
  });

  it("drops text with raw values, so the plain sentence shows instead", () => {
    const raw = [
      "Payment of 100000 to 6QUTX4jCxJiBXpX2VjC66tKuodmkhvVf2qtEvbwBEfaN matches no order",
      "Order 049f85eb paid approved seller DataCo $0.10 for a price quote.",
      "The agent's $0.10 premium_report order was denied.",
      "Booking awaits Streams confirmation.",
      "The agent paid approved seller dataco $0.10 for a price quote.",
    ];
    for (const text of raw) expect(readableSummary(text, sellers)).toBeNull();
    expect(readableSummary(null, sellers)).toBeNull();
    expect(readableSummary("  ", sellers)).toBeNull();
  });
});

describe("deliveryText / longDate", () => {
  it("reads a price quote delivery as a sentence", () => {
    expect(deliveryText('{"ticker":"SOL","date":"2026-11-13","price_usd":142.1,"source":"DataCo"}')).toBe(
      "SOL was $142.10 on Nov 13 (source: DataCo).",
    );
  });

  it("says when nothing came or it can't be read", () => {
    expect(deliveryText("")).toBe("Nothing was delivered.");
    expect(deliveryText(null)).toBe("Nothing was delivered.");
    expect(deliveryText("<html>oops")).toBe("The delivery couldn't be read.");
    expect(deliveryText("[1,2]")).toBe("The delivery couldn't be read.");
    expect(deliveryText('{"headline":"Markets up"}')).toBe("Headline Markets up");
  });

  it("writes journal dates in words", () => {
    expect(longDate("2026-11-13")).toBe("Nov 13, 2026");
    expect(longDate("not a date")).toBe("not a date");
  });
});

describe("label maps", () => {
  const snake = /[a-z]_[a-z]/;
  const all = [
    ...ORDER_STATUSES.map(friendlyStatus),
    ...Object.values(EXCEPTION_TITLE),
    ...Object.values(EXCEPTION_STATUS_LABEL),
    ...Object.values(SEVERITY_LABEL),
    ...Object.values(SELLER_STATUS_LABEL),
    ...Object.values(PROVENANCE_LABEL),
  ];

  it("has no snake_case anywhere", () => {
    for (const label of all) expect(label).not.toMatch(snake);
  });

  it("capitalizes severity and statuses, and names who decided each step", () => {
    expect(SEVERITY_LABEL).toEqual({ critical: "Critical", high: "High", medium: "Medium" });
    expect(EXCEPTION_STATUS_LABEL.seller_blocked).toBe("Seller blocked");
    expect(SELLER_STATUS_LABEL).toEqual({ approved: "Approved", blocked: "Blocked" });
    expect(PROVENANCE_LABEL).toEqual({ deterministic: "Rule", "on-chain": "Blockchain", human: "Person" });
  });

  it("names the copilot's lookups and the test network", () => {
    expect(toolLabel("get_order")).toBe("Order details");
    expect(toolLabel("daily_spend")).toBe("Today's spending");
    expect(toolLabel("brand_new_tool")).toBe("brand new tool");
    expect(networkLabel("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1")).toBe("Solana (test network)");
    expect(networkLabel("solana:other")).toBe("solana:other");
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
