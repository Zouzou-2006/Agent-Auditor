"use client";

import { useMemo } from "react";
import type { OrderRow, OrderStatus } from "@/lib/db-types";
import { filterOrders, formatUsd, ORDER_STATUSES, paymentTxByOrder, shortId, type DashboardData, type OrderFilter } from "@/lib/dashboard/model";
import { AddrLink, Empty, fullTime, Icon, SkeletonRows, StatusBadge, timeAgo, TxLink } from "./ui";

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

function paramsText(params: unknown): string {
  if (!params || typeof params !== "object") return "";
  return Object.entries(params as Record<string, unknown>)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" · ");
}

export default function Orders({ data, now, loading, fresh, filter, onFilter, onOpen, onApprove }: Props) {
  const rows = useMemo(() => filterOrders(data.orders, filter), [data.orders, filter]);
  const paymentTx = useMemo(() => paymentTxByOrder(data.payments), [data.payments]);
  const sellers = useMemo(() => [...new Set(data.orders.map((o) => o.seller_id))].sort(), [data.orders]);
  const filtered = filter.query !== "" || filter.status !== "all" || filter.seller !== "all";

  return (
    <section className="card" aria-labelledby="orders-h">
      <div className="card-head">
        <h2 id="orders-h">Orders</h2>
        <span className="hint">
          {rows.length} of {data.orders.length}
        </span>
      </div>
      <div className="toolbar">
        <label className="search">
          <Icon name="search" />
          <span className="sr-only">Search orders</span>
          <input
            className="input"
            placeholder="Search id, seller, purpose, reason…"
            value={filter.query}
            onChange={(e) => onFilter({ ...filter, query: e.target.value })}
          />
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select className="select" value={filter.status} onChange={(e) => onFilter({ ...filter, status: e.target.value as OrderStatus | "all" })}>
            <option value="all">All statuses</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Seller</span>
          <select className="select" value={filter.seller} onChange={(e) => onFilter({ ...filter, seller: e.target.value })}>
            <option value="all">All sellers</option>
            {sellers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {filtered && (
          <button className="btn btn-ghost btn-sm" onClick={() => onFilter({ query: "", status: "all", seller: "all" })}>
            Clear filters
          </button>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Order</th>
              <th>Seller</th>
              <th>Item</th>
              <th className="right">Max</th>
              <th className="right">Quote</th>
              <th>Payment</th>
              <th>Status</th>
              <th>Reason</th>
              <th />
            </tr>
          </thead>
          {loading ? (
            <SkeletonRows rows={5} cols={10} />
          ) : (
            <tbody>
              {rows.map((o) => (
                <tr
                  key={o.order_id}
                  className={`clickable${fresh.has(o.order_id) ? " fresh" : ""}`}
                  onClick={() => onOpen(o)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onOpen(o)}
                >
                  <td title={fullTime(o.created_at)} className="dim" style={{ whiteSpace: "nowrap" }}>
                    {timeAgo(o.created_at, now)}
                  </td>
                  <td className="mono">{shortId(o.order_id)}</td>
                  <td>{o.seller_id}</td>
                  <td>
                    {o.item}
                    <div className="cell-sub mono">{paramsText(o.params)}</div>
                  </td>
                  <td className="right num">{formatUsd(o.max_amount)}</td>
                  <td className="right num">
                    {formatUsd(o.quote_amount)}
                    {o.quote_wallet && (
                      <div className="cell-sub">
                        <AddrLink addr={o.quote_wallet} />
                      </div>
                    )}
                  </td>
                  <td>
                    <TxLink sig={paymentTx.get(o.order_id) ?? null} />
                  </td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td style={{ maxWidth: 260 }}>
                    {o.deny_reason ? (
                      <span className="reason">{o.deny_reason}</span>
                    ) : o.summary ? (
                      <span className="cell-sub"><span className="ai-tag">AI</span>{o.summary}</span>
                    ) : (
                      <span className="cell-sub">{o.purpose}</span>
                    )}
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
              ))}
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
