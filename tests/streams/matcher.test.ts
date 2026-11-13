import { describe, expect, it, vi } from "vitest";
import type { PaymentRow } from "@/lib/db-types";
import { MEMO_PROGRAM_ID, TOKEN_PROGRAM_ID, type ParsedTransaction } from "@/lib/solana/parse-payment";
import { extractTransactions, matchPayments, toPaymentRow, type MatcherDeps } from "@/lib/streams/matcher";
import { signStreamsPayload, verifyStreamsSignature } from "@/lib/streams/signature";

const MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const GATEWAY = "HsyoZYyJCdDiGAvQgokFPGdvEUQy2p5byzeZvEhRRbgr";
const DATACO = "ATDBWGF9hk38MJZ9QHiDKw7ujZXh8nwEnqFF4D7iPXQc";
const ATTACKER = "6QUTX4jCxJiBXpX2VjC66tKuodmkhvVf2qtEvbwBEfaN";
const FAUCET = "Faucet11111111111111111111111111111111111111";
const FEE_PAYER = "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4";
const SRC_ATA = "SrcAta1111111111111111111111111111111111111";
const DST_ATA = "DstAta1111111111111111111111111111111111111";
const ORDER = "a33f1475-9f9b-4649-bcfd-e36622793015";

/** A USDC transfer in getTransaction(jsonParsed) shape, like an x402 payment. */
function tx(opts: { sig?: string; from?: string; to?: string; amount?: string; memo?: string | null; err?: unknown } = {}): ParsedTransaction {
  const { sig = "Sig1", from = GATEWAY, to = DATACO, amount = "100000", memo = ORDER, err = null } = opts;
  const instructions: ParsedTransaction["transaction"]["message"]["instructions"] = [
    {
      programId: TOKEN_PROGRAM_ID,
      program: "spl-token",
      parsed: {
        type: "transferChecked",
        info: { source: SRC_ATA, destination: DST_ATA, mint: MINT, authority: from, tokenAmount: { amount, decimals: 6 } },
      },
    },
  ];
  if (memo !== null) instructions.push({ programId: MEMO_PROGRAM_ID, program: "spl-memo", parsed: memo });
  return {
    blockTime: 1794604122,
    meta: {
      err,
      // The destination may be brand new (the stolen-key script creates it), so only post has it.
      preTokenBalances: [{ accountIndex: 2, mint: MINT, owner: from }],
      postTokenBalances: [
        { accountIndex: 2, mint: MINT, owner: from },
        { accountIndex: 3, mint: MINT, owner: to },
      ],
      innerInstructions: [],
    },
    transaction: {
      signatures: [sig],
      message: { accountKeys: [{ pubkey: FEE_PAYER }, { pubkey: from }, { pubkey: SRC_ATA }, { pubkey: DST_ATA }], instructions },
    },
  };
}

function fakeDeps(orders: string[] = [ORDER]) {
  const saved = new Map<string, PaymentRow>();
  const deps: MatcherDeps = {
    orderExists: vi.fn(async (id: string) => orders.includes(id)),
    insertPayment: vi.fn(async (p: PaymentRow) => {
      if (saved.has(p.tx_signature)) return false;
      saved.set(p.tx_signature, p);
      return true;
    }),
    tryBook: vi.fn(async () => ({ result: "waiting" })),
    flagUnmatchedPayment: vi.fn(async () => null),
  };
  return { deps, saved };
}

describe("extractTransactions", () => {
  const t = tx();
  it.each([
    ["a bare array", [t]],
    ["{data: [tx]}", { data: [t] }],
    ["a single tx", t],
    ["{data: [[tx]]} (batched)", { data: [[t]] }],
    ["blocks", [{ blockTime: 5, transactions: [t] }]],
    ["{data: [block]}", { data: [{ blockTime: 5, transactions: [t] }] }],
  ])("finds the transaction in %s", (_name, payload) => {
    expect(extractTransactions(payload)).toHaveLength(1);
  });

  it("gives a transaction its block's time when it has none", () => {
    const noTime = { ...t, blockTime: null };
    expect(extractTransactions({ data: [{ blockTime: 77, transactions: [noTime] }] })[0].blockTime).toBe(77);
  });

  it("ignores junk", () => {
    expect(extractTransactions({ data: null })).toEqual([]);
    expect(extractTransactions("hello")).toEqual([]);
  });
});

