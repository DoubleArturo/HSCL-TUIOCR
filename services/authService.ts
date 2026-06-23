import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
  return _client;
}

export interface AppUser {
  id: string;
  email: string;
  is_admin: boolean;
}

const SESSION_KEY = 'auth_user';
let _cached: AppUser | null = null;

export function getSession(): AppUser | null {
  if (_cached) return _cached;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    _cached = raw ? JSON.parse(raw) : null;
    return _cached;
  } catch {
    return null;
  }
}

function saveSession(user: AppUser): void {
  _cached = user;
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

export async function clearSession(): Promise<void> {
  _cached = null;
  localStorage.removeItem(SESSION_KEY);
  await getClient().auth.signOut();
}

// Called on app load to verify the Supabase session is still valid.
export async function initSession(): Promise<AppUser | null> {
  const { data: { session } } = await getClient().auth.getSession();
  if (!session?.user) {
    _cached = null;
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
  const user: AppUser = {
    id: session.user.id,
    email: session.user.email ?? '',
    is_admin: false,
  };
  saveSession(user);
  return user;
}

export async function login(
  email: string,
  password: string,
): Promise<{ user: AppUser | null; error: string | null }> {
  const { data, error } = await getClient().auth.signInWithPassword({ email, password });
  if (error) return { user: null, error: error.message };
  if (!data.user) return { user: null, error: '登入失敗，請再試一次' };
  const user: AppUser = { id: data.user.id, email: data.user.email ?? email, is_admin: false };
  saveSession(user);
  return { user, error: null };
}

export async function signup(
  email: string,
  password: string,
): Promise<{ user: AppUser | null; error: string | null }> {
  const { data, error } = await getClient().auth.signUp({ email, password });
  if (error) return { user: null, error: error.message };
  if (!data.user) return { user: null, error: '建立帳號失敗，請再試一次' };

  if (data.session) {
    // Email confirmation disabled — auto-logged in
    const user: AppUser = { id: data.user.id, email: data.user.email ?? email, is_admin: false };
    saveSession(user);
    return { user, error: null };
  }

  // Email confirmation required
  return { user: null, error: '確認信已寄出，請點擊信件中的連結後再登入' };
}

// ─── Admin stubs (not supported without service-role key) ────────────────────

export async function fetchAllUsers(): Promise<AppUser[]> {
  return [];
}

export async function deleteUser(_targetId: string): Promise<{ error: string | null }> {
  return { error: '使用者管理功能尚未開放' };
}
