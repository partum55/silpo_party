import "server-only";

import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

export function createSupabaseAdminClient() {
  return createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("SUPABASE_SECRET_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
