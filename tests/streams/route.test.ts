// POST /api/webhooks/streams end to end against the in-memory booking database (no Supabase).
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeliveryRow, OrderRow, PaymentRow } from "@/lib/db-types";
import { MEMO_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@/lib/solana/parse-payment";
import { signStreamsPayload } from "@/lib/streams/signature";
import { FakeDb } from "../fakeDb";

const db = new FakeDb();

vi.mock("@/lib/booking-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/booking-db")>()),
  getDb: () => db,
}));
vi.mock("@/lib/streams/matcher-db", () => ({
  supabaseMatcherDeps: () => ({
    orderExists: async (id: string) => db.orders.has(id),
    insertPayment: async (p: PaymentRow) => {
      if (db.payments.some((x) => x.tx_signature === p.tx_signature)) return false;
      db.addPayment(p);
      return true;
    },
  }),
}));

const { POST } = await import("@/app/api/webhooks/streams/route");

const SECRET = "test-security-token-of-more-than-32-bytes";
const MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const GATEWAY = "HsyoZYyJCdDiGAvQgokFPGdvEUQy2p5byzeZvEhRRbgr";
const DATACO = "ATDBWGF9hk38MJZ9QHiDKw7ujZXh8nwEnqFF4D7iPXQc";
const ATTACKER = "6QUTX4jCxJiBXpX2VjC66tKuodmkhvVf2qtEvbwBEfaN";
const ORDER = "a33f1475-9f9b-4649-bcfd-e36622793015";

const transfer = (sig: string, to: string, memo: string | null) => ({
  blockTime: 1794604122,
  meta: {
    err: null,
    preTokenBalances: [{ accountIndex: 1, mint: MINT, owner: GATEWAY }],
    postTokenBalances: [
      { accountIndex: 1, mint: MINT, owner: GATEWAY },
      { accountIndex: 2, mint: MINT, owner: to },
    ],
    innerInstructions: [],
  },
  transaction: {
    signatures: [sig],
    message: {
      accountKeys: [GATEWAY, "SrcAta", "DstAta"],
      instructions: [
        {
          programId: TOKEN_PROGRAM_ID,
          parsed: { type: "transferChecked", info: { source: "SrcAta", destination: "DstAta", mint: MINT, authority: GATEWAY, tokenAmount: { amount: "100000" } } },
        },
        ...(memo ? [{ programId: MEMO_PROGRAM_ID, parsed: memo }] : []),
      ],
    },
  },
});

function signedRequest(payload: unknown, opts: { secret?: string; gzip?: boolean } = {}) {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-qn-nonce": "nonce-1",
    "x-qn-timestamp": "1794604122",
    "x-qn-signature": signStreamsPayload(opts.secret ?? SECRET, "nonce-1", "1794604122", body),
  };
  if (opts.gzip) headers["content-encoding"] = "gzip";
  return new Request("http://localhost/api/webhooks/streams", {
    method: "POST",
    headers,
    body: opts.gzip ? gzipSync(body) : body,
  });
}

const paidOrder: OrderRow = {
  order_id: ORDER, created_at: "2026-11-13T20:48:42Z", seller_id: "dataco", item: "price_quote",
  params: { ticker: "SOL", date: "2026-11-14" }, max_amount: 100000, purpose: "Beat 1 test",
  status: "paid", deny_reason: null, quote_amount: 100000, quote_wallet: DATACO, summary: null,
};
const passedDelivery: DeliveryRow = {
  order_id: ORDER, received_at: "2026-11-13T20:48:45Z",
  body: '{"ticker":"SOL","date":"2026-11-14","price_usd":142.1,"source":"DataCo"}',
  checks: { received: true, format: true, matches_order: true }, passed: true,
};

beforeEach(() => {
  vi.stubEnv("QUICKNODE_STREAMS_SECRET", SECRET);
  vi.stubEnv("GATEWAY_WALLET_ADDRESS", GATEWAY);
  db.orders.clear();
  db.payments.length = 0;
  db.deliveries.clear();
  db.journal.length = 0;
  db.exceptions.length = 0;
  db.addSeller({ seller_id: "dataco", name: "DataCo", url: "http://localhost:3000/api/sellers/dataco", wallet: DATACO, status: "approved" });
});

describe("POST /api/webhooks/streams", () => {
  it("beat 1: the payment lands after the delivery → order booked with a journal entry", async () => {
    db.addOrder(paidOrder);
    db.addDelivery(passedDelivery);
    const res = await POST(signedRequest({ data: [transfer("Sig1", DATACO, ORDER)] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, results: [{ tx_signature: "Sig1", result: "matched", order_id: ORDER }] });
    expect(db.orders.get(ORDER)?.status).toBe("booked");
    expect(db.journal).toEqual([expect.objectContaining({ debit_account: "Data purchases expense", amount: 100000, tx_signature: "Sig1" })]);
  });

  it("works with a gzipped body", async () => {
    db.addOrder(paidOrder);
    db.addDelivery(passedDelivery);
    expect((await POST(signedRequest({ data: [transfer("Sig1", DATACO, ORDER)] }, { gzip: true }))).status).toBe(200);
    expect(db.orders.get(ORDER)?.status).toBe("booked");
  });

  it("beat 4: a payment to the attacker with no memo → critical no_order exception, no journal entry", async () => {
    const res = await POST(signedRequest([transfer("Steal", ATTACKER, null)]));
    expect(res.status).toBe(200);
    expect(db.exceptions).toEqual([expect.objectContaining({ type: "no_order", severity: "critical", tx_signature: "Steal", order_id: null })]);
    expect(db.journal).toHaveLength(0);
  });

  it("the same delivery twice → still one payment and one exception", async () => {
    await POST(signedRequest([transfer("Steal", ATTACKER, null)]));
    await POST(signedRequest([transfer("Steal", ATTACKER, null)]));
    expect(db.payments).toHaveLength(1);
    expect(db.exceptions).toHaveLength(1);
  });

  it("a wrong signature → 401 and nothing saved", async () => {
    const res = await POST(signedRequest([transfer("Steal", ATTACKER, null)], { secret: "someone-else" }));
    expect(res.status).toBe(401);
    expect(db.payments).toHaveLength(0);
  });

  it("no secret configured → 500, never accepts unsigned data", async () => {
    vi.stubEnv("QUICKNODE_STREAMS_SECRET", "");
    expect((await POST(signedRequest([]))).status).toBe(500);
  });
});
