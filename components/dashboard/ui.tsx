"use client";
// Small shared pieces for the dashboard: icons, badges, links, dialog. No data fetching here.

import { useEffect, useRef, type ReactNode } from "react";
import type { ExceptionSeverity, ExceptionStatus, OrderStatus, SellerStatus } from "@/lib/db-types";
import { explorerAddressUrl, explorerTxUrl, shortId } from "@/lib/dashboard/model";
import { EXCEPTION_STATUS_LABEL, friendlyStatus, timeShort } from "@/lib/dashboard/words";

const paths: Record<string, ReactNode> = {
  overview: <path d="M3 13h4v8H3zM10 9h4v12h-4zM17 4h4v17h-4z" />,
  orders: <path d="M4 5h16M4 12h16M4 19h10" />,
  exceptions: <path d="M12 3 2 20h20L12 3zm0 6v5m0 3v.5" />,
  ledger: <path d="M5 3h11l3 3v15H5zM9 9h6M9 13h6M9 17h4" />,
  controls: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4" />,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
  search: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="M5 12.5 10 17 19 7" />,
  x: <path d="M7 7l10 10M17 7 7 17" />,
  clock: <path d="M12 6v6l4 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />,
  minus: <path d="M6 12h12" />,
  send: <path d="M4 12 20 4l-6 16-3-7-7-1z" />,
  chain: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  shield: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" />,
  ban: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8" />,
  book: <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM19 19v2H6" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />,
  lock: <path d="M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />,
  command: <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  bolt: <path d="M13 3 5 14h6l-1 7 8-11h-6z" />,
  user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" />,
  wallet: <path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1zM4 7l11-3v3M16 13h1" />,
  layers: <path d="M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5" />,
  pause: <path d="M9 6v12M15 6v12" />,
  hourglass: <path d="M7 3h10M7 21h10M8 3v3l4 6-4 6v3M16 3v3l-4 6 4 6v3" />,
};

export function Icon({ name, className }: { name: keyof typeof paths | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {paths[name]}
    </svg>
  );
}

// Color discipline: red only for critical, amber only for "waiting for a human", green only for
// completed or verified, everything else neutral gray. The accent color is for interactive things.
const ORDER_TONE: Record<OrderStatus, string> = {
  booked: "good",
  paid: "neutral",
  paying: "neutral",
  pending_review: "warning",
  denied: "neutral",
  exception: "warning",
};
const SEVERITY_TONE: Record<ExceptionSeverity, string> = { critical: "critical", high: "warning", medium: "warning" };
const EXC_STATUS_TONE: Record<ExceptionStatus, string> = { open: "warning", approved: "good", seller_blocked: "neutral" };

export const ORDER_TONE_VAR: Record<OrderStatus, string> = {
  booked: "var(--good)",
  paid: "var(--muted)",
  paying: "var(--muted)",
  pending_review: "var(--warning)",
  denied: "var(--muted)",
  exception: "var(--warning)",
};

function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className={`badge tone-${tone}`}>
      <span className="dot" />
      {children}
    </span>
  );
}

/** Raw status code: used only in the order drawer, where the exact state matters. */
export const StatusBadge = ({ status }: { status: OrderStatus }) => <Badge tone={ORDER_TONE[status]}>{status}</Badge>;
/** Plain-language status ("Completed", "Waiting for approval", …): the label everywhere else. */
export const FriendlyStatusBadge = ({ status }: { status: OrderStatus }) => <Badge tone={ORDER_TONE[status]}>{friendlyStatus(status)}</Badge>;
export const SeverityBadge = ({ severity }: { severity: ExceptionSeverity }) => <Badge tone={SEVERITY_TONE[severity]}>{severity}</Badge>;
export const ExceptionStatusBadge = ({ status }: { status: ExceptionStatus }) => <Badge tone={EXC_STATUS_TONE[status]}>{EXCEPTION_STATUS_LABEL[status]}</Badge>;
export const SellerStatusBadge = ({ status }: { status: SellerStatus }) => (
  <Badge tone={status === "approved" ? "good" : "neutral"}>{status}</Badge>
);

export function TxLink({ sig }: { sig: string | null }) {
  if (!sig) return <span className="muted">—</span>;
  return (
    <a className="mono" href={explorerTxUrl(sig)} target="_blank" rel="noreferrer" title={sig} onClick={(e) => e.stopPropagation()}>
      {shortId(sig, 6)}
    </a>
  );
}

export function AddrLink({ addr, label }: { addr: string | null; label?: string }) {
  if (!addr) return <span className="muted">—</span>;
  return (
    <a className="mono" href={explorerAddressUrl(addr)} target="_blank" rel="noreferrer" title={addr} onClick={(e) => e.stopPropagation()}>
      {label ?? shortId(addr, 4)}
    </a>
  );
}

/** "just now", "5m ago", "2h ago" (see timeShort in lib/dashboard/words.ts). */
export function timeAgo(iso: string | null, now: number): string {
  return iso ? timeShort(iso, now) : "—";
}

/** Full timestamp in America/New_York, the dashboard's display time zone. */
export function fullTime(iso: string | null): string {
  return iso ? `${new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "medium", timeZone: "America/New_York" })} ET` : "—";
}

export function Empty({ title, children, icon = "layers" }: { title: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="empty">
      <span className="glyph">
        <Icon name={icon} />
      </span>
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  );
}

export function SkeletonRows({ rows = 4, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }, (_, c) => (
            <td key={c}>
              <div className="skeleton" style={{ width: `${50 + ((r * 7 + c * 13) % 40)}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export interface ConfirmRequest {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  run: () => Promise<void>;
}

export function ConfirmDialog({ request, busy, onCancel, onConfirm }: { request: ConfirmRequest; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <>
      <div className="overlay top" onClick={() => !busy && onCancel()} />
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="dialog-body">
          <h2 id="confirm-title">{request.title}</h2>
          <div className="dim">{request.body}</div>
        </div>
        <div className="dialog-foot">
          <button ref={cancelRef} className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={`btn ${request.danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm} disabled={busy}>
            {busy && <Icon name="refresh" className="spin" />}
            {busy ? "Working…" : request.confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
