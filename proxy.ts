// Next.js 16 proxy (formerly middleware), owner: Nizar. Enforces lib/auth.ts on EVERY /api request
// before any route runs: default deny, with an explicit public list (x402 sellers, the signed
// Streams webhook, /api/auth). Pages and static files are not matched; the dashboard reads data
// straight from Supabase with the read-only anon key, so it stays viewable without signing in.
import { NextResponse, type NextRequest } from "next/server";
import { decide, deniedResponse } from "@/lib/auth-http";

export function proxy(request: NextRequest) {
  const decision = decide(request);
  if (!decision.ok) return deniedResponse(decision);
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
