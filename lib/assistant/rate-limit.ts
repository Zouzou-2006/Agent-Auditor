// Best-effort rate limit for the public copilot (owner: Nizar). POST /api/assistant needs no sign-in,
// so this caps how fast one IP can spend Claude credits. In memory, per server instance: it slows a
// script down, it is not a hard quota (the Claude account's spending limit is the backstop).

export const ASSISTANT_LIMIT = 30; // questions per IP per window: plenty for a person trying it out
export const ASSISTANT_WINDOW_MS = 10 * 60 * 1000;
const MAX_TRACKED = 5000; // forget the oldest IPs past this, so memory stays bounded

const hits = new Map<string, { count: number; resetAt: number }>();

/** Counts one question from `ip`. Returns 0 if it may proceed, otherwise the seconds until it may retry. */
export function takeAssistantSlot(ip: string, nowMs: number): number {
  const h = hits.get(ip);
  if (!h || h.resetAt <= nowMs) {
    if (hits.size >= MAX_TRACKED) {
      for (const [key, value] of hits) if (value.resetAt <= nowMs) hits.delete(key);
      if (hits.size >= MAX_TRACKED) hits.delete(hits.keys().next().value as string);
    }
    hits.set(ip, { count: 1, resetAt: nowMs + ASSISTANT_WINDOW_MS });
    return 0;
  }
  if (h.count >= ASSISTANT_LIMIT) return Math.max(1, Math.ceil((h.resetAt - nowMs) / 1000));
  h.count += 1;
  return 0;
}

/** Test-only: forget every IP. */
export function resetAssistantLimits(): void {
  hits.clear();
}

/** The caller's IP as Vercel reports it (first x-forwarded-for hop), same as the login throttle. */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
