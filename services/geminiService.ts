import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { createClient } from '@supabase/supabase-js';
import { InvoiceData, ExpectedERP } from "../types";
import { assignTaxCode, syncVoucherType, isForeignInvoice } from '../src/lib/taxCodeLogic';
import { PROMPT_BASE } from './prompts/base';
import { PROMPT_T300 } from './prompts/T300';
import { PROMPT_T301 } from './prompts/T301';
import { PROMPT_T302 } from './prompts/T302';
import { PROMPT_T500 } from './prompts/T500';
import { PROMPT_TXXX } from './prompts/TXXX';
import { buildUnknownTypePrompt } from './prompts/unknown';
import { validateInvoice, autoCorrectAmounts } from './validationPipeline';
import { recordUnknownType, getRegistry, isKnownType } from './documentRegistry';

// Define process for Vite environment to avoid TS errors
declare const process: {
  env: {
    GEMINI_API_KEY?: string;
    API_KEY?: string;
    [key: string]: string | undefined;
  }
};

function getTypeSpecificPrompt(tax_code?: string | null): string {
  if (!tax_code) return '';
  switch (tax_code) {
    case 'T300': return PROMPT_T300;
    case 'T301': return PROMPT_T301;
    case 'T302': return PROMPT_T302;
    case 'T500': return PROMPT_T500;
    case 'TXXX': return PROMPT_TXXX;
    default: return '';
  }
}



const invoiceObjectSchema = {
  type: "OBJECT",
  properties: {
    document_type: {
      type: "STRING",
      description: "Exact document classification. e.g. '統一發票', 'Commercial Invoice', 'Receipt', '進口報單', 'Packing List', etc."
    },
    voucher_type: {
      type: "STRING",
      description: "Fine-grained voucher format type. Common values: 三聯手寫, 三聯收銀, 三聯電子, 二聯收銀, 收據, 交通票券, Invoice, 其他. New types will be auto-captured."
    },
    tax_code: {
      type: "STRING",
      enum: ["T300", "T301", "T302", "T400", "T500", "TXXX"],
      description: "稅別: T300=三聆手開(格21), T301=三聆電子(格25/證明聯), T302=三聆收銀(格25), T400=海關進口(格28), T500=二聆收銀(格22)或車票, TXXX=其他"
    },
    error_code: { type: "STRING", enum: ["SUCCESS", "BLURRY", "NOT_INVOICE", "PARTIAL", "UNKNOWN"] },
    invoice_number: { type: "STRING" },
    invoice_date: { type: "STRING" },
    seller_name: { type: "STRING" },
    seller_tax_id: { type: "STRING", description: "The Tax ID of the Seller (賣方). Use '?' for unclear digits." },
    buyer_tax_id: { type: "STRING", description: "The Tax ID of the Buyer (買受人統一編號). On 三聯手寫 invoices, found at lower-left '買受人統一編號' field. 8 digits. Use '?' for digits obscured by grid lines or stamps. Output null if not visible." },
    currency: { type: "STRING", description: "Currency of the amounts (e.g., TWD, USD, EUR). Default to TWD if none found." },
    amount_sales: { type: "INTEGER" },
    amount_tax: { type: "INTEGER" },
    amount_total: { type: "INTEGER" },
    has_stamp: { type: "BOOLEAN" },
    verification: {
      type: "OBJECT",
      properties: {
        ai_confidence: { type: "NUMBER" },
        logic_is_valid: { type: "BOOLEAN" },
        flagged_fields: { type: "ARRAY", items: { type: "STRING" } }
      },
      required: ["ai_confidence", "logic_is_valid", "flagged_fields"]
    },
    field_confidence: {
      type: "OBJECT",
      properties: {
        invoice_number: { type: "NUMBER" },
        invoice_date: { type: "NUMBER" },
        seller_name: { type: "NUMBER" },
        seller_tax_id: { type: "NUMBER" },
        currency: { type: "NUMBER" },
        amount_sales: { type: "NUMBER" },
        amount_tax: { type: "NUMBER" },
        amount_total: { type: "NUMBER" }
      },
      required: ["invoice_number", "invoice_date", "seller_name", "seller_tax_id", "currency", "amount_sales", "amount_tax", "amount_total"]
    },
    usage_metadata: {
      type: "OBJECT",
      properties: {
        promptTokenCount: { type: "NUMBER" },
        candidatesTokenCount: { type: "NUMBER" },
        totalTokenCount: { type: "NUMBER" },
        cost_usd: { type: "NUMBER" }
      }
    }
  },
  // We make most fields optional to support error cases, but verification is required
  required: ["verification", "field_confidence"]
};

