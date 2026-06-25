import { getSupabase } from './supabaseClient';

export interface AppUser {
  id: string;
  email: string;
  is_admin: boolean;
}

const SESSION_KEY = 'auth_user';
let _cached: AppUser | null = null;

// Keep _cached in sync with the shared Supabase client's auth state.
// This fires on signIn, signOut, and token refresh — eliminates the stale-cache
// race condition that caused account-switch data leaks.
getSupabase().auth.onAuthStateChange((_event, session) => {
  if (!session?.user) {
    _cached = null;
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  } else {
    _cached = { id: session.user.id, email: session.user.email ?? '', is_admin: false };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(_cached)); } catch { /* quota full */ }
  }
});

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

export async function clearSession(): Promise<void> {
  _cached = null;
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  await getSupabase().auth.signOut();
}

// Called on app load to verify the Supabase session is still valid.
export async function initSession(): Promise<AppUser | null> {
  const { data: { session } } = await getSupabase().auth.getSession();
  if (!session?.user) {
    _cached = null;
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    return null;
  }
  _cached = { id: session.user.id, email: session.user.email ?? '', is_admin: false };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(_cached)); } catch { /* quota full */ }
  return _cached;
}

export async function login(
  email: string,
  password: string,
): Promise<{ user: AppUser | null; error: string | null }> {
  try {
    const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error) return { user: null, error: error.message };
    if (!data.user) return { user: null, error: '登入失敗，請再試一次' };
    // onAuthStateChange will update _cached; set it here too for immediate consistency
    _cached = { id: data.user.id, email: data.user.email ?? email, is_admin: false };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(_cached)); } catch { /* quota full */ }
    return { user: _cached, error: null };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/quota/i.test(msg)) {
      return { user: null, error: '瀏覽器儲存空間已滿，請清除瀏覽器快取或 Cookie 後再試' };
    }
    return { user: null, error: '登入失敗，請再試一次' };
  }
}

export async function signup(
  email: string,
  password: string,
): Promise<{ user: AppUser | null; error: string | null }> {
  try {
    const { data, error } = await getSupabase().auth.signUp({ email, password });
    if (error) return { user: null, error: error.message };
    if (!data.user) return { user: null, error: '建立帳號失敗，請再試一次' };

    if (data.session) {
      _cached = { id: data.user.id, email: data.user.email ?? email, is_admin: false };
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(_cached)); } catch { /* quota full */ }
      return { user: _cached, error: null };
    }

    return { user: null, error: '確認信已寄出，請點擊信件中的連結後再登入' };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/quota/i.test(msg)) {
      return { user: null, error: '瀏覽器儲存空間已滿，請清除瀏覽器快取或 Cookie 後再試' };
    }
    return { user: null, error: '建立帳號失敗，請再試一次' };
  }
}

// ─── Admin stubs (not supported without service-role key) ────────────────────

export async function fetchAllUsers(): Promise<AppUser[]> {
  return [];
}

export async function deleteUser(_targetId: string): Promise<{ error: string | null }> {
  return { error: '使用者管理功能尚未開放' };
}
