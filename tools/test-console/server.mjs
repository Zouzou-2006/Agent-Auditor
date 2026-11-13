// Local test console for Agent Auditor (owner: Nizar). A dev tool, NOT the dashboard (Aidan owns app/).
// Usage: npm run build && npm start, then: node tools/test-console/server.mjs, and open http://localhost:4000
// Keys stay in this process: the browser only ever sees table rows and API replies.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
process.loadEnvFile(path.join(repo, ".env.local"));
const GATEWAY = process.env.GATEWAY_URL || "http://localhost:3000";
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const GATEWAY_WALLET = process.env.GATEWAY_WALLET_ADDRESS;

const TABLES = {
  sellers: "select=*&order=seller_id",
  orders: "select=*&order=created_at.desc&limit=50",
  payments: "select=tx_signature,block_time,from_wallet,to_wallet,amount,memo,order_id&order=block_time.desc&limit=50",
  deliveries: "select=*&order=received_at.desc&limit=50",
  journal_entries: "select=*&order=entry_date.desc&limit=50",
  exceptions: "select=*&order=created_at.desc&limit=50",
};

const redact = (s) => String(s).replace(/sk-ant-[\w-]+/g, "[key]").replace(/sb_secret_[\w-]+/g, "[key]");

async function table(name) {
  const r = await fetch(`${SB}/rest/v1/${name}?${TABLES[name]}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  return r.ok ? r.json() : { error: `${r.status} ${await r.text()}` };
}

async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json()).result;
}

async function usdcOf(owner) {
  const res = await rpc("getTokenAccountsByOwner", [owner, { mint: MINT }, { encoding: "jsonParsed" }]);
  const acct = res?.value?.[0];
  return acct ? { account: acct.pubkey, amount: Number(acct.account.data.parsed.info.tokenAmount.amount) } : { account: null, amount: null };
}

async function wallets(sellers) {
  const list = [{ label: "Gateway", owner: GATEWAY_WALLET }, ...(Array.isArray(sellers) ? sellers : []).map((s) => ({ label: s.name, owner: s.wallet }))];
  return Promise.all(
    list.map(async (w) => {
      try {
        const [usdc, sol] = await Promise.all([usdcOf(w.owner), rpc("getBalance", [w.owner])]);
        return { ...w, ...usdc, lamports: sol?.value ?? null };
      } catch (e) {
        return { ...w, error: String(e) };
      }
    }),
  );
}

let walletCache = { at: 0, data: [] };

async function state() {
  const names = Object.keys(TABLES);
  const rows = await Promise.all(names.map(table));
  const out = Object.fromEntries(names.map((n, i) => [n, rows[i]]));
  if (Date.now() - walletCache.at > 10000) walletCache = { at: Date.now(), data: await wallets(out.sellers) };
  let gatewayUp = false;
  try {
    gatewayUp = (await fetch(`${GATEWAY}/api/orders`, { signal: AbortSignal.timeout(2000) })).status > 0;
  } catch {}
  return { ...out, wallets: walletCache.data, gatewayUp, gateway: GATEWAY };
}

async function proxy(pathname, body) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${GATEWAY}${pathname}`, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(130000) });
    return { http: r.status, ms: Date.now() - t0, body: await r.text() };
  } catch (e) {
    return { http: 0, ms: Date.now() - t0, body: String(e) };
  }
}

function runAgent(beat) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--import", "./scripts/ts-resolve.mjs", `demo/${beat}.ts`], { cwd: repo, env: process.env });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => p.kill(), 180000);
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output: redact(out.split("\n").filter((l) => !/^\s+at /.test(l)).join("\n")) });
    });
  });
}

const readBody = (req) => new Promise((res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => res(b)); });
const send = (res, code, obj, type = "application/json") => {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(obj) : obj);
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, readFileSync(path.join(here, "index.html")), "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/state") return send(res, 200, await state());
    if (req.method === "POST" && url.pathname === "/order") return send(res, 200, await proxy("/api/orders", await readBody(req)));
    let m;
    if (req.method === "POST" && (m = url.pathname.match(/^\/approve\/([\w-]+)$/))) return send(res, 200, await proxy(`/api/orders/${m[1]}/approve`, "{}"));
    if (req.method === "POST" && (m = url.pathname.match(/^\/exception\/([\w-]+)$/))) return send(res, 200, await proxy(`/api/exceptions/${m[1]}`, await readBody(req)));
    if (req.method === "POST" && (m = url.pathname.match(/^\/agent\/(beat[1-4])$/))) return send(res, 200, await runAgent(m[1]));
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: redact(e) });
  }
}).listen(4000, "127.0.0.1", () => console.log("Agent Auditor test console: http://localhost:4000"));
