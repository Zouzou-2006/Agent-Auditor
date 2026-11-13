// The four demo scenes (SPEC.md section 9), detected from the real rows. Nothing here is mocked:
// a scene shows as "seen" only when the data that proves it exists. Pure, unit-tested.

import type { DashboardData } from "./model";

export type SceneId = "clean" | "empty" | "injection" | "stolen";
export type SceneState = "proven" | "in_progress" | "not_yet";

export interface Scene {
  id: SceneId;
  n: number;
  title: string;
  proves: string;
  state: SceneState;
  evidence: string;
  /** What to open when the scene card is clicked. */
  target: { kind: "order"; id: string } | { kind: "exception"; id: string } | null;
}

const newest = <T>(rows: T[], key: (r: T) => string) => [...rows].sort((a, b) => key(b).localeCompare(key(a)))[0];

export function detectScenes(data: DashboardData): Scene[] {
  // 1. Clean purchase: an order booked to Data purchases expense.
  const booked = newest(data.orders.filter((o) => o.status === "booked"), (o) => o.created_at);
  const paid = newest(data.orders.filter((o) => o.status === "paid" || o.status === "paying"), (o) => o.created_at);

  // 2. Empty delivery: a nothing_delivered exception (proven once the seller is blocked).
  const empty = newest(data.exceptions.filter((e) => e.type === "nothing_delivered"), (e) => e.created_at);
  const blockedRetry = data.orders.some((o) => o.status === "denied" && o.deny_reason === "seller blocked");

  // 3. Prompt injection: an order to a seller that isn't in the table, denied before payment.
  const injected = newest(
    data.orders.filter((o) => o.status === "denied" && o.deny_reason === "seller not approved"),
    (o) => o.created_at,
  );

  // 4. Stolen key: a no_order exception raised from an unmatched on-chain payment.
  const stolen = newest(data.exceptions.filter((e) => e.type === "no_order"), (e) => e.created_at);

  return [
    {
      id: "clean",
      n: 1,
      title: "Clean purchase",
      proves: "Rules → x402 payment → on-chain match → delivery checks → journal entry",
      state: booked ? "proven" : paid ? "in_progress" : "not_yet",
      evidence: booked ? `Order ${booked.order_id.slice(0, 8)} booked` : paid ? `Order ${paid.order_id.slice(0, 8)} paid, waiting for booking` : "No purchase yet",
      target: booked ? { kind: "order", id: booked.order_id } : paid ? { kind: "order", id: paid.order_id } : null,
    },
    {
      id: "empty",
      n: 2,
      title: "Empty delivery",
      proves: "Paid but nothing delivered → exception → Block Seller",
      state: empty && (empty.status === "seller_blocked" || blockedRetry) ? "proven" : empty ? "in_progress" : "not_yet",
      evidence: empty ? (empty.status === "seller_blocked" ? "Seller blocked, loss booked" : "nothing_delivered exception open") : "No empty delivery yet",
      target: empty ? { kind: "exception", id: empty.exception_id } : null,
    },
    {
      id: "injection",
      n: 3,
      title: "Prompt injection",
      proves: "A fooled agent orders from an unknown seller → denied, no money moves",
      state: injected ? "proven" : "not_yet",
      evidence: injected ? `Order ${injected.order_id.slice(0, 8)} denied: seller not approved` : "No injected order yet",
      target: injected ? { kind: "order", id: injected.order_id } : null,
    },
    {
      id: "stolen",
      n: 4,
      title: "Stolen key",
      proves: "A payment that skips the gateway → critical no_order exception within seconds",
      state: stolen ? "proven" : "not_yet",
      evidence: stolen ? `Critical no_order exception (${stolen.status})` : "No unmatched payment yet",
      target: stolen ? { kind: "exception", id: stolen.exception_id } : null,
    },
  ];
}
