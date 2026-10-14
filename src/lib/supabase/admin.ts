import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./env";

function supabaseServiceKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return key;
}

/** Service-role client. Server-only. Bypasses RLS for webhooks, credits, and admin. */
export function createServiceSupabase() {
  return createClient(supabaseUrl(), supabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
