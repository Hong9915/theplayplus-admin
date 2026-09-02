import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

export function getSupabaseServerClient(): SupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
  }

  cachedClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
    global: {
      // Next.js patches global fetch and caches GET responses in its Data
      // Cache (persisted under .next/cache/fetch-cache), which serves stale
      // games/inquiries. Admin data must always be read fresh.
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return cachedClient;
}