const responseSchema = {
  type: "ARRAY",
  items: invoiceObjectSchema,
};

// 輔助函式：等待
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 從 base64 圖片資料讀取寬高比，PDF 或解析失敗時回傳 null
const getImageAspectRatio = (base64Data: string, mimeType: string): Promise<number | null> => {
  if (!mimeType.startsWith('image/')) return Promise.resolve(null);
  return new Promise(resolve => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), 3000);
    img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth / img.naturalHeight); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    const data = base64Data.includes(',') ? base64Data : `data:${mimeType};base64,${base64Data}`;
    img.src = data;
  });
};

function buildPromptText(expectedERP?: ExpectedERP, validationRetryCount = 0): string {
  let promptText = `Extract all invoice data from this document.

**MULTI-INVOICE PAGES — CRITICAL ISOLATION RULE**:
If the document image contains MULTIPLE physical invoices (e.g. two invoices side-by-side, top/bottom halves, or multiple stapled pages scanned together):
1. FIRST, visually identify and mentally draw a boundary around EACH separate invoice form.
2. For EACH invoice boundary, extract data ONLY from within that boundary. Never mix fields across boundaries.
3. Return one separate JSON object per invoice, in left-to-right or top-to-bottom order.
4. Each object MUST have its own unique invoice_number, invoice_date, and amounts. If two objects end up with the same invoice_number — you made an error: re-examine the image carefully.
5. Common layouts: two invoices side by side (左右兩張), same paper vertically split, or physically stacked/stapled scans.

**SPECIAL CASE — NARROW THERMAL RECEIPT (二聯收銀) NEXT TO ANOTHER INVOICE**:
A very common layout in expense reports: a narrow thermal strip receipt (長條型二聯收銀, T500, e.g. from parking lots, shoe stores, gas stations) is placed or taped NEXT TO a larger invoice (e.g. 電子發票證明聯 or 三聯手寫). In this layout:
- The narrow strip on the LEFT (or RIGHT) is a SEPARATE invoice — extract it independently with its own invoice_number and amounts (合計/總計 printed on the strip).
- Do NOT let the larger invoice's amounts bleed into the narrow strip's fields.
- Even if the narrow strip's text is small or compressed, zoom in and read the 合計 or 總計 line carefully.
- Return TWO separate JSON objects: one for each physical document.

**DATA INTEGRITY CHECK**: Before returning, verify:
- Do all returned invoice_numbers look distinct from each other? If not, re-read that invoice area.
- Does each object's amount_total match what is printed in ITS OWN 總計 cell?

**MULTI-PAGE PDF RULE**: This document may contain multiple pages. Even if page 1 is a delivery note (訂單出貨憑證 / 出貨通知單), you MUST check every subsequent page for a 統一發票. Extract the invoice from whichever page it appears on. Only output NOT_INVOICE if NO page in the entire document contains a 統一發票 form.

**EMBEDDED INVOICE IMAGES / PHOTOCOPIED STUBS (CRITICAL)**: A page may contain photocopied, scanned, or printed-as-image invoice stubs — typically 收銀機統一發票 (cash register / 三聯式) thumbnails pasted or scanned alongside a delivery note. These are NOT decoration, NOT thumbnails, NOT illustrations. They ARE real, independent invoices that MUST be extracted as their own JSON objects with their own invoice_number, invoice_date, seller_name, seller_tax_id, amount_sales, amount_tax, amount_total. Indicators that a region is an embedded real invoice (not decoration):
- Contains a readable 發票號碼 (e.g. XW17220651 format: 2 letters + 8 digits)
- Contains 統一編號 / 統一發票 / 收銀機統一發票 wording
- Contains 總計 / 應稅銷售額 / 營業稅 fields with numbers
If you see N embedded invoice stubs on a page, the output array MUST include N corresponding objects — never collapse them into one, never skip them because they look small or low-res.

If the ENTIRE document (all pages) contains only generic unbillable documents (Packing List, delivery note with no invoice anywhere), set 'error_code' to 'NOT_INVOICE' and output 0 for all amounts. If image is blurry, set 'error_code' accordingly.`;

  if (expectedERP && (expectedERP.amount_total !== undefined || expectedERP.amount_sales !== undefined || expectedERP.amount_tax !== undefined)) {
    promptText += `\n\n[CROSS-CHECK REQUIRED]: The ERP system expects the following totals for this document:\n`;
    if (expectedERP.amount_total !== undefined) promptText += `- 總金額 (Total Amount): ${expectedERP.amount_total}\n`;
    if (expectedERP.amount_sales !== undefined) promptText += `- 銷售額合計 (Sales Amount): ${expectedERP.amount_sales}\n`;
    if (expectedERP.amount_tax !== undefined) promptText += `- 營業稅 (Tax Amount): ${expectedERP.amount_tax}\n`;
    promptText += `\nCRITICAL ANTI-HALLUCINATION RULE: You MUST visually verify these numbers are printed on the document.`;
    promptText += `\nIf your initial extraction DOES NOT match these expected ERP totals, you MUST re-examine the image carefully to see if you missed them.\n`;
    promptText += `HOWEVER, if you CANNOT see the number on the image, YOU MUST OUTPUT 0. DO NOT under any circumstances return the ERP number just because it was listed here if it is not printed on the document itself. DO NOT calculate difference to fill in "Tax".\n`;

    if (validationRetryCount > 0) {
      promptText += `\nNOTE: This is retry attempt ${validationRetryCount}/3. Previous extraction failed ERP validation. Look closer!\n`;
    }
  }

  return promptText;
}

