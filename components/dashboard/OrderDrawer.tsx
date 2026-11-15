"use client";
// One order's full story (owner: Aidan). The top reads in plain words; ids, wallet addresses, the memo
// and raw JSON live in the collapsed "Technical details" section at the bottom.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ExceptionRow, OrderRow } from "@/lib/db-types";
import { explorerTxUrl, formatUsd, orderTrail, STEP_PROVENANCE, type DashboardData } from "@/lib/dashboard/model";
import { exceptionText, orderSummary, orderText } from "@/lib/dashboard/overview";
import { deliveryText, EXCEPTION_TITLE, itemLabel, longDate, paramsText, PROVENANCE_LABEL, sellerName } from "@/lib/dashboard/words";
import { AddrLink, ExceptionStatusBadge, fullTime, Icon, SellerStatusBadge, SeverityBadge, StatusBadge } from "./ui";

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
  const seller = sellerName(live.seller_id, data.sellers);
  const item = itemLabel(live);
  const aiSummary = orderSummary(live, data);
  const paidToSeller = t.payment && t.seller ? t.payment.to_wallet === t.seller.wallet : false;

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
              {item.charAt(0).toUpperCase() + item.slice(1)} from {seller}
            </h2>
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
              {aiSummary && (
                <span className="ai-tag" title="Written by Claude from the saved facts. It explains the decision; it never makes it."><Icon name="spark" />AI-written</span>
              )}
            </h3>
            {aiSummary ? (
              <div className="summary">{aiSummary}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
                <div className="summary plain">{t.exception ? exceptionText(t.exception, data) : orderText(live, data)}</div>
                {live.status === "paying" ? (
                  <div className="cell-sub">An AI summary is written once the payment settles.</div>
                ) : live.summary === null ? (
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
                ) : null}
              </div>
            )}
          </div>

          <div>
            <h3>Audit trail</h3>
            <ol className="trail">
              {t.steps.map((s) => {
                const p = STEP_PROVENANCE[s.key];
                return (
                  <li key={s.key} className={s.state} tabIndex={0}>
                    <span className="node" aria-label={s.state}>
                      <Icon name={STEP_ICON[s.state]} />
                    </span>
                    <div>
                      <div className="t-row">
                        <span className="t-label">{s.label}</span>
                        <span className={`prov ${p.basis}`} title={`Decided by: ${p.source} (${p.basis})`}>
                          <i />
                          {PROVENANCE_LABEL[p.basis]}
                        </span>
                      </div>
                      <div className="t-detail">{s.detail}</div>
                      <div className="t-source cell-sub">{p.source}</div>
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
                {seller}
                {t.seller && <SellerStatusBadge status={t.seller.status} />}
              </dd>
              <dt>Asked for</dt>
              <dd>{paramsText(live.params)}</dd>
              <dt>Purpose</dt>
              <dd>{live.purpose}</dd>
              <dt>Max amount</dt>
              <dd className="num">{formatUsd(live.max_amount)}</dd>
              <dt>Seller&apos;s price</dt>
              <dd className="num">{formatUsd(live.quote_amount)}</dd>
              <dt>Created</dt>
              <dd>{fullTime(live.created_at)}</dd>
            </dl>
          </div>

          {t.payment && (
            <div>
              <h3>Payment</h3>
              <dl className="kv">
                <dt>Amount</dt>
                <dd className="num">{formatUsd(t.payment.amount)}</dd>
                <dt>Paid to</dt>
                <dd>{paidToSeller ? seller : <span className="reason crit">a wallet that isn&apos;t the seller&apos;s</span>}</dd>
                <dt>Paid at</dt>
                <dd>{fullTime(t.payment.block_time)}</dd>
                <dt>Proof</dt>
                <dd>
                  <a href={explorerTxUrl(t.payment.tx_signature)} target="_blank" rel="noreferrer" title={t.payment.tx_signature}>
                    View on Solana <Icon name="external" />
                  </a>
                </dd>
              </dl>
            </div>
          )}

          {t.delivery && (
            <div>
              <h3>What the seller delivered ({t.delivery.passed ? "checks passed" : "checks failed"})</h3>
              <div className="summary plain">{deliveryText(t.delivery.body)}</div>
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
                      <td title={j.entry_date}>{longDate(j.entry_date)}</td>
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
                <span title={t.exception.type}>{EXCEPTION_TITLE[t.exception.type]}</span>
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

          <details className="tech">
            <summary>Technical details</summary>
            <dl className="kv">
              <dt>Order ID</dt>
              <dd>
                <button className="mono linklike" onClick={copy} title="Copy">
                  {live.order_id}
                </button>
                {copied && <span className="muted"> · copied</span>}
              </dd>
              <dt>Status</dt>
              <dd className="mono">{live.status}</dd>
              <dt>Seller ID</dt>
              <dd className="mono">{live.seller_id}</dd>
              <dt>Item</dt>
              <dd className="mono">{live.item} {JSON.stringify(live.params)}</dd>
              {live.quote_wallet && (
                <>
                  <dt>Quote wallet</dt>
                  <dd><AddrLink addr={live.quote_wallet} label={live.quote_wallet} /></dd>
                </>
              )}
              {t.payment && (
                <>
                  <dt>Transaction</dt>
                  <dd className="mono"><a href={explorerTxUrl(t.payment.tx_signature)} target="_blank" rel="noreferrer">{t.payment.tx_signature}</a></dd>
                  <dt>From → to</dt>
                  <dd><AddrLink addr={t.payment.from_wallet} label={t.payment.from_wallet} /> → <AddrLink addr={t.payment.to_wallet} label={t.payment.to_wallet} /></dd>
                  <dt>Memo</dt>
                  <dd className="mono">{t.payment.memo ?? "—"}</dd>
                </>
              )}
              {t.delivery && (
                <>
                  <dt>Delivery body</dt>
                  <dd><div className="code">{t.delivery.body || "(empty)"}</div></dd>
                  <dt>Delivery checks</dt>
                  <dd className="mono">{JSON.stringify(t.delivery.checks)}</dd>
                </>
              )}
              {live.summary && live.summary !== aiSummary && (
                <>
                  <dt>Stored summary</dt>
                  <dd>{live.summary}</dd>
                </>
              )}
              {t.exception && (
                <>
                  <dt>Exception</dt>
                  <dd className="mono">{t.exception.type} · {t.exception.severity} · {t.exception.status}</dd>
                  {t.exception.summary && (
                    <>
                      <dt>Exception note</dt>
                      <dd>{t.exception.summary}</dd>
                    </>
                  )}
                </>
              )}
            </dl>
          </details>
        </div>
      </aside>
    </>
  );
}
