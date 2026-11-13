import rules from "../config/rules.json";

// All amounts are integers in USDC base units (1 USDC = 1_000_000).

export interface Order {
  max_amount: number;
}

export interface Seller {
  wallet: string;
  status: string; // only "approved" passes rule 1; anything else is denied
}

export interface Quote {
  amount: number;
  wallet: string;
  asset: string; // token mint address; must equal rules.usdc_mint
  network: string;
}

export type CheckResult =
  | { ok: true }
  | { ok: false; rule: number; reason: string };

const OK: CheckResult = { ok: true };
const fail = (rule: number, reason: string): CheckResult => ({ ok: false, rule, reason });

/** Rules 1–3: is this order allowed before we even ask for a quote? */
export function checkOrder(order: Order, seller: Seller | null, todaySpent: number): CheckResult {
  if (seller === null) return fail(1, "seller not approved");
  // Default deny: any status other than exactly "approved" is treated as blocked.
  if (seller.status !== "approved") return fail(1, "seller blocked");
  if (order.max_amount > rules.max_per_purchase) return fail(2, "over per-purchase limit");
  if (todaySpent + order.max_amount > rules.max_per_day) return fail(3, "over daily limit");
  return OK;
}

/** Rules 4–6: does the seller's quote match what we agreed to pay, and where? */
export function checkQuote(order: Order, quote: Quote, seller: Seller): CheckResult {
  if (quote.amount > order.max_amount) return fail(4, "quote over max");
  if (quote.wallet !== seller.wallet) return fail(5, "quote wallet doesn't match seller");
  if (quote.asset !== rules.usdc_mint || quote.network !== rules.network) {
    return fail(6, "wrong asset or network");
  }
  return OK;
}

/** Orders above the review threshold need a human to sign off. */
export function needsReview(order: Order): boolean {
  return order.max_amount > rules.human_review_over;
}