function buildSystemPrompt(expectedERP?: ExpectedERP, validationRetryCount = 0): string {
  // ===== 動態 prompt 組合 =====
  // 稅別跟發票格式是綁定的：只要 ERP 告訴我們稅別，第一次 pass 就直接注入 type 模組，
  // 讓 Gemini 不需要自己分類，減少 T300/T302 等混淆。
  let systemPrompt = PROMPT_BASE;

  if (expectedERP?.tax_code) {
    // 無論是否是 retry，只要 ERP 已知稅別，就注入對應的 type module。
    // Type module 放在 base 之後，讓 Gemini 先讀 base rules，再讀 type-specific fingerprint。
    const typePrompt = getTypeSpecificPrompt(expectedERP.tax_code);
    if (typePrompt) systemPrompt += '\n\n' + typePrompt;
  } else {
    // 未知稅別：注入視覺分類樹 + 未知類型處理引導
    const registry = getRegistry();
    const unknownPrompt = buildUnknownTypePrompt(registry);
    systemPrompt += '\n\n' + unknownPrompt;
  }

  return systemPrompt;
}

let _supabaseSellersCache: { data: Record<string, string>; ts: number } | null = null;
const SELLER_CACHE_TTL_MS = 30 * 60 * 1000;

async function mergeSellerDB(knownSellers: Record<string, string>): Promise<Record<string, string>> {
  const now = Date.now();

  if (!_supabaseSellersCache || now - _supabaseSellersCache.ts >= SELLER_CACHE_TTL_MS) {
    let SUPABASE_SELLERS: Record<string, string> = {};
    try {
      const { fetchAllSellers } = await import('./supabaseService');
      SUPABASE_SELLERS = await fetchAllSellers();
    } catch (e) {
      console.warn('Failed to load Supabase seller DB', e);
    }
    _supabaseSellersCache = { data: SUPABASE_SELLERS, ts: now };
    console.log('[SellerDB] Supabase cache refreshed');
  }

  let STATIC_SELLERS: Record<string, string> = {};
  try {
    const db = await import('../src/data/seller_db.json');
    STATIC_SELLERS = (db as any).default || db;
  } catch (e) {
    console.warn('Failed to load seller_db.json', e);
  }

  // Merge priority: Static < ERP Excel < Supabase (Supabase wins)
  return { ...STATIC_SELLERS, ...knownSellers, ..._supabaseSellersCache!.data };
}

