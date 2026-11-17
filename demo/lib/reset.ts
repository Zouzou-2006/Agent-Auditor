// Demo reset (run before every take), as testable pieces. Owner: Cooper.
// demo/reset.ts wires these to the real database and devnet.

/** Children first (each references orders), then orders, so no foreign key blocks a delete. */
export const RESET_TABLES = [
  { table: "journal_entries", key: "entry_id" },
  { table: "exceptions", key: "exception_id" },
  { table: "deliveries", key: "order_id" },
  { table: "payments", key: "tx_signature" },
  { table: "orders", key: "order_id" },
] as const;

/** Every column SPEC.md section 4 names, per table. The reset stops if the database lacks any. */
export const SPEC_COLUMNS = {
  sellers: ["seller_id", "name", "url", "wallet", "status"],
  orders: [
    "order_id",
    "created_at",
    "seller_id",
    "item",
    "params",
    "max_amount",
    "purpose",
    "status",
    "deny_reason",
    "quote_amount",
    "quote_wallet",
    "summary",
  ],
  payments: ["tx_signature", "block_time", "from_wallet", "to_wallet", "amount", "memo", "order_id", "raw"],
  deliveries: ["order_id", "received_at", "body", "checks", "passed"],
  journal_entries: [
    "entry_id",
    "order_id",
    "tx_signature",
    "entry_date",
    "debit_account",
    "credit_account",
    "amount",
    "description",
  ],
  exceptions: ["exception_id", "created_at", "order_id", "tx_signature", "type", "severity", "summary", "status"],
} as const;

export const MIN_USDC = 2_000_000n; // 2.00 USDC in base units
/** 0.01 SOL: beat 4 pays its own fee (5000 lamports) plus, the first time, ~0.00204 SOL rent. */
export const MIN_SOL_LAMPORTS = 10_000_000n;

type Env = Record<string, string | undefined>;

/**
 * Why the reset must not touch this database; an empty list means go.
 * `fileEnv` is .env.local parsed on its own; `liveEnv` is process.env, which a shell variable
 * can override (process.loadEnvFile never replaces one). The client uses liveEnv, so both must agree.
 */
export function targetProblems(fileEnv: Env, liveEnv: Env): string[] {
  const fileUrl = fileEnv.NEXT_PUBLIC_SUPABASE_URL;
  if (!fileUrl) return ["NEXT_PUBLIC_SUPABASE_URL is not set in .env.local"];
  const problems: string[] = [];
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(fileUrl)) {
    problems.push(`NEXT_PUBLIC_SUPABASE_URL in .env.local isn't a Supabase project URL: ${fileUrl}`);
  }
  if (liveEnv.NEXT_PUBLIC_SUPABASE_URL !== fileUrl) {
    problems.push(
      `NEXT_PUBLIC_SUPABASE_URL is overridden by your shell (${liveEnv.NEXT_PUBLIC_SUPABASE_URL ?? "unset"}), not the .env.local project. Unset it and rerun.`,
    );
  }
  if (!fileEnv.SUPABASE_SERVICE_ROLE_KEY) problems.push("SUPABASE_SERVICE_ROLE_KEY is not set in .env.local");
  else if (liveEnv.SUPABASE_SERVICE_ROLE_KEY !== fileEnv.SUPABASE_SERVICE_ROLE_KEY) {
    problems.push("SUPABASE_SERVICE_ROLE_KEY is overridden by your shell, not the .env.local key. Unset it and rerun.");
  }
  return problems;
}

/** Integer base units as a decimal string, e.g. (1500000n, 6) -> "1.500000". No floats. */
export function formatUnits(amount: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const sign = amount < 0n ? "-" : "";
  const abs = amount < 0n ? -amount : amount;
  return `${sign}${abs / scale}.${(abs % scale).toString().padStart(decimals, "0")}`;
}

export function balanceWarnings(usdc: bigint, lamports: bigint): string[] {
  const warnings: string[] = [];
  if (usdc < MIN_USDC) {
    warnings.push(`USDC is ${formatUnits(usdc, 6)}, under ${formatUnits(MIN_USDC, 6)}: top up at faucet.circle.com`);
  }
  if (lamports < MIN_SOL_LAMPORTS) {
    warnings.push(
      `SOL is ${formatUnits(lamports, 9)}, under ${formatUnits(MIN_SOL_LAMPORTS, 9)}: too low for fees, top up at faucet.solana.com`,
    );
  }
  return warnings;
}
