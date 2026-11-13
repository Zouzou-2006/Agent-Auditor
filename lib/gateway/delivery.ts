// Delivery checks hook for the gateway (owner of this file: Nizar).
//
// The delivery checks themselves are FABI's (SPEC.md section 7), in lib/delivery.ts:
// `recordDelivery(order, body)` runs the 3 checks, inserts the `deliveries` row, then calls
// tryBook(order_id). It always records a delivery, so it never returns null.

import type { DeliveryRow, OrderRow } from "../db-types";
import { recordDelivery as fabiRecordDelivery } from "../delivery";

export type RecordDelivery = (order: OrderRow, body: string) => Promise<DeliveryRow | null>;

export const recordDelivery: RecordDelivery = (order, body) => fabiRecordDelivery(order, body);
