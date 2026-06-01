import { createClient } from '@supabase/supabase-js';

// Service role client — bypasses RLS. Only use in API routes.
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin environment variables are not configured.');
  }

  return createClient(
    supabaseUrl,
    serviceRoleKey
  );
}
