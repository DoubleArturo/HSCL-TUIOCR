import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import type { Project, ProjectMeta, InvoiceEntry } from '../types';

let _supabase: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (_supabase) return _supabase;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.warn('[SellerDB] Supabase env vars not set — seller DB disabled');
    return null;
  }
  _supabase = createClient(url, key);
  return _supabase;
}

export interface SellerRow {
  id: string;
  seller_name: string;
  seller_tax_id: string;
  source: 'ocr' | 'erp' | 'manual';
  created_at: string;
  updated_at: string;
}

export async function fetchAllSellers(): Promise<Record<string, string>> {
  const client = getClient();
  if (!client) return {};
  const { data, error } = await client
    .from('seller_db')
    .select('seller_name, seller_tax_id');
  if (error) {
    console.warn('[SellerDB] fetchAllSellers failed:', error.message);
    return {};
  }
  return Object.fromEntries((data || []).map(r => [r.seller_name, r.seller_tax_id]));
}

export async function fetchAllSellerRows(): Promise<SellerRow[]> {
  const client = getClient();
  if (!client) return [];
  const { data, error } = await client
    .from('seller_db')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) {
    console.warn('[SellerDB] fetchAllSellerRows failed:', error.message);
    return [];
  }
  return data || [];
}

export async function upsertSeller(
  name: string,
  taxId: string,
  source: 'ocr' | 'erp' | 'manual'
): Promise<void> {
  const client = getClient();
  if (!client || !name?.trim() || !taxId?.trim()) return;
  const { error } = await client
    .from('seller_db')
    .upsert(
      { seller_name: name.trim(), seller_tax_id: taxId.trim(), source },
      { onConflict: 'seller_tax_id' }
    );
  if (error) console.warn('[SellerDB] upsertSeller failed:', error.message);
}

export async function upsertSellers(
  sellers: Record<string, string>,
  source: 'ocr' | 'erp' | 'manual'
): Promise<void> {
  const client = getClient();
  if (!client) return;
  const rows = Object.entries(sellers)
    .filter(([name, taxId]) => name?.trim() && /^\d{8}$/.test(taxId?.trim()))
    .map(([name, taxId]) => ({
      seller_name: name.trim(),
      seller_tax_id: taxId.trim(),
      source,
    }));
  if (rows.length === 0) return;
  const { error } = await client
    .from('seller_db')
    .upsert(rows, { onConflict: 'seller_tax_id' });
  if (error) console.warn('[SellerDB] upsertSellers failed:', error.message);
}

export async function deleteSeller(id: string): Promise<void> {
  const client = getClient();
  if (!client) return;
  const { error } = await client.from('seller_db').delete().eq('id', id);
  if (error) console.warn('[SellerDB] deleteSeller failed:', error.message);
}

// ─── Auth ───────────────────────────────────────────────────

export function getSupabaseClient(): SupabaseClient | null {
  return getClient();
}

export async function getCurrentUser(): Promise<User | null> {
  const client = getClient();
  if (!client) return null;
  const { data: { session } } = await client.auth.getSession();
  return session?.user ?? null;
}

// ─── Cloud Projects ──────────────────────────────────────────

export async function fetchCloudProjects(userId: string): Promise<ProjectMeta[]> {
  const client = getClient();
  if (!client) return [];
  const { data, error } = await client
    .from('projects')
    .select('id, name, year, month, updated_at, erp_data, invoices(count)')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) { console.warn('[Cloud] fetchProjects failed:', error.message); return []; }
  return (data || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    year: p.year,
    month: p.month,
    updatedAt: p.updated_at,
    invoiceCount: p.invoices?.[0]?.count ?? 0,
    erpCount: Array.isArray(p.erp_data) ? p.erp_data.length : 0,
  }));
}

export async function fetchCloudProject(userId: string, projectId: string): Promise<Project | null> {
  const client = getClient();
  if (!client) return null;

  const { data: p, error: pe } = await client
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single();
  if (pe || !p) { console.warn('[Cloud] fetchProject failed:', pe?.message); return null; }

  const { data: rows, error: ie } = await client
    .from('invoices')
    .select('*')
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (ie) { console.warn('[Cloud] fetchInvoices failed:', ie.message); return null; }

  const invoices: InvoiceEntry[] = (rows || []).map((inv: any) => ({
    id: inv.id,
    file: new File([], inv.file_name || 'unknown', { type: inv.file_type || 'image/jpeg' }),
    previewUrl: '',
    status: (inv.status === 'PROCESSING' ? 'PENDING' : inv.status) as any,
    data: inv.ocr_data || [],
    error: inv.error ?? undefined,
    storagePath: inv.storage_path ?? undefined,
  }));

  return {
    id: p.id, name: p.name, year: p.year, month: p.month,
    invoices, erpData: p.erp_data || [],
    createdAt: p.created_at, updatedAt: p.updated_at,
  };
}

export async function saveProjectToCloud(userId: string, project: Project): Promise<void> {
  const client = getClient();
  if (!client) return;

  const { error: pe } = await client.from('projects').upsert({
    id: project.id, user_id: userId,
    name: project.name, year: project.year, month: project.month,
    erp_data: project.erpData,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (pe) { console.warn('[Cloud] upsertProject failed:', pe.message); return; }

  if (project.invoices.length === 0) return;
  const rows = project.invoices.map(inv => ({
    id: inv.id, project_id: project.id, user_id: userId,
    status: inv.status,
    ocr_data: inv.data,
    file_name: inv.file?.name ?? '',
    file_type: inv.file?.type ?? '',
    storage_path: inv.storagePath ?? null,
    error: inv.error ?? null,
    updated_at: new Date().toISOString(),
  }));
  const { error: ie } = await client.from('invoices')
    .upsert(rows, { onConflict: 'id,project_id' });
  if (ie) console.warn('[Cloud] upsertInvoices failed:', ie.message);
}

export async function deleteCloudProject(userId: string, projectId: string): Promise<void> {
  const client = getClient();
  if (!client) return;
  const { error } = await client.from('projects').delete()
    .eq('id', projectId).eq('user_id', userId);
  if (error) console.warn('[Cloud] deleteProject failed:', error.message);
}

// ─── Cloud File Storage ──────────────────────────────────────

const BUCKET = 'invoice-files';

export async function uploadInvoiceFile(
  userId: string, projectId: string, invoiceId: string, file: File
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;
  const path = `${userId}/${projectId}/${invoiceId}/${file.name}`;
  const { data, error } = await client.storage.from(BUCKET)
    .upload(path, file, { upsert: true });
  if (error) { console.warn('[Storage] upload failed:', error.message); return null; }
  return data.path;
}

export async function downloadInvoiceFile(storagePath: string): Promise<File | null> {
  const client = getClient();
  if (!client) return null;
  const { data, error } = await client.storage.from(BUCKET).download(storagePath);
  if (error || !data) return null;
  const fileName = storagePath.split('/').pop() || 'invoice';
  return new File([data], fileName, { type: data.type });
}
