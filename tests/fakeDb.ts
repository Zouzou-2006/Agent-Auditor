import type {
  Db,
  Delivery,
  ExceptionRow,
  JournalEntry,
  Order,
  Payment,
  Seller,
} from "../lib/db";

/** In-memory Db. Each method is synchronous inside, so compare-and-set is atomic. */
export class FakeDb implements Db {
  orders = new Map<string, Order>();
  payments: Payment[] = [];
  deliveries = new Map<string, Delivery>();
  journal: JournalEntry[] = [];
  exceptions: ExceptionRow[] = [];
  sellers = new Map<string, Seller>();
  private nextId = 1;

  // Test helpers (stand-ins for the webhook / delivery checker writing rows).
  addOrder(o: Order) { this.orders.set(o.order_id, { ...o }); }
  addSeller(s: Seller) { this.sellers.set(s.seller_id, { ...s }); }
  addPayment(p: Payment) { this.payments.push({ ...p }); }
  addDelivery(d: Delivery) { this.deliveries.set(d.order_id, structuredClone(d)); }

  async getOrder(id: string) { const o = this.orders.get(id); return o ? { ...o } : null; }
  async getSeller(id: string) { const s = this.sellers.get(id); return s ? { ...s } : null; }
  async getPaymentForOrder(id: string) { return this.payments.find((p) => p.order_id === id) ?? null; }
  async getDelivery(id: string) { return this.deliveries.get(id) ?? null; }
  async getException(id: string) { return this.exceptions.find((e) => e.exception_id === id) ?? null; }
  async getExceptionByTx(sig: string) { return this.exceptions.find((e) => e.tx_signature === sig) ?? null; }

  async updateOrderStatusIf(id: string, from: Order["status"], to: Order["status"]) {
    const o = this.orders.get(id);
    if (!o || o.status !== from) return false;
    o.status = to;
    return true;
  }

  async updateExceptionStatusIf(id: string, from: ExceptionRow["status"], to: ExceptionRow["status"]) {
    const e = this.exceptions.find((x) => x.exception_id === id);
    if (!e || e.status !== from) return false;
    e.status = to;
    return true;
  }

  async insertJournalEntry(entry: Omit<JournalEntry, "entry_id">) {
    const row = { entry_id: `je_${this.nextId++}`, ...entry };
    this.journal.push(row);
    return row;
  }

  async insertException(exception: Omit<ExceptionRow, "exception_id">) {
    const row = { exception_id: `ex_${this.nextId++}`, ...exception };
    this.exceptions.push(row);
    return row;
  }

  async setSellerStatus(id: string, status: Seller["status"]) {
    const s = this.sellers.get(id);
    if (s) s.status = status;
  }
}
