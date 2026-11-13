"use client";

import { useMemo, useState } from "react";
import type { ExceptionRow, OrderRow } from "@/lib/db-types";
import {
  computeOverview,
  dailySpend,
  formatUsd,
  ORDER_STATUSES,
  shortId,
  type DashboardData,
  type DayBucket,
  type Rules,
} from "@/lib/dashboard/model";
import { Empty, Icon, ORDER_TONE_VAR, SeverityBadge, StatusBadge, timeAgo } from "./ui";

interface Props {
  data: DashboardData;
  rules: Rules;
  gatewayWallet: string | null;
  now: number;
  loading: boolean;
  onOpenOrder: (order: OrderRow) => void;
  onApprove: (order: OrderRow) => void;
  onException: (exc: ExceptionRow, action: "approve" | "block_seller") => void;
  onNavigate: (section: string) => void;
}

export default function Overview({ data, rules, gatewayWallet, now, loading, onOpenOrder, onApprove, onException, onNavigate }: Props) {
  const nowDate = useMemo(() => new Date(now), [now]);
  const o = useMemo(() => computeOverview(data, rules, gatewayWallet, nowDate), [data, rules, gatewayWallet, nowDate]);
  const spend = useMemo(() => dailySpend(data.payments, gatewayWallet, nowDate, 14), [data.payments, gatewayWallet, nowDate]);
  const pending = data.orders.filter((x) => x.status === "pending_review");
  const open = data.exceptions.filter((x) => x.status === "open");
  const meterClass = o.dailyUsedPct >= 90 ? "crit" : o.dailyUsedPct >= 70 ? "warn" : "";
  const dash = (v: string | number) => (loading ? "…" : v);

  return (
    <>
      <div className="grid grid-kpi">
        <div className="card kpi">
          <div className="kpi-label">Spent today (on-chain)</div>
          <div className="kpi-value">{dash(formatUsd(o.spentToday))}</div>
          <div className={`meter ${meterClass}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={o.dailyUsedPct} aria-label="Daily limit used">
            <span style={{ width: `${o.dailyUsedPct}%` }} />
          </div>
          <div className="kpi-foot">
            {o.dailyUsedPct}% of the {formatUsd(o.dailyLimit)} daily limit
          </div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Orders</div>
          <div className="kpi-value">{dash(o.totalOrders)}</div>
          <div className="kpi-foot">
            {o.ordersByStatus.booked} booked · {formatUsd(o.bookedAmount)} expensed
          </div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">
            <Icon name="shield" className="" />
            Blocked before payment
          </div>
          <div className="kpi-value">{dash(o.blockedBeforePayment)}</div>
          <div className="kpi-foot">Denied by the rules or the quote check. No money moved.</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Open exceptions</div>
          <div className="kpi-value" style={{ color: o.openBySeverity.critical ? "var(--critical-text)" : undefined }}>
            {dash(o.openExceptions)}
          </div>
          <div className="kpi-foot">
            {o.openBySeverity.critical} critical · {o.openBySeverity.high} high · {o.openBySeverity.medium} medium
            {o.unmatchedPayments > 0 && <> · {o.unmatchedPayments} unmatched payment{o.unmatchedPayments > 1 ? "s" : ""}</>}
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <section className="card" aria-labelledby="spend-h">
          <div className="card-head">
            <h2 id="spend-h">USDC paid out per day</h2>
            <span className="hint">Last 14 days, UTC, from QuickNode Streams</span>
          </div>
          <div className="card-body">
            <SpendChart buckets={spend} />
          </div>
        </section>

        <section className="card" aria-labelledby="outcome-h">
          <div className="card-head">
            <h2 id="outcome-h">Order outcomes</h2>
            <span className="hint">{o.totalOrders} total</span>
          </div>
          <div className="card-body">
            {o.totalOrders === 0 ? (
              <Empty title="No orders yet">Orders appear here as the agent files them.</Empty>
            ) : (
              <>
                <div className="stackbar" role="img" aria-label="Orders by status">
                  {ORDER_STATUSES.filter((s) => o.ordersByStatus[s] > 0).map((s) => (
                    <span key={s} title={`${s}: ${o.ordersByStatus[s]}`} style={{ width: `${(o.ordersByStatus[s] / o.totalOrders) * 100}%`, background: ORDER_TONE_VAR[s] }} />
                  ))}
                </div>
                <div className="legend">
                  {ORDER_STATUSES.map((s) => (
                    <button
                      key={s}
                      className="legend-item"
                      style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left" }}
                      onClick={() => onNavigate(`orders:${s}`)}
                    >
                      <span className="dot" style={{ background: ORDER_TONE_VAR[s] }} />
                      {s}
                      <b>{o.ordersByStatus[s]}</b>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      <div className="grid grid-2">
        <section className="card" aria-labelledby="feed-h">
          <div className="card-head">
            <h2 id="feed-h">Live activity</h2>
            <span className="hint">Orders, payments, deliveries and exceptions as they land</span>
          </div>
          <ActivityFeed data={data} now={now} onOpenOrder={onOpenOrder} />
        </section>

        <section className="card" aria-labelledby="attn-h">
          <div className="card-head">
            <h2 id="attn-h">Needs a human</h2>
            <span className="hint">{pending.length + open.length} waiting</span>
          </div>
          {pending.length + open.length === 0 ? (
            <Empty title="Nothing waiting">Orders over {formatUsd(rules.human_review_over)} and exceptions show up here.</Empty>
          ) : (
            <ul className="feed">
              {open.slice(0, 5).map((e) => (
                <li key={e.exception_id}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <div className="what" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <SeverityBadge severity={e.severity} />
                      <span className="mono">{e.type}</span>
                    </div>
                    <div className="cell-sub">{e.summary ?? (e.order_id ? `Order ${shortId(e.order_id)}` : "Payment with no order")}</div>
                  </div>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                    {e.type === "no_order" ? (
                      <span className="cell-sub">Investigate</span>
                    ) : (
                      <>
                        <button className="btn btn-sm" onClick={() => onException(e, "approve")}>Approve</button>
                        <button className="btn btn-sm btn-danger" onClick={() => onException(e, "block_seller")}>Block seller</button>
                      </>
                    )}
                  </div>
                </li>
              ))}
              {pending.slice(0, 5).map((p) => (
                <li key={p.order_id}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <div className="what" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <StatusBadge status={p.status} />
                      <span>
                        {p.seller_id} · {formatUsd(p.max_amount)}
                      </span>
                    </div>
                    <div className="cell-sub">{p.purpose}</div>
                  </div>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => onOpenOrder(p)}>Details</button>
                    <button className="btn btn-sm btn-primary" onClick={() => onApprove(p)}>Approve</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function SpendChart({ buckets }: { buckets: DayBucket[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 180;
  const pad = { l: 44, r: 8, t: 10, b: 24 };
  const max = Math.max(...buckets.map((b) => b.amount), 100000);
  // Round the axis max up to a "nice" base-unit step (0.10, 0.25, 0.50, 1, 2.5, 5 ...).
  const steps = [100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000, 25000000, 50000000];
  const top = steps.find((s) => s >= max) ?? max;
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const slot = plotW / buckets.length;
  const barW = Math.max(4, slot - 6);
  const y = (v: number) => pad.t + plotH - (v / top) * plotH;
  const total = buckets.reduce((s, b) => s + b.amount, 0);
  const h = hover !== null ? buckets[hover] : null;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`USDC paid out per day, ${formatUsd(total)} over ${buckets.length} days`} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(top * f)} y2={y(top * f)} stroke="var(--grid)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(top * f) + 4} textAnchor="end" fontSize={10.5} fill="var(--muted)">
              {formatUsd(Math.round(top * f))}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const x = pad.l + i * slot + (slot - barW) / 2;
          const bh = b.amount > 0 ? Math.max(2, plotH - (y(b.amount) - pad.t)) : 0;
          const r = Math.min(4, barW / 2, bh);
          const yTop = pad.t + plotH - bh;
          return (
            <g key={b.day}>
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={plotH} fill={hover === i ? "rgba(255,255,255,.03)" : "transparent"} onMouseEnter={() => setHover(i)} />
              {bh > 0 && (
                <path
                  d={`M${x},${yTop + bh} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${yTop + bh} Z`}
                  fill="var(--series-1)"
                  opacity={hover === null || hover === i ? 1 : 0.55}
                  pointerEvents="none"
                />
              )}
              {(i === 0 || i === buckets.length - 1 || i % 3 === 0) && (
                <text x={pad.l + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize={10.5} fill="var(--muted)">
                  {b.day.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {h && hover !== null && (
        <div className="tip" style={{ left: `${((pad.l + hover * slot + slot / 2) / W) * 100}%`, top: `${(y(h.amount) / H) * 100}%` }}>
          <div className="muted">{h.day}</div>
          <b className="num">{formatUsd(h.amount)}</b> · {h.count} payment{h.count === 1 ? "" : "s"}
        </div>
      )}
      {total === 0 && <div className="cell-sub" style={{ marginTop: 6 }}>No outgoing payments in this window yet.</div>}
    </div>
  );
}

interface FeedItem {
  at: string;
  key: string;
  icon: string;
  text: React.ReactNode;
  order?: OrderRow;
}

function ActivityFeed({ data, now, onOpenOrder }: { data: DashboardData; now: number; onOpenOrder: (o: OrderRow) => void }) {
  const items = useMemo(() => {
    const byId = new Map(data.orders.map((o) => [o.order_id, o]));
    const list: FeedItem[] = [];
    for (const o of data.orders) {
      list.push({
        at: o.created_at,
        key: `o-${o.order_id}`,
        icon: o.status === "denied" ? "ban" : "orders",
        order: o,
        text: (
          <>
            Order to <b>{o.seller_id}</b> for {formatUsd(o.max_amount)} · <StatusBadge status={o.status} />
            {o.deny_reason && <span className="reason"> {o.deny_reason}</span>}
          </>
        ),
      });
    }
    for (const p of data.payments) {
      list.push({
        at: p.block_time,
        key: `p-${p.tx_signature}`,
        icon: "chain",
        order: p.order_id ? byId.get(p.order_id) : undefined,
        text: p.order_id ? (
          <>
            Payment of {formatUsd(p.amount)} seen on-chain, matched to <span className="mono">{shortId(p.order_id)}</span>
          </>
        ) : (
          <span className="reason crit">Payment of {formatUsd(p.amount)} with no matching order</span>
        ),
      });
    }
    for (const d of data.deliveries) {
      list.push({
        at: d.received_at,
        key: `d-${d.order_id}`,
        icon: d.passed ? "check" : "x",
        order: byId.get(d.order_id),
        text: <>Delivery {d.passed ? "passed all checks" : <span className="reason">failed a check</span>} for <span className="mono">{shortId(d.order_id)}</span></>,
      });
    }
    for (const e of data.exceptions) {
      list.push({
        at: e.created_at,
        key: `e-${e.exception_id}`,
        icon: "exceptions",
        order: e.order_id ? byId.get(e.order_id) : undefined,
        text: (
          <>
            Exception <span className="mono">{e.type}</span> · <SeverityBadge severity={e.severity} />
          </>
        ),
      });
    }
    return list.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  }, [data]);

  if (items.length === 0) return <Empty title="Quiet so far">Activity streams in here live.</Empty>;
  return (
    <ul className="feed">
      {items.map((it) => (
        <li key={it.key} className={it.order ? "clickable" : undefined} style={{ cursor: it.order ? "pointer" : undefined }} onClick={() => it.order && onOpenOrder(it.order)}>
          <span className="ico">
            <Icon name={it.icon} />
          </span>
          <span className="what">{it.text}</span>
          <span className="when" title={it.at}>
            {timeAgo(it.at, now)}
          </span>
        </li>
      ))}
    </ul>
  );
}
