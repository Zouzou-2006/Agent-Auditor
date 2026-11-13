"use client";
// The dashboard shell: live data (Supabase realtime + a slow poll fallback), navigation, the order
// drawer, the command palette, the floating copilot, confirmations for human actions, and toasts.
// Reads with the anon key only; every action goes through the existing API routes (SPEC.md section 10).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExceptionRow, OrderRow, OrderStatus } from "@/lib/db-types";
import { getBrowserClient } from "@/lib/db-browser";
import { loadDashboardData } from "@/lib/dashboard/load";
import { EMPTY_DATA, formatUsd, ORDER_STATUSES, shortId, type DashboardData, type OrderFilter, type Rules } from "@/lib/dashboard/model";
import type { Scene } from "@/lib/dashboard/scenes";
import CommandPalette, { type PaletteAction } from "./CommandPalette";
import Controls from "./Controls";
import Copilot from "./Copilot";
import Exceptions from "./Exceptions";
import Ledger from "./Ledger";
import OrderDrawer from "./OrderDrawer";
import Orders from "./Orders";
import Overview from "./Overview";
import { ConfirmDialog, Icon, timeAgo, type ConfirmRequest } from "./ui";

const TABLES = ["sellers", "orders", "payments", "deliveries", "journal_entries", "exceptions"] as const;
const SECTIONS = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "orders", label: "Orders", icon: "orders" },
  { id: "exceptions", label: "Exceptions", icon: "exceptions" },
  { id: "ledger", label: "Ledger", icon: "ledger" },
  { id: "controls", label: "Controls", icon: "controls" },
] as const;
type Section = (typeof SECTIONS)[number]["id"];
type Live = "connecting" | "live" | "offline";
interface Toast {
  id: number;
  text: string;
  error?: boolean;
}

const DEVNET_RPC = "https://api.devnet.solana.com"; // public devnet RPC, read-only balance lookup

function rowKeys(d: DashboardData): Set<string> {
  return new Set([
    ...d.orders.map((o) => `${o.order_id}`),
    ...d.payments.map((p) => p.tx_signature),
    ...d.exceptions.map((e) => e.exception_id),
    ...d.journal_entries.map((j) => j.entry_id),
    ...d.deliveries.map((x) => `${x.order_id}`),
  ]);
}

