import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const reset = readFileSync("supabase/reset_demo.sql", "utf8");
const seed = readFileSync("supabase/seed_sellers.sql", "utf8");

const sellers = (sql: string) =>
  [...sql.matchAll(/\('(\w+)',\s*'([^']+)',\s*'([^']+)',\s*'(\w+)',\s*'(\w+)'\)/g)].map(([, id, name, url, wallet, status]) => ({ id, name, url, wallet, status }));

describe("supabase/reset_demo.sql", () => {
  it("runs as one transaction", () => {
    expect(reset).toMatch(/^begin;$/m);
    expect(reset).toMatch(/^commit;$/m);
    expect(reset.indexOf("begin;")).toBeLessThan(reset.indexOf("delete from"));
    expect(reset.lastIndexOf("delete from")).toBeLessThan(reset.indexOf("commit;"));
  });

  it("deletes children before orders, so no foreign key blocks it", () => {
    const order = [...reset.matchAll(/^delete from public\.(\w+);$/gm)].map((m) => m[1]);
    expect(order).toEqual(["journal_entries", "exceptions", "deliveries", "payments", "orders"]);
    expect(reset).not.toMatch(/delete from public\.sellers/);
  });

  it("restores the same sellers and wallets as seed_sellers.sql, approved, on the production host", () => {
    const r = sellers(reset);
    const s = sellers(seed);
    expect(r.map((x) => [x.id, x.name, x.wallet])).toEqual(s.map((x) => [x.id, x.name, x.wallet]));
    for (const x of r) {
      expect(x.status).toBe("approved");
      expect(x.url).toBe(`https://agentauditor-kappa.vercel.app/api/sellers/${x.id}`);
    }
  });
});
