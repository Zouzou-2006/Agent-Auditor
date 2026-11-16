"use client";
// Exceptions (owner: Aidan): one card per exception, most severe first. Each card says what happened in
// a sentence, with the decision buttons on the right. A payment with no order has no order to book and
// no seller to block, so its only action is to look at the payment on Solana.

import { useMemo, useState } from "react";
import type { ExceptionRow, ExceptionStatus, OrderRow } from "@/lib/db-types";
import { explorerTxUrl, SEVERITIES, type DashboardData } from "@/lib/dashboard/model";
import { exceptionText } from "@/lib/dashboard/overview";
import { dollars, EXCEPTION_STATUS_LABEL, EXCEPTION_TITLE } from "@/lib/dashboard/words";
import { Empty, ExceptionStatusBadge, fullTime, SeverityStamp, timeAgo } from "./ui";

interface Props {
  data: DashboardData;
  now: number;
  loading: boolean;
  fresh: Set<string>;
  onOpenOrder: (order: OrderRow) => void;
  onAction: (exc: ExceptionRow, action: "approve" | "block_seller") => void;
}

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
  const payments = useMemo(() => new Map(data.payments.map((p) => [p.tx_signature, p])), [data.payments]);
  const count = (s: ExceptionStatus | "all") => (s === "all" ? data.exceptions.length : data.exceptions.filter((e) => e.status === s).length);

  return (
    <section className="card" aria-labelledby="exc-h">
      <div className="card-head">
        <h2 id="exc-h">Exceptions</h2>
        <span className="hint">Most severe first. Each one needs a human decision.</span>
      </div>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Filter by status">
          {(["open", "approved", "seller_blocked", "all"] as const).map((s) => (
            <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>
              {s === "all" ? "All" : EXCEPTION_STATUS_LABEL[s]} <span className="seg-count">{count(s)}</span>
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="exc-list" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="exc-card">
              <span className="skeleton" style={{ width: "60%" }} />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty title={status === "open" ? "No open exceptions" : "Nothing here"}>Every matched payment with a passing delivery was booked.</Empty>
      ) : (
        <ul className="exc-list">
          {rows.map((e) => {
            const order = e.order_id ? orders.get(e.order_id) : undefined;
            const payment = e.tx_signature ? payments.get(e.tx_signature) : undefined;
            const amount = payment?.amount ?? order?.quote_amount ?? null;
            return (
              <li
                key={e.exception_id}
                className={`exc-card sev-${e.severity}${order ? " clickable" : ""}${fresh.has(e.exception_id) ? " fresh" : ""}`}
                onClick={() => order && onOpenOrder(order)}
              >
                <SeverityStamp severity={e.severity} />
                <div className="exc-main">
                  <div className="exc-title" title={e.type}>
                    {EXCEPTION_TITLE[e.type]}
                    {e.status !== "open" && <ExceptionStatusBadge status={e.status} />}
                  </div>
                  <div className="exc-text" title={e.summary ?? undefined}>{exceptionText(e, data)}</div>
                </div>
                <div className="exc-figures">
                  <span className="exc-amount num">{amount !== null ? dollars(amount) : ""}</span>
                  <time className="exc-when" dateTime={e.created_at} title={fullTime(e.created_at)}>{timeAgo(e.created_at, now)}</time>
                </div>
                <div className="exc-actions" onClick={(ev) => ev.stopPropagation()}>
                  {e.status !== "open" ? (
                    <span className="muted">Resolved</span>
                  ) : e.type === "no_order" ? (
                    e.tx_signature ? (
                      <a className="btn btn-sm" href={explorerTxUrl(e.tx_signature)} target="_blank" rel="noreferrer" title={e.tx_signature}>
                        View payment on Solana ↗
                      </a>
                    ) : (
                      <button className="btn btn-sm" disabled>View payment on Solana ↗</button>
                    )
                  ) : (
                    <>
                      <button className="btn btn-sm" onClick={() => onAction(e, "approve")}>Approve</button>
                      <button className="btn btn-sm btn-danger" onClick={() => onAction(e, "block_seller")}>Block seller</button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
