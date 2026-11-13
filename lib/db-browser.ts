// Browser-safe Supabase client using the public anon key. Read-only by design: RLS allows
// SELECT on the six tables and nothing else. Use it in the dashboard for queries and realtime.
// Owner: Nizar. Never put the service-role key here (it has no NEXT_PUBLIC_ prefix on purpose,
// so Next.js never ships it to the browser).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./db-types";

export type { Database } from "./db-types";
export type * from "./db-types";

let client: SupabaseClient<Database> | null = null;

export function getBrowserClient(): SupabaseClient<Database> {
  if (client) return client;
  // Read as literal process.env.NEXT_PUBLIC_* so Next.js inlines them into the browser bundle.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (see .env.example)");
  }
  client = createClient<Database>(url, anonKey);
  return client;
}
