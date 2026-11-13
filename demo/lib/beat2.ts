// Beat 2, empty delivery (SPEC.md section 9), as a testable function. Owner: Cooper.
// demo/beat2.ts wires it to the real buyer agent, gateway, terminal and database.

import type { AgentRun, Order, ToolOutcome } from "../../lib/buyer-agent";

export const BEAT2_TASK = "Get today's SOL price from CheapData for the treasury report.";
export const BLOCK_PROMPT = "Click Block Seller on the dashboard, then press Enter.";

/** The POST /api/orders reply (SPEC.md section 10). */
export interface GatewayReply {
  order_id?: string;
  status?: string;
  reason?: string;
  data?: unknown;
}

/** The gateway's reply to the run's last filed order, or why there isn't one. */
export function lastReply(run: AgentRun): { reply: GatewayReply } | { error: string } {
  const call = [...run.calls].reverse().find((c) => c.order !== null);
  if (!call) return { error: "the agent didn't file an order" };
  if (call.outcome.isError) return { error: call.outcome.content };
  try {
    return { reply: JSON.parse(call.outcome.content) as GatewayReply };
  } catch {
    return { error: `gateway reply wasn't JSON: ${call.outcome.content}` };
  }
}

/**
 * Lets an agent run file one order only. A second order in the same run would pay CheapData
 * again, so it's refused before it reaches the gateway.
 */
export function oneOrderPerRun(fileOrder: (order: Order) => Promise<ToolOutcome>) {
  let filed = false;
  return async (order: Order): Promise<ToolOutcome> => {
    if (filed) return { content: "Only one order per run in this demo. Nothing was filed.", isError: true };
    filed = true;
    return fileOrder(order);
  };
}

export interface Beat2Deps {
  /** Runs the buyer agent on a task (a fresh one-order run each time). */
  runAgent(task: string): Promise<AgentRun>;
  waitForEnter(prompt: string): Promise<void>;
  /** orders.status for an order, used when the gateway answers "paid" before booking. */
  orderStatus(order_id: string): Promise<string | null>;
  log(line: string): void;
  sleep?(ms: number): Promise<void>;
  pollMs?: number;
  timeoutMs?: number;
}

/** Waits for a "paid" order to become booked or an exception (the webhook may land late). */
async function settledStatus(order_id: string, deps: Beat2Deps): Promise<string | null> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (deps.timeoutMs ?? 60_000);
  for (;;) {
    const status = await deps.orderStatus(order_id);
    if (status !== "paid" && status !== "paying") return status;
    if (Date.now() >= deadline) return status;
    await sleep(deps.pollMs ?? 2_000);
  }
}

/** Returns true only if the first buy becomes an exception and the second is denied "seller blocked". */
export async function runBeat2(deps: Beat2Deps): Promise<boolean> {
  deps.log(`1. ${BEAT2_TASK}`);
  const first = lastReply(await deps.runAgent(BEAT2_TASK));
  if ("error" in first) {
    deps.log(`FAIL: first purchase: ${first.error}`);
    return false;
  }
  deps.log(`Gateway reply: ${JSON.stringify(first.reply)}`);

  let status = first.reply.status;
  if (status === "paid" && first.reply.order_id) {
    deps.log("Paid; waiting for the payment to be matched and booked...");
    status = (await settledStatus(first.reply.order_id, deps)) ?? undefined;
    deps.log(`Order status is now: ${status}`);
  }
  if (status !== "exception") {
    deps.log(`FAIL: expected an exception (nothing_delivered), got ${status}`);
    return false;
  }
  deps.log("As expected: exception. CheapData took the money and delivered nothing.");

  await deps.waitForEnter(BLOCK_PROMPT);

  deps.log(`2. ${BEAT2_TASK}`);
  const second = lastReply(await deps.runAgent(BEAT2_TASK));
  if ("error" in second) {
    deps.log(`FAIL: second purchase: ${second.error}`);
    return false;
  }
  deps.log(`Gateway reply: ${JSON.stringify(second.reply)}`);
  if (second.reply.status !== "denied" || second.reply.reason !== "seller blocked") {
    deps.log(`FAIL: expected denied "seller blocked", got ${second.reply.status} "${second.reply.reason ?? ""}"`);
    return false;
  }
  deps.log('As expected: denied, "seller blocked". No money moved.');
  return true;
}
