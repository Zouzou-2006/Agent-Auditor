// Extract memo + SPL token transfers from a Solana transaction fetched with
// getTransaction(signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }).
// Owner: Nizar. Pure function: no RPC calls, so the memo test and the Streams matcher can share it.
//
// Token transfers move between TOKEN ACCOUNTS. The owning wallets are resolved from
// meta.preTokenBalances / meta.postTokenBalances (accountIndex -> owner). If an owner can't be
// resolved that way it is left null and the caller must look the account up via RPC.

export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** The subset of a jsonParsed instruction we read. */
export interface ParsedInstruction {
  programId: string;
  program?: string;
  parsed?: unknown;
  data?: string;
}

interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
}

/** The subset of a jsonParsed getTransaction result we read. */
export interface ParsedTransaction {
  blockTime?: number | null;
  meta: {
    err: unknown;
    preTokenBalances?: TokenBalance[] | null;
    postTokenBalances?: TokenBalance[] | null;
    innerInstructions?: { index: number; instructions: ParsedInstruction[] }[] | null;
  } | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: ({ pubkey: string } | string)[];
      instructions: ParsedInstruction[];
    };
  };
}

export interface TokenTransfer {
  type: "transfer" | "transferChecked";
  programId: string;
  source: string;
  destination: string;
  authority: string | null;
  /** base units, as a string (never a float) */
  amount: string;
  /** null for plain `transfer`, which doesn't carry the mint */
  mint: string | null;
  sourceOwner: string | null;
  destinationOwner: string | null;
  /** true when the instruction was an inner (CPI) instruction */
  inner: boolean;
}

export interface PaymentFacts {
  signature: string;
  succeeded: boolean;
  blockTime: number | null;
  /** program name/id of each top-level instruction, in order */
  instructionLayout: string[];
  memos: string[];
  transfers: TokenTransfer[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function accountKey(entry: { pubkey: string } | string): string {
  return typeof entry === "string" ? entry : entry.pubkey;
}

function ownerMap(tx: ParsedTransaction): Map<string, string> {
  const keys = tx.transaction.message.accountKeys.map(accountKey);
  const owners = new Map<string, string>();
  for (const balance of [...(tx.meta?.preTokenBalances ?? []), ...(tx.meta?.postTokenBalances ?? [])]) {
    const account = keys[balance.accountIndex];
    if (account && balance.owner) owners.set(account, balance.owner);
  }
  return owners;
}

function readMemo(ix: ParsedInstruction): string | null {
  if (ix.programId !== MEMO_PROGRAM_ID) return null;
  // jsonParsed renders the memo as a plain string in `parsed`.
  if (typeof ix.parsed === "string") return ix.parsed;
  return null;
}

function readTransfer(ix: ParsedInstruction, owners: Map<string, string>, inner: boolean): TokenTransfer | null {
  if (ix.programId !== TOKEN_PROGRAM_ID && ix.programId !== TOKEN_2022_PROGRAM_ID) return null;
  if (!isRecord(ix.parsed) || !isRecord(ix.parsed.info)) return null;
  const type = ix.parsed.type;
  if (type !== "transfer" && type !== "transferChecked") return null;
  const info = ix.parsed.info;

  const source = String(info.source);
  const destination = String(info.destination);
  const tokenAmount = isRecord(info.tokenAmount) ? info.tokenAmount.amount : undefined;
  const amount = String(type === "transferChecked" ? tokenAmount : info.amount);
  if (!/^\d+$/.test(amount)) return null;

  return {
    type,
    programId: ix.programId,
    source,
    destination,
    authority: typeof info.authority === "string" ? info.authority : null,
    amount,
    mint: typeof info.mint === "string" ? info.mint : null,
    sourceOwner: owners.get(source) ?? null,
    destinationOwner: owners.get(destination) ?? null,
    inner,
  };
}

export function parsePayment(tx: ParsedTransaction): PaymentFacts {
  const owners = ownerMap(tx);
  const top = tx.transaction.message.instructions;
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((group) => group.instructions);

  const memos: string[] = [];
  const transfers: TokenTransfer[] = [];
  for (const ix of top) {
    const memo = readMemo(ix);
    if (memo !== null) memos.push(memo);
    const transfer = readTransfer(ix, owners, false);
    if (transfer) transfers.push(transfer);
  }
  for (const ix of inner) {
    const transfer = readTransfer(ix, owners, true);
    if (transfer) transfers.push(transfer);
  }

  return {
    signature: tx.transaction.signatures[0] ?? "",
    succeeded: tx.meta !== null && tx.meta.err === null,
    blockTime: tx.blockTime ?? null,
    instructionLayout: top.map((ix) => {
      const kind = isRecord(ix.parsed) && typeof ix.parsed.type === "string" ? `:${ix.parsed.type}` : "";
      return `${ix.program ?? ix.programId}${kind}`;
    }),
    memos,
    transfers,
  };
}
