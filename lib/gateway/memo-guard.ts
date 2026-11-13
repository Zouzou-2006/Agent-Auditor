// Gateway memo guard (owner: Nizar).
//
// In x402 v2 on Solana the SELLER chooses the memo (`extra.memo` in its 402 quote) and the
// facilitator only checks the signed transaction against that value. So before the gateway
// signs anything it must confirm the quote's memo is exactly this order's `order_id`;
// otherwise the payment could not be matched to the order on-chain.
//
// This is a proposed gateway requirement (see docs/memo-test.md), not a SPEC.md rule:
// the reasons below are internal and are NOT orders.deny_reason strings.

import type { PaymentRequirements } from "@x402/core/types";

export type MemoCheck = { ok: true } | { ok: false; reason: string };

export function checkPaymentMemo(requirements: PaymentRequirements, orderId: string): MemoCheck {
  const memo = requirements.extra?.memo;
  if (typeof memo !== "string" || memo === "") {
    return { ok: false, reason: "seller quote has no memo" };
  }
  if (memo !== orderId) {
    return { ok: false, reason: "seller quote memo does not match order_id" };
  }
  return { ok: true };
}

/**
 * `x402Client.onBeforePaymentCreation` hook: aborts before the transaction is built or
 * signed when the selected requirements don't carry this order's id as the memo.
 */
export function memoGuardHook(orderId: string) {
  return async (context: { selectedRequirements: PaymentRequirements }) => {
    const result = checkPaymentMemo(context.selectedRequirements, orderId);
    if (!result.ok) return { abort: true as const, reason: result.reason };
    return undefined;
  };
}
