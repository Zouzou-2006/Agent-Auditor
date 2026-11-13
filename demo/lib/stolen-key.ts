// Beat 4, stolen key (SPEC.md section 9), as testable pieces. Owner: Cooper.
// The transfer skips the gateway and carries no memo, so it matches no order and the
// Streams webhook must raise a critical no_order exception. Devnet only.

import { address, type Address, type Instruction, type TransactionSigner } from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

export const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const STOLEN_AMOUNT = 100_000n; // 0.10 USDC in base units
export const USDC_DECIMALS = 6;
const ATA_RENT_LAMPORTS = 2_039_280n; // if the attacker's USDC account doesn't exist yet
const FEE_HEADROOM_LAMPORTS = 50_000n;

export interface StolenKeyTransfer {
  senderAta: Address;
  attackerAta: Address;
  /** Create the attacker's USDC account if needed, then transfer. No memo instruction. */
  instructions: Instruction[];
}

export async function buildStolenKeyTransfer(
  sender: TransactionSigner,
  attacker: string,
  mint: string,
): Promise<StolenKeyTransfer> {
  const mintAddress = address(mint);
  const attackerAddress = address(attacker);
  const [senderAta] = await findAssociatedTokenPda({ owner: sender.address, mint: mintAddress, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [attackerAta] = await findAssociatedTokenPda({ owner: attackerAddress, mint: mintAddress, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const createAta = await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: sender, owner: attackerAddress, mint: mintAddress });
  const transfer = getTransferCheckedInstruction({
    source: senderAta,
    mint: mintAddress,
    destination: attackerAta,
    authority: sender,
    amount: STOLEN_AMOUNT,
    decimals: USDC_DECIMALS,
  });
  return { senderAta, attackerAta, instructions: [createAta, transfer] };
}

export interface PreflightFacts {
  sender: string;
  attacker: string;
  mint: string;
  senderLamports: bigint;
  senderUsdc: bigint;
  attackerAtaExists: boolean;
}

/** Everything that must hold before sending; an empty list means go. */
export function preflightProblems(f: PreflightFacts): string[] {
  const problems: string[] = [];
  if (f.mint !== DEVNET_USDC_MINT) problems.push(`USDC_MINT must be the devnet mint ${DEVNET_USDC_MINT}, got ${f.mint}`);
  if (f.attacker === f.sender) problems.push("the attacker address is the sender's own address");
  if (f.senderUsdc < STOLEN_AMOUNT) problems.push(`sender holds ${f.senderUsdc} USDC base units, needs ${STOLEN_AMOUNT}`);
  const needLamports = FEE_HEADROOM_LAMPORTS + (f.attackerAtaExists ? 0n : ATA_RENT_LAMPORTS);
  if (f.senderLamports < needLamports) problems.push(`sender holds ${f.senderLamports} lamports, needs ${needLamports} for fees`);
  return problems;
}

/** The facts we check after sending, from scripts' parsePayment(). */
export interface SentFacts {
  succeeded: boolean;
  memos: string[];
  transfers: { amount: string; mint: string | null; destinationOwner: string | null }[];
}

/** Confirms the transaction is what beat 4 needs: one 0.10 USDC transfer to the attacker, no memo. */
export function verifySent(facts: SentFacts, attacker: string, mint: string): string[] {
  const problems: string[] = [];
  if (!facts.succeeded) problems.push("transaction failed on-chain");
  if (facts.memos.length > 0) problems.push(`transaction carries a memo (${JSON.stringify(facts.memos)}), so it could match an order`);
  if (facts.transfers.length !== 1) {
    problems.push(`expected exactly one token transfer, found ${facts.transfers.length}`);
    return problems;
  }
  const [t] = facts.transfers;
  if (t.amount !== STOLEN_AMOUNT.toString()) problems.push(`amount ${t.amount}, expected ${STOLEN_AMOUNT}`);
  if (t.mint !== mint) problems.push(`mint ${t.mint}, expected ${mint}`);
  if (t.destinationOwner !== attacker) problems.push(`went to ${t.destinationOwner}, expected the attacker ${attacker}`);
  return problems;
}
