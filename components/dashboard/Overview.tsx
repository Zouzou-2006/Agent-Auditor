"use client";

import { memo, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { ExceptionRow, OrderRow } from "@/lib/db-types";
import {
  computeOverview,
  dailySpend,
  formatUsd,
  ORDER_STATUSES,
  percent,
  shortId,
  type DashboardData,
  type DayBucket,
  type Rules,
} from "@/lib/dashboard/model";
import { detectScenes, type Scene } from "@/lib/dashboard/scenes";
import { Empty, Icon, ORDER_TONE_VAR, SeverityBadge, StatusBadge, timeAgo } from "./ui";

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

const tone = (v: string) => ({ "--kpi-tone": v }) as CSSProperties;

export default function Overview({ data, rules, gatewayWallet, now, loading, fresh, onOpenOrder, onApprove, onException, onNavigate, onScene }: Props) {
  // Day-level dates only change once a day; avoid recomputing on every 5 s clock tick.
  const day = new Date(now).toISOString().slice(0, 10);
  const nowDate = useMemo(() => new Date(`${day}T12:00:00Z`), [day]);
  const o = useMemo(() => computeOverview(data, rules, gatewayWallet, nowDate), [data, rules, gatewayWallet, nowDate]);
  const spend = useMemo(() => dailySpend(data.payments, gatewayWallet, nowDate, 14), [data.payments, gatewayWallet, nowDate]);
  const scenes = useMemo(() => detectScenes(data), [data]);
  const pending = data.orders.filter((x) => x.status === "pending_review");
  const open = data.exceptions.filter((x) => x.status === "open");
  const meterClass = o.dailyUsedPct >= 90 ? "crit" : o.dailyUsedPct >= 70 ? "warn" : "";
  const largestOrder = data.orders.reduce((m, x) => Math.max(m, x.quote_amount ?? 0), 0);
  const v = (x: ReactNode) => (loading ? <span className="skeleton" style={{ display: "block", width: 90, height: 26 }} /> : x);

  return (
    <>
      {!loading && data.orders.length === 0 && (
        <div className="banner welcome">
          <Icon name="bolt" />
          <span>
            <b style={{ color: "var(--text)" }}>Ready.</b> Run <code className="mono">demo/beat1.ts</code> to have the agent make its first purchase. Every decision will appear here live.
          </span>
        </div>
      )}

      <div className="grid grid-kpi">
        <div className="card kpi" style={tone("var(--accent)")}>
          <div className="kpi-label"><Icon name="wallet" />Spent today · on-chain</div>
          <div className="kpi-value">{v(formatUsd(o.spentToday))}</div>
          <div className={`meter ${meterClass}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={o.dailyUsedPct} aria-label="Daily limit used">
            <span style={{ width: `${Math.max(o.dailyUsedPct, o.spentToday > 0 ? 2 : 0)}%` }} />
          </div>
          <div className="kpi-foot">{o.dailyUsedPct}% of the {formatUsd(o.dailyLimit)} daily limit</div>
        </div>
        <div className="card kpi" style={tone("var(--good)")}>
          <div className="kpi-label"><Icon name="book" />Orders</div>
          <div className="kpi-value">{v(<>{o.totalOrders}<small>{o.ordersByStatus.booked} booked</small></>)}</div>
          <div className="kpi-foot">{formatUsd(o.bookedAmount)} expensed to Data purchases</div>
        </div>
        <div className="card kpi" style={tone("var(--serious)")}>
          <div className="kpi-label"><Icon name="shield" />Blocked before payment</div>
          <div className="kpi-value">{v(o.blockedBeforePayment)}</div>
          <div className="kpi-foot">Denied by a rule or the quote check. No money moved.</div>
        </div>
        <div className="card kpi" style={tone(o.openBySeverity.critical ? "var(--critical)" : "var(--warning)")}>
          <div className="kpi-label"><Icon name="exceptions" />Open exceptions</div>
          <div className="kpi-value" style={{ color: o.openBySeverity.critical ? "var(--critical)" : undefined }}>{v(o.openExceptions)}</div>
          <div className="kpi-foot">
            {o.openBySeverity.critical} critical · {o.openBySeverity.high} high · {o.openBySeverity.medium} medium
            {o.unmatchedPayments > 0 && <span className="reason crit"> · {o.unmatchedPayments} unmatched payment{o.unmatchedPayments > 1 ? "s" : ""}</span>}
          </div>
        </div>
      </div>

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

      <div className="grid grid-2">
        <section className="card" aria-labelledby="spend-h">
          <div className="card-head">
            <h2 id="spend-h">USDC paid out</h2>
            <span className="hint">Per UTC day, last 14 days · source: QuickNode Streams</span>
          </div>
          <div className="card-body">
            <SpendChart buckets={spend} />
          </div>
        </section>

        <section className="card" aria-labelledby="outcome-h">
          <div className="card-head">
            <h2 id="outcome-h">Outcomes and limits</h2>
            <span className="hint">{o.totalOrders} orders</span>
          </div>
          <div className="card-body">
            {o.totalOrders === 0 ? (
              <div className="stackbar" />
            ) : (
              <div className="stackbar" role="img" aria-label="Orders by status">
                {ORDER_STATUSES.filter((s) => o.ordersByStatus[s] > 0).map((s) => (
                  <span key={s} title={`${s}: ${o.ordersByStatus[s]}`} style={{ width: `${(o.ordersByStatus[s] / o.totalOrders) * 100}%`, background: ORDER_TONE_VAR[s] }} />
                ))}
              </div>
            )}
            <div className="legend">
              {ORDER_STATUSES.map((s) => (
                <button key={s} className="legend-item" onClick={() => onNavigate(`orders:${s}`)} title={`Show ${s} orders`}>
                  <span className="dot" style={{ background: ORDER_TONE_VAR[s] }} />
                  {s}
                  <b>{o.ordersByStatus[s]}</b>
                </button>
              ))}
            </div>
            <div className="limits">
              <Limit label="Daily limit" used={o.spentToday} cap={rules.max_per_day} note={`${formatUsd(o.spentToday)} of ${formatUsd(rules.max_per_day)}`} />
              <Limit label="Per-purchase limit" used={largestOrder} cap={rules.max_per_purchase} note={`largest quote ${formatUsd(largestOrder)} of ${formatUsd(rules.max_per_purchase)}`} />
              <div className="limit-row">
                <span className="dim">Human review above</span>
                <span className="num">{formatUsd(rules.human_review_over)}</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="grid grid-2">
        <section className="card" aria-labelledby="feed-h">
          <div className="card-head">
            <h2 id="feed-h">Live activity</h2>
            <span className="hint">Orders, payments, deliveries and exceptions as they land</span>
          </div>
          <ActivityFeed data={data} now={now} fresh={fresh} onOpenOrder={onOpenOrder} />
        </section>

        <section className="card" aria-labelledby="attn-h">
          <div className="card-head">
            <h2 id="attn-h">Needs a human</h2>
            <span className="hint">{pending.length + open.length} waiting</span>
          </div>
          {pending.length + open.length === 0 ? (
            <Empty title="Nothing waiting" icon="check">Orders over {formatUsd(rules.human_review_over)} and exceptions land here.</Empty>
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
                      <button className="btn btn-sm btn-ghost" onClick={() => onNavigate("exceptions")}>Investigate</button>
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
                    <div className="what" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <StatusBadge status={p.status} />
                      <span>{p.seller_id} · <b className="num">{formatUsd(p.max_amount)}</b></span>
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

function Limit({ label, used, cap, note }: { label: string; used: number; cap: number; note: string }) {
  const pct = percent(used, cap);
  return (
    <div className="limit-row">
      <span className="dim">{label}</span>
      <span className="num dim">{note}</span>
      <div className={`meter ${pct >= 90 ? "crit" : pct >= 70 ? "warn" : ""}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={{ width: `${Math.max(pct, used > 0 ? 2 : 0)}%` }} />
      </div>
    </div>
  );
}

const SpendChart = memo(function SpendChart({ buckets }: { buckets: DayBucket[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 190;
  const pad = { l: 46, r: 8, t: 12, b: 24 };
  const max = Math.max(...buckets.map((b) => b.amount), 100000);
  const steps = [100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000, 25000000, 50000000];
  const top = steps.find((s) => s >= max) ?? max;
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const slot = plotW / buckets.length;
  const barW = Math.max(4, slot - 8);
  const y = (val: number) => pad.t + plotH - (val / top) * plotH;
  const total = buckets.reduce((s, b) => s + b.amount, 0);
  const h = hover !== null ? buckets[hover] : null;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`USDC paid out per day, ${formatUsd(total)} over ${buckets.length} days`} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="bar" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#67e8f9" />
            <stop offset="1" stopColor="#0891b2" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(top * f)} y2={y(top * f)} stroke="var(--grid)" strokeWidth={1} strokeDasharray={f === 0 ? undefined : "3 4"} />
            <text x={pad.l - 8} y={y(top * f) + 4} textAnchor="end" fontSize={10.5} fill="var(--muted)">{formatUsd(Math.round(top * f))}</text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const x = pad.l + i * slot + (slot - barW) / 2;
          const bh = b.amount > 0 ? Math.max(2, plotH - (y(b.amount) - pad.t)) : 0;
          const r = Math.min(4, barW / 2, bh);
          const yTop = pad.t + plotH - bh;
          return (
            <g key={b.day}>
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={plotH} rx={4} fill={hover === i ? "rgba(34,211,238,.06)" : "transparent"} onMouseEnter={() => setHover(i)} />
              {bh > 0 ? (
                <path d={`M${x},${yTop + bh} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${yTop + bh} Z`} fill="url(#bar)" opacity={hover === null || hover === i ? 1 : 0.5} pointerEvents="none" />
              ) : (
                <rect x={x} y={pad.t + plotH - 1} width={barW} height={1} fill="var(--grid)" pointerEvents="none" />
              )}
              {(i === 0 || i === buckets.length - 1 || i % 3 === 0) && (
                <text x={pad.l + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize={10.5} fill="var(--muted)">{b.day.slice(5)}</text>
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
      {total === 0 && <div className="cell-sub" style={{ marginTop: 6 }}>No payments matched from the chain yet. They appear once the Streams webhook delivers them.</div>}
    </div>
  );
});

interface FeedItem {
  at: string;
  key: string;
  rowKey: string;
  icon: string;
  tone: string;
  text: ReactNode;
  order?: OrderRow;
}

const ActivityFeed = memo(function ActivityFeed({ data, now, fresh, onOpenOrder }: { data: DashboardData; now: number; fresh: Set<string>; onOpenOrder: (o: OrderRow) => void }) {
  const items = useMemo(() => {
    const byId = new Map(data.orders.map((o) => [o.order_id, o]));
    const list: FeedItem[] = [];
    for (const o of data.orders) {
      list.push({
        at: o.created_at,
        key: `o-${o.order_id}`,
        rowKey: o.order_id,
        icon: o.status === "denied" ? "ban" : o.status === "booked" ? "book" : "orders",
        tone: o.status === "denied" ? "warn" : o.status === "booked" ? "good" : o.status === "exception" ? "bad" : "",
        order: o,
        text: (
          <>
            Order to <b>{o.seller_id}</b> for {formatUsd(o.max_amount)} <StatusBadge status={o.status} />
            {o.deny_reason && <span className="reason"> {o.deny_reason}</span>}
          </>
        ),
      });
    }
    for (const p of data.payments) {
      list.push({
        at: p.block_time,
        key: `p-${p.tx_signature}`,
        rowKey: p.tx_signature,
        icon: "chain",
        tone: p.order_id ? "chain" : "bad",
        order: p.order_id ? byId.get(p.order_id) : undefined,
        text: p.order_id ? (
          <>On-chain payment {formatUsd(p.amount)} matched to <span className="mono">{shortId(p.order_id)}</span> by memo</>
        ) : (
          <span className="reason crit">On-chain payment {formatUsd(p.amount)} with no matching order</span>
        ),
      });
    }
    for (const d of data.deliveries) {
      list.push({
        at: d.received_at,
        key: `d-${d.order_id}`,
        rowKey: d.order_id,
        icon: d.passed ? "check" : "x",
        tone: d.passed ? "good" : "bad",
        order: byId.get(d.order_id),
        text: <>Delivery {d.passed ? "passed all three checks" : <span className="reason">failed a check</span>} for <span className="mono">{shortId(d.order_id)}</span></>,
      });
    }
    for (const e of data.exceptions) {
      list.push({
        at: e.created_at,
        key: `e-${e.exception_id}`,
        rowKey: e.exception_id,
        icon: "exceptions",
        tone: "bad",
        order: e.order_id ? byId.get(e.order_id) : undefined,
        text: <>Exception <span className="mono">{e.type}</span> <SeverityBadge severity={e.severity} /></>,
      });
    }
    return list.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  }, [data]);

  if (items.length === 0) return <Empty title="Quiet so far" icon="bolt">Activity streams in here the moment it happens.</Empty>;
  return (
    <ul className="feed">
      {items.map((it) => (
        <li key={it.key} className={`${it.order ? "clickable" : ""}${fresh.has(it.rowKey) ? " fresh" : ""}`} onClick={() => it.order && onOpenOrder(it.order)}>
          <span className={`ico ${it.tone}`}><Icon name={it.icon} /></span>
          <span className="what">{it.text}</span>
          <span className="when" title={it.at}>{timeAgo(it.at, now)}</span>
        </li>
      ))}
    </ul>
  );
});
