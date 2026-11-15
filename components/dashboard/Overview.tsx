"use client";
// Overview (owner: Aidan). Leads with what the auditor did this week, then today's spend, the week's
// numbers, and recent purchases: one row each, with a result stamp and the Order ↔ Payment ↔ Delivery
// match. What needs a human lives in the "needs you" drawer. Reads only the data Dashboard loaded.

import { useMemo, useSyncExternalStore, type KeyboardEvent } from "react";
import type { OrderRow } from "@/lib/db-types";
import { computeOverview, type DashboardData, type Rules } from "@/lib/dashboard/model";
import { etClock, nextUtcMidnight, recentActivity, weekOutcomes, weekStats, type ActivityRow } from "@/lib/dashboard/overview";
import { detectScenes, type Scene } from "@/lib/dashboard/scenes";
import { bookedNote, dollars, outcomeLabel, problemNote, timeShort } from "@/lib/dashboard/words";
import { Empty, fullTime, MatchChips, Stamp } from "./ui";

interface Props {
  data: DashboardData;
  rules: Rules;
  gatewayWallet: string | null;
  now: number;
  loading: boolean;
  fresh: Set<string>;
  onOpenOrder: (order: OrderRow) => void;
  onNavigate: (section: string) => void;
  onScene: (scene: Scene) => void;
  /** Open the needs-you drawer on this exception (a flagged row's "Review" button). */
  onReview: (key: string) => void;
}

const noSubscribe = () => () => {};
const demoFlag = () => new URLSearchParams(window.location.search).get("demo") === "1";

