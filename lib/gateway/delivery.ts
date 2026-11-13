// Delivery checks hook for the gateway (owner of this file: Nizar).
//
// The delivery checks themselves are FABI's (SPEC.md section 7). The interface proposed in Slack
// (Nov 13) is `recordDelivery(order, body)` in lib/delivery.ts: run the 3 checks, insert the
// `deliveries` row, then call tryBook(order_id).
//
// STUB, not an implementation: until Fabi's lib/delivery.ts lands this records nothing, so a paid
// order stays `paid` and the gateway answers `paid` with a note. When it lands, replace the body
// below with `export { recordDelivery } from "../delivery";` (or the agreed name).

import type { DeliveryRow, OrderRow } from "../db-types";

export type RecordDelivery = (order: OrderRow, body: string) => Promise<DeliveryRow | null>;

/** Returns null = "delivery checks not connected yet". */
export const recordDelivery: RecordDelivery = async (order) => {
  console.warn(`gateway: delivery checks not connected yet (lib/delivery.ts, Fabi); order ${order.order_id} stays paid`);
  return null;
};
