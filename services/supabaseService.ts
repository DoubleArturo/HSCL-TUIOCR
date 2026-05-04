import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export interface SellerRow {
  id: string;
  seller_name: string;
  seller_tax_id: string;
  source: 'ocr' | 'erp' | 'manual';
  created_at: string;
  updated_at: string;
}

// 回傳 { seller_name: seller_tax_id } map，供 AI lookup 用
export async function fetchAllSellers(): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('seller_db')
    .select('seller_name, seller_tax_id');
  if (error) {
    console.warn('[SellerDB] fetchAllSellers failed:', error.message);
    return {};
  }
  return Object.fromEntries((data || []).map(r => [r.seller_name, r.seller_tax_id]));
}

// 完整 row 陣列，給 UI 用
export async function fetchAllSellerRows(): Promise<SellerRow[]> {
  const { data, error } = await supabase
    .from('seller_db')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) {
    console.warn('[SellerDB] fetchAllSellerRows failed:', error.message);
    return [];
  }
  return data || [];
}

// upsert：以 seller_tax_id 為唯一鍵；若已存在則更新 seller_name + source
export async function upsertSeller(
  name: string,
  taxId: string,
  source: 'ocr' | 'erp' | 'manual'
): Promise<void> {
  if (!name?.trim() || !taxId?.trim()) return;
  const { error } = await supabase
    .from('seller_db')
    .upsert(
      { seller_name: name.trim(), seller_tax_id: taxId.trim(), source },
      { onConflict: 'seller_tax_id' }
    );
  if (error) console.warn('[SellerDB] upsertSeller failed:', error.message);
}

// 批次 upsert（ERP 匯入用）
export async function upsertSellers(
  sellers: Record<string, string>,
  source: 'ocr' | 'erp' | 'manual'
): Promise<void> {
  const rows = Object.entries(sellers)
    .filter(([name, taxId]) => name?.trim() && /^\d{8}$/.test(taxId?.trim()))
    .map(([name, taxId]) => ({
      seller_name: name.trim(),
      seller_tax_id: taxId.trim(),
      source,
    }));
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('seller_db')
    .upsert(rows, { onConflict: 'seller_tax_id' });
  if (error) console.warn('[SellerDB] upsertSellers failed:', error.message);
}

export async function deleteSeller(id: string): Promise<void> {
  const { error } = await supabase.from('seller_db').delete().eq('id', id);
  if (error) console.warn('[SellerDB] deleteSeller failed:', error.message);
}