async function postProcessItems(
  results: InvoiceData[],
  base64Data: string,
  mimeType: string,
  modelName: string,
  expectedERP: ExpectedERP | undefined,
  text: string,
  usageData: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number; cost_usd: number } | undefined,
  MERGED_SELLERS: Record<string, string>
): Promise<InvoiceData[]> {
  return Promise.all(results.map(async (item) => {
    const logs: string[] = [`[${new Date().toISOString()}] Started processing`, `Model: ${modelName}`];

    // Inject usage data into each item (redundant but useful for item-level tracking)
    item.usage_metadata = usageData;
    item.raw_response = text; // Attach raw text for debugging

    // Default success if not specified
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
    // Flag when only 1 result extracted but image is wide enough to likely contain multiple invoices (aspect ratio > 1.8)
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

    // --- SYNC voucher_type from tax_code if AI didn't provide it ---
    if (!item.voucher_type) {
      item.voucher_type = syncVoucherType(item.tax_code as any) as any;
    }

    // --- TRANSIT TICKET DETECTION — normalize voucher_type and clear seller_tax_id ---
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
      // Transit tickets (高鐵電子車票等) only show the BUYER's tax ID (統一編號 = 清河 16547744).
      // There is no seller tax ID field — clear it to avoid misidentification.
      item.seller_tax_id = null;
      logs.push(`Transit ticket detected: forced voucher_type=交通票券, cleared seller_tax_id`);
    }

    // --- SKIP LOGIC for foreign Invoice ---
    if (isForeignInvoice(item.document_type) && item.error_code === ('SUCCESS' as any)) {
      item.error_code = 'NOT_INVOICE' as any;
      logs.push(`AUTO-SKIP: Foreign Invoice detected. Document is skipped (tax_code=TXXX, NOT_INVOICE).`);
    }


    // ===== SELLER TAX ID：DB 查詢 + Checksum 驗證 + 自動修正 =====
    const { validateTaiwanTaxId } = await import('../src/lib/taxIdValidator');
    const BUYER_TAX_IDS = ['16547744'];

    // Helper: 從 MERGED_SELLERS 查 seller_name → 找最接近的合法 tax_id
    const lookupSellerTaxId = (sellerName: string): string | undefined => {
      for (const [name, id] of Object.entries(MERGED_SELLERS)) {
        if (
          (sellerName.includes(name) || name.includes(sellerName)) &&
          validateTaiwanTaxId(id)
        ) return id;
      }
      return undefined;
    };

    // Step 1: 缺值 / 有 ? → DB 補值
    if (item.seller_name && (!item.seller_tax_id || item.seller_tax_id.includes('?'))) {
      const found = lookupSellerTaxId(item.seller_name);
      if (found) {
        logs.push(`Enriched seller_tax_id from DB: ${item.seller_tax_id ?? 'null'} → ${found}`);
        item.seller_tax_id = found;
      } else if (item.seller_tax_id?.includes('?')) {
        item.verification.flagged_fields.push('seller_tax_id');
        logs.push(`seller_tax_id has unclear digits, no DB match found`);
      }
    }

    // Step 2: 有值但 Checksum 驗失敗 → DB 自動修正
    if (item.seller_tax_id && /^\d{8}$/.test(item.seller_tax_id)) {
      if (!validateTaiwanTaxId(item.seller_tax_id)) {
        const wrong = item.seller_tax_id;
        const corrected = item.seller_name ? lookupSellerTaxId(item.seller_name) : undefined;
        if (corrected) {
          item.seller_tax_id = corrected;
          logs.push(`Auto-corrected seller_tax_id: ${wrong} → ${corrected} (checksum failed, DB lookup)`);
        } else {
          item.verification.flagged_fields.push('seller_tax_id');
          logs.push(`seller_tax_id ${wrong} failed checksum, no DB correction found`);
        }
      }
    }

    // Step 3: 合法的 seller_tax_id → 回存 Supabase（自動累積廠商庫）
    if (
      item.seller_name &&
      item.seller_tax_id &&
      /^\d{8}$/.test(item.seller_tax_id) &&
      !item.seller_tax_id.includes('?') &&
      !BUYER_TAX_IDS.includes(item.seller_tax_id) &&
      validateTaiwanTaxId(item.seller_tax_id)
    ) {
      try {
        const { upsertSeller } = await import('./supabaseService');
        await upsertSeller(item.seller_name, item.seller_tax_id, 'ocr');
        logs.push(`SellerDB: Upserted ${item.seller_name} (${item.seller_tax_id}) to Supabase`);
      } catch (e) {
        console.warn('[SellerDB] Auto-save failed', e);
      }
    }

    // ===== BUYER TAX ID：Checksum + 自動修正到本公司統編 =====
    // 台灣三聯/二聯式發票的買方一律是本公司 (16547744)。
    // OCR 誤讀（? 佔位 / checksum 失敗）→ 自動修正回正確值，不再 flag 為錯誤。
    const BUYER_COMPANY_TAX_ID = '16547744';
    const isTWInvoice = ['T300', 'T301', 'T302'].includes((item.tax_code || '').toUpperCase());
    if (isTWInvoice && item.buyer_tax_id) {
      const hasQmark = item.buyer_tax_id.includes('?');
      const isValid8Digits = /^\d{8}$/.test(item.buyer_tax_id);
      const failsChecksum = isValid8Digits && !validateTaiwanTaxId(item.buyer_tax_id);
      const isWrongBuyer = isValid8Digits && !hasQmark && item.buyer_tax_id !== BUYER_COMPANY_TAX_ID;

      if (hasQmark || failsChecksum) {
        // OCR 誤讀 → 自動修正
        logs.push(`Auto-corrected buyer_tax_id: ${item.buyer_tax_id} → ${BUYER_COMPANY_TAX_ID} (${hasQmark ? 'unclear digit' : 'checksum failed'})`);
        item.buyer_tax_id = BUYER_COMPANY_TAX_ID;
      } else if (isWrongBuyer) {
        // Checksum 合法但不是本公司 → 保留並 flag（可能是業務場合）
        item.verification.flagged_fields.push('buyer_tax_id');
        logs.push(`buyer_tax_id ${item.buyer_tax_id} ≠ expected ${BUYER_COMPANY_TAX_ID} (valid checksum, flagged for review)`);
      } else {
        logs.push(`buyer_tax_id OK: ${item.buyer_tax_id}`);
      }
    }

    // Rule 1: 清除發票號碼空白 + 轉大寫
    if (item.invoice_number) {
      const original = item.invoice_number;
      item.invoice_number = item.invoice_number.replace(/\s+/g, '').toUpperCase();
      if (original !== item.invoice_number) logs.push(`Rule 1: Cleaned invoice_number (${original} → ${item.invoice_number})`);
    }

    // Issue 12: invoice_number must not contain the buyer's own tax ID (16547744).
    // Real cases: G61-Q40142, G61-Q40092 — Gemini copies 買受人統一編號 into invoice_number.
    const BUYER_KNOWN_TAX_ID = '16547744';
    if (item.invoice_number && item.invoice_number.includes(BUYER_KNOWN_TAX_ID)) {
      if (!item.verification.flagged_fields.includes('invoice_number_is_buyer_tax_id')) {
        item.verification.flagged_fields.push('invoice_number_is_buyer_tax_id');
      }
      logs.push(`[Issue12] invoice_number '${item.invoice_number}' contains buyer_tax_id '${BUYER_KNOWN_TAX_ID}' — likely misread`);
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

    // Issue 13: invoice_date year sanity check — invoices should be from 2020–2030 era.
    // Catches ROC year misreads: 民國115 → mistakenly 105 → 2016.
    if (item.invoice_date) {
      const yearMatch = item.invoice_date.match(/^(\d{4})-/);
      if (yearMatch) {
        const year = parseInt(yearMatch[1], 10);
        if (year < 2020 || year > 2030) {
          if (!item.verification.flagged_fields.includes('invoice_date')) {
            item.verification.flagged_fields.push('invoice_date');
          }
          logs.push(`[Issue13] invoice_date year ${year} out of 2020–2030 range — likely ROC misread: ${item.invoice_date}`);
        }
      }
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

    // --- f) 信心度格式驗證 + 補預設值 ---
    normalizeFieldConfidence(item);
    logs.push(`[Confidence] Normalized field_confidence: inv=${item.field_confidence!.invoice_number.toFixed(2)} seller=${item.field_confidence!.seller_tax_id.toFixed(2)} total=${item.field_confidence!.amount_total.toFixed(2)}`);

    item.trace_logs = logs;
    return item;
  }));
}

/**
 * 驗證 Gemini 回傳的 confidence 分數是否與格式現實相符。
 * 若欄位值不符合格式正則，自動乘上懲罰係數（0.8）；
 * 特殊邊界情況（金額 = 0）上限壓到 0.5。
 * 若 Gemini 未回傳 confidence，預設保守值 0.7。
 */
function validateConfidenceScore(
  ocrValue: string | number | null | undefined,
  geminiConfidence: number | undefined,
  field: string
): number {
  const base = typeof geminiConfidence === 'number' ? Math.max(0, Math.min(1, geminiConfidence)) : 0.7;

  const formatChecks: Record<string, RegExp> = {
    invoice_number: /^[A-Z]{2}\d{8}$/,
    seller_tax_id: /^\d{8}$/,
    buyer_tax_id:  /^\d{8}$/,
    amount_sales:  /^\d+$/,
    amount_tax:    /^\d+$/,
    amount_total:  /^\d+$/,
    invoice_date:  /^\d{4}-\d{2}-\d{2}$/,
    tax_code:      /^T\d{3}$|^TXXX$/,
  };

  if (ocrValue === null || ocrValue === undefined || ocrValue === '') {
    // 值缺失 → 直接壓 0.5
    return Math.min(base, 0.5);
  }

  const valueStr = String(ocrValue);
  const regex = formatChecks[field];
  if (regex && !regex.test(valueStr)) {
    // 格式不合 → 扣 20%
    return base * 0.8;
  }

  // 金額欄位值為 0 永遠存疑
  if (['amount_sales', 'amount_tax', 'amount_total'].includes(field) && Number(ocrValue) === 0) {
    return Math.min(base, 0.5);
  }

  return base;
}

/**
 * 確保 field_confidence 每個欄位都存在，並套用格式驗證懲罰。
 * 若 Gemini 未回傳某欄位的 confidence，填入保守預設值 0.7 後再驗證。
 */
function normalizeFieldConfidence(item: InvoiceData): void {
  if (!item.field_confidence) {
    item.field_confidence = {
      invoice_number: 0.7,
      invoice_date: 0.7,
      seller_name: 0.7,
      seller_tax_id: 0.7,
      currency: 0.7,
      amount_sales: 0.7,
      amount_tax: 0.7,
      amount_total: 0.7,
    };
  }

  const fc = item.field_confidence;

  // 對每個關鍵欄位套用格式驗證後重新賦值
  fc.invoice_number = validateConfidenceScore(item.invoice_number, fc.invoice_number, 'invoice_number');
  fc.invoice_date   = validateConfidenceScore(item.invoice_date,   fc.invoice_date,   'invoice_date');
  fc.seller_tax_id  = validateConfidenceScore(item.seller_tax_id,  fc.seller_tax_id,  'seller_tax_id');
  fc.amount_sales   = validateConfidenceScore(item.amount_sales,   fc.amount_sales,   'amount_sales');
  fc.amount_tax     = validateConfidenceScore(item.amount_tax,     fc.amount_tax,     'amount_tax');
  fc.amount_total   = validateConfidenceScore(item.amount_total,   fc.amount_total,   'amount_total');
  // seller_name / currency 只補預設值，不做格式正則（自由文字）
  fc.seller_name = typeof fc.seller_name === 'number' ? fc.seller_name : 0.7;
  fc.currency    = typeof fc.currency    === 'number' ? fc.currency    : 0.7;
}

function deduplicateResults(results: InvoiceData[]): InvoiceData[] {
  // --- Deduplicate ghost results & filter mixed NOT_INVOICE types ---
  // Check if the file contains at least one valid invoice (not a packing list or empty document)
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
      // If file contains a real invoice, drop this generic page entirely (e.g., packing list attached to invoice)
      if (hasValidInvoice) {
        console.log(`[Dedup] Dropping ${item.document_type} page because a valid invoice exists in the same file.`);
        return false;
      }
      // Keep it but mark as NOT_INVOICE for UI clarity and ZERO out amounts
      item.error_code = 'NOT_INVOICE' as any;
      item.amount_sales = 0;
      item.amount_tax = 0;
      item.amount_total = 0;
      return true;
    }
    if (!item.invoice_number) {
      // Ghost: has amounts but no invoice number — check if a real duplicate with same total exists
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
    // Exact duplicate: same invoice_number already seen at an earlier index — drop the repeat
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

export const analyzeInvoice = async (
  base64Data: string,
  mimeType: string,
  modelName: string = 'gemini-1.5-flash',
  retryCount = 0,
  knownSellers: Record<string, string> = {},
  expectedERP?: ExpectedERP,
  validationRetryCount = 0,
  skipValidationRetry = false
): Promise<InvoiceData[]> => {
  const useDirectAPI = import.meta.env.VITE_USE_DIRECT_API === 'true';

  const effectiveModel = modelName.includes('hybrid') ? 'gemini-3-flash-preview' : modelName;
  const cleanBase64 = base64Data.split(',')[1] || base64Data;
  const promptText = buildPromptText(expectedERP, validationRetryCount);
  const systemPrompt = buildSystemPrompt(expectedERP, validationRetryCount);

  try {
    let text: string | null = null;
    let usageData: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number; cost_usd: number } | undefined;

    if (useDirectAPI) {
      // Local dev: call Gemini directly (API key stays out of production bundle)
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.API_KEY;
      const ai = new GoogleGenAI({ apiKey: apiKey as string });

      const response: GenerateContentResponse = await ai.models.generateContent({
        model: effectiveModel,
        contents: {
          parts: [
            { inlineData: { mimeType, data: cleanBase64 } },
            { text: promptText },
          ],
        },
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          responseSchema: responseSchema,
        },
      });

      text = response.text ?? null;
      const usage = response.usageMetadata;
      if (usage) {
        const inputPrice = 0.075 / 1000000;
        const outputPrice = 0.30 / 1000000;
        usageData = {
          promptTokenCount: usage.promptTokenCount,
          candidatesTokenCount: usage.candidatesTokenCount,
          totalTokenCount: usage.totalTokenCount,
          cost_usd: (usage.promptTokenCount * inputPrice) + (usage.candidatesTokenCount * outputPrice),
        };
      }
    } else {
      // Production: call via Supabase Edge Function proxy
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const supabase = createClient(supabaseUrl, supabaseAnonKey);

      const { data, error } = await supabase.functions.invoke('gemini-ocr-proxy', {
        body: {
          model: effectiveModel,
          mimeType,
          base64Data: cleanBase64,
          promptText,
          systemPrompt,
          responseSchema,
        },
      });

      if (error) throw new Error(`Proxy error: ${error.message} | context: ${error.context?.message ?? ''} | status: ${(error as any).status ?? ''}`);
      text = data?.text ?? null;
      if (data?.usageMetadata) {
        const usage = data.usageMetadata;
        const inputPrice = 0.075 / 1000000;
        const outputPrice = 0.30 / 1000000;
        usageData = {
          promptTokenCount: usage.promptTokenCount ?? 0,
          candidatesTokenCount: usage.candidatesTokenCount ?? 0,
          totalTokenCount: usage.totalTokenCount ?? 0,
          cost_usd: ((usage.promptTokenCount ?? 0) * inputPrice) + ((usage.candidatesTokenCount ?? 0) * outputPrice),
        };
      }
    }

    if (!text) {
      console.warn("AI returned empty response text.");
      return [];
    }

    const parsedData = JSON.parse(text);

    let results: InvoiceData[] = [];
    // Ensure the final output is always an array for consistent handling downstream.
    if (Array.isArray(parsedData)) {
      results = parsedData;
    } else if (typeof parsedData === 'object' && parsedData !== null) {
      results = [parsedData];
    }

    const MERGED_SELLERS = await mergeSellerDB(knownSellers);

    results = await postProcessItems(results, base64Data, mimeType, modelName, expectedERP, text, usageData, MERGED_SELLERS);
    results = deduplicateResults(results);

    // --- Hybrid Auto-Escalation Logic (Tier 1 Flash → Tier 2 Pro) ---
    // Only triggered when user selected a *-hybrid model option.
    if (modelName.includes('hybrid')) {
      // Only escalate for valid invoices (not receipts/tickets/packing lists)
      const validResults = results.filter(r => r.error_code !== 'NOT_INVOICE' && r.tax_code !== 'TXXX');
      const needsEscalation = validResults.length > 0 && validResults.some(r => {
        // Arithmetic check: sales + tax ≠ total (core logic failure)
        const arithmeticFail = r.amount_total > 0 && r.amount_sales > 0 &&
          Math.abs((r.amount_sales + r.amount_tax) - r.amount_total) > 1;
        // Missing invoice number on a document that should have one
        const missingInvNo = !r.invoice_number && r.tax_code !== 'TXXX' && r.tax_code !== 'T500';
        // AI itself flagged low confidence
        const lowConfidence = r.verification.ai_confidence < 70;
        return arithmeticFail || missingInvNo || lowConfidence || !r.verification.logic_is_valid;
      });

      if (needsEscalation) {
        console.log(`[Auto-Escalation] Tier-1 failed (${effectiveModel}). Escalating to gemini-2.5-pro...`);
        const proResults = await analyzeInvoice(base64Data, mimeType, 'gemini-2.5-pro', retryCount, knownSellers, expectedERP, validationRetryCount, true);
        return proResults.map(item => {
          item.trace_logs = [`[System] Escalated: ${effectiveModel} → gemini-2.5-pro`, ...(item.trace_logs || [])];
          return item;
        });
      }
    }

    // --- ERP Crosscheck Validation Retry Logic ---
    // skipValidationRetry=true when coming from hybrid escalation to prevent double Pro upgrade
    if (expectedERP && validationRetryCount < 1 && !skipValidationRetry) { // STRICT CAP: Only try once to save time
      // Only check amounts against valid invoices
      const validInvoices = results.filter(r => r.document_type !== '非發票' && r.error_code !== 'NOT_INVOICE');

      // SMART GUARD: If the first pass found NO valid invoices (e.g., blurry, packing list),
      // DO NOT escalate to Pro. Escalating is a waste of time for non-invoices.
      if (validInvoices.length > 0) {
        const ocrTotalSum = validInvoices.reduce((sum, inv) => sum + (inv.amount_total || 0), 0);
        const ocrSalesSum = validInvoices.reduce((sum, inv) => sum + (inv.amount_sales || 0), 0);
        const ocrTaxSum = validInvoices.reduce((sum, inv) => sum + (inv.amount_tax || 0), 0);

        let hasMismatch = false;
        const mismatchLogs = [];

        if (expectedERP.amount_total !== undefined && expectedERP.amount_total !== 0 && Math.abs(ocrTotalSum - expectedERP.amount_total) > 1) {
          hasMismatch = true;
          mismatchLogs.push(`Total mismatch (OCR: ${ocrTotalSum}, ERP: ${expectedERP.amount_total})`);
        }
        if (expectedERP.amount_sales !== undefined && expectedERP.amount_sales !== 0 && Math.abs(ocrSalesSum - expectedERP.amount_sales) > 1) {
          hasMismatch = true;
          mismatchLogs.push(`Sales mismatch (OCR: ${ocrSalesSum}, ERP: ${expectedERP.amount_sales})`);
        }
        if (expectedERP.amount_tax !== undefined && expectedERP.amount_tax !== 0 && Math.abs(ocrTaxSum - expectedERP.amount_tax) > 1) {
          hasMismatch = true;
          mismatchLogs.push(`Tax mismatch (OCR: ${ocrTaxSum}, ERP: ${expectedERP.amount_tax})`);
        }

        // 多張發票憑證：OCR 取出的數量少於 ERP 期望數量，也觸發 Pro 升級
        const countMismatch =
          expectedERP.invoice_numbers &&
          expectedERP.invoice_numbers.length > 1 &&
          validInvoices.filter(r => r.invoice_number).length < expectedERP.invoice_numbers.length;

        if (countMismatch && !hasMismatch) {
          hasMismatch = true;
          mismatchLogs.push(
            `Count mismatch: ERP expects ${expectedERP.invoice_numbers!.length} invoices, OCR found ${validInvoices.filter(r => r.invoice_number).length}`,
          );
        }

        if (hasMismatch) {
          console.log(`[Validation Retry] ERP mismatch detected: ${mismatchLogs.join(', ')}. Attempt ${validationRetryCount + 1}/1 with gemini-2.5-pro...`);

          // ESCALATION: Use the much smarter (but slower) Pro model for the single validation retry
          const nextModel = 'gemini-2.5-pro';

          // Recursive call with Pro model
          const retryResults = await analyzeInvoice(base64Data, mimeType, nextModel, retryCount, knownSellers, expectedERP, validationRetryCount + 1);

          // Prepend escalation log to trace_logs
          return retryResults.map(item => {
            const log = `[System] Escapated to PRO (Attempt ${validationRetryCount + 1}) due to ERP mismatch: ${mismatchLogs.join(', ')}.`;
            item.trace_logs = [log, ...(item.trace_logs || [])];
            return item;
          });
        }
      } else {
        console.log(`[Validation Guard] Skipping Pro escalation because no valid invoice data was found initially.`);
      }
    }

    // ===== LOG: Final Results Summary =====
    console.log("[GEMINI] ===== FINAL RESULTS =====");
    console.log("[GEMINI] Total invoices returned:", results.length);
    console.log("[GEMINI] Invoice numbers:", results.map(r => r.invoice_number || '(blank)').join(", "));
    console.log("[GEMINI] Tax codes:", results.map(r => r.tax_code || 'N/A').join(", "));
    console.log("[GEMINI] Amounts (total):", results.map(r => r.amount_total || 0).join(", "));
    if (expectedERP) {
      console.log("[GEMINI] ERP expects:", expectedERP.invoice_numbers?.join(", ") || 'N/A', "| tax_code:", expectedERP.tax_code, "| amount:", expectedERP.amount_total);
    }
    console.log("[GEMINI] ===== END GEMINI LOG =====");

    return results;

  } catch (err: any) {
    // Retry logic for 429 (Too Many Requests) or 5xx Server Errors
    const isRetryable = err?.message?.includes('429') || err?.status === 503 || err?.status === 500;

    if (isRetryable && retryCount < 3) { // Reduced max retries
      // Exponential backoff: 1s, 2s, 4s
      const waitTime = Math.pow(2, retryCount) * 1000 + (Math.random() * 500);
      console.log(`API Busy/Error. Retrying in ${Math.round(waitTime)}ms (Attempt ${retryCount + 1}/3)`);
      await sleep(waitTime);
      return analyzeInvoice(base64Data, mimeType, modelName, retryCount + 1, knownSellers, expectedERP, validationRetryCount, skipValidationRetry);
    }
    console.error("Error analyzing invoice:", err);
    throw err;
  }
};
