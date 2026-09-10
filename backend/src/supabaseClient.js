import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'محتاج SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في .env — من Project Settings → API في لوحة Supabase.',
  );
}

// Service-role key: the backend is the only thing that talks to Supabase and
// already enforces its own auth/session layer, so requests here bypass row
// level security by design rather than acting as any particular end user.
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
