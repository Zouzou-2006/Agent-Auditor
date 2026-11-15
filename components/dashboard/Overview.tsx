"use client";
// Overview (owner: Aidan). Leads with what the auditor did this week, then today's spend, the week's
// numbers, and recent purchases: one row each, with a result stamp and the Order ↔ Payment ↔ Delivery
// match. What needs a human lives in the "needs you" drawer. Reads only the data Dashboard loaded.

import { useMemo, useSyncExternalStore, type KeyboardEvent } from "react";
import type { OrderRow } from "@/lib/db-types";
import { computeOverview, explorerTxUrl, type DashboardData, type Rules } from "@/lib/dashboard/model";
import { etClock, lastDecisionAt, nextUtcMidnight, recentActivity, weekStats, type ActivityRow } from "@/lib/dashboard/overview";
import { detectScenes, type Scene } from "@/lib/dashboard/scenes";
import { auditHeadline, dollars, timeShort } from "@/lib/dashboard/words";
import { Empty, fullTime, MatchChips, Stamp } from "./ui";

interface Props {
  data: DashboardData;
  rules: Rules;
  gatewayWallet: string | null;
  now: number;
  loading: boolean;
  live: "connecting" | "live" | "offline";
  fresh: Set<string>;
  onOpenOrder: (order: OrderRow) => void;
  onNavigate: (section: string) => void;
  onScene: (scene: Scene) => void;
}

const HOUR_MS = 3_600_000;
const noSubscribe = () => () => {};
const demoFlag = () => new URLSearchParams(window.location.search).get("demo") === "1";

