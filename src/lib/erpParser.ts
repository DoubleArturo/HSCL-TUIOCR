import type { ERPRecord } from '../../types';
import { normalizeDate } from './invoiceNormalizer';

const KEY_MAP = {
  voucher_id: ['傳票編號', '傳票號碼', '單號', 'Voucher', '傳票', 'NO.', '帳款單號'],
  invoice_number: ['發票號碼', '發票編號', 'Invoice No', '發票', '多發票號碼'],
  invoice_date: ['發票日期', '日期', 'Date'],
  tax_code: ['稅別', 'Tax Code', '稅型'],
  seller_name: ['廠商名稱', '廠商', 'Vendor', '客戶名稱', '摘要'],
  seller_tax_id: ['統一編號', '統編', 'Tax ID'],
  amount_sales: ['未稅金額(本幣)(查詢 1 與 fin_apb)', '未稅金額', '銷售額', 'Sales Amount', '未稅'],
  amount_tax: ['稅額(本幣)(查詢 1 與 fin_apb)', '稅額', '營業稅', 'Tax Amount', '稅金', '稅額(本幣)'],
  amount_total: ['含稅金額(本幣)(查詢 1 與 fin_apb)', '含稅金額', '總額', '總計', 'Total Amount', '金額', '本幣借方金額'],
} as const;

type KeyMapKey = keyof typeof KEY_MAP;

function parseAmount(val: unknown): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return parseFloat(val.replace(/,/g, '').trim()) || 0;
  return 0;
}

/**
 * Detect header row index and build a column-index map.
 * Returns null if no header row is found.
 */
export function detectHeaderMap(rows: unknown[][]): Record<KeyMapKey, number> | null {
  for (const row of rows) {
    const cells = row.map(c => String(c ?? '').trim());
    if (!cells.some(s => KEY_MAP.voucher_id.some(k => s.includes(k)))) continue;

    const map: Partial<Record<KeyMapKey, number>> = {};
    const quality: Partial<Record<KeyMapKey, number>> = {};

    cells.forEach((col, idx) => {
      for (const [key, keywords] of Object.entries(KEY_MAP) as [KeyMapKey, readonly string[]][]) {
        const matchIdx = keywords.findIndex(k => col.includes(k));
        if (matchIdx === -1) continue;
        const best = quality[key] ?? 999;
        if (matchIdx < best) {
          map[key] = idx;
          quality[key] = matchIdx;
        }
      }
    });

    return map as Record<KeyMapKey, number>;
  }
  return null;
}

/**
 * Parse raw 2D rows (from XLSX.utils.sheet_to_json header:1) into ERPRecord[].
 * This is a pure function — no FileReader, no XLSX dependency.
 */
export function parseERPRows(rows: unknown[][]): ERPRecord[] {
  const headerMap = detectHeaderMap(rows);
  const records: ERPRecord[] = [];
  let headerRowFound = false;

  for (const row of rows) {
    // Skip until we find the header row, then mark it passed
    if (!headerRowFound) {
      const cells = row.map(c => String(c ?? '').trim());
      if (cells.some(s => KEY_MAP.voucher_id.some(k => s.includes(k)))) {
        headerRowFound = true;
      }
      continue;
    }

    const get = (key: KeyMapKey): unknown => {
      const idx = headerMap?.[key] ?? -1;
      return idx >= 0 && idx < row.length ? row[idx] : undefined;
    };

    const voucherRaw = get('voucher_id');
    const vId = voucherRaw ? String(voucherRaw).trim() : '';
    if (!vId || KEY_MAP.voucher_id.some(k => vId.includes(k))) continue;

    const invRaw = get('invoice_number');
    const invStr = invRaw ? String(invRaw) : '';
    const invoiceNumbers = invStr.split(/[\s,、;/]+/).filter(Boolean);

    const rawDate = String(get('invoice_date') ?? '');

    records.push({
      voucher_id: vId,
      invoice_date: normalizeDate(rawDate),
      tax_code: String(get('tax_code') ?? ''),
      invoice_numbers: invoiceNumbers,
      seller_name: String(get('seller_name') ?? ''),
      seller_tax_id: String(get('seller_tax_id') ?? ''),
      amount_sales: parseAmount(get('amount_sales')),
      amount_tax: parseAmount(get('amount_tax')),
      amount_total: parseAmount(get('amount_total')),
      raw_row: row.map(String),
    });
  }

  return records;
}
