import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Public client — safe for client-side use
export const supabase = createClient(url, anonKey);

// Service client — server-side only, bypasses RLS
export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false },
});
