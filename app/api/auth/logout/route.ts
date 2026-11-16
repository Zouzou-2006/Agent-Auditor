// POST /api/auth/logout: clears the team session cookie (owner: Nizar). Always 204.
import { SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function POST(): Response {
  return new Response(null, {
    status: 204,
    headers: { "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`, "cache-control": "no-store" },
  });
}
