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
  let systemPrompt = PROMPT_BASE;

  // 如果是重試且 expectedERP 有 tax_code，載入對應類型的詳細 prompt
  if (validationRetryCount > 0 && expectedERP?.tax_code) {
    const typePrompt = getTypeSpecificPrompt(expectedERP.tax_code);
    if (typePrompt) systemPrompt += '\n\n' + typePrompt;
  }

  // 沒有已知 tax_code 時，載入 unknown 類型的引導
  if (!expectedERP?.tax_code) {
    const registry = getRegistry();
    const unknownPrompt = buildUnknownTypePrompt(registry);
    systemPrompt += '\n\n' + unknownPrompt;
  }

  return systemPrompt;
}

async function mergeSellerDB(knownSellers: Record<string, string>): Promise<Record<string, string>> {
  // Load Static Seller DB once
  let STATIC_SELLERS: Record<string, string> = {};
  try {
    const db = await import('../src/data/seller_db.json');
    STATIC_SELLERS = db.default || db;
  } catch (e) {
    console.warn('Failed to load seller_db.json', e);
  }

  // TODO: N+1 issue — fetchAllSellers is called once per analyzeInvoice invocation.
  // Consider caching at the App level and passing in as a parameter.
  // Load Supabase dynamic seller DB (highest priority)
  let SUPABASE_SELLERS: Record<string, string> = {};
  try {
    const { fetchAllSellers } = await import('./supabaseService');
    SUPABASE_SELLERS = await fetchAllSellers();
  } catch (e) {
    console.warn('Failed to load Supabase seller DB', e);
  }

  // Merge: Static < ERP Excel < Supabase (Supabase wins)
  return { ...STATIC_SELLERS, ...knownSellers, ...SUPABASE_SELLERS };
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


    // A. Seller Tax ID Logic (Database Lookup)
    // If we extracted a name but ID is unclear, try to find in DB
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

    // C. Unified Invoice Format Validation (GUI Rule)
    // Rule: 2 Uppercase Letters + 8 Digits
    if (item.invoice_number) {
      const cleanInv = item.invoice_number.replace(/[^A-Z0-9]/g, '');
      // Regex: Starts with 2 letters, followed by 8 digits
      const guiRegex = /^[A-Z]{2}\d{8}$/;
      // Only apply strict warning if it looks like a Standard GUI (not 'INV-...' style)
      if (!item.invoice_number.startsWith('INV') && !item.invoice_number.includes('-')) {
        if (!guiRegex.test(cleanInv)) {
          logs.push(`Warning: Invoice Number ${cleanInv} does not match standard Taiwan GUI format (2 Letters + 8 Digits)`);
          // We don't fail validation yet, just warn/cloud log, unless confidence is low
        }
      }
    }

    // Rule 1: Force remove all whitespaces from Invoice Number
    if (item.invoice_number) {
      const original = item.invoice_number;
      item.invoice_number = item.invoice_number.replace(/\s+/g, '').toUpperCase();
      if (original !== item.invoice_number) logs.push(`Rule 1: Cleaned Invoice Number (${original} -> ${item.invoice_number})`);
    }

    // Rule 2: Check for '?' in Seller Tax ID and flag it
    if (item.seller_tax_id && item.seller_tax_id.includes('?')) {
      if (!item.verification.flagged_fields.includes('seller_tax_id')) {
        item.verification.flagged_fields.push('seller_tax_id');
        logs.push(`Rule 2: Flagged unclear Seller Tax ID (${item.seller_tax_id})`);
      }
    }

    // Rule 2b: Validate Taiwan tax ID checksum (mod-5 rule, post-2023 amendment)
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
