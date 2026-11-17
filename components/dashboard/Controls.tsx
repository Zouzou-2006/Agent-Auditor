"use client";
// Controls (owner: Aidan): the agent's wallet at a glance, the spending rules with their exact deny
// reasons (SPEC.md section 5), and the approved sellers.

import { useMemo } from "react";
import { computeOverview, formatUsd, outgoing, type DashboardData, type Rules } from "@/lib/dashboard/model";
import { networkLabel, SELLER_NOTE } from "@/lib/dashboard/words";
import { AddrLink, SellerStatusBadge } from "./ui";

interface Props {
  data: DashboardData;
  rules: Rules;
  gatewayWallet: string | null;
  balance: number | null;
  now: number;
}

export default function Controls({ data, rules, gatewayWallet, balance, now }: Props) {
  const o = useMemo(() => computeOverview(data, rules, gatewayWallet, new Date(now)), [data, rules, gatewayWallet, now]);
  const out = useMemo(() => outgoing(data.payments, gatewayWallet), [data.payments, gatewayWallet]);

  // [number, rule, deny reasons (exact strings, shown in quotes) or null for the review rule, raw tooltip]
  const ruleRows: [string, string, string[] | null, string?][] = [
    ["1", "Seller is in the approved list", ["seller not approved", "seller blocked"]],
    ["2", `Max amount at most ${formatUsd(rules.max_per_purchase)} per purchase`, ["over per-purchase limit"]],
    ["3", `Today's spend plus this order at most ${formatUsd(rules.max_per_day)}`, ["over daily limit"]],
    ["4", "Seller's price at or under the order's max", ["quote over max"]],
    ["5", "Seller's wallet is the one on file", ["quote wallet doesn't match seller"]],
    ["6", `Paid in ${rules.asset} on ${networkLabel(rules.network)}`, ["wrong asset or network"], `${rules.asset} on ${rules.network}`],
    ["7", `Over ${formatUsd(rules.human_review_over)} waits for a person to approve`, null, "pending_review"],
  ];

  return (
    <>
      <section className="card" aria-labelledby="agent-h">
        <div className="card-head">
          <h2 id="agent-h">Buyer agent</h2>
          <span className="hint">One agent, one wallet. Only the gateway holds the key.</span>
          <span className="right dim">
            Wallet {gatewayWallet ? <AddrLink addr={gatewayWallet} /> : <span className="muted" title="GATEWAY_WALLET_ADDRESS is not set">not set</span>}
          </span>
        </div>
        <div className="tiles">
          <div className="tile">
            <div className="tile-label">USDC balance</div>
            <div className="tile-value num">{balance === null ? "—" : formatUsd(balance)}</div>
            <div className="tile-foot">In the agent&apos;s wallet</div>
          </div>
          <div className="tile">
            <div className="tile-label">Spent today</div>
            <div className="tile-value num">{formatUsd(o.spentToday)}</div>
            <div className="tile-foot">
              of {formatUsd(rules.max_per_day)} ({o.dailyUsedPct}%)
            </div>
          </div>
          <div className="tile">
            <div className="tile-label">Payments out</div>
            <div className="tile-value num">{out.length}</div>
            <div className="tile-foot">{o.unmatchedPayments > 0 ? <span className="crit-text">{o.unmatchedPayments} with no order</span> : "all matched to orders"}</div>
          </div>
          <div className="tile">
            <div className="tile-label">Orders</div>
            <div className="tile-value num">{o.totalOrders}</div>
            <div className="tile-foot">
              {o.ordersByStatus.booked} booked · {o.blockedBeforePayment} blocked
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-2 controls-grid">
        <section className="card" aria-labelledby="rules-h">
          <div className="card-head">
            <h2 id="rules-h">Spending rules</h2>
            <span className="hint" title="config/rules.json">Hard yes/no checks, run before anything is paid</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th>Rule</th>
                  <th>If it fails</th>
                </tr>
              </thead>
              <tbody>
                {ruleRows.map(([n, rule, reasons, raw]) => (
                  <tr key={n} title={raw}>
                    <td className="muted num">{n}</td>
                    <td>{rule}</td>
                    <td>
                      {reasons ? (
                        <span className="reason">{reasons.map((r) => `“${r}”`).join(" or ")}</span>
                      ) : (
                        <span className="dim">Waits for approval, not denied</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card" aria-labelledby="sellers-h">
          <div className="card-head">
            <h2 id="sellers-h">Sellers</h2>
            <span className="hint">Anything not listed is denied by default</span>
          </div>
          <div className="table-wrap">
            <table className="sellers-table">
              <thead>
                <tr>
                  <th>Seller</th>
                  <th>Wallet</th>
                  <th className="right">Orders</th>
                  <th className="right">Paid</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.sellers.map((s) => (
                  <tr key={s.seller_id}>
                    <td className="seller-cell" title={s.seller_id}>
                      {s.name}
                      {SELLER_NOTE[s.seller_id] && <div className="cell-sub">{SELLER_NOTE[s.seller_id]}</div>}
                    </td>
                    <td><AddrLink addr={s.wallet} /></td>
                    <td className="right num">{data.orders.filter((x) => x.seller_id === s.seller_id).length}</td>
                    <td className="right num">{formatUsd(out.filter((p) => p.to_wallet === s.wallet).reduce((sum, p) => sum + p.amount, 0))}</td>
                    <td><SellerStatusBadge status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
