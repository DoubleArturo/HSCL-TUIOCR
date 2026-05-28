import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Project, InvoiceEntry, ERPRecord, ProjectMeta } from '../types';
import { getSession } from './authService';

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
  return _client;
}


// ─── Projects ────────────────────────────────────────────────────────────────

export async function fetchProjectList(): Promise<ProjectMeta[]> {
  const client = getClient();
  const user = getSession();
  if (!user) return [];

  const { data, error } = await client
    .from('audit_projects')
    .select('id, name, year, month, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) { console.warn('[Cloud] fetchProjectList:', error.message); return []; }

  // invoiceCount / erpCount 從 counts
  const ids = (data || []).map(p => p.id);
  if (ids.length === 0) return [];

  const [invCounts, erpCounts] = await Promise.all([
    client.from('invoice_entries').select('project_id').in('project_id', ids),
    client.from('erp_records').select('project_id').in('project_id', ids),
  ]);

  const invMap: Record<string, number> = {};
  const erpMap: Record<string, number> = {};
  (invCounts.data || []).forEach(r => { invMap[r.project_id] = (invMap[r.project_id] || 0) + 1; });
  (erpCounts.data || []).forEach(r => { erpMap[r.project_id] = (erpMap[r.project_id] || 0) + 1; });

  return (data || []).map(p => ({
    id: p.id,
    name: p.name,
    year: p.year,
    month: p.month,
    updatedAt: p.updated_at,
    invoiceCount: invMap[p.id] || 0,
    erpCount: erpMap[p.id] || 0,
  }));
}

export async function upsertProject(proj: Project): Promise<void> {
  const client = getClient();
  const user = getSession();
  if (!user) return;

  const { error } = await client.from('audit_projects').upsert({
    id: proj.id,
    user_id: user.id,
    name: proj.name,
    year: proj.year ?? null,
    month: proj.month ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  if (error) console.warn('[Cloud] upsertProject:', error.message);
}

export async function deleteProject(id: string): Promise<void> {
  const client = getClient();
  const user = getSession();
  if (!user) return;
  const { error } = await client.from('audit_projects').delete().eq('id', id).eq('user_id', user.id);
  if (error) console.warn('[Cloud] deleteProject:', error.message);
}

// ─── Invoice Entries ──────────────────────────────────────────────────────────

export async function upsertInvoiceEntries(projectId: string, entries: InvoiceEntry[]): Promise<void> {
  const client = getClient();
  const user = getSession();
  if (!user || entries.length === 0) return;

  const { data: proj } = await client
    .from('audit_projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!proj) { console.warn('[Cloud] upsertInvoiceEntries: unauthorized projectId'); return; }

  const rows = entries.map(inv => ({
    id: inv.id,
    project_id: projectId,
    status: inv.status,
    data: inv.data,
    error: inv.error ?? null,
    file_name: inv.file?.name ?? null,
    file_type: inv.file?.type ?? null,
    updated_at: new Date().toISOString(),
  }));

  // batch upsert in chunks of 200
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await client
      .from('invoice_entries')
      .upsert(chunk, { onConflict: 'id,project_id' });
    if (error) console.warn('[Cloud] upsertInvoiceEntries:', error.message);
  }
}

export async function fetchInvoiceEntries(projectId: string): Promise<InvoiceEntry[]> {
  const client = getClient();
  const user = getSession();
  if (!user) return [];

  const { data: proj } = await client
    .from('audit_projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!proj) return [];

  const { data, error } = await client
    .from('invoice_entries')
    .select('id, status, data, error, file_name, file_type')
    .eq('project_id', projectId);

  if (error) { console.warn('[Cloud] fetchInvoiceEntries:', error.message); return []; }

  return (data || []).map(row => ({
    id: row.id,
    status: row.status as InvoiceEntry['status'],
    data: row.data ?? [],
    error: row.error ?? undefined,
    // file 和 previewUrl 由 IndexedDB rehydrate，這裡給空殼
    file: new File([], row.file_name || 'unknown', { type: row.file_type || 'image/jpeg' }),
    previewUrl: '',
  }));
}

export async function deleteInvoiceEntry(projectId: string, entryId: string): Promise<void> {
  const client = getClient();
  const user = getSession();
  if (!user) return;

  const { data: proj } = await client
    .from('audit_projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!proj) { console.warn('[Cloud] deleteInvoiceEntry: unauthorized'); return; }

  const { error } = await client
    .from('invoice_entries')
    .delete()
    .eq('project_id', projectId)
    .eq('id', entryId);
  if (error) console.warn('[Cloud] deleteInvoiceEntry:', error.message);
}

// ─── ERP Records ─────────────────────────────────────────────────────────────

export async function upsertErpRecords(projectId: string, records: ERPRecord[]): Promise<void> {
  const client = getClient();
  const user = getSession();
  if (!user || records.length === 0) return;

  const { data: proj } = await client
    .from('audit_projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!proj) { console.warn('[Cloud] upsertErpRecords: unauthorized projectId'); return; }

  const rows = records.map(r => ({
    project_id: projectId,
    voucher_id: r.voucher_id,
    data: r,
  }));

  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await client
      .from('erp_records')
      .upsert(chunk, { onConflict: 'project_id,voucher_id' });
    if (error) console.warn('[Cloud] upsertErpRecords:', error.message);
  }
}

export async function fetchErpRecords(projectId: string): Promise<ERPRecord[]> {
  const client = getClient();
  const user = getSession();
  if (!user) return [];

  const { data: proj } = await client
    .from('audit_projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!proj) return [];

  const { data, error } = await client
    .from('erp_records')
    .select('data')
    .eq('project_id', projectId);

  if (error) { console.warn('[Cloud] fetchErpRecords:', error.message); return []; }
  return (data || []).map(row => row.data as ERPRecord);
}

// ─── Full Project Load ────────────────────────────────────────────────────────

export async function fetchFullProject(projectId: string): Promise<Omit<Project, 'invoices'> & { invoices: InvoiceEntry[] } | null> {
  const client = getClient();
  const user = getSession();
  if (!user) return null;

  const { data: proj, error } = await client
    .from('audit_projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !proj) return null;

  const [invoices, erpData] = await Promise.all([
    fetchInvoiceEntries(projectId),
    fetchErpRecords(projectId),
  ]);

  return {
    id: proj.id,
    name: proj.name,
    year: proj.year,
    month: proj.month,
    createdAt: proj.created_at,
    updatedAt: proj.updated_at,
    invoices,
    erpData,
  };
}