describe("toPaymentRow", () => {
  it("records an outgoing x402 payment with OWNER wallets and the memo", () => {
    expect(toPaymentRow(tx(), GATEWAY, new Date())).toMatchObject({
      tx_signature: "Sig1",
      block_time: new Date(1794604122 * 1000).toISOString(),
      from_wallet: GATEWAY,
      to_wallet: DATACO,
      amount: 100000,
      memo: ORDER,
      order_id: null,
    });
  });

  it("ignores incoming money (faucet funding must not look like a stolen key)", () => {
    expect(toPaymentRow(tx({ from: FAUCET, to: GATEWAY, memo: null }), GATEWAY, new Date())).toBeNull();
  });

  it("ignores a transaction that failed on chain (no money moved)", () => {
    expect(toPaymentRow(tx({ err: { InstructionError: [0, "Custom"] } }), GATEWAY, new Date())).toBeNull();
  });
});

describe("matchPayments", () => {
  it("beat 1: memo = a known order → saved with order_id, then tryBook(order_id)", async () => {
    const { deps, saved } = fakeDeps();
    const results = await matchPayments({ data: [tx()] }, GATEWAY, deps);
    expect(results).toEqual([{ tx_signature: "Sig1", result: "matched", order_id: ORDER }]);
    expect(saved.get("Sig1")?.order_id).toBe(ORDER);
    expect(deps.tryBook).toHaveBeenCalledWith(ORDER);
    expect(deps.flagUnmatchedPayment).not.toHaveBeenCalled();
  });

  it("beat 4: stolen key, no memo → saved with no order, then flagUnmatchedPayment", async () => {
    const { deps, saved } = fakeDeps();
    const results = await matchPayments([tx({ sig: "Steal", to: ATTACKER, memo: null })], GATEWAY, deps);
    expect(results).toEqual([{ tx_signature: "Steal", result: "no_order" }]);
    expect(saved.get("Steal")).toMatchObject({ order_id: null, to_wallet: ATTACKER, memo: null });
    expect(deps.flagUnmatchedPayment).toHaveBeenCalledWith(expect.objectContaining({ tx_signature: "Steal" }));
    expect(deps.tryBook).not.toHaveBeenCalled();
  });

  it.each([
    ["a uuid that matches no order", "11111111-2222-4333-8444-555555555555"],
    ["a random x402 nonce", "c2VsbGVyLW5vbmNl"],
  ])("memo is %s → no_order", async (_name, memo) => {
    const { deps } = fakeDeps();
    expect(await matchPayments([tx({ memo })], GATEWAY, deps)).toEqual([{ tx_signature: "Sig1", result: "no_order" }]);
  });

  it("a retried delivery doesn't double-save, and booking calls are safe to repeat", async () => {
    const { deps, saved } = fakeDeps();
    await matchPayments([tx()], GATEWAY, deps);
    await matchPayments([tx()], GATEWAY, deps);
    expect(saved.size).toBe(1);
  });

  it("skips incoming funding entirely: nothing saved, no alarm", async () => {
    const { deps, saved } = fakeDeps();
    expect(await matchPayments([tx({ from: FAUCET, to: GATEWAY, memo: null })], GATEWAY, deps)).toEqual([]);
    expect(saved.size).toBe(0);
    expect(deps.flagUnmatchedPayment).not.toHaveBeenCalled();
  });
});

describe("Streams signature", () => {
  const secret = "test-security-token-of-more-than-32-bytes";
  const body = JSON.stringify({ data: [] });
  const sig = signStreamsPayload(secret, "n1", "1794604122", body);

  it("accepts QuickNode's hex HMAC-SHA256 of nonce + timestamp + body", () => {
    expect(verifyStreamsSignature(secret, { nonce: "n1", timestamp: "1794604122", signature: sig }, body)).toBe(true);
  });

  it.each([
    ["a changed body", { nonce: "n1", timestamp: "1794604122", signature: sig }, body + " "],
    ["a different nonce", { nonce: "n2", timestamp: "1794604122", signature: sig }, body],
    ["a missing header", { nonce: null, timestamp: "1794604122", signature: sig }, body],
    ["a non-hex signature", { nonce: "n1", timestamp: "1794604122", signature: "zz" }, body],
    ["a short signature", { nonce: "n1", timestamp: "1794604122", signature: "abcd" }, body],
  ])("rejects %s", (_name, headers, b) => {
    expect(verifyStreamsSignature(secret, headers, b)).toBe(false);
  });
});
