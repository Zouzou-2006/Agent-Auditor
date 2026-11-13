"use client";
// The copilot side panel. Streams answers from POST /api/assistant (read-only: it can look things
// up but has no tool that pays, approves or blocks). History lives in sessionStorage for this tab.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./ui";

interface Msg {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
  error?: string;
}

const STORE = "agent-auditor-copilot";
const SUGGESTIONS = [
  "Give me a summary of today's agent activity.",
  "Which sellers is the agent spending the most with?",
  "Identify any unusual payment behavior.",
  "Why was the most recent denied order blocked?",
  "Are we close to the daily spending limit?",
  "Summarize the current system health.",
];

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

export default function Copilot({ onClose }: { onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Read sessionStorage after mount: it doesn't exist during server rendering.
    setMsgs(load());
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

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs([...history, { role: "assistant", content: "", tools: [] }]);
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
          const ev = JSON.parse(line) as { t: string; v?: string };
          if (ev.t === "text" && ev.v) update((m) => ({ ...m, content: m.content + ev.v }));
          else if (ev.t === "tool" && ev.v) update((m) => ({ ...m, tools: [...(m.tools ?? []), ev.v as string] }));
          else if (ev.t === "error" && ev.v) update((m) => ({ ...m, error: ev.v }));
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

  return (
    <aside className="copilot" aria-label="Copilot">
      <div className="copilot-head">
        <Icon name="spark" />
        <span className="title">Copilot</span>
        <span className="ro">read-only</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {msgs.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={clear} disabled={busy}>
              Clear
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close copilot">
            <Icon name="close" />
          </button>
        </span>
      </div>

      <div className="copilot-log" ref={logRef} aria-live="polite">
        {msgs.length === 0 && (
          <>
            <div className="dim">
              Ask about orders, payments, exceptions and limits. Answers come from the live tables. The copilot can explain but never pays, approves or blocks: those stay with you.
            </div>
            <div className="suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === "assistant" && m.tools && m.tools.length > 0 && (
              <div className="tools-used" aria-label="Data looked up">
                {m.tools.map((t, j) => (
                  <span key={j}>{t}</span>
                ))}
              </div>
            )}
            <div className="bubble">
              {m.role === "user" ? m.content : m.content ? <Markdown text={m.content} /> : busy && i === msgs.length - 1 && !m.error ? <span className="typing" aria-label="Thinking"><i /><i /><i /></span> : null}
            </div>
            {m.error && <div className="msg-error">{m.error}</div>}
          </div>
        ))}
      </div>

      <form
        className="copilot-input"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <label className="sr-only" htmlFor="copilot-q">Ask the copilot</label>
        <textarea
          id="copilot-q"
          ref={inputRef}
          rows={1}
          placeholder="Ask about today's activity…"
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
          <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={!input.trim()} aria-label="Send">
            <Icon name="send" />
          </button>
        )}
      </form>
    </aside>
  );
}

/** Minimal, safe Markdown: paragraphs, headings, bullet/numbered lists, tables, **bold**, `code`. No HTML. */
function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
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
            {head && (
              <thead>
                <tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr>
              </thead>
            )}
            <tbody>
              {body.map((r, k) => (
                <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>
              ))}
            </tbody>
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
      out.push(<List key={out.length}>{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</List>);
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      out.push(<h4 key={out.length}>{inline(heading[1])}</h4>);
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(\||[-*]\s|\d+\.\s|#)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    if (para.length === 0) {
      para.push(line);
      i++;
    }
    out.push(<p key={out.length}>{inline(para.join(" "))}</p>);
  }
  return <>{out}</>;
}

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}
