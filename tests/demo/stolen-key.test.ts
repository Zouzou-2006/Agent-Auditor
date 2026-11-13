// Beat 4's transfer and checks, with no chain: the signer is generated in memory and never used on-chain.
import { generateKeyPairSigner, type KeyPairSigner } from "@solana/kit";
import {
  findAssociatedTokenPda,
  getTransferCheckedInstructionDataDecoder,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { beforeAll, describe, expect, it } from "vitest";
import { MEMO_PROGRAM_ID } from "@/lib/solana/parse-payment";
import {
  buildStolenKeyTransfer,
  DEVNET_USDC_MINT,
  preflightProblems,
  STOLEN_AMOUNT,
  verifySent,
  type PreflightFacts,
} from "@/demo/lib/stolen-key";

let sender: KeyPairSigner;
let attacker: string;

beforeAll(async () => {
  sender = await generateKeyPairSigner();
  attacker = (await generateKeyPairSigner()).address;
});

describe("buildStolenKeyTransfer", () => {
  it("creates the attacker's USDC account if needed, then transfers exactly 100000 base units, with no memo", async () => {
    const { instructions, senderAta, attackerAta } = await buildStolenKeyTransfer(sender, attacker, DEVNET_USDC_MINT);

    expect(instructions).toHaveLength(2);
    expect(instructions.some((ix) => ix.programAddress === MEMO_PROGRAM_ID)).toBe(false);

    const [, transfer] = instructions;
    expect(transfer.programAddress).toBe(TOKEN_PROGRAM_ADDRESS);
    expect(getTransferCheckedInstructionDataDecoder().decode(transfer.data!)).toMatchObject({ amount: 100000n, decimals: 6 });
    expect(transfer.accounts!.map((a) => a.address)).toEqual([senderAta, DEVNET_USDC_MINT, attackerAta, sender.address]);
  });

  it("uses the sender's and the attacker's associated USDC accounts", async () => {
    const { senderAta, attackerAta } = await buildStolenKeyTransfer(sender, attacker, DEVNET_USDC_MINT);
    const ata = async (owner: string) =>
      (await findAssociatedTokenPda({ owner: owner as never, mint: DEVNET_USDC_MINT as never, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];

    expect(senderAta).toBe(await ata(sender.address));
    expect(attackerAta).toBe(await ata(attacker));
  });
});

describe("preflightProblems", () => {
  const facts = (overrides: Partial<PreflightFacts> = {}): PreflightFacts => ({
    sender: sender.address, attacker, mint: DEVNET_USDC_MINT,
    senderLamports: 10_000_000n, senderUsdc: 5_000_000n, attackerAtaExists: false, ...overrides,
  });

  it("is empty when everything is in place", () => {
    expect(preflightProblems(facts())).toEqual([]);
    expect(STOLEN_AMOUNT).toBe(100000n);
  });

  it.each([
    ["the wrong mint (e.g. mainnet USDC)", { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }, "devnet mint"],
    ["not enough USDC", { senderUsdc: 99_999n }, "needs 100000"],
    ["not enough SOL for the account rent and fees", { senderLamports: 1_000_000n }, "lamports"],
  ])("refuses %s", (_label, overrides, message) => {
    expect(preflightProblems(facts(overrides))).toEqual([expect.stringContaining(message)]);
  });

  it("refuses to send to the sender itself", () => {
    expect(preflightProblems(facts({ attacker: sender.address }))).toEqual([expect.stringContaining("sender's own address")]);
  });

  it("needs less SOL when the attacker's USDC account already exists", () => {
    expect(preflightProblems(facts({ senderLamports: 1_000_000n, attackerAtaExists: true }))).toEqual([]);
  });
});

describe("verifySent", () => {
  const good = () => ({
    succeeded: true, memos: [] as string[],
    transfers: [{ amount: "100000", mint: DEVNET_USDC_MINT as string | null, destinationOwner: attacker as string | null }],
  });

  it("accepts one 0.10 USDC transfer to the attacker with no memo", () => {
    expect(verifySent(good(), attacker, DEVNET_USDC_MINT)).toEqual([]);
  });

  it("flags a memo, because a memo could match an order and hide the theft", () => {
    expect(verifySent({ ...good(), memos: ["f85a9daf-7955-4a18-90aa-04cba49b76a6"] }, attacker, DEVNET_USDC_MINT)).toEqual([
      expect.stringContaining("carries a memo"),
    ]);
  });

  it("flags a failed transaction, the wrong amount, mint or destination", () => {
    const t = { amount: "1", mint: "OtherMint", destinationOwner: "Someone" };
    expect(verifySent({ succeeded: false, memos: [], transfers: [t] }, attacker, DEVNET_USDC_MINT)).toHaveLength(4);
    expect(verifySent({ succeeded: true, memos: [], transfers: [] }, attacker, DEVNET_USDC_MINT)).toEqual([
      expect.stringContaining("exactly one token transfer"),
    ]);
  });
});
