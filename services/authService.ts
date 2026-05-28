import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  _client = createClient(url, key);
  return _client;
}

export interface AppUser {
  id: string;
  employee_id: string;
  name: string;
  is_admin: boolean;
  created_at: string;
  last_login_at: string | null;
}

const SESSION_KEY = 'auth_user';

export function getSession(): AppUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(user: AppUser) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export async function login(employeeId: string, name: string): Promise<{ user: AppUser | null; error: string | null }> {
  const client = getClient();
  const eid = employeeId.trim().toUpperCase();
  const nm = name.trim();

  if (!eid || !nm) return { user: null, error: '請填寫工號與姓名' };
  if (!/^[A-Z][0-9]{4}$/.test(eid)) return { user: null, error: '工號格式錯誤（例：A1282）' };

  // 查詢是否已存在
  const { data: existing, error: fetchErr } = await client
    .from('users')
    .select('*')
    .eq('employee_id', eid)
    .maybeSingle();

  if (fetchErr) return { user: null, error: `登入失敗：${fetchErr.message}` };

  if (existing) {
    // 已有帳號：驗證姓名是否吻合
    if (existing.name !== nm) {
      return { user: null, error: '工號與姓名不符，請確認後再試' };
    }
    // 更新 last_login_at
    await client.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', existing.id);
    const user: AppUser = { ...existing, last_login_at: new Date().toISOString() };
    saveSession(user);
    return { user, error: null };
  }

  // 新使用者：自動建帳號
  const { data: created, error: insertErr } = await client
    .from('users')
    .insert({ employee_id: eid, name: nm, is_admin: false, last_login_at: new Date().toISOString() })
    .select()
    .single();

  if (insertErr) return { user: null, error: `建立帳號失敗：${insertErr.message}` };

  saveSession(created);
  return { user: created, error: null };
}

export async function fetchAllUsers(): Promise<AppUser[]> {
  const session = getSession();
  if (!session?.is_admin) return [];

  const client = getClient();
  const { data, error } = await client
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

export async function deleteUser(targetId: string): Promise<{ error: string | null }> {
  const session = getSession();
  if (!session?.is_admin) return { error: '權限不足' };
  if (session.id === targetId) return { error: '無法刪除自己的帳號' };

  const client = getClient();

  // 先取得該 user 的所有 projects
  const { data: projects } = await client
    .from('audit_projects')
    .select('id')
    .eq('user_id', targetId);

  const projectIds = (projects || []).map(p => p.id);

  if (projectIds.length > 0) {
    // 刪 invoice_entries 和 erp_records
    await client.from('invoice_entries').delete().in('project_id', projectIds);
    await client.from('erp_records').delete().in('project_id', projectIds);
    // 刪 projects
    await client.from('audit_projects').delete().eq('user_id', targetId);
  }

  // 刪 user
  const { error } = await client.from('users').delete().eq('id', targetId);
  if (error) return { error: error.message };
  return { error: null };
}
