"use client";

import { useMemo, useState } from "react";
import type { OrderRow } from "@/lib/db-types";
import { formatUsd, outgoing, shortId, type DashboardData } from "@/lib/dashboard/model";
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
  const totals = useMemo(() => {
    const byAccount = new Map<string, number>();
    for (const j of data.journal_entries) byAccount.set(j.debit_account, (byAccount.get(j.debit_account) ?? 0) + j.amount);
    return [...byAccount.entries()];
  }, [data.journal_entries]);
  const orderLink = (id: string | null) => {
    const o = id ? orders.get(id) : undefined;
    if (!o) return <span className="muted">{id ? shortId(id) : "none"}</span>;
    return (
      <button className="mono" style={{ background: "none", border: 0, padding: 0, color: "var(--accent)", cursor: "pointer" }} onClick={() => onOpenOrder(o)}>
        {shortId(o.order_id)}
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
          {totals.length > 0 && (
            <div className="toolbar" style={{ gap: 20 }}>
              {totals.map(([account, amount]) => (
                <span key={account} className="dim">
                  {account}: <b className="num" style={{ color: "var(--text)" }}>{formatUsd(amount)}</b>
                </span>
              ))}
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Debit</th>
                  <th>Credit</th>
                  <th className="right">Amount</th>
                  <th>Description</th>
                  <th>Order</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              {loading ? (
                <SkeletonRows rows={3} cols={7} />
              ) : (
                <tbody>
                  {data.journal_entries.map((j) => (
                    <tr key={j.entry_id} className={fresh.has(j.entry_id) ? "fresh" : undefined}>
                      <td className="num">{j.entry_date}</td>
                      <td>{j.debit_account}</td>
                      <td>{j.credit_account}</td>
                      <td className="right num">{formatUsd(j.amount)}</td>
                      <td className="dim">{j.description}</td>
                      <td>{orderLink(j.order_id)}</td>
                      <td><TxLink sig={j.tx_signature} /></td>
                    </tr>
                  ))}
                </tbody>
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
                <th>Block time</th>
                <th>Transaction</th>
                <th>Direction</th>
                <th>From → to</th>
                <th className="right">Amount</th>
                <th>Memo</th>
                <th>Matched order</th>
              </tr>
            </thead>
            {loading ? (
              <SkeletonRows rows={3} cols={7} />
            ) : (
              <tbody>
                {payments.map((p) => (
                  <tr key={p.tx_signature} className={fresh.has(p.tx_signature) ? "fresh" : undefined}>
                    <td className="dim" title={fullTime(p.block_time)}>{timeAgo(p.block_time, now)}</td>
                    <td><TxLink sig={p.tx_signature} /></td>
                    <td className="dim">{out.has(p.tx_signature) ? "out" : "in"}</td>
                    <td><AddrLink addr={p.from_wallet} /> → <AddrLink addr={p.to_wallet} /></td>
                    <td className="right num">{formatUsd(p.amount)}</td>
                    <td className="mono dim">{p.memo ? shortId(p.memo, 6) : "—"}</td>
                    <td>{p.order_id ? orderLink(p.order_id) : out.has(p.tx_signature) ? <span className="reason crit">no order</span> : <span className="muted">funding</span>}</td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
          {!loading && payments.length === 0 && <Empty title="No payments seen yet">QuickNode Streams writes every USDC transfer from the wallet here.</Empty>}
        </div>
      )}
    </section>
  );
}
