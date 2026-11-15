"use client";
// Overview (owner: Aidan): what needs a human first, then this week at a glance, today's budget,
// and recent activity in plain English. Reads only the data Dashboard already loaded; every button
// calls the same handlers as before (no new routes, no new writes).

import { useMemo, type KeyboardEvent, type ReactNode } from "react";
import type { ExceptionRow, OrderRow } from "@/lib/db-types";
import { computeOverview, explorerTxUrl, formatUsd, type DashboardData, type Rules } from "@/lib/dashboard/model";
import {
  attentionItems,
  etClock,
  nextUtcMidnight,
  recentActivity,
  weekStats,
  type ActivityKind,
  type ActivityRow,
  type AttentionItem,
} from "@/lib/dashboard/overview";
import { detectScenes, type Scene } from "@/lib/dashboard/scenes";
import { Empty, fullTime, Icon, SeverityBadge, StatusBadge, timeAgo } from "./ui";

interface Props {
  data: DashboardData;
  rules: Rules;
  gatewayWallet: string | null;
  now: number;
  loading: boolean;
  fresh: Set<string>;
  onOpenOrder: (order: OrderRow) => void;
  onApprove: (order: OrderRow) => void;
  onException: (exc: ExceptionRow, action: "approve" | "block_seller") => void;
  onNavigate: (section: string) => void;
  onScene: (scene: Scene) => void;
}

const ACTIVITY_ICON: Record<ActivityKind, string> = {
  paid: "check",
  blocked: "ban",
  exception: "exceptions",
  pending: "pause",
  paying: "clock",
};

