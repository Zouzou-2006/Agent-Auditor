"use client";
// The "needs you" drawer (owner: Aidan): a 400px panel from the right with every pending review and
// open exception. Buttons call the same handlers as everywhere else (confirm dialog, then the existing
// routes). A no_order exception has no order to book and no seller to block, so it only links to the
// transaction on chain.

import { useEffect, useRef } from "react";
import type { ExceptionRow, OrderRow } from "@/lib/db-types";
import { explorerTxUrl } from "@/lib/dashboard/model";
import type { AttentionItem } from "@/lib/dashboard/overview";
import { dollars, EXCEPTION_TITLE, friendlyStatus, timeShort } from "@/lib/dashboard/words";
import { AddrLink, fullTime, Icon, SeverityBadge } from "./ui";

interface Props {
  items: AttentionItem[];
  /** Highlight and scroll to this item (from an Overview "Review" button), or null. */
  focusKey?: string | null;
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

export default function AttentionDrawer({ items, focusKey = null, now, inFlight, errors, suspended, onClose, onApprove, onException, onOpenOrder }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    // Opened from a "Review" button: bring that item into view and put focus on it.
    const target = focusKey ? listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`) : null;
    if (target) {
      target.scrollIntoView({ block: "center" });
      target.focus();
    } else {
      closeRef.current?.focus();
    }
  }, [focusKey]);

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
            <ul className="attn-list" ref={listRef}>
              {items.map((item) => {
                const busy = inFlight.has(item.key);
                const critical = item.kind === "exception" && item.exception.severity === "critical";
                return (
                  <li key={item.key} data-key={item.key} tabIndex={-1} className={`attn-item${critical ? " crit" : ""}${item.key === focusKey ? " focused" : ""}`}>
                    <div className="attn-top">
                      <span className={`attn-ico ${critical ? "crit" : "warn"}`}>
                        <Icon name={item.kind === "pending" ? "pause" : "exceptions"} />
                      </span>
                      <div className="attn-main">
                        <div className="attn-title" title={item.kind === "pending" ? item.order.status : item.exception.type}>
                          {item.kind === "pending" ? friendlyStatus(item.order.status) : EXCEPTION_TITLE[item.exception.type]}
                          {item.amount !== null && <span className="num attn-amount">{dollars(item.amount)}</span>}
                        </div>
                        <div className="attn-text" title={item.note ?? undefined}>{item.text}</div>
                        <div className="attn-meta">
                          {item.kind === "exception" && <SeverityBadge severity={item.exception.severity} />}
                          <time dateTime={item.at} title={fullTime(item.at)}>{timeShort(item.at, now)}</time>
                          {item.kind === "exception" && item.exception.type === "no_order" && item.toWallet && (
                            <span>
                              sent to <AddrLink addr={item.toWallet} />
                            </span>
                          )}
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
