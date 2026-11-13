"use client";
// The floating copilot panel. Streams answers from POST /api/assistant, which is read-only: its tools
// can look things up but never pay, approve or block. Suggestions follow the page and the open order;
// order ids in answers are clickable and open the audit-trail drawer. History lives in sessionStorage.

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import type { OrderRow } from "@/lib/db-types";
import { Icon } from "./ui";

interface Msg {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
  links?: string[];
  error?: string;
}

export interface CopilotContext {
  section: string;
  order: OrderRow | null;
}

interface Props {
  context: CopilotContext;
  orders: OrderRow[];
  /** A question to ask as soon as the panel opens (from the command palette). */
  seed?: string;
  onClose: () => void;
  onOpenOrder: (orderId: string) => void;
}

const STORE = "agent-auditor-copilot";

function suggestionsFor(ctx: CopilotContext): string[] {
  if (ctx.order) {
    const id = ctx.order.order_id.slice(0, 8);
    return [
      `Walk me through order ${id}'s audit trail.`,
      ctx.order.status === "denied" ? `Why was order ${id} denied, and was that the right call?` : `Has order ${id} been paid and delivered correctly?`,
      `Has this seller had other problems?`,
    ];
  }
  switch (ctx.section) {
    case "exceptions":
      return ["Which open exception is most urgent, and why?", "Is there any sign of a stolen key?", "What happens if I click Block Seller?"];
    case "ledger":
      return ["Summarize what has been booked so far.", "Are there payments with no matching order?", "Show me recent payment activity."];
    case "controls":
      return ["Are we close to the daily spending limit?", "Which sellers is the agent spending the most with?", "Explain the finance rules in plain English."];
    case "orders":
      return ["Why were orders denied today?", "Which orders are stuck and need attention?", "Is the agent buying the same thing repeatedly?"];
    default:
      return [
        "Give me a summary of today's agent activity.",
        "Identify any unusual payment behavior.",
        "Are we approaching our spending limits?",
        "Summarize the current system health.",
      ];
  }
}

function load(): Msg[] {
  try {
    const raw = sessionStorage.getItem(STORE);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Msg[]) : [];
  } catch {
    return [];
  }
}

function save(msgs: Msg[]) {
  try {
    sessionStorage.setItem(STORE, JSON.stringify(msgs.slice(-40)));
  } catch {
    /* storage unavailable: history just won't persist */
  }
}

