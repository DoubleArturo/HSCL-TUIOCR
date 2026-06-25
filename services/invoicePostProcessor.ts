import { InvoiceData, ExpectedERP } from '../types';
import { assignTaxCode, syncVoucherType, isForeignInvoice } from '../src/lib/taxCodeLogic';
import { validateInvoice, autoCorrectAmounts } from './validationPipeline';
import { recordUnknownType, isKnownType } from './documentRegistry';

export type UsageData = {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  cost_usd: number;
};

// 從 base64 圖片資料讀取寬高比，PDF 或解析失敗時回傳 null
export function getImageAspectRatio(base64Data: string, mimeType: string): Promise<number | null> {
  if (!mimeType.startsWith('image/')) return Promise.resolve(null);
  return new Promise(resolve => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), 3000);
    img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth / img.naturalHeight); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    const data = base64Data.includes(',') ? base64Data : `data:${mimeType};base64,${base64Data}`;
    img.src = data;
  });
}

// TODO: N+1 issue — fetchAllSellers is called once per analyzeInvoice invocation.
// Consider caching at the App level and passing in as a parameter.
export async function mergeSellerDB(knownSellers: Record<string, string>): Promise<Record<string, string>> {
  let STATIC_SELLERS: Record<string, string> = {};
  try {
    const db = await import('../src/data/seller_db.json');
    STATIC_SELLERS = db.default || db;
  } catch (e) {
    console.warn('Failed to load seller_db.json', e);
  }

  let SUPABASE_SELLERS: Record<string, string> = {};
  try {
    const { fetchAllSellers } = await import('./supabaseService');
    SUPABASE_SELLERS = await fetchAllSellers();
  } catch (e) {
    console.warn('Failed to load Supabase seller DB', e);
  }

  // Merge priority: Static < ERP Excel < Supabase
  return { ...STATIC_SELLERS, ...knownSellers, ...SUPABASE_SELLERS };
}