export default function Overview({ data, rules, gatewayWallet, now, loading, fresh, onOpenOrder, onApprove, onException, onNavigate, onScene }: Props) {
  // The daily limit is per UTC day (gateway rule); recompute only when the UTC day changes.
  const day = new Date(now).toISOString().slice(0, 10);
  const nowDate = useMemo(() => new Date(`${day}T12:00:00Z`), [day]);
  const today = useMemo(() => computeOverview(data, rules, gatewayWallet, nowDate), [data, rules, gatewayWallet, nowDate]);
  const week = useMemo(() => weekStats(data, gatewayWallet, now), [data, gatewayWallet, now]);
  const attention = useMemo(() => attentionItems(data, rules), [data, rules]);
  const activity = useMemo(() => recentActivity(data, 8), [data]);
  const scenes = useMemo(() => detectScenes(data), [data]);
  const meterClass = today.dailyUsedPct >= 90 ? "crit" : today.dailyUsedPct >= 70 ? "warn" : "";

  return (
    <>
      <section className="card" aria-labelledby="attn-h">
        <div className="card-head">
          <h2 id="attn-h">Needs your attention</h2>
          {!loading && attention.length > 0 && <span className="hint">{attention.length} waiting</span>}
        </div>
        <div className="card-body">
          {loading ? (
            <div className="attn-list">
              <div className="skeleton" style={{ height: 56, borderRadius: 10 }} />
            </div>
          ) : attention.length === 0 ? (
            <AllClear />
          ) : (
            <ul className="attn-list">
              {attention.map((item) => (
                <AttentionRow key={item.key} item={item} now={now} fresh={fresh.has(item.key)} onOpenOrder={onOpenOrder} onApprove={onApprove} onException={onException} />
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="ov-stats">
        <Stat label="This week" loading={loading} value={formatUsd(week.spent)} foot={`${week.purchases} purchase${week.purchases === 1 ? "" : "s"} · since Monday ET`} />
        <Stat label="Rules blocked" loading={loading} value={String(week.blocked)} foot="This week · no money moved" />
        <Stat label="Verified on chain" loading={loading} value={String(week.verified)} foot="Paid orders matched on Solana devnet" />
      </div>

      <div className="card budget" aria-label="Today's budget">
        <span className="budget-label">Today&apos;s budget</span>
        <div className={`meter ${meterClass}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={today.dailyUsedPct} aria-label="Daily limit used">
          <span style={{ width: `${Math.max(today.dailyUsedPct, today.spentToday > 0 ? 2 : 0)}%` }} />
        </div>
        <span className="budget-num num">
          {formatUsd(today.spentToday)} of {formatUsd(today.dailyLimit)} · resets at {etClock(nextUtcMidnight(now))} ET
        </span>
      </div>

      <section className="card" aria-labelledby="activity-h">
        <div className="card-head">
          <h2 id="activity-h">Recent activity</h2>
          <span className="right">
            <button className="linklike" onClick={() => onNavigate("orders")}>All orders</button>
          </span>
        </div>
        {loading ? (
          <div className="card-body">
            <div className="skeleton" style={{ height: 14, width: "70%" }} />
          </div>
        ) : activity.length === 0 ? (
          <Empty title="No activity yet" icon="bolt">
            Run <code className="mono">demo/beat1.ts</code> and the agent&apos;s first purchase shows up here live.
          </Empty>
        ) : (
          <ul className="activity">
            {activity.map((row) => (
              <ActivityLine key={row.key} row={row} now={now} fresh={fresh.has(row.rowKey)} onOpenOrder={onOpenOrder} />
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="scenes-h">
        <div className="card-head">
          <h2 id="scenes-h">Demo scenes</h2>
          <span className="hint">Detected from live data, never mocked. Click a scene to open its evidence.</span>
          <span className="right dim" style={{ fontSize: 12 }}>
            {scenes.filter((s) => s.state === "proven").length} / 4 proven
          </span>
        </div>
        <div className="scenes">
          {scenes.map((s) => (
            <button key={s.id} className={`scene ${s.state}`} disabled={!s.target} onClick={() => onScene(s)}>
              <span className="scene-top">
                <span className="scene-n">{s.n}</span>
                <span className="scene-title">{s.title}</span>
                <span className="scene-state">{s.state === "proven" ? "Proven" : s.state === "in_progress" ? "In progress" : "Not yet"}</span>
              </span>
              <span className="scene-proves">{s.proves}</span>
              <span className="scene-evidence">{s.evidence}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function AllClear() {
  return (
    <div className="allclear">
      <span className="allclear-glyph">
        <Icon name="check" />
      </span>
      <strong>All clear</strong>
      <span>Nothing needs you right now. Your agent is working inside its rules.</span>
    </div>
  );
}

function Stat({ label, value, foot, loading }: { label: string; value: ReactNode; foot: string; loading: boolean }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value num">{loading ? <span className="skeleton" style={{ display: "block", width: 80, height: 24 }} /> : value}</div>
      <div className="stat-foot">{foot}</div>
    </div>
  );
}

function AttentionRow({
  item,
  now,
  fresh,
  onOpenOrder,
  onApprove,
  onException,
}: {
  item: AttentionItem;
  now: number;
  fresh: boolean;
  onOpenOrder: (order: OrderRow) => void;
  onApprove: (order: OrderRow) => void;
  onException: (exc: ExceptionRow, action: "approve" | "block_seller") => void;
}) {
  const critical = item.kind === "exception" && item.exception.severity === "critical";
  return (
    <li className={`attn-item${critical ? " crit" : ""}${fresh ? " fresh" : ""}`}>
      <span className={`attn-ico ${item.kind === "pending" ? "review" : critical ? "crit" : "warn"}`}>
        <Icon name={item.kind === "pending" ? "pause" : "exceptions"} />
      </span>
      <div className="attn-main">
        <div className="attn-text">{item.text}</div>
        <div className="attn-meta">
          {item.kind === "exception" ? <SeverityBadge severity={item.exception.severity} /> : <StatusBadge status="pending_review" />}
          <time dateTime={item.at} title={fullTime(item.at)}>{timeAgo(item.at, now)}</time>
          {item.kind === "pending" && item.note && <span className="attn-note">{item.note}</span>}
        </div>
      </div>
      <div className="attn-actions">
        {item.kind === "pending" ? (
          <>
            <button className="btn btn-sm btn-primary" onClick={() => onApprove(item.order)}>Approve</button>
            <button className="btn btn-sm btn-ghost" onClick={() => onOpenOrder(item.order)}>View details</button>
          </>
        ) : item.exception.type === "no_order" ? (
          // A stolen-key payment has no order to open; its evidence is the transaction itself.
          item.exception.tx_signature ? (
            <a className="btn btn-sm" href={explorerTxUrl(item.exception.tx_signature)} target="_blank" rel="noreferrer">
              View on chain <Icon name="external" />
            </a>
          ) : (
            <button className="btn btn-sm" disabled>View on chain</button>
          )
        ) : (
          <>
            <button className="btn btn-sm" onClick={() => onException(item.exception, "approve")}>Approve</button>
            <button className="btn btn-sm btn-danger" onClick={() => onException(item.exception, "block_seller")}>Block seller</button>
          </>
        )}
      </div>
    </li>
  );
}

function ActivityLine({ row, now, fresh, onOpenOrder }: { row: ActivityRow; now: number; fresh: boolean; onOpenOrder: (order: OrderRow) => void }) {
  const open = () => row.order && onOpenOrder(row.order);
  const onKey = (e: KeyboardEvent<HTMLLIElement>) => {
    if (row.order && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      open();
    }
  };
  const tone = row.kind === "exception" ? (row.critical ? "crit" : "warn") : row.kind;
  const showTx = row.tx && (row.kind === "paid" || (row.kind === "exception" && !row.order));
  return (
    <li
      className={`${row.order ? "clickable" : ""}${fresh ? " fresh" : ""}`}
      onClick={open}
      onKeyDown={onKey}
      tabIndex={row.order ? 0 : undefined}
      role={row.order ? "button" : undefined}
    >
      <span className={`act-ico ${tone}`}>
        <Icon name={ACTIVITY_ICON[row.kind]} />
      </span>
      <span className="act-text">
        {row.text}
        {showTx && row.tx && (
          <a className="act-link" href={explorerTxUrl(row.tx)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            {row.kind === "paid" ? "verified on chain →" : "view on chain →"}
          </a>
        )}
      </span>
      <time className="act-when" dateTime={row.at} title={fullTime(row.at)}>{timeAgo(row.at, now)}</time>
    </li>
  );
}
