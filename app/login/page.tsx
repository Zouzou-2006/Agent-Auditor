"use client";
// /login: team sign-in for human actions (Approve, Block Seller, summaries). Owner: Nizar.
// Posts the password to /api/auth/login, which sets an HttpOnly cookie; the password never touches
// client storage. Standalone page, deliberately separate from the dashboard (Aidan's) so it doesn't
// change any dashboard file. Styling uses the shared classes in app/globals.css.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 204) {
        setPassword("");
        router.replace("/");
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(res.status === 401 ? "Wrong password." : body.error ?? `Sign-in failed (HTTP ${res.status}).`);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <form className="card" onSubmit={submit} style={{ width: "min(380px, 100%)", padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Agent Auditor · team sign-in</h1>
        <p className="dim" style={{ margin: 0 }}>
          Viewing the dashboard is open. Approving orders, blocking sellers and the copilot need the team password.
        </p>
        <label htmlFor="pw" className="dim" style={{ fontSize: 12 }}>
          Team password
        </label>
        <input id="pw" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        {error && (
          <div role="alert" className="reason crit">
            {error}
          </div>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <Link href="/" className="dim" style={{ fontSize: 12 }}>
          ← Back to the dashboard
        </Link>
      </form>
    </main>
  );
}
