"use client";
// Orders (owner: Aidan): every order the agent filed, one line each. Status chips filter; search looks
// at the seller name, the item in words, the deny reason and the purpose (plus raw ids for the team).

import { useMemo } from "react";
import type { OrderRow } from "@/lib/db-types";
import { explorerTxUrl, filterOrders, formatUsd, matchesStatus, paymentTxByOrder, type DashboardData, type OrderFilter } from "@/lib/dashboard/model";
import { friendlyStatus, itemLabel, sellerName } from "@/lib/dashboard/words";
import { Empty, fullTime, Icon, SkeletonRows, StatusBadge, timeAgo } from "./ui";

/** Filter chips, in the order a reviewer scans them. Processing = paid or paying. */
const CHIPS: { status: OrderFilter["status"]; label: string }[] = [
  { status: "all", label: "All" },
  { status: "booked", label: friendlyStatus("booked") },
  { status: "denied", label: friendlyStatus("denied") },
  { status: "processing", label: "Processing" },
  { status: "pending_review", label: friendlyStatus("pending_review") },
  { status: "exception", label: friendlyStatus("exception") },
];

interface Props {
  data: DashboardData;
  now: number;
  loading: boolean;
  fresh: Set<string>;
  filter: OrderFilter;
  onFilter: (f: OrderFilter) => void;
  onOpen: (order: OrderRow) => void;
  onApprove: (order: OrderRow) => void;
}

export default function Orders({ data, now, loading, fresh, filter, onFilter, onOpen, onApprove }: Props) {
  const rows = useMemo(() => {
    const q = filter.query.trim().toLowerCase();
    const base = filterOrders(data.orders, { ...filter, query: "" });
    if (!q) return base;
    return base.filter((o) =>
      [sellerName(o.seller_id, data.sellers), itemLabel(o), o.deny_reason ?? "", o.purpose, o.seller_id, o.order_id].join(" ").toLowerCase().includes(q),
    );
  }, [data.orders, data.sellers, filter]);
  const paymentTx = useMemo(() => paymentTxByOrder(data.payments), [data.payments]);
  const sellers = useMemo(() => [...new Set(data.orders.map((o) => o.seller_id))].sort(), [data.orders]);
  const filtered = filter.query !== "" || filter.status !== "all" || filter.seller !== "all";
  const count = (status: OrderFilter["status"]) => data.orders.filter((o) => matchesStatus(o, status)).length;

  return (
    <section className="card" aria-labelledby="orders-h">
      <div className="card-head">
        <h2 id="orders-h">Orders</h2>
        <span className="hint">
          {rows.length} of {data.orders.length}
        </span>
      </div>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Filter by status">
          {CHIPS.map((c) => (
            <button key={c.status} aria-pressed={filter.status === c.status} onClick={() => onFilter({ ...filter, status: c.status })}>
              {c.label} <span className="seg-count">{count(c.status)}</span>
            </button>
          ))}
        </div>
        <label className="search">
          <Icon name="search" />
          <span className="sr-only">Search orders</span>
          <input className="input" placeholder="Search seller, item, reason…" value={filter.query} onChange={(e) => onFilter({ ...filter, query: e.target.value })} />
        </label>
        <label>
          <span className="sr-only">Seller</span>
          <select className="select" value={filter.seller} onChange={(e) => onFilter({ ...filter, seller: e.target.value })}>
            <option value="all">All sellers</option>
            {sellers.map((s) => (
              <option key={s} value={s}>
                {sellerName(s, data.sellers)}
              </option>
            ))}
          </select>
        </label>
        {filtered && (
          <button className="btn btn-ghost btn-sm" onClick={() => onFilter({ query: "", status: "all", seller: "all" })}>
            Clear
          </button>
        )}
      </div>
      <div className="table-wrap">
        <table className="orders-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Seller</th>
              <th>Item</th>
              <th className="right">Amount</th>
              <th>Status</th>
              <th>Why</th>
              <th />
            </tr>
          </thead>
          {loading ? (
            <SkeletonRows rows={5} cols={7} />
          ) : (
            <tbody>
              {rows.map((o) => {
                const tx = paymentTx.get(o.order_id) ?? null;
                const why = o.deny_reason ?? o.purpose;
                return (
                  <tr
                    key={o.order_id}
                    className={`clickable${fresh.has(o.order_id) ? " fresh" : ""}`}
                    onClick={() => onOpen(o)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && onOpen(o)}
                  >
                    <td className="dim" title={`${fullTime(o.created_at)} · order ${o.order_id}`}>{timeAgo(o.created_at, now)}</td>
                    <td title={o.seller_id}>{sellerName(o.seller_id, data.sellers)}</td>
                    <td title={`${o.item} ${JSON.stringify(o.params)}`}>{itemLabel(o)}</td>
                    <td className="right num amount-cell" title={o.quote_amount !== null ? `Seller's price (max ${formatUsd(o.max_amount)})` : "Max amount: no price quoted"}>
                      {tx && (
                        <a className="chain-ok" href={explorerTxUrl(tx)} target="_blank" rel="noreferrer" title={`Matched on Solana\n${tx}`} onClick={(e) => e.stopPropagation()} aria-label="Payment matched on Solana">
                          ✓
                        </a>
                      )}
                      <span className={o.status === "denied" ? "struck" : undefined}>{formatUsd(o.quote_amount ?? o.max_amount)}</span>
                    </td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="why-cell" title={why}>
                      {o.deny_reason ? <span className="reason">&ldquo;{o.deny_reason}&rdquo;</span> : <span className="dim">{o.purpose}</span>}
                    </td>
                    <td className="right">
                      {o.status === "pending_review" && (
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            onApprove(o);
                          }}
                        >
                          Approve
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          )}
        </table>
        {!loading && rows.length === 0 && (
          <Empty title={filtered ? "No orders match these filters" : "No orders yet"}>
            {filtered ? "Try clearing the filters." : "Run demo/beat1.ts to file the first purchase."}
          </Empty>
        )}
      </div>
    </section>
  );
}
