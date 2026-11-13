// Row types for the six Supabase tables, copied from SPEC.md section 4 and
// supabase/migrations/0001_init.sql. Owner: Nizar. Change the SPEC first, then this file.
//
// bigint columns are `number`: PostgREST returns them as JSON numbers, and USDC base-unit
// amounts in this project stay far below Number.MAX_SAFE_INTEGER. They are always integers.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type SellerStatus = "approved" | "blocked";
export type OrderStatus = "pending_review" | "denied" | "paid" | "booked" | "exception";
export type ExceptionType =
  | "no_order"
  | "wallet_mismatch"
  | "amount_mismatch"
  | "nothing_delivered"
  | "bad_format"
  | "wrong_data";
export type ExceptionSeverity = "critical" | "high" | "medium";
export type ExceptionStatus = "open" | "approved" | "seller_blocked";

export interface SellerRow {
  seller_id: string;
  name: string;
  url: string;
  wallet: string;
  status: SellerStatus;
}

export interface OrderRow {
  order_id: string;
  created_at: string;
  seller_id: string;
  item: string;
  params: Json;
  max_amount: number;
  purpose: string;
  status: OrderStatus;
  deny_reason: string | null;
  quote_amount: number | null;
  quote_wallet: string | null;
  summary: string | null;
}

export interface PaymentRow {
  tx_signature: string;
  block_time: string;
  from_wallet: string;
  to_wallet: string;
  amount: number;
  memo: string | null;
  order_id: string | null;
  raw: Json;
}

export interface DeliveryRow {
  order_id: string;
  received_at: string;
  body: string | null;
  checks: Json;
  passed: boolean;
}

export interface JournalEntryRow {
  entry_id: string;
  order_id: string;
  tx_signature: string | null;
  entry_date: string;
  debit_account: string;
  credit_account: string;
  amount: number;
  description: string;
}

export interface ExceptionRow {
  exception_id: string;
  created_at: string;
  order_id: string | null;
  tx_signature: string | null;
  type: ExceptionType;
  severity: ExceptionSeverity;
  summary: string | null;
  status: ExceptionStatus;
}

/** Columns with a database default (or nullable) are optional on insert. */
type Insert<Row, Optional extends keyof Row> = Omit<Row, Optional> & Partial<Pick<Row, Optional>>;

type Table<Row, Optional extends keyof Row> = {
  Row: Row;
  Insert: Insert<Row, Optional>;
  Update: Partial<Row>;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      sellers: Table<SellerRow, never>;
      orders: Table<
        OrderRow,
        "order_id" | "created_at" | "deny_reason" | "quote_amount" | "quote_wallet" | "summary"
      >;
      payments: Table<PaymentRow, "memo" | "order_id">;
      deliveries: Table<DeliveryRow, "received_at" | "body">;
      journal_entries: Table<JournalEntryRow, "entry_id" | "tx_signature">;
      exceptions: Table<ExceptionRow, "exception_id" | "created_at" | "order_id" | "tx_signature" | "summary">;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}
