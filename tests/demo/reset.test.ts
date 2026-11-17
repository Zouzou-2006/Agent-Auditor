// The demo reset's pure pieces: which database it may touch, delete order, money formatting.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  balanceWarnings,
  formatUnits,
  MIN_SOL_LAMPORTS,
  MIN_USDC,
  RESET_TABLES,
  SPEC_COLUMNS,
  targetProblems,
} from "@/demo/lib/reset";

const URL_A = "https://abcdefghijklmnopqrst.supabase.co";
const URL_B = "https://zyxwvutsrqponmlkjihg.supabase.co";
const file = { NEXT_PUBLIC_SUPABASE_URL: URL_A, SUPABASE_SERVICE_ROLE_KEY: "key-a" };

describe("targetProblems", () => {
  it("allows the .env.local project when nothing overrides it", () => {
    expect(targetProblems(file, { ...file })).toEqual([]);
  });

  it("refuses when the shell points at another project", () => {
    expect(targetProblems(file, { ...file, NEXT_PUBLIC_SUPABASE_URL: URL_B }).join()).toMatch(/overridden by your shell/);
  });

  it("refuses when the shell supplies a different key, and never echoes the key", () => {
    const problems = targetProblems(file, { ...file, SUPABASE_SERVICE_ROLE_KEY: "key-b" }).join();
    expect(problems).toMatch(/SUPABASE_SERVICE_ROLE_KEY is overridden/);
    expect(problems).not.toMatch(/key-[ab]/);
  });

  it("refuses when .env.local has no project, a non-Supabase url, or no key", () => {
    expect(targetProblems({}, file)).toHaveLength(1);
    expect(targetProblems({ ...file, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" }, { ...file, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" })).toHaveLength(1);
    expect(targetProblems({ NEXT_PUBLIC_SUPABASE_URL: URL_A }, { NEXT_PUBLIC_SUPABASE_URL: URL_A }).join()).toMatch(/not set in .env.local/);
  });
});

describe("RESET_TABLES", () => {
  it("deletes children before orders, the same order as supabase/reset_demo.sql, and never sellers", () => {
    const sqlOrder = [...readFileSync("supabase/reset_demo.sql", "utf8").matchAll(/^delete from public\.(\w+);$/gm)].map((m) => m[1]);
    expect(RESET_TABLES.map((t) => t.table)).toEqual(sqlOrder);
    expect(RESET_TABLES.map((t) => t.table)).not.toContain("sellers");
  });

  it("filters each delete on a column SPEC.md names for that table", () => {
    for (const { table, key } of RESET_TABLES) expect(SPEC_COLUMNS[table]).toContain(key);
  });
});

describe("formatUnits", () => {
  it("formats integer base units without floats", () => {
    expect(formatUnits(2_000_000n, 6)).toBe("2.000000");
    expect(formatUnits(100_000n, 6)).toBe("0.100000");
    expect(formatUnits(0n, 9)).toBe("0.000000000");
    expect(formatUnits(1_234_567_891n, 9)).toBe("1.234567891");
  });
});

describe("balanceWarnings", () => {
  it("is quiet at exactly the minimums", () => {
    expect(balanceWarnings(MIN_USDC, MIN_SOL_LAMPORTS)).toEqual([]);
  });

  it("warns for USDC under 2.00 and SOL under the fee floor", () => {
    expect(balanceWarnings(MIN_USDC - 1n, MIN_SOL_LAMPORTS).join()).toMatch(/USDC is 1\.999999/);
    expect(balanceWarnings(MIN_USDC, MIN_SOL_LAMPORTS - 1n).join()).toMatch(/too low for fees/);
    expect(balanceWarnings(0n, 0n)).toHaveLength(2);
  });
});
