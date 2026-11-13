"use client";
// Small shared pieces for the dashboard: icons, badges, links, dialog. No data fetching here.

import { useEffect, useRef, type ReactNode } from "react";
import type { ExceptionSeverity, ExceptionStatus, OrderStatus, SellerStatus } from "@/lib/db-types";
import { shortId } from "@/lib/dashboard/model";

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
};

export function Icon({ name, className }: { name: keyof typeof paths | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {paths[name]}
    </svg>
  );
}

const ORDER_TONE: Record<OrderStatus, string> = {
  booked: "good",
  paid: "info",
  paying: "warning",
  pending_review: "review",
  denied: "serious",
  exception: "critical",
};
const SEVERITY_TONE: Record<ExceptionSeverity, string> = { critical: "critical", high: "serious", medium: "warning" };
const EXC_STATUS_TONE: Record<ExceptionStatus, string> = { open: "warning", approved: "good", seller_blocked: "critical" };

export const ORDER_TONE_VAR: Record<OrderStatus, string> = {
  booked: "var(--good)",
  paid: "var(--info)",
  paying: "var(--warning)",
  pending_review: "var(--review)",
  denied: "var(--serious)",
  exception: "var(--critical)",
};

function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className="badge">
      <span className={`dot dot-${tone}`} />
      {children}
    </span>
  );
}

export const StatusBadge = ({ status }: { status: OrderStatus }) => <Badge tone={ORDER_TONE[status]}>{status}</Badge>;
export const SeverityBadge = ({ severity }: { severity: ExceptionSeverity }) => <Badge tone={SEVERITY_TONE[severity]}>{severity}</Badge>;
export const ExceptionStatusBadge = ({ status }: { status: ExceptionStatus }) => <Badge tone={EXC_STATUS_TONE[status]}>{status}</Badge>;
export const SellerStatusBadge = ({ status }: { status: SellerStatus }) => (
  <Badge tone={status === "approved" ? "good" : "critical"}>{status}</Badge>
);

const EXPLORER = "https://explorer.solana.com";

export function TxLink({ sig }: { sig: string | null }) {
  if (!sig) return <span className="muted">—</span>;
  return (
    <a className="mono" href={`${EXPLORER}/tx/${sig}?cluster=devnet`} target="_blank" rel="noreferrer" title={sig} onClick={(e) => e.stopPropagation()}>
      {shortId(sig, 6)}
    </a>
  );
}

export function AddrLink({ addr, label }: { addr: string | null; label?: string }) {
  if (!addr) return <span className="muted">—</span>;
  return (
    <a className="mono" href={`${EXPLORER}/address/${addr}?cluster=devnet`} target="_blank" rel="noreferrer" title={addr} onClick={(e) => e.stopPropagation()}>
      {label ?? shortId(addr, 4)}
    </a>
  );
}

export function timeAgo(iso: string | null, now: number): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fullTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" }) : "—";
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
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
