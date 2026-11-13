"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ExceptionRow, OrderRow } from "@/lib/db-types";
import { formatUsd, orderTrail, STEP_PROVENANCE, type DashboardData } from "@/lib/dashboard/model";
import { AddrLink, ExceptionStatusBadge, fullTime, Icon, SellerStatusBadge, SeverityBadge, StatusBadge, TxLink } from "./ui";

interface Props {
  order: OrderRow;
  data: DashboardData;
  onClose: () => void;
  onApprove: (order: OrderRow) => void;
  onException: (exc: ExceptionRow, action: "approve" | "block_seller") => void;
  onAsk: (order: OrderRow) => void;
  onSummarize: (order: OrderRow) => Promise<void>;
}

const STEP_ICON = { done: "check", failed: "x", waiting: "clock", skipped: "minus" } as const;

export default function OrderDrawer({ order, data, onClose, onApprove, onException, onAsk, onSummarize }: Props) {
  const [summarizing, setSummarizing] = useState(false);
  // Re-read the order from live data so the drawer updates when its status changes.
  const live = data.orders.find((o) => o.order_id === order.order_id) ?? order;
  const t = useMemo(() => orderTrail(live, data), [live, data]);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(live.order_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <div className="drawer-head">
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <StatusBadge status={live.status} />
              {live.deny_reason && <span className="reason">{live.deny_reason}</span>}
            </div>
            <h2 id="drawer-title" style={{ margin: 0, fontSize: 15 }}>
              {live.item} from {t.seller?.name ?? live.seller_id}
            </h2>
            <button className="mono muted" onClick={copy} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left" }} title="Copy order_id">
              {live.order_id} {copied ? "· copied" : ""}
            </button>
          </div>
          <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => onAsk(live)}>
            <Icon name="spark" />
            Ask copilot
          </button>
          <button ref={closeRef} className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="drawer-body">
          {live.status === "pending_review" && (
            <div className="banner info" style={{ alignItems: "center" }}>
              <span>Over the human-review threshold. Approving re-checks the rules, then requests the quote and pays.</span>
              <button className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }} onClick={() => onApprove(live)}>
                Approve
              </button>
            </div>
          )}

          <div>
            <h3>
              Why
              <span className="ai-tag" title="Written by Claude from the saved facts. It explains the decision; it never makes it."><Icon name="spark" />AI-written</span>
            </h3>
            {live.summary || t.exception?.summary ? (
              <div className="summary">{live.summary ?? t.exception?.summary}</div>
            ) : live.status === "paying" ? (
              <div className="cell-sub">A summary is written once the payment settles.</div>
            ) : (
              <button
                className="btn btn-sm"
                disabled={summarizing}
                onClick={async () => {
                  setSummarizing(true);
                  try {
                    await onSummarize(live);
                  } finally {
                    setSummarizing(false);
                  }
                }}
              >
                {summarizing ? <Icon name="refresh" className="spin" /> : <Icon name="spark" />}
                {summarizing ? "Writing summary…" : "Generate one-line summary"}
              </button>
            )}
          </div>

          <div>
            <h3>Audit trail</h3>
            <ol className="trail">
              {t.steps.map((s) => {
                const p = STEP_PROVENANCE[s.key];
                return (
                  <li key={s.key} className={s.state}>
                    <span className="node" aria-label={s.state}>
                      <Icon name={STEP_ICON[s.state]} />
                    </span>
                    <div>
                      <div className="t-row">
                        <span className="t-label">{s.label}</span>
                        <span className={`prov ${p.basis}`} title={`Decided by: ${p.source}`}>
                          <i />
                          {p.basis}
                        </span>
                      </div>
                      <div className="t-detail">{s.detail}</div>
                      <div className="cell-sub" style={{ fontSize: 11 }}>{p.source}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          <div>
            <h3>Order</h3>
            <dl className="kv">
              <dt>Seller</dt>
              <dd style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {live.seller_id}
                {t.seller ? <SellerStatusBadge status={t.seller.status} /> : <span className="reason">not in sellers</span>}
              </dd>
              <dt>Params</dt>
              <dd className="mono">{JSON.stringify(live.params)}</dd>
              <dt>Purpose</dt>
              <dd>{live.purpose}</dd>
              <dt>Max amount</dt>
              <dd className="num">{formatUsd(live.max_amount)}</dd>
              <dt>Quote</dt>
              <dd className="num">
                {formatUsd(live.quote_amount)} {live.quote_wallet && <>to <AddrLink addr={live.quote_wallet} /></>}
              </dd>
              <dt>Created</dt>
              <dd>{fullTime(live.created_at)}</dd>
            </dl>
          </div>

          {t.payment && (
            <div>
              <h3>Payment (from the chain)</h3>
              <dl className="kv">
                <dt>Transaction</dt>
                <dd><TxLink sig={t.payment.tx_signature} /></dd>
                <dt>Amount</dt>
                <dd className="num">{formatUsd(t.payment.amount)}</dd>
                <dt>From → to</dt>
                <dd><AddrLink addr={t.payment.from_wallet} /> → <AddrLink addr={t.payment.to_wallet} /></dd>
                <dt>Memo</dt>
                <dd className="mono">{t.payment.memo ?? "—"}</dd>
                <dt>Block time</dt>
                <dd>{fullTime(t.payment.block_time)}</dd>
              </dl>
            </div>
          )}

          {t.delivery && (
            <div>
              <h3>Delivery ({t.delivery.passed ? "passed" : "failed"})</h3>
              <div className="code">{t.delivery.body || "(empty body)"}</div>
            </div>
          )}

          {t.journal.length > 0 && (
            <div>
              <h3>Journal entries</h3>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Debit</th>
                    <th>Credit</th>
                    <th className="right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {t.journal.map((j) => (
                    <tr key={j.entry_id}>
                      <td>{j.entry_date}</td>
                      <td>{j.debit_account}</td>
                      <td>{j.credit_account}</td>
                      <td className="right num">{formatUsd(j.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {t.exception && (
            <div>
              <h3>Exception</h3>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="mono">{t.exception.type}</span>
                <SeverityBadge severity={t.exception.severity} />
                <ExceptionStatusBadge status={t.exception.status} />
                {t.exception.status === "open" && t.exception.type !== "no_order" && (
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <button className="btn btn-sm" onClick={() => onException(t.exception as ExceptionRow, "approve")}>Approve</button>
                    <button className="btn btn-sm btn-danger" onClick={() => onException(t.exception as ExceptionRow, "block_seller")}>Block seller</button>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
