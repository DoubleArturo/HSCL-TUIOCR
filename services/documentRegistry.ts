// 記錄遇到過但不在標準清單的文件類型，形成累積知識庫
// 存在 localStorage，key = 'hscl_document_registry'

export interface UnknownDocumentType {
  document_type: string;
  voucher_type: string;
  tax_code: string | null;
  first_seen: string;       // ISO date
  last_seen: string;        // ISO date
  count: number;
  sample_seller: string;
  has_invoice_number: boolean;
}

const STORAGE_KEY = 'hscl_document_registry';

const KNOWN_VOUCHER_TYPES = new Set([
  '三聯手寫', '三聯收銀', '三聯電子', '二聯收銀', '收據', '交通票券', 'Invoice', '其他'
]);

export function isKnownType(voucherType: string): boolean {
  return KNOWN_VOUCHER_TYPES.has(voucherType);
}

export function getRegistry(): UnknownDocumentType[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function recordUnknownType(
  document_type: string,
  voucher_type: string,
  tax_code: string | null,
  seller_name: string,
  has_invoice_number: boolean,
): void {
  if (isKnownType(voucher_type)) return;
  const registry = getRegistry();
  const now = new Date().toISOString();
  const existing = registry.find(r => r.document_type === document_type);
  if (existing) {
    existing.count += 1;
    existing.last_seen = now;
  } else {
    registry.push({
      document_type,
      voucher_type,
      tax_code,
      first_seen: now,
      last_seen: now,
      count: 1,
      sample_seller: seller_name,
      has_invoice_number,
    });
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
  } catch {
    // localStorage full — ignore
  }
}