export default function Dashboard({ rules, gatewayWallet }: { rules: Rules; gatewayWallet: string | null }) {
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<Live>("connecting");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [section, setSection] = useState<Section>("overview");
  const [filter, setFilter] = useState<OrderFilter>({ query: "", status: "all", seller: "all" });
  const [drawer, setDrawer] = useState<OrderRow | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [copilot, setCopilot] = useState<{ open: boolean; seed?: string; key: number }>({ open: false, key: 0 });
  const [unseen, setUnseen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const known = useRef<Set<string> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copilotOpen = useRef(false);
  useEffect(() => {
    copilotOpen.current = copilot.open;
  }, [copilot.open]);

  const toast = useCallback((text: string, isError = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, error: isError }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), isError ? 7000 : 4500);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await loadDashboardData(getBrowserClient());
      const keys = rowKeys(next);
      if (known.current) {
        const added = [...keys].filter((k) => !known.current?.has(k));
        if (added.length) {
          setFresh(new Set(added));
          setTimeout(() => setFresh(new Set()), 2400);
          if (!copilotOpen.current) setUnseen(true);
        }
      }
      known.current = keys;
      setData(next);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load data");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load, realtime subscription, slow poll as a fallback, and a clock for "x ago" labels.
  useEffect(() => {
    void refresh();
    let client: ReturnType<typeof getBrowserClient>;
    try {
      client = getBrowserClient();
    } catch {
      return; // refresh() reports the missing configuration in the error banner
    }
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void refresh(), 300);
    };
    let channel = client.channel("dashboard");
    for (const table of TABLES) channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, schedule);
    channel.subscribe((status) => setLive(status === "SUBSCRIBED" ? "live" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED" ? "offline" : "connecting"));
    const poll = setInterval(() => void refresh(), 15000);
    const clock = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
      if (timer.current) clearTimeout(timer.current);
      void client.removeChannel(channel);
    };
  }, [refresh]);

  // Gateway USDC balance from the public devnet RPC (read-only).
  useEffect(() => {
    if (!gatewayWallet) return;
    let stop = false;
    const fetchBalance = async () => {
      try {
        const res = await fetch(DEVNET_RPC, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [gatewayWallet, { mint: rules.usdc_mint }, { encoding: "jsonParsed" }] }),
        });
        const json = (await res.json()) as { result?: { value?: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] } };
        const amount = json.result?.value?.[0]?.account.data.parsed.info.tokenAmount.amount;
        if (!stop) setBalance(amount && /^\d+$/.test(amount) ? Number(amount) : 0);
      } catch {
        if (!stop) setBalance(null);
      }
    };
    void fetchBalance();
    const id = setInterval(fetchBalance, 30000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [gatewayWallet, rules.usdc_mint]);

  const openCopilot = useCallback((seed?: string) => {
    setUnseen(false);
    setPalette(false);
    setCopilot((c) => ({ open: true, seed, key: seed ? c.key + 1 : c.key }));
  }, []);
  const closeCopilot = useCallback(() => setCopilot((c) => ({ ...c, open: false, seed: undefined })), []);

  // Hash navigation and keyboard shortcuts: Ctrl/⌘+K palette, Ctrl/⌘+/ copilot.
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      if (SECTIONS.some((s) => s.id === h)) setSection(h as Section);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (mod && e.key === "/") {
        e.preventDefault();
        setUnseen(false);
        setCopilot((c) => ({ ...c, open: !c.open, seed: undefined }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("hashchange", fromHash);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const navigate = useCallback((target: string) => {
    const [id, status] = target.split(":");
    if (status && ORDER_STATUSES.includes(status as OrderStatus)) setFilter({ query: "", status: status as OrderStatus, seller: "all" });
    setSection(id as Section);
    history.replaceState(null, "", `#${id}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const openOrderById = useCallback(
    (orderId: string) => {
      const order = data.orders.find((o) => o.order_id === orderId);
      if (order) setDrawer(order);
      else toast("That order isn't loaded any more.", true);
    },
    [data.orders, toast],
  );

  const post = useCallback(async (url: string, body: unknown) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, json };
  }, []);

  const approveOrder = useCallback(
    (order: OrderRow) =>
      setConfirm({
        title: "Approve this order?",
        confirmLabel: `Approve and pay up to ${formatUsd(order.max_amount)}`,
        body: (
          <>
            <p>{order.seller_id} · {order.item} · max {formatUsd(order.max_amount)}</p>
            <p style={{ marginTop: 8 }}>The gateway re-checks the rules, asks the seller for a quote and pays it in USDC on devnet. This can take up to about 20 seconds.</p>
          </>
        ),
        run: async () => {
          const r = await post(`/api/orders/${order.order_id}/approve`, {});
          if (r.ok) toast(`Order ${shortId(order.order_id)}: ${String(r.json.status)}${r.json.reason ? ` · ${String(r.json.reason)}` : ""}`, r.json.status === "denied");
          else toast(`Approve failed (${r.status}): ${String(r.json.error ?? "error")}`, true);
        },
      }),
    [post, toast],
  );

  const exceptionAction = useCallback(
    (exc: ExceptionRow, action: "approve" | "block_seller") =>
      setConfirm({
        title: action === "approve" ? "Approve this exception?" : "Block this seller?",
        danger: action === "block_seller",
        confirmLabel: action === "approve" ? "Approve and book" : "Block seller and book loss",
        body:
          action === "approve" ? (
            <p>Books the purchase as normal: debit Data purchases expense, credit USDC - agent wallet.</p>
          ) : (
            <p>Blocks the seller, so its next order is denied with “seller blocked”, and books the loss: debit Loss on undelivered purchases, credit USDC - agent wallet.</p>
          ),
        run: async () => {
          const r = await post(`/api/exceptions/${exc.exception_id}`, { action });
          if (r.ok) toast(action === "approve" ? "Exception approved and booked" : "Seller blocked and loss booked");
          else toast(`Action failed (${r.status}): ${String(r.json.error ?? "error")}`, true);
        },
      }),
    [post, toast],
  );

  const summarize = useCallback(
    async (order?: OrderRow) => {
      try {
        const r = await post("/api/summaries", order ? { order_id: order.order_id } : {});
        if (!r.ok) toast(`Summaries failed (${r.status}): ${String(r.json.error ?? "error")}`, true);
        else {
          const n = Number(r.json.orders ?? 0) + Number(r.json.exceptions ?? 0);
          toast(n ? `Wrote ${n} AI summar${n === 1 ? "y" : "ies"}` : "Nothing new to summarize");
        }
      } catch {
        toast("Summaries failed: is the server running?", true);
      }
      void refresh();
    },
    [post, refresh, toast],
  );

  const onScene = useCallback(
    (scene: Scene) => {
      if (!scene.target) return;
      if (scene.target.kind === "order") return openOrderById(scene.target.id);
      const target = scene.target;
      const exc = data.exceptions.find((e) => e.exception_id === target.id);
      const order = exc?.order_id ? data.orders.find((o) => o.order_id === exc.order_id) : undefined;
      if (order) setDrawer(order);
      else navigate("exceptions");
    },
    [data.exceptions, data.orders, navigate, openOrderById],
  );

  const runPalette = useCallback(
    (action: PaletteAction) => {
      setPalette(false);
      switch (action.kind) {
        case "section":
          return navigate(action.id);
        case "order":
          return setDrawer(action.order);
        case "exception": {
          const order = action.exception.order_id ? data.orders.find((o) => o.order_id === action.exception.order_id) : undefined;
          return order ? setDrawer(order) : navigate("exceptions");
        }
        case "ask":
          return openCopilot(action.question || undefined);
        case "refresh":
          void refresh();
          return toast("Refreshed");
        case "summaries":
          return void summarize();
      }
    },
    [data.orders, navigate, openCopilot, refresh, summarize, toast],
  );

  const runConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      await confirm.run();
    } catch {
      toast("Request failed: is the server running?", true);
    } finally {
      setConfirmBusy(false);
      setConfirm(null);
      void refresh();
    }
  };

  const openExceptions = useMemo(() => data.exceptions.filter((e) => e.status === "open"), [data.exceptions]);
  const counts: Partial<Record<Section, { n: number; alert?: boolean }>> = useMemo(
    () => ({
      orders: { n: data.orders.filter((o) => o.status === "pending_review").length },
      exceptions: { n: openExceptions.length, alert: openExceptions.some((e) => e.severity === "critical") },
    }),
    [data.orders, openExceptions],
  );
  const title = SECTIONS.find((s) => s.id === section)?.label ?? "Overview";
  const liveState: Live = error && live !== "live" ? "offline" : live;
  const copilotContext = useMemo(() => ({ section, order: drawer }), [section, drawer]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">AA</div>
          <div>
            <div className="brand-name">Agent Auditor</div>
            <div className="brand-sub">Controls for AI spend · devnet</div>
          </div>
        </div>
        <div>
          <div className="nav-label">Monitor</div>
          <nav className="nav" aria-label="Sections">
            {SECTIONS.map((s) => (
              <button key={s.id} aria-current={section === s.id ? "page" : undefined} onClick={() => navigate(s.id)}>
                <Icon name={s.icon} />
                {s.label}
                {counts[s.id] && counts[s.id]!.n > 0 && <span className={`count${counts[s.id]!.alert ? " alert" : ""}`}>{counts[s.id]!.n}</span>}
              </button>
            ))}
          </nav>
        </div>
        <div className="sidebar-foot">
          <span className={`live ${liveState === "live" ? "on" : liveState === "offline" ? "off" : ""}`}>
            <span className="dot" />
            {liveState === "live" ? "Live · realtime" : liveState === "offline" ? "Polling every 15 s" : "Connecting…"}
          </span>
          <span>Updated {updatedAt ? timeAgo(new Date(updatedAt).toISOString(), now) : "—"}</span>
          <span className="kbd-hint">Command menu <kbd>Ctrl K</kbd></span>
          <span className="kbd-hint">Copilot <kbd>Ctrl /</kbd></span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{title}</h1>
          <span className="crumb hide-sm">· Agent Auditor</span>
          <span className="spacer" />
          <button className="palette-trigger" onClick={() => setPalette(true)} aria-label="Open command menu">
            <Icon name="search" />
            <span className="label">Jump to order, exception…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => void refresh()} aria-label="Refresh">
            <Icon name="refresh" />
          </button>
        </header>
        <nav className="mobile-nav" aria-label="Sections">
          {SECTIONS.map((s) => (
            <button key={s.id} aria-current={section === s.id ? "page" : undefined} onClick={() => navigate(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>

        <main className="content">
          {error && (
            <div className="banner" role="alert">
              <span><b>Can’t reach the database.</b> {error}</span>
              <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => void refresh()}>Retry</button>
            </div>
          )}

          {section === "overview" && (
            <Overview data={data} rules={rules} gatewayWallet={gatewayWallet} now={now} loading={loading} fresh={fresh} onOpenOrder={setDrawer} onApprove={approveOrder} onException={exceptionAction} onNavigate={navigate} onScene={onScene} />
          )}
          {section === "orders" && <Orders data={data} now={now} loading={loading} fresh={fresh} filter={filter} onFilter={setFilter} onOpen={setDrawer} onApprove={approveOrder} />}
          {section === "exceptions" && <Exceptions data={data} now={now} loading={loading} fresh={fresh} onOpenOrder={setDrawer} onAction={exceptionAction} />}
          {section === "ledger" && <Ledger data={data} gatewayWallet={gatewayWallet} now={now} loading={loading} fresh={fresh} onOpenOrder={setDrawer} />}
          {section === "controls" && <Controls data={data} rules={rules} gatewayWallet={gatewayWallet} balance={balance} now={now} />}
        </main>
      </div>

      {drawer && (
        <OrderDrawer
          order={drawer}
          data={data}
          onClose={() => setDrawer(null)}
          onApprove={approveOrder}
          onException={exceptionAction}
          onAsk={(o) => openCopilot(`Walk me through order ${o.order_id.slice(0, 8)}'s audit trail.`)}
          onSummarize={summarize}
        />
      )}

      {!copilot.open && (
        <button className="fab" onClick={() => openCopilot()} aria-label={`Open copilot${unseen ? " (new activity)" : ""}`}>
          <span className="orb"><Icon name="spark" /></span>
          <span className="label">Ask copilot</span>
          <kbd>Ctrl /</kbd>
          {unseen && <span className="news" aria-hidden="true" />}
        </button>
      )}
      {copilot.open && (
        <Copilot key={copilot.key} context={copilotContext} orders={data.orders} seed={copilot.seed} onClose={closeCopilot} onOpenOrder={openOrderById} />
      )}

      {palette && <CommandPalette sections={SECTIONS} orders={data.orders} exceptions={data.exceptions} onRun={runPalette} onClose={() => setPalette(false)} />}
      {confirm && <ConfirmDialog request={confirm} busy={confirmBusy} onCancel={() => setConfirm(null)} onConfirm={runConfirm} />}

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.error ? " error" : ""}`}>
            <Icon name={t.error ? "x" : "check"} />
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