export default function Overview({ data, rules, gatewayWallet, now, loading, fresh, onOpenOrder, onNavigate, onScene, onReview }: Props) {
  // The daily limit is per UTC day (gateway rule); recompute only when the UTC day changes.
  const day = new Date(now).toISOString().slice(0, 10);
  const nowDate = useMemo(() => new Date(`${day}T12:00:00Z`), [day]);
  const today = useMemo(() => computeOverview(data, rules, gatewayWallet, nowDate), [data, rules, gatewayWallet, nowDate]);
  const week = useMemo(() => weekStats(data, gatewayWallet, now), [data, gatewayWallet, now]);
  const outcomes = useMemo(() => weekOutcomes(data, gatewayWallet, now), [data, gatewayWallet, now]);
  const activity = useMemo(() => recentActivity(data, 8, now), [data, now]);
  const scenes = useMemo(() => detectScenes(data), [data]);
  const meterClass = today.dailyUsedPct >= 90 ? "crit" : today.dailyUsedPct >= 70 ? "warn" : "";
  // The demo checklist is for recording the video: shown only with ?demo=1 (false on the server).
  const showScenes = useSyncExternalStore(noSubscribe, demoFlag, () => false);

  return (
    <div className="ov">
      <section className="card hero" aria-labelledby="hero-h">
        <h2 id="hero-h" className="hero-heading">This week, Agent Auditor…</h2>
        {/* Three separate results, each a way into the page that holds the detail. */}
        <div className="outcomes">
          <Outcome
            tone={outcomes.caught > 0 ? "flagged" : "quiet"}
            value={outcomes.caught}
            label={outcomeLabel("caught", outcomes.caught)}
            note={problemNote(outcomes.topProblem, outcomes.caught)}
            loading={loading}
            onClick={() => onNavigate("exceptions")}
            go="Open exceptions"
          />
          <Outcome
            tone="blocked"
            value={outcomes.blocked}
            label={outcomeLabel("blocked", outcomes.blocked)}
            note="No money moved"
            loading={loading}
            onClick={() => onNavigate("orders:denied")}
            go="Show blocked orders"
          />
          <Outcome
            tone={outcomes.booked > 0 ? "booked" : "quiet"}
            value={outcomes.booked}
            label={outcomeLabel("booked", outcomes.booked)}
            note={bookedNote(outcomes.bookedAmount, outcomes.booked)}
            loading={loading}
            onClick={() => onNavigate("ledger")}
            go="Open the ledger"
          />
        </div>
      </section>

      {/* One slim strip: the week's money out on the left, today's spend against the budget on the right. */}
      <section className="card ov-strip" aria-label="Spending">
        <div className="strip-half" title={`${week.purchases} purchase${week.purchases === 1 ? "" : "s"}, confirmed on Solana · since Monday ET`}>
          <span className="strip-label">This week</span>
          {loading ? (
            <span className="skeleton" style={{ width: 160, height: 28 }} />
          ) : (
            <span className="strip-value num">
              {dollars(week.spent)}
              <span className="strip-aside">
                {" "}out
                {week.unmatched > 0 && (
                  <>
                    {" "}· <span className="crit-text">{dollars(week.unmatched)} with no order</span>
                  </>
                )}
              </span>
            </span>
          )}
        </div>
        <div className="strip-half strip-right" title={`Daily budget resets at ${etClock(nextUtcMidnight(now))} ET`}>
          <span className="strip-label">Today</span>
          {loading ? (
            <span className="skeleton" style={{ width: 140, height: 28 }} />
          ) : (
            <span className="strip-value num">
              {/* Cyan only when something was spent; $0.00 stays plain. */}
              <span className={today.spentToday > 0 ? "spend-value" : undefined}>{dollars(today.spentToday)}</span>
              <span className="strip-aside"> of {dollars(today.dailyLimit)}</span>
            </span>
          )}
          <div className={`meter strip-meter ${meterClass}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={today.dailyUsedPct} aria-label="Daily budget used">
            <span style={{ width: `${Math.max(today.dailyUsedPct, today.spentToday > 0 ? 2 : 0)}%` }} />
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="activity-h">
        <div className="card-head">
          <h2 id="activity-h">Recent activity</h2>
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
              <ActivityLine key={row.key} row={row} now={now} fresh={row.freshKeys.some((k) => fresh.has(k))} onOpenOrder={onOpenOrder} onReview={onReview} />
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

/** One result tile: a big number in the matching stamp color, its label, and a one-line note. */
function Outcome({
  tone,
  value,
  label,
  note,
  loading,
  onClick,
  go,
}: {
  tone: "flagged" | "blocked" | "booked" | "quiet";
  value: number;
  label: string;
  note: string;
  loading: boolean;
  onClick: () => void;
  go: string;
}) {
  return (
    <button className={`outcome outcome-${tone}`} onClick={onClick} title={go}>
      <span className="outcome-value num">{loading ? <span className="skeleton" style={{ display: "block", width: 40, height: 40 }} /> : value}</span>
      <span className="outcome-label">{label}</span>
      <span className="outcome-note">{note}</span>
    </button>
  );
}

function ActivityLine({
  row,
  now,
  fresh,
  onOpenOrder,
  onReview,
}: {
  row: ActivityRow;
  now: number;
  fresh: boolean;
  onOpenOrder: (order: OrderRow) => void;
  onReview: (key: string) => void;
}) {
  const open = () => row.order && onOpenOrder(row.order);
  // A flagged row whose exception is still open is waiting in the needs-you drawer.
  const reviewKey = row.stamp === "flagged" && row.exception?.status === "open" ? row.exception.exception_id : null;
  const onKey = (e: KeyboardEvent<HTMLLIElement>) => {
    if (row.order && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      open();
    }
  };
  return (
    <li
      className={`${row.order ? "clickable" : ""}${fresh ? " fresh" : ""}${row.critical ? " critical" : ""}`}
      onClick={open}
      onKeyDown={onKey}
      tabIndex={row.order ? 0 : undefined}
      role={row.order ? "button" : undefined}
    >
      {/* Up to two lines, so a long sentence wraps instead of losing its end. */}
      <span className="act-text" title={row.note ?? row.text}>
        {row.text}
      </span>
      {/* The Payment chip is the link to the transaction on Solana, when there is one. Fixed slots keep
          the Order, Payment and Delivery chips in columns down the list. */}
      <span className="act-match">
        <MatchChips match={row.match} tx={row.tx} slots />
      </span>
      {/* Every row reserves this slot so amounts stay in a straight column; only open flagged rows fill it,
          and the button shows on hover or keyboard focus. */}
      <span className="act-review">
        {reviewKey && (
          <button
            className="btn btn-sm review-btn"
            onClick={(e) => {
              e.stopPropagation();
              onReview(reviewKey);
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            Review
          </button>
        )}
      </span>
      <span className={`act-amount num${row.struck ? " struck" : ""}`} title={row.struck ? "Not spent: blocked before payment" : undefined}>
        {row.amount !== null ? dollars(row.amount) : ""}
      </span>
      <span className="act-stamp">{row.stamp && <Stamp kind={row.stamp} animate={fresh} />}</span>
      <time className="act-when" dateTime={row.at} title={fullTime(row.at)}>{timeShort(row.at, now)}</time>
    </li>
  );
}
