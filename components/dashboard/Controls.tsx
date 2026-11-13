"use client";

import { useMemo } from "react";
import { computeOverview, formatUsd, outgoing, type DashboardData, type Rules } from "@/lib/dashboard/model";
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

  const ruleRows: [string, string, string][] = [
    ["1", "Seller is in the approved list", "seller not approved / seller blocked"],
    ["2", `Max amount at most ${formatUsd(rules.max_per_purchase)} per purchase`, "over per-purchase limit"],
    ["3", `Today's spend plus this order at most ${formatUsd(rules.max_per_day)}`, "over daily limit"],
    ["4", "Quote at or under the order's max", "quote over max"],
    ["5", "Quote wallet is the seller's wallet on file", "quote wallet doesn't match seller"],
    ["6", `Paid in ${rules.asset} on ${rules.network}`, "wrong asset or network"],
    ["·", `Over ${formatUsd(rules.human_review_over)} waits for a human Approve`, "pending_review"],
  ];

  return (
    <>
      <section className="card" aria-labelledby="agent-h">
        <div className="card-head">
          <h2 id="agent-h">Buyer agent</h2>
          <span className="hint">One agent, one wallet. Only the gateway holds the key.</span>
        </div>
        <div className="card-body">
          <dl className="kv">
            <dt>Wallet</dt>
            <dd>{gatewayWallet ? <AddrLink addr={gatewayWallet} label={gatewayWallet} /> : <span className="muted">GATEWAY_WALLET_ADDRESS not set</span>}</dd>
            <dt>USDC balance</dt>
            <dd className="num">{balance === null ? "—" : formatUsd(balance)}</dd>
            <dt>Spent today</dt>
            <dd className="num">
              {formatUsd(o.spentToday)} of {formatUsd(rules.max_per_day)} ({o.dailyUsedPct}%)
            </dd>
            <dt>Payments out</dt>
            <dd>
              {out.length} total · {o.unmatchedPayments} with no matching order
            </dd>
            <dt>Orders</dt>
            <dd>
              {o.totalOrders} filed · {o.ordersByStatus.booked} booked · {o.blockedBeforePayment} blocked
            </dd>
          </dl>
        </div>
      </section>

      <div className="grid grid-2">
        <section className="card" aria-labelledby="rules-h">
          <div className="card-head">
            <h2 id="rules-h">Finance rules</h2>
            <span className="hint">config/rules.json · hard yes/no, checked before anything is signed</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Rule</th>
                  <th>Deny reason</th>
                </tr>
              </thead>
              <tbody>
                {ruleRows.map(([n, rule, reason]) => (
                  <tr key={n + rule}>
                    <td className="muted">{n}</td>
                    <td>{rule}</td>
                    <td className="mono dim">{reason}</td>
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
            <table>
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
                    <td>
                      {s.name}
                      <div className="cell-sub mono">{s.seller_id}</div>
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
