"use client";

import { useMemo, useState } from "react";
import type { ExceptionRow, ExceptionStatus, OrderRow } from "@/lib/db-types";
import { SEVERITIES, shortId, type DashboardData } from "@/lib/dashboard/model";
import { Empty, ExceptionStatusBadge, fullTime, SeverityBadge, SkeletonRows, timeAgo, TxLink } from "./ui";

interface Props {
  data: DashboardData;
  now: number;
  loading: boolean;
  fresh: Set<string>;
  onOpenOrder: (order: OrderRow) => void;
  onAction: (exc: ExceptionRow, action: "approve" | "block_seller") => void;
}

const TYPE_HELP: Record<string, string> = {
  no_order: "A payment left the wallet with no matching order: the key may be stolen.",
  wallet_mismatch: "The payment went to a wallet other than the quoted one.",
  amount_mismatch: "The payment amount differs from the quote.",
  nothing_delivered: "Paid, but the seller returned nothing.",
  bad_format: "The delivery is missing fields or has the wrong types.",
  wrong_data: "The delivery doesn't match what was ordered.",
};

export default function Exceptions({ data, now, loading, fresh, onOpenOrder, onAction }: Props) {
  const [status, setStatus] = useState<ExceptionStatus | "all">("open");
  const rows = useMemo(
    () =>
      data.exceptions
        .filter((e) => status === "all" || e.status === status)
        .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || b.created_at.localeCompare(a.created_at)),
    [data.exceptions, status],
  );
  const orders = useMemo(() => new Map(data.orders.map((o) => [o.order_id, o])), [data.orders]);
  const count = (s: ExceptionStatus | "all") => (s === "all" ? data.exceptions.length : data.exceptions.filter((e) => e.status === s).length);

  return (
    <section className="card" aria-labelledby="exc-h">
      <div className="card-head">
        <h2 id="exc-h">Exceptions</h2>
        <span className="hint">Sorted by severity. Each one needs a human decision.</span>
      </div>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Filter by status">
          {(["open", "approved", "seller_blocked", "all"] as const).map((s) => (
            <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>
              {s} ({count(s)})
            </button>
          ))}
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Type</th>
              <th>What happened</th>
              <th>Order</th>
              <th>Transaction</th>
              <th>Raised</th>
              <th>Status</th>
              <th className="right">Action</th>
            </tr>
          </thead>
          {loading ? (
            <SkeletonRows rows={3} cols={8} />
          ) : (
            <tbody>
              {rows.map((e) => {
                const order = e.order_id ? orders.get(e.order_id) : undefined;
                return (
                  <tr key={e.exception_id} className={fresh.has(e.exception_id) ? "fresh" : undefined}>
                    <td><SeverityBadge severity={e.severity} /></td>
                    <td className="mono">{e.type}</td>
                    <td style={{ maxWidth: 320 }}>
                      {e.summary ?? TYPE_HELP[e.type]}
                      {e.summary && <div className="cell-sub">{TYPE_HELP[e.type]}</div>}
                    </td>
                    <td>
                      {order ? (
                        <button className="mono" style={{ background: "none", border: 0, padding: 0, color: "var(--accent)", cursor: "pointer" }} onClick={() => onOpenOrder(order)}>
                          {shortId(order.order_id)}
                        </button>
                      ) : (
                        <span className="muted">none</span>
                      )}
                    </td>
                    <td><TxLink sig={e.tx_signature} /></td>
                    <td className="dim" title={fullTime(e.created_at)}>{timeAgo(e.created_at, now)}</td>
                    <td><ExceptionStatusBadge status={e.status} /></td>
                    <td className="right" style={{ whiteSpace: "nowrap" }}>
                      {e.status !== "open" ? (
                        <span className="muted">Resolved</span>
                      ) : e.type === "no_order" ? (
                        <span className="cell-sub" title="No order to book and no seller to block: resolving these is on the roadmap">Investigate off-platform</span>
                      ) : (
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          <button className="btn btn-sm" onClick={() => onAction(e, "approve")}>Approve</button>
                          <button className="btn btn-sm btn-danger" onClick={() => onAction(e, "block_seller")}>Block seller</button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          )}
        </table>
        {!loading && rows.length === 0 && (
          <Empty title={status === "open" ? "No open exceptions" : "Nothing here"}>
            Every matched payment with a passing delivery was booked.
          </Empty>
        )}
      </div>
    </section>
  );
}
