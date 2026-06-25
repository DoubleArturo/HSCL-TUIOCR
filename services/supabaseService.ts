import { getSupabase } from './supabaseClient';

function getClient() {
  try { return getSupabase(); }
  catch { console.warn('[SellerDB] Supabase env vars not set — seller DB disabled'); return null; }
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
  const deduped = Array.from(
    rows.reduce((m, r) => m.set(r.seller_tax_id, r), new Map<string, typeof rows[number]>()).values()
  );
  const { error } = await client
    .from('seller_db')
    .upsert(deduped, { onConflict: 'seller_tax_id' });
  if (error) console.warn('[SellerDB] upsertSellers failed:', error.message);
}

export async function deleteSeller(id: string): Promise<void> {
  const client = getClient();
  if (!client) return;
  const { error } = await client.from('seller_db').delete().eq('id', id);
  if (error) console.warn('[SellerDB] deleteSeller failed:', error.message);
}

export interface OCRCorrectionRecord {
  file_id: string;
  voucher_id?: string;
  tax_code?: string | null;
  voucher_type?: string | null;
  field_name: string;
  original_value: string | null;
  corrected_value: string;
  user_email?: string;
}

/**
 * Batch-insert OCR correction diffs for analytics.
 * Silently no-ops if Supabase is unavailable or corrections is empty.
 */
export async function recordOCRCorrections(corrections: OCRCorrectionRecord[]): Promise<void> {
  const client = getClient();
  if (!client || corrections.length === 0) return;
  const { error } = await client.from('ocr_corrections').insert(corrections);
  if (error) console.warn('[OCR Corrections] Failed to record:', error.message);
}
