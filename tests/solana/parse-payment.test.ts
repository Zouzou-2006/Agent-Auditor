import { describe, expect, it } from "vitest";
import { MEMO_PROGRAM_ID, parsePayment, TOKEN_PROGRAM_ID, type ParsedTransaction } from "@/lib/solana/parse-payment";

const MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const GATEWAY = "HsyoZYyJCdDiGAvQgokFPGdvEUQy2p5byzeZvEhRRbgr";
const SELLER = "bcSuSumf9ChahaHsvz92xDnXSMABkSo6qcYV1kwrnWa";
const FEE_PAYER = "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5";
const SRC_ATA = "SrcAta1111111111111111111111111111111111111";
const DST_ATA = "DstAta1111111111111111111111111111111111111";
const ORDER = "6f1c2a8e-0b7d-4c1e-9a52-3d4e5f60718a";

/** Shape of an x402 SVM exact payment as returned by getTransaction(jsonParsed). */
function x402Tx(overrides: Partial<ParsedTransaction["meta"]> = {}): ParsedTransaction {
  return {
    blockTime: 1794590000,
    meta: {
      err: null,
      preTokenBalances: [
        { accountIndex: 2, mint: MINT, owner: GATEWAY },
        { accountIndex: 3, mint: MINT, owner: SELLER },
      ],
      postTokenBalances: [
        { accountIndex: 2, mint: MINT, owner: GATEWAY },
        { accountIndex: 3, mint: MINT, owner: SELLER },
      ],
      innerInstructions: [],
      ...overrides,
    },
    transaction: {
      signatures: ["Sig111"],
      message: {
        accountKeys: [{ pubkey: FEE_PAYER }, { pubkey: GATEWAY }, { pubkey: SRC_ATA }, { pubkey: DST_ATA }],
        instructions: [
          { programId: "ComputeBudget111111111111111111111111111111", data: "abc" },
          { programId: "ComputeBudget111111111111111111111111111111", data: "def" },
          {
            programId: TOKEN_PROGRAM_ID,
            program: "spl-token",
            parsed: {
              type: "transferChecked",
              info: {
                source: SRC_ATA,
                destination: DST_ATA,
                mint: MINT,
                authority: GATEWAY,
                tokenAmount: { amount: "100000", decimals: 6, uiAmount: 0.1, uiAmountString: "0.1" },
              },
            },
          },
          { programId: MEMO_PROGRAM_ID, program: "spl-memo", parsed: ORDER },
        ],
      },
    },
  };
}

describe("parsePayment", () => {
  it("extracts memo, amount, mint and both OWNER wallets (not token accounts)", () => {
    const facts = parsePayment(x402Tx());
    expect(facts.succeeded).toBe(true);
    expect(facts.memos).toEqual([ORDER]);
    expect(facts.transfers).toEqual([
      {
        type: "transferChecked",
        programId: TOKEN_PROGRAM_ID,
        source: SRC_ATA,
        destination: DST_ATA,
        authority: GATEWAY,
        amount: "100000",
        mint: MINT,
        sourceOwner: GATEWAY,
        destinationOwner: SELLER,
        inner: false,
      },
    ]);
    expect(facts.instructionLayout).toEqual([
      "ComputeBudget111111111111111111111111111111",
      "ComputeBudget111111111111111111111111111111",
      "spl-token:transferChecked",
      "spl-memo",
    ]);
  });

  it("reports a failed transaction", () => {
    expect(parsePayment(x402Tx({ err: { InstructionError: [2, "Custom"] } })).succeeded).toBe(false);
  });

  it("leaves owners null when token balances don't cover the account", () => {
    const facts = parsePayment(x402Tx({ preTokenBalances: [], postTokenBalances: [] }));
    expect(facts.transfers[0].sourceOwner).toBeNull();
    expect(facts.transfers[0].destinationOwner).toBeNull();
  });

  it("finds transfers in inner (CPI) instructions too", () => {
    const tx = x402Tx();
    const transfer = tx.transaction.message.instructions[2];
    tx.transaction.message.instructions.splice(2, 1);
    tx.meta!.innerInstructions = [{ index: 2, instructions: [transfer] }];
    const facts = parsePayment(tx);
    expect(facts.transfers).toHaveLength(1);
    expect(facts.transfers[0].inner).toBe(true);
  });
});
