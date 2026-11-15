"use client";
// The "needs you" drawer (owner: Aidan): a 400px panel from the right with every pending review and
// open exception. Buttons call the same handlers as everywhere else (confirm dialog, then the existing
// routes). A no_order exception has no order to book and no seller to block, so it only links to the
// transaction on chain.

import { useEffect, useRef } from "react";
import type { ExceptionRow, OrderRow } from "@/lib/db-types";
import { explorerTxUrl } from "@/lib/dashboard/model";
import type { AttentionItem } from "@/lib/dashboard/overview";
import { dollars, EXCEPTION_TITLE, timeShort } from "@/lib/dashboard/words";
import { fullTime, Icon, SeverityBadge } from "./ui";

interface Props {
  items: AttentionItem[];
  now: number;
  /** Keys (order_id / exception_id) whose request is in flight. */
  inFlight: Set<string>;
  /** Server error text per key, from the last failed request. */
  errors: Record<string, string>;
  /** True while a dialog sits on top, so Escape belongs to it. */
  suspended: boolean;
  onClose: () => void;
  onApprove: (order: OrderRow) => void;
  onException: (exc: ExceptionRow, action: "approve" | "block_seller") => void;
  onOpenOrder: (order: OrderRow) => void;
}

export default function AttentionDrawer({ items, now, inFlight, errors, suspended, onClose, onApprove, onException, onOpenOrder }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !suspended) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, suspended]);

  return (
    <>
      <div className="overlay soft" onClick={onClose} />
      <aside className="drawer attn-drawer" role="dialog" aria-modal="true" aria-labelledby="attn-drawer-title">
        <div className="drawer-head">
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <h2 id="attn-drawer-title" style={{ margin: 0, fontSize: 15 }}>
              Needs you
            </h2>
            <span className="cell-sub">{items.length === 0 ? "Nothing waiting" : `${items.length} waiting for a decision`}</span>
          </div>
          <button ref={closeRef} className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="drawer-body">
          {items.length === 0 ? (
            <div className="allclear">
              <span className="allclear-glyph">
                <Icon name="check" />
              </span>
              <strong>All clear</strong>
              <span>Nothing needs you right now.</span>
            </div>
          ) : (
            <ul className="attn-list">
              {items.map((item) => {
                const busy = inFlight.has(item.key);
                const critical = item.kind === "exception" && item.exception.severity === "critical";
                return (
                  <li key={item.key} className={`attn-item${critical ? " crit" : ""}`}>
                    <div className="attn-top">
                      <span className={`attn-ico ${critical ? "crit" : "warn"}`}>
                        <Icon name={item.kind === "pending" ? "pause" : "exceptions"} />
                      </span>
                      <div className="attn-main">
                        <div className="attn-title">
                          {item.kind === "pending" ? "Waiting for approval" : EXCEPTION_TITLE[item.exception.type]}
                          {item.amount !== null && <span className="num attn-amount">{dollars(item.amount)}</span>}
                        </div>
                        <div className="attn-text">{item.text}</div>
                        <div className="attn-meta">
                          {item.kind === "exception" && <SeverityBadge severity={item.exception.severity} />}
                          <time dateTime={item.at} title={fullTime(item.at)}>{timeShort(item.at, now)}</time>
                        </div>
                      </div>
                    </div>

                    {errors[item.key] && (
                      <div className="attn-error" role="alert">
                        {errors[item.key]}
                      </div>
                    )}

                    <div className="attn-actions">
                      {item.kind === "pending" ? (
                        <>
                          <button className="btn btn-sm btn-ghost" onClick={() => onOpenOrder(item.order)}>View details</button>
                          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => onApprove(item.order)}>
                            {busy ? "Approving…" : "Approve"}
                          </button>
                        </>
                      ) : item.exception.type === "no_order" ? (
                        item.exception.tx_signature ? (
                          <a className="btn btn-sm" href={explorerTxUrl(item.exception.tx_signature)} target="_blank" rel="noreferrer">
                            View on chain <Icon name="external" />
                          </a>
                        ) : (
                          <button className="btn btn-sm" disabled>View on chain</button>
                        )
                      ) : (
                        <>
                          <button className="btn btn-sm" disabled={busy} onClick={() => onException(item.exception, "approve")}>Approve</button>
                          <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => onException(item.exception, "block_seller")}>
                            Block seller
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
