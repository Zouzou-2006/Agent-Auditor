"use client";
// Ctrl/⌘ + K: jump to any section, order or exception, ask the copilot, or refresh.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ExceptionRow, OrderRow } from "@/lib/db-types";
import { formatUsd, shortId } from "@/lib/dashboard/model";
import { Icon } from "./ui";

export type PaletteAction =
  | { kind: "section"; id: string }
  | { kind: "order"; order: OrderRow }
  | { kind: "exception"; exception: ExceptionRow }
  | { kind: "ask"; question: string }
  | { kind: "refresh" }
  | { kind: "summaries" };

interface Item {
  group: string;
  icon: string;
  label: string;
  sub?: string;
  haystack: string;
  action: PaletteAction;
}

interface Props {
  sections: readonly { id: string; label: string; icon: string }[];
  orders: OrderRow[];
  exceptions: ExceptionRow[];
  onRun: (action: PaletteAction) => void;
  onClose: () => void;
}

export default function CommandPalette({ sections, orders, exceptions, onRun, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all: Item[] = [
      ...sections.map((s) => ({ group: "Go to", icon: s.icon, label: s.label, haystack: s.label.toLowerCase(), action: { kind: "section", id: s.id } as PaletteAction })),
      { group: "Actions", icon: "spark", label: q ? `Ask the copilot: “${query.trim()}”` : "Ask the copilot…", haystack: `ask copilot ai ${q}`, action: { kind: "ask", question: query.trim() } },
      { group: "Actions", icon: "refresh", label: "Refresh data", haystack: "refresh reload", action: { kind: "refresh" } },
      { group: "Actions", icon: "spark", label: "Generate missing AI summaries", haystack: "generate ai summaries summary explain", action: { kind: "summaries" } },
      ...exceptions.map((e) => ({
        group: "Exceptions",
        icon: "exceptions",
        label: `${e.type} · ${e.severity}`,
        sub: e.status,
        haystack: `${e.exception_id} ${e.type} ${e.severity} ${e.status} ${e.summary ?? ""}`.toLowerCase(),
        action: { kind: "exception", exception: e } as PaletteAction,
      })),
      ...orders.map((o) => ({
        group: "Orders",
        icon: "orders",
        label: `${shortId(o.order_id)} · ${o.seller_id} · ${formatUsd(o.max_amount)}`,
        sub: o.deny_reason ?? o.status,
        haystack: `${o.order_id} ${o.seller_id} ${o.item} ${o.status} ${o.deny_reason ?? ""} ${o.purpose}`.toLowerCase(),
        action: { kind: "order", order: o } as PaletteAction,
      })),
    ];
    const words = q.split(/\s+/).filter(Boolean);
    // While typing, real matches come first and "Ask the copilot" moves to the end as the fallback.
    const matched = words.length
      ? [...all.filter((it) => it.action.kind !== "ask" && words.every((w) => it.haystack.includes(w))), ...all.filter((it) => it.action.kind === "ask").map((it) => ({ ...it, group: "Ask" }))]
      : all;
    // Keep the list short and fast: at most 8 orders and 6 exceptions.
    const caps: Record<string, number> = { Orders: 8, Exceptions: 6 };
    const seen: Record<string, number> = {};
    return matched.filter((it) => (seen[it.group] = (seen[it.group] ?? 0) + 1) <= (caps[it.group] ?? 99));
  }, [query, sections, orders, exceptions]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (i: number) => {
    const it = items[i];
    if (it) onRun(it.action);
  };

  let lastGroup = "";
  return (
    <>
      <div className="overlay top" onClick={onClose} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input">
          <Icon name="search" />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search orders, exceptions, sections, or ask the copilot…"
            aria-label="Search"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); run(active); }
              else if (e.key === "Escape") { e.preventDefault(); onClose(); }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {items.length === 0 && <div className="empty" style={{ padding: 24 }}>No matches</div>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? <div className="palette-group" key={`g-${it.group}`}>{it.group}</div> : null;
            lastGroup = it.group;
            return (
              <div key={`${it.group}-${i}`}>
                {header}
                <button className="palette-item" role="option" aria-selected={i === active} onMouseMove={() => setActive(i)} onClick={() => run(i)}>
                  <Icon name={it.icon} />
                  <span className={it.group === "Orders" ? "mono" : undefined}>{it.label}</span>
                  {it.sub && <span className="sub">{it.sub}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd> <kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span style={{ marginLeft: "auto" }}><kbd>Ctrl</kbd> <kbd>/</kbd> copilot</span>
        </div>
      </div>
    </>
  );
}
