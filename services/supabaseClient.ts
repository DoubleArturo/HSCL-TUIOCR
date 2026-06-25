import { createClient, SupabaseClient } from '@supabase/supabase-js';

const _memStore: Record<string, string> = {};
const safeStorage = {
  getItem: (key: string): string | null => {
    try { return localStorage.getItem(key); } catch { return _memStore[key] ?? null; }
  },
  setItem: (key: string, value: string): void => {
    try { localStorage.setItem(key, value); } catch { _memStore[key] = value; }
  },
  removeItem: (key: string): void => {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    delete _memStore[key];
  },
};

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    { auth: { storage: safeStorage, persistSession: true, autoRefreshToken: true } },
  );
  return _client;
}
