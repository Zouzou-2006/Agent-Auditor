// SERVER-ONLY Supabase client using the service-role key (bypasses RLS; full write access).
// Owner: Nizar. Use from route handlers, server code and scripts. NEVER from a client component:
// the `server-only` import below makes the Next.js build fail if this file reaches the browser.
// Browser code (the dashboard) uses lib/db-browser.ts instead.

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./db-types";

export type { Database } from "./db-types";
export type * from "./db-types";

let client: SupabaseClient<Database> | null = null;

/** Lazily created so builds and tests don't need real credentials. */
export function getServiceClient(): SupabaseClient<Database> {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example)");
  }
  client = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