export async function postProcessItems(
  results: InvoiceData[],
  base64Data: string,
  mimeType: string,
  modelName: string,
  expectedERP: ExpectedERP | undefined,
  text: string,
  usageData: UsageData | undefined,
  MERGED_SELLERS: Record<string, string>
): Promise<InvoiceData[]> {
  return Promise.all(results.map(async (item) => {
    const logs: string[] = [`[${new Date().toISOString()}] Started processing`, `Model: ${modelName}`];

    item.usage_metadata = usageData;
    item.raw_response = text;

    if (!item.error_code) item.error_code = "SUCCESS" as any;
    logs.push(`Initial Error Code: ${item.error_code}`);

    // --- a) N 張驗證 ---
    if (expectedERP?.invoice_numbers && expectedERP.invoice_numbers.length > 1) {
      const extractedNos = results.filter(r => r.invoice_number).map(r => r.invoice_number!);
      if (extractedNos.length < expectedERP.invoice_numbers.length) {
        logs.push(`[N-張驗證] ERP expects ${expectedERP.invoice_numbers.length} invoice(s) (${expectedERP.invoice_numbers.join(', ')}), but only ${extractedNos.length} found.`);
        if (!item.verification.flagged_fields.includes('count_mismatch')) {
          item.verification.flagged_fields.push('count_mismatch');
        }
      }
    }

    // --- b) 空間一致性 check ---
    if (results.length === 1) {
      const aspectRatio = await getImageAspectRatio(base64Data, mimeType);
      if (aspectRatio !== null && aspectRatio > 1.8) {
        logs.push(`[空間check] Single result extracted but image aspect ratio is ${aspectRatio.toFixed(2)} (> 1.8) — may contain multiple invoices, manual review suggested.`);
        if (!item.verification.flagged_fields.includes('possible_multiple_invoices')) {
          item.verification.flagged_fields.push('possible_multiple_invoices');
        }
      }
    }

    // --- TAX CODE CLASSIFICATION ---
    if (!item.tax_code) {
      item.tax_code = assignTaxCode(item.voucher_type, item.document_type, item.invoice_number) as any;
      logs.push(`Tax Code Assigned: ${item.tax_code} (from voucher_type: ${item.voucher_type}, document_type: ${item.document_type})`);
    }

    if (!item.voucher_type) {
      item.voucher_type = syncVoucherType(item.tax_code as any) as any;
    }

    // --- TRANSIT TICKET DETECTION ---
    const isTransitTicket = (
      item.voucher_type === '交通票券' ||
      item.tax_code === 'T500' && (
        (item.document_type || '').toLowerCase().includes('車票') ||
        (item.document_type || '').toLowerCase().includes('高鐵') ||
        (item.document_type || '').toLowerCase().includes('火車') ||
        (item.document_type || '').toLowerCase().includes('客運') ||
        (item.document_type || '').toLowerCase().includes('捷遊') ||
        (item.document_type || '').toLowerCase().includes('捷運') ||
        (item.document_type || '').toLowerCase().includes('ticket')
      )
    );
    if (isTransitTicket) {
      item.voucher_type = '交通票券';
      item.tax_code = 'T500';
      // Transit tickets only show the BUYER's tax ID — no seller tax ID field
      item.seller_tax_id = null;
      logs.push(`Transit ticket detected: forced voucher_type=交通票券, cleared seller_tax_id`);
    }

    // --- SKIP LOGIC for foreign Invoice ---
    if (isForeignInvoice(item.document_type) && item.error_code === ('SUCCESS' as any)) {
      item.error_code = 'NOT_INVOICE' as any;
      logs.push(`AUTO-SKIP: Foreign Invoice detected. Document is skipped (tax_code=TXXX, NOT_INVOICE).`);
    }

    // A. Seller Tax ID — database lookup when ID is missing or unclear
    if (item.seller_name && (!item.seller_tax_id || item.seller_tax_id.includes('?'))) {
      for (const [name, id] of Object.entries(MERGED_SELLERS)) {
        if (item.seller_name.includes(name) || name.includes(item.seller_name)) {
          item.seller_tax_id = id;
          logs.push(`Enriched: Found Seller Tax ID from DB (${name} -> ${id})`);
          break;
        }
      }
    }

    // B. Auto-save new seller to Supabase (never save our own buyer tax ID)
    const BUYER_TAX_IDS = ['16547744'];
    if (
      item.seller_name &&
      item.seller_tax_id &&
      /^\d{8}$/.test(item.seller_tax_id) &&
      !item.seller_tax_id.includes('?') &&
      !BUYER_TAX_IDS.includes(item.seller_tax_id)
    ) {
      try {
        const { upsertSeller } = await import('./supabaseService');
        await upsertSeller(item.seller_name, item.seller_tax_id, 'ocr');
        logs.push(`SellerDB: Upserted ${item.seller_name} (${item.seller_tax_id}) to Supabase`);
      } catch (e) {
        console.warn('[SellerDB] Auto-save failed', e);
      }
    }

    // C. Invoice number format validation (2 uppercase letters + 8 digits)
    if (item.invoice_number) {
      const cleanInv = item.invoice_number.replace(/[^A-Z0-9]/g, '');
      const guiRegex = /^[A-Z]{2}\d{8}$/;
      if (!item.invoice_number.startsWith('INV') && !item.invoice_number.includes('-')) {
        if (!guiRegex.test(cleanInv)) {
          logs.push(`Warning: Invoice Number ${cleanInv} does not match standard Taiwan GUI format (2 Letters + 8 Digits)`);
        }
      }
    }

    // Rule 1: Remove all whitespace from Invoice Number
    if (item.invoice_number) {
      const original = item.invoice_number;
      item.invoice_number = item.invoice_number.replace(/\s+/g, '').toUpperCase();
      if (original !== item.invoice_number) logs.push(`Rule 1: Cleaned Invoice Number (${original} -> ${item.invoice_number})`);
    }

    // Rule 2: Flag unclear Seller Tax ID
    if (item.seller_tax_id && item.seller_tax_id.includes('?')) {
      if (!item.verification.flagged_fields.includes('seller_tax_id')) {
        item.verification.flagged_fields.push('seller_tax_id');
        logs.push(`Rule 2: Flagged unclear Seller Tax ID (${item.seller_tax_id})`);
      }
    }

    // Rule 2b: Validate Taiwan tax ID checksum (mod-5 rule)
    if (item.seller_tax_id && /^\d{8}$/.test(item.seller_tax_id)) {
      const { validateTaiwanTaxId } = await import('../src/lib/taxIdValidator');
      if (!validateTaiwanTaxId(item.seller_tax_id)) {
        if (!item.verification.flagged_fields.includes('seller_tax_id')) {
          item.verification.flagged_fields.push('seller_tax_id');
        }
        logs.push(`Rule 2b: Seller Tax ID ${item.seller_tax_id} failed checksum (mod-5 rule)`);
      }
    }

    // Rule 2c: Validate buyer_tax_id
    const EXPECTED_BUYER_TAX_IDS = ['16547744'];
    if (item.buyer_tax_id) {
      if (item.buyer_tax_id.includes('?')) {
        if (!item.verification.flagged_fields.includes('buyer_tax_id')) {
          item.verification.flagged_fields.push('buyer_tax_id');
          logs.push(`Rule 2c: Flagged unclear Buyer Tax ID (${item.buyer_tax_id})`);
        }
      } else if (/^\d{8}$/.test(item.buyer_tax_id)) {
        if (!EXPECTED_BUYER_TAX_IDS.includes(item.buyer_tax_id)) {
          if (!item.verification.flagged_fields.includes('buyer_tax_id')) {
            item.verification.flagged_fields.push('buyer_tax_id');
            logs.push(`Rule 2c: Buyer Tax ID ${item.buyer_tax_id} does not match expected (${EXPECTED_BUYER_TAX_IDS.join(', ')})`);
          }
        } else {
          logs.push(`Rule 2c: Buyer Tax ID validated OK (${item.buyer_tax_id})`);
        }
      }
    }

    // --- c) 自動金額修正 ---
    const amountFix = autoCorrectAmounts(item);
    if (amountFix.corrected) {
      logs.push(amountFix.log);
    }

    // --- d) 結構化驗證 ---
    const validationFailures = validateInvoice(item);
    if (validationFailures.length > 0) {
      validationFailures.forEach(f => {
        if (!item.verification.flagged_fields.includes(f.field)) {
          item.verification.flagged_fields.push(f.field);
        }
      });
      logs.push(`[驗證] ${validationFailures.length} validation error(s) found: ${validationFailures.map(f => f.field).join(', ')}`);
    }

    // --- e) 未知類型記錄 ---
    if (item.voucher_type && !isKnownType(item.voucher_type)) {
      recordUnknownType(
        item.document_type || 'unknown',
        item.voucher_type,
        item.tax_code,
        item.seller_name,
        !!item.invoice_number
      );
      logs.push(`[Registry] Recorded unknown voucher_type: "${item.voucher_type}"`);
    }

    item.trace_logs = logs;
    return item;
  }));
}

