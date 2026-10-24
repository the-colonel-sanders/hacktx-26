import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Browser client: publishable key only (read + Realtime). Never use the secret key here. */
export function browserDb(): SupabaseClient {
  if (client) return client;
  client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  return client;
}
