import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server Components build; neutralise it for unit tests.
vi.mock("server-only", () => ({}));

const ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  vi.resetModules();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("lib/db (service role, server only)", () => {
  it("throws a clear error when env is missing (and only when called)", async () => {
    const { getServiceClient } = await import("@/lib/db");
    expect(() => getServiceClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("creates one client and reuses it", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
    const { getServiceClient } = await import("@/lib/db");
    expect(getServiceClient()).toBe(getServiceClient());
  });

  it("imports server-only so Next.js refuses to bundle it for the browser", () => {
    expect(readFileSync("lib/db.ts", "utf8")).toMatch(/^import "server-only";$/m);
  });
});

describe("lib/db-browser (anon key)", () => {
  it("throws a clear error when env is missing", async () => {
    const { getBrowserClient } = await import("@/lib/db-browser");
    expect(() => getBrowserClient()).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it("creates a client from the public URL + anon key", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    const { getBrowserClient } = await import("@/lib/db-browser");
    expect(getBrowserClient()).toBe(getBrowserClient());
  });

  it("never references the service-role key", () => {
    expect(readFileSync("lib/db-browser.ts", "utf8")).not.toMatch(/SERVICE_ROLE/);
  });
});

describe("migration enums match SPEC.md section 4 and lib/db-types.ts", () => {
  const sql = readFileSync("supabase/migrations/0001_init.sql", "utf8");
  const checkValues = (column: string) => {
    const match = new RegExp(`${column}\\s+text not null check \\(${column} in \\(([^)]*)\\)\\)`).exec(sql);
    return match ? [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : null;
  };

  it.each([
    ["status", ["approved", "blocked"]], // sellers.status (first match)
    ["severity", ["critical", "high", "medium"]],
    ["type", ["no_order", "wallet_mismatch", "amount_mismatch", "nothing_delivered", "bad_format", "wrong_data"]],
  ])("%s", (column, expected) => {
    expect(checkValues(column)).toEqual(expected);
  });

  it("orders.status and exceptions.status", () => {
    expect(sql).toContain("check (status in ('pending_review', 'denied', 'paid', 'booked', 'exception'))");
    expect(sql).toContain("check (status in ('open', 'approved', 'seller_blocked'))");
  });

  it("all six tables get RLS and realtime", () => {
    const tables = "array['sellers', 'orders', 'payments', 'deliveries', 'journal_entries', 'exceptions']";
    expect(sql.split(tables).length - 1).toBe(2);
  });
});

describe("migration 0002 adds the paying status (SPEC.md 0.18)", () => {
  const sql = readFileSync("supabase/migrations/0002_order_status_paying.sql", "utf8");

  it("replaces orders_status_check with the six statuses", () => {
    expect(sql).toContain("drop constraint if exists orders_status_check");
    expect(sql).toContain(
      "check (status in ('pending_review', 'denied', 'paying', 'paid', 'booked', 'exception'))",
    );
  });
});