export default function Copilot({ context, orders, seed, onClose, onOpenOrder }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const suggestions = suggestionsFor(context);

  // Resolve an 8-character id prefix to a real order, so only real ids become links.
  const resolve = (prefix: string): string | null => {
    const hits = orders.filter((o) => o.order_id.startsWith(prefix.toLowerCase()));
    return hits.length === 1 ? hits[0].order_id : null;
  };

  // Once per mount: restore history (sessionStorage only exists after mount) and ask the seed question.
  const started = useRef(false);
  const onMount = useEffectEvent(() => {
    if (started.current) return;
    started.current = true;
    const stored = load();
    setMsgs(stored);
    if (seed?.trim()) void ask(seed, stored);
  });
  useEffect(() => onMount(), []);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      abortRef.current?.abort();
    };
  }, [onClose]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [msgs]);

  async function ask(question: string, base: Msg[] = msgs) {
    const q = question.trim();
    if (!q || busy) return;
    const history: Msg[] = [...base, { role: "user", content: q }];
    setMsgs([...history, { role: "assistant", content: "", tools: [], links: [] }]);
    setInput("");
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const update = (fn: (m: Msg) => Msg) =>
      setMsgs((prev) => {
        const next = [...prev];
        next[next.length - 1] = fn(next[next.length - 1]);
        return next;
      });

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history.filter((m) => m.content.trim()).map((m) => ({ role: m.role, content: m.content })),
          context: { section: context.section, ...(context.order ? { order_id: context.order.order_id } : {}) },
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as { t: string; v?: string; a?: string };
          if (ev.t === "text" && ev.v) update((m) => ({ ...m, content: m.content + ev.v }));
          else if (ev.t === "tool" && ev.v) {
            const link = ev.a ? resolve(ev.a.slice(0, 8)) : null;
            update((m) => ({ ...m, tools: [...(m.tools ?? []), ev.v as string], links: link && !m.links?.includes(link) ? [...(m.links ?? []), link] : m.links }));
          } else if (ev.t === "error" && ev.v) update((m) => ({ ...m, error: ev.v }));
        }
      }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      update((m) => ({ ...m, error: aborted ? "Stopped." : err instanceof Error ? err.message : "Request failed" }));
    } finally {
      setBusy(false);
      abortRef.current = null;
      setMsgs((prev) => {
        save(prev);
        return prev;
      });
    }
  }

  const clear = () => {
    setMsgs([]);
    save([]);
  };

  const ctxLabel = context.order ? `order ${context.order.order_id.slice(0, 8)}` : context.section;

  return (
    <aside className="copilot" role="dialog" aria-label="Copilot">
      <div className="copilot-head">
        <span className="orb"><Icon name="spark" /></span>
        <div style={{ minWidth: 0 }}>
          <div className="title">Audit copilot</div>
          <div className="subtitle">Answers from live tables · Claude</div>
        </div>
        <span className="ro" title="The copilot can look things up but can't pay, approve or block"><Icon name="lock" />read-only</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          {msgs.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={clear} disabled={busy}>Clear</button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close copilot"><Icon name="close" /></button>
        </span>
      </div>
      <div className="copilot-ctx">
        <Icon name="layers" className="" />
        Looking at <b>{ctxLabel}</b>
      </div>

      <div className="copilot-log" ref={logRef} aria-live="polite">
        {msgs.length === 0 && (
          <>
            <div className="copilot-hello">
              <h3>What do you want to check?</h3>
              <p>I read every order, payment, delivery and exception as it lands, and explain why each decision was made. I can’t move money or change anything; I’ll point you to the right button instead.</p>
            </div>
            <div className="suggest">
              {suggestions.map((s) => (
                <button key={s} onClick={() => void ask(s)}>
                  <Icon name="arrow" />
                  {s}
                </button>
              ))}
            </div>
          </>
        )}
        {msgs.map((m, i) => {
          const last = i === msgs.length - 1;
          return (
            <div key={i} className={`msg ${m.role}`}>
              {m.role === "assistant" && m.tools && m.tools.length > 0 && (
                <div className="tools-used" aria-label="Data looked up">
                  {m.tools.map((t, j) => <span key={j}>{t}</span>)}
                </div>
              )}
              <div className={`bubble${busy && last && m.role === "assistant" && m.content ? " caret" : ""}`}>
                {m.role === "user" ? (
                  m.content
                ) : m.content ? (
                  <Markdown text={m.content} resolve={resolve} onOpen={onOpenOrder} />
                ) : busy && last && !m.error ? (
                  <span className="typing" aria-label="Thinking"><i /><i /><i /></span>
                ) : null}
              </div>
              {m.links && m.links.length > 0 && !busy && (
                <div className="msg-actions">
                  {m.links.map((id) => (
                    <button key={id} className="btn btn-sm" onClick={() => onOpenOrder(id)}>
                      <Icon name="arrow" />Open trail {id.slice(0, 8)}
                    </button>
                  ))}
                </div>
              )}
              {m.error && (
                <div className="msg-error">
                  {m.error}
                  {last && !busy && m.error !== "Stopped." && (
                    <button className="btn btn-sm btn-ghost" onClick={() => { const q = msgs[i - 1]?.content; if (q) void ask(q, msgs.slice(0, i - 1)); }}>Retry</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {msgs.length > 0 && !busy && (
        <div className="chips" aria-label="Suggested follow-ups">
          {suggestions.slice(0, 3).map((s) => (
            <button key={s} onClick={() => void ask(s)}>{s}</button>
          ))}
        </div>
      )}
      <form className="copilot-input" onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
        <label className="sr-only" htmlFor="copilot-q">Ask the copilot</label>
        <textarea
          id="copilot-q"
          ref={inputRef}
          rows={1}
          placeholder={context.order ? "Ask about this order…" : "Ask about orders, payments, limits…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(input);
            }
          }}
        />
        {busy ? (
          <button type="button" className="btn" onClick={() => abortRef.current?.abort()} aria-label="Stop"><Icon name="x" /></button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={!input.trim()} aria-label="Send"><Icon name="send" /></button>
        )}
      </form>
      <div className="copilot-foot">Read-only. Approve and Block Seller stay with you.</div>
    </aside>
  );
}

type Resolve = (prefix: string) => string | null;

/** Minimal, safe Markdown: paragraphs, headings, lists, tables, **bold**, `code`, order-id links. No HTML. */
function Markdown({ text, resolve, onOpen }: { text: string; resolve: Resolve; onOpen: (id: string) => void }) {
  const fmt = (s: string) => inline(s, resolve, onOpen);
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split("|").map((c) => c.trim()));
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div className="table-wrap" key={out.length}>
          <table>
            {head && <thead><tr>{head.map((c, j) => <th key={j}>{fmt(c)}</th>)}</tr></thead>}
            <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{fmt(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i++;
      }
      const List = ordered ? "ol" : "ul";
      out.push(<List key={out.length}>{items.map((it, j) => <li key={j}>{fmt(it)}</li>)}</List>);
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) { out.push(<h4 key={out.length}>{fmt(heading[1])}</h4>); i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(\||[-*]\s|\d+\.\s|#)/.test(lines[i])) { para.push(lines[i]); i++; }
    if (para.length === 0) { para.push(line); i++; }
    out.push(<p key={out.length}>{fmt(para.join(" "))}</p>);
  }
  return <>{out}</>;
}

function inline(s: string, resolve: Resolve, onOpen: (id: string) => void): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`|\b[0-9a-f]{8}\b)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{inline(part.slice(2, -2), resolve, onOpen)}</strong>;
    const code = part.startsWith("`") && part.endsWith("`") && part.length > 2 ? part.slice(1, -1) : null;
    const candidate = code ?? part;
    if (/^[0-9a-f]{8}$/.test(candidate)) {
      const id = resolve(candidate);
      if (id) return <button key={i} className="order-chip" onClick={() => onOpen(id)} title="Open the audit trail">{candidate}</button>;
    }
    if (code !== null) return <code key={i}>{code}</code>;
    return part;
  });
}
