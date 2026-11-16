"use client";

import { useMemo, useState } from "react";
import type { OrderRow } from "@/lib/db-types";
import { explorerTxUrl, formatUsd, outgoing, type DashboardData } from "@/lib/dashboard/model";
import { ledgerTotals } from "@/lib/dashboard/overview";
import { itemLabel, longDate } from "@/lib/dashboard/words";
import { AddrLink, Empty, fullTime, SkeletonRows, timeAgo, TxLink } from "./ui";

interface Props {
  data: DashboardData;
  gatewayWallet: string | null;
  now: number;
  loading: boolean;
  fresh: Set<string>;
  onOpenOrder: (order: OrderRow) => void;
}

export default function Ledger({ data, gatewayWallet, now, loading, fresh, onOpenOrder }: Props) {
  const [tab, setTab] = useState<"journal" | "payments">("journal");
  const orders = useMemo(() => new Map(data.orders.map((o) => [o.order_id, o])), [data.orders]);
  const payments = useMemo(
    () => [...data.payments].sort((a, b) => b.block_time.localeCompare(a.block_time)),
    [data.payments],
  );
  const out = useMemo(() => new Set(outgoing(data.payments, gatewayWallet).map((p) => p.tx_signature)), [data.payments, gatewayWallet]);
  const totals = useMemo(() => ledgerTotals(data, gatewayWallet), [data, gatewayWallet]);
  const orderLink = (id: string | null, memo?: string | null) => {
    const o = id ? orders.get(id) : undefined;
    const tip = [id && `Order ${id}`, memo && `Memo ${memo}`].filter(Boolean).join(" · ") || undefined;
    if (!o) return <span className="muted" title={tip}>{id ? "Order not loaded" : "No order"}</span>;
    return (
      <button className="linklike" onClick={() => onOpenOrder(o)} title={tip}>
        {itemLabel(o)}
      </button>
    );
  };

  return (
    <section className="card" aria-labelledby="ledger-h">
      <div className="card-head">
        <h2 id="ledger-h">Ledger</h2>
        <div className="right">
          <div className="seg" role="group" aria-label="Ledger view">
            <button aria-pressed={tab === "journal"} onClick={() => setTab("journal")}>
              Journal entries ({data.journal_entries.length})
            </button>
            <button aria-pressed={tab === "payments"} onClick={() => setTab("payments")}>
              On-chain payments ({data.payments.length})
            </button>
          </div>
        </div>
      </div>

      {tab === "journal" ? (
        <>
          <div className="toolbar ledger-totals">
            <span>On-chain out <b className="num">{formatUsd(totals.out)}</b></span>
            <span aria-hidden="true">·</span>
            <span>Booked <b className="num">{formatUsd(totals.booked)}</b></span>
            <span aria-hidden="true">·</span>
            <span>
              Not booked <b className={`num${totals.notBooked > 0 ? " crit-text" : ""}`}>{formatUsd(totals.notBooked)}</b>
              {totals.notBooked > 0 && totals.unmatched > 0 && (
                <span className="crit-text">
                  {" "}({totals.unmatched === totals.notBooked ? "payment with no order" : `${formatUsd(totals.unmatched)} is a payment with no order`})
                </span>
              )}
              {totals.notBooked > 0 && totals.unmatched === 0 && <span className="muted"> (waiting to be booked)</span>}
            </span>
          </div>
          <div className="table-wrap">
            {/* Accounting format: the entry line, the debit, then the credit indented in its own column. */}
            <table className="journal">
              <thead>
                <tr>
                  <th style={{ width: 130 }}>Date</th>
                  <th>Account</th>
                  <th className="right" style={{ width: 120 }}>Debit</th>
                  <th className="right" style={{ width: 120 }}>Credit</th>
                </tr>
              </thead>
              {loading ? (
                <SkeletonRows rows={3} cols={4} />
              ) : (
                data.journal_entries.map((j) => (
                  <tbody key={j.entry_id} className={`je${fresh.has(j.entry_id) ? " fresh" : ""}`}>
                    <tr className="je-head">
                      <td className="num" title={j.entry_date}>{longDate(j.entry_date)}</td>
                      <td colSpan={3}>
                        <span className="je-desc">{j.description}</span>
                        <span className="je-refs">
                          {orderLink(j.order_id)}
                          {j.tx_signature && (
                            <a href={explorerTxUrl(j.tx_signature)} target="_blank" rel="noreferrer" title={j.tx_signature}>
                              on Solana ↗
                            </a>
                          )}
                        </span>
                      </td>
                    </tr>
                    <tr className="je-line">
                      <td />
                      <td>{j.debit_account}</td>
                      <td className="right num">{formatUsd(j.amount)}</td>
                      <td />
                    </tr>
                    <tr className="je-line je-credit">
                      <td />
                      <td>{j.credit_account}</td>
                      <td />
                      <td className="right num">{formatUsd(j.amount)}</td>
                    </tr>
                  </tbody>
                ))
              )}
            </table>
            {!loading && data.journal_entries.length === 0 && <Empty title="No journal entries yet">Clean purchases are booked here automatically.</Empty>}
          </div>
        </>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Transaction</th>
                <th>Direction</th>
                <th>From → to</th>
                <th className="right">Amount</th>
                <th>Matched order</th>
              </tr>
            </thead>
            {loading ? (
              <SkeletonRows rows={3} cols={6} />
            ) : (
              <tbody>
                {payments.map((p) => (
                  <tr key={p.tx_signature} className={fresh.has(p.tx_signature) ? "fresh" : undefined}>
                    <td className="dim" title={fullTime(p.block_time)}>{timeAgo(p.block_time, now)}</td>
                    <td><TxLink sig={p.tx_signature} /></td>
                    <td className="dim">{out.has(p.tx_signature) ? "Out" : "In"}</td>
                    <td><AddrLink addr={p.from_wallet} /> → <AddrLink addr={p.to_wallet} /></td>
                    <td className="right num">{formatUsd(p.amount)}</td>
                    <td>
                      {p.order_id ? (
                        orderLink(p.order_id, p.memo)
                      ) : out.has(p.tx_signature) ? (
                        <span className="reason crit" title={p.memo ? `Memo ${p.memo}` : "No memo"}>No order</span>
                      ) : (
                        <span className="muted">Incoming funds</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
          {!loading && payments.length === 0 && <Empty title="No payments seen yet">Every USDC payment in or out of the wallet shows up here, read from Solana.</Empty>}
        </div>
      )}
    </section>
  );
}
