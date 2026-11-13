// Beat 2 with the agent, the gateway and the database all faked.
import { describe, expect, it, vi } from "vitest";
import type { AgentRun, Order } from "@/lib/buyer-agent";
import { BEAT2_TASK, BLOCK_PROMPT, lastReply, oneOrderPerRun, runBeat2, type Beat2Deps } from "@/demo/lib/beat2";

const ORDER: Order = {
  seller_id: "cheapdata", item: "price_quote", params: { ticker: "SOL", date: "2026-11-13" },
  max_amount: 100000, purpose: "Daily SOL price",
};

/** An agent run whose single order got `reply` (an object) or a gateway error (a string). */
function runWith(reply: object | string): AgentRun {
  const outcome = typeof reply === "string" ? { content: reply, isError: true } : { content: JSON.stringify(reply), isError: false };
  return { calls: [{ input: ORDER, order: ORDER, outcome }], finalText: "", stopReason: "end_turn" };
}

const EXCEPTION = { order_id: "o1", status: "exception", reason: "nothing_delivered", data: null };
const PAID = { order_id: "o1", status: "paid", reason: "waiting for the webhook", data: null };
const BLOCKED = { order_id: "o2", status: "denied", reason: "seller blocked", data: null };

function deps(runs: AgentRun[], overrides: Partial<Beat2Deps> = {}) {
  const lines: string[] = [];
  const d = {
    runAgent: vi.fn<Beat2Deps["runAgent"]>(async () => runs.shift()!),
    waitForEnter: vi.fn<Beat2Deps["waitForEnter"]>(async () => {}),
    orderStatus: vi.fn<Beat2Deps["orderStatus"]>(async () => "exception"),
    log: (line: string) => lines.push(line),
    sleep: async () => {},
    ...overrides,
  };
  return { d, lines };
}

describe("runBeat2", () => {
  it("passes when the first buy is an exception and the second is denied 'seller blocked'", async () => {
    const { d } = deps([runWith(EXCEPTION), runWith(BLOCKED)]);

    expect(await runBeat2(d)).toBe(true);
    expect(d.runAgent).toHaveBeenNthCalledWith(1, BEAT2_TASK);
    expect(d.runAgent).toHaveBeenNthCalledWith(2, BEAT2_TASK);
    expect(d.waitForEnter).toHaveBeenCalledWith("Click Block Seller on the dashboard, then press Enter.");
    expect(BLOCK_PROMPT).toBe("Click Block Seller on the dashboard, then press Enter.");
  });

  it("pauses for Enter only between the two purchases", async () => {
    const order: string[] = [];
    const { d } = deps([runWith(EXCEPTION), runWith(BLOCKED)], {
      runAgent: vi.fn(async () => {
        order.push("agent");
        return order.length === 1 ? runWith(EXCEPTION) : runWith(BLOCKED);
      }),
      waitForEnter: vi.fn(async () => {
        order.push("enter");
      }),
    });

    await runBeat2(d);

    expect(order).toEqual(["agent", "enter", "agent"]);
  });

  it("a 'paid' reply waits for the order to become an exception", async () => {
    const statuses = ["paid", "paid", "exception"];
    const { d } = deps([runWith(PAID), runWith(BLOCKED)], { orderStatus: vi.fn(async () => statuses.shift()!) });

    expect(await runBeat2(d)).toBe(true);
    expect(d.orderStatus).toHaveBeenCalledTimes(3);
    expect(d.orderStatus).toHaveBeenCalledWith("o1");
  });

  it("a 'paid' order that never settles fails after the timeout", async () => {
    const { d, lines } = deps([runWith(PAID)], { orderStatus: vi.fn(async () => "paid"), timeoutMs: 0 });

    expect(await runBeat2(d)).toBe(false);
    expect(d.waitForEnter).not.toHaveBeenCalled();
    expect(lines.at(-1)).toContain("expected an exception");
  });

  it.each([
    ["booked (CheapData delivered after all)", runWith({ order_id: "o1", status: "booked", reason: "", data: {} })],
    ["denied before payment", runWith({ order_id: "o1", status: "denied", reason: "seller blocked", data: null })],
    ["a gateway error", runWith("Gateway error HTTP 500: {\"error\":\"internal error\"}")],
    ["no order filed", { calls: [], finalText: "I can't do that.", stopReason: "end_turn" } as AgentRun],
  ])("fails without pausing when the first purchase is %s", async (_label, run) => {
    const { d } = deps([run]);

    expect(await runBeat2(d)).toBe(false);
    expect(d.waitForEnter).not.toHaveBeenCalled();
    expect(d.runAgent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["exception again (seller wasn't blocked)", runWith(EXCEPTION)],
    ["denied for another reason", runWith({ order_id: "o2", status: "denied", reason: "over daily limit", data: null })],
    ["a gateway error", runWith("Gateway unreachable at http://localhost:3000/api/orders: fetch failed")],
  ])("fails when the second purchase is %s", async (_label, run) => {
    const { d, lines } = deps([runWith(EXCEPTION), run]);

    expect(await runBeat2(d)).toBe(false);
    expect(lines.at(-1)).toMatch(/^FAIL/);
  });
});

describe("helpers", () => {
  it("lastReply reads the gateway's JSON reply, or explains why there isn't one", () => {
    expect(lastReply(runWith(EXCEPTION))).toEqual({ reply: EXCEPTION });
    expect(lastReply(runWith("down"))).toEqual({ error: "down" });
    expect(lastReply({ calls: [], finalText: "", stopReason: "end_turn" })).toEqual({ error: "the agent didn't file an order" });
  });

  it("oneOrderPerRun sends the first order and refuses any second one", async () => {
    const post = vi.fn(async () => ({ content: JSON.stringify(EXCEPTION), isError: false }));
    const fileOrder = oneOrderPerRun(post);

    expect(await fileOrder(ORDER)).toEqual({ content: JSON.stringify(EXCEPTION), isError: false });
    expect(await fileOrder(ORDER)).toMatchObject({ isError: true });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