export function deduplicateResults(results: InvoiceData[]): InvoiceData[] {
  const isGenericDocument = (type: string) => {
    const t = (type || '').toLowerCase();
    return (
      type === '非發票' ||
      t.includes('packing list') ||
      t.includes('delivery') ||
      t.includes('出貨單') ||
      t.includes('送貨單') ||
      t.includes('訂單出貨') ||
      t.includes('出貨憑證') ||
      t.includes('出貨通知') ||
      t.includes('銷貨單') ||
      t.includes('收料單') ||
      t.includes('驗收單')
    );
  };
  const hasValidInvoice = results.some(r => !isGenericDocument(r.document_type || '') && r.invoice_number);

  return results.filter((item, index) => {
    const isGeneric = isGenericDocument(item.document_type || '');
    if (isGeneric) {
      if (hasValidInvoice) {
        console.log(`[Dedup] Dropping ${item.document_type} page because a valid invoice exists in the same file.`);
        return false;
      }
      item.error_code = 'NOT_INVOICE' as any;
      item.amount_sales = 0;
      item.amount_tax = 0;
      item.amount_total = 0;
      return true;
    }
    if (!item.invoice_number) {
      const hasBetterMatch = results.some((other, otherIdx) =>
        otherIdx !== index &&
        other.invoice_number &&
        Math.abs((other.amount_total || 0) - (item.amount_total || 0)) <= 5
      );
      if (hasBetterMatch) {
        console.log(`[Dedup] Dropping ghost result with null invoice_number, total=${item.amount_total}`);
        return false;
      }
    }
    if (item.invoice_number) {
      const firstOccurrence = results.findIndex(other => other.invoice_number === item.invoice_number);
      if (firstOccurrence !== index) {
        console.log(`[Dedup] Dropping duplicate invoice_number=${item.invoice_number} at index ${index} (first seen at ${firstOccurrence})`);
        return false;
      }
    }
    return true;
  });
}