export default function Overview({ data, rules, gatewayWallet, now, loading, live, fresh, onOpenOrder, onNavigate, onScene }: Props) {
  // The daily limit is per UTC day (gateway rule); recompute only when the UTC day changes.
  const day = new Date(now).toISOString().slice(0, 10);
  const nowDate = useMemo(() => new Date(`${day}T12:00:00Z`), [day]);
  const today = useMemo(() => computeOverview(data, rules, gatewayWallet, nowDate), [data, rules, gatewayWallet, nowDate]);
  const week = useMemo(() => weekStats(data, gatewayWallet, now), [data, gatewayWallet, now]);
  const activity = useMemo(() => recentActivity(data, 8, now), [data, now]);
  const scenes = useMemo(() => detectScenes(data), [data]);
  const last = useMemo(() => lastDecisionAt(data), [data]);
  const active = last !== null && now - Date.parse(last) < HOUR_MS;
  const meterClass = today.dailyUsedPct >= 90 ? "crit" : today.dailyUsedPct >= 70 ? "warn" : "";
  // The demo checklist is for recording the video: shown only with ?demo=1 (false on the server).
  const showScenes = useSyncExternalStore(noSubscribe, demoFlag, () => false);

  return (
    <div className="ov">
      <section className="card hero" aria-label="This week">
        <div className="hero-status">
          {loading ? (
            <span className="skeleton" style={{ display: "block", width: 420, height: 30 }} />
          ) : (
            <h2 className="hero-title">{auditHeadline(week)}</h2>
          )}
          <p className="hero-lede">Checks every payment your AI agent makes: rules before it pays, the blockchain after, and what it actually received.</p>
          <div className="hero-sub">
            <span>{active ? "Agent active" : "Agent idle"}</span>
            <span aria-hidden="true">·</span>
            <span className={`live ${live === "live" ? "on" : live === "offline" ? "off" : ""}`}>
              <span className="dot" />
              {live === "live" ? "Live" : live === "offline" ? "Reconnecting…" : "Connecting…"}
            </span>
            <span aria-hidden="true">·</span>
            <span>{loading ? "loading…" : last ? <>last decision <time dateTime={last} title={fullTime(last)}>{timeShort(last, now)}</time></> : "no decisions yet"}</span>
          </div>
        </div>
        <div className="hero-spend">
          <div className="hero-spend-label">Spent today</div>
          <div className="hero-spend-value num">
            {loading ? <span className="skeleton" style={{ display: "block", width: 110, height: 40 }} /> : dollars(today.spentToday)}
          </div>
          <div className={`meter ${meterClass}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={today.dailyUsedPct} aria-label="Daily budget used">
            <span style={{ width: `${Math.max(today.dailyUsedPct, today.spentToday > 0 ? 2 : 0)}%` }} />
          </div>
          <div className="hero-spend-cap num">
            of {dollars(today.dailyLimit)} daily budget · resets at {etClock(nextUtcMidnight(now))} ET
          </div>
        </div>
      </section>

      <div className="ov-stats">
        <div className="card stat">
          <div className="stat-label">This week</div>
          <div className="stat-value num">
            {loading ? (
              <span className="skeleton" style={{ display: "block", width: 90, height: 40 }} />
            ) : (
              <>
                {dollars(week.spent)}
                {week.unmatched > 0 && (
                  <span className="stat-aside">
                    {" "}out · <span className="crit-text">{dollars(week.unmatched)} with no order</span>
                  </span>
                )}
              </>
            )}
          </div>
          <div className="stat-foot">
            {week.purchases} purchase{week.purchases === 1 ? "" : "s"}, confirmed on Solana · since Monday ET
          </div>
        </div>
        <div className="card stat">
          <div className="stat-label">Blocked by rules</div>
          <div className="stat-value num">{loading ? <span className="skeleton" style={{ display: "block", width: 50, height: 40 }} /> : week.blocked}</div>
          <div className="stat-foot">This week · no money moved</div>
        </div>
      </div>

      <section className="card" aria-labelledby="activity-h">
        <div className="card-head">
          <h2 id="activity-h">Recent purchases</h2>
          <span className="right">
            <button className="linklike" onClick={() => onNavigate("orders")}>All orders</button>
          </span>
        </div>
        {loading ? (
          <ul className="activity" aria-hidden="true">
            {[70, 55, 62].map((w) => (
              <li key={w}>
                <span className="skeleton" style={{ width: `${w}%` }} />
              </li>
            ))}
          </ul>
        ) : activity.length === 0 ? (
          <Empty title="No activity yet" icon="bolt">
            Run <code className="mono">demo/beat1.ts</code> and the agent&apos;s first purchase shows up here live.
          </Empty>
        ) : (
          <ul className="activity">
            {activity.map((row) => (
              <ActivityLine key={row.key} row={row} now={now} fresh={row.freshKeys.some((k) => fresh.has(k))} onOpenOrder={onOpenOrder} />
            ))}
          </ul>
        )}
      </section>

      {showScenes && (
        <section className="card" aria-labelledby="scenes-h">
          <div className="card-head">
            <h2 id="scenes-h">Demo scenes</h2>
            <span className="hint">Detected from live data, never mocked. Click a scene to open its evidence.</span>
            <span className="right dim">{scenes.filter((s) => s.state === "proven").length} / 4 proven</span>
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
      )}
    </div>
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
  // Booked rows link to their transaction; a payment with no order has only its transaction to show.
  const link = row.tx && row.kind === "completed" ? "verified on chain →" : row.tx && !row.order ? "view on chain →" : null;
  return (
    <li
      className={`${row.order ? "clickable" : ""}${fresh ? " fresh" : ""}${row.critical ? " critical" : ""}`}
      onClick={open}
      onKeyDown={onKey}
      tabIndex={row.order ? 0 : undefined}
      role={row.order ? "button" : undefined}
    >
      <span className="act-text" title={row.note ?? undefined}>
        {row.text}
        {link && row.tx && (
          <a className="act-link" href={explorerTxUrl(row.tx)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            {link}
          </a>
        )}
      </span>
      <span className="act-match">{row.match && <MatchChips match={row.match} />}</span>
      <span className={`act-amount num${row.struck ? " struck" : ""}`} title={row.struck ? "Not spent: blocked before payment" : undefined}>
        {row.amount !== null ? dollars(row.amount) : ""}
      </span>
      <span className="act-stamp">{row.stamp && <Stamp kind={row.stamp} animate={fresh} />}</span>
      <time className="act-when" dateTime={row.at} title={fullTime(row.at)}>{timeShort(row.at, now)}</time>
    </li>
  );
}
