import type { Db, NewException, NewJournalEntry } from "../lib/booking-db";
import type {
  DeliveryRow,
  ExceptionRow,
  ExceptionStatus,
  JournalEntryRow,
  OrderRow,
  OrderStatus,
  PaymentRow,
  SellerRow,
  SellerStatus,
} from "../lib/db-types";

/** In-memory Db. Each method is synchronous inside, so compare-and-set is atomic. */
export class FakeDb implements Db {
  orders = new Map<string, OrderRow>();
  payments: PaymentRow[] = [];
  deliveries = new Map<string, DeliveryRow>();
  journal: JournalEntryRow[] = [];
  exceptions: ExceptionRow[] = [];
  sellers = new Map<string, SellerRow>();
  private nextId = 1;

  // Test helpers (stand-ins for the webhook / delivery checker writing rows).
  addOrder(o: OrderRow) { this.orders.set(o.order_id, structuredClone(o)); }
  addSeller(s: SellerRow) { this.sellers.set(s.seller_id, { ...s }); }
  addPayment(p: PaymentRow) { this.payments.push(structuredClone(p)); }
  addDelivery(d: DeliveryRow) { this.deliveries.set(d.order_id, structuredClone(d)); }

  async getOrder(id: string) { const o = this.orders.get(id); return o ? structuredClone(o) : null; }
  async getSeller(id: string) { const s = this.sellers.get(id); return s ? { ...s } : null; }
  async getPaymentForOrder(id: string) { return this.payments.find((p) => p.order_id === id) ?? null; }
  async getDelivery(id: string) { return this.deliveries.get(id) ?? null; }
  async getException(id: string) { return this.exceptions.find((e) => e.exception_id === id) ?? null; }
  async getExceptionByTx(sig: string) { return this.exceptions.find((e) => e.tx_signature === sig) ?? null; }

  async updateOrderStatusIf(id: string, from: OrderStatus, to: OrderStatus) {
    const o = this.orders.get(id);
    if (!o || o.status !== from) return false;
    o.status = to;
    return true;
  }

  async updateExceptionStatusIf(id: string, from: ExceptionStatus, to: ExceptionStatus) {
    const e = this.exceptions.find((x) => x.exception_id === id);
    if (!e || e.status !== from) return false;
    e.status = to;
    return true;
  }

  async insertJournalEntry(entry: NewJournalEntry) {
    const row: JournalEntryRow = { entry_id: `je_${this.nextId++}`, ...entry };
    this.journal.push(row);
    return row;
  }

  async insertException(exception: NewException) {
    const row: ExceptionRow = {
      exception_id: `ex_${this.nextId++}`,
      created_at: new Date().toISOString(),
      ...exception,
    };
    this.exceptions.push(row);
    return row;
  }

  async setSellerStatus(id: string, status: SellerStatus) {
    const s = this.sellers.get(id);
    if (!s) throw new Error(`booking-db: setSellerStatus: seller ${id} not found`); // same as Supabase Db
    s.status = status;
  }
}
