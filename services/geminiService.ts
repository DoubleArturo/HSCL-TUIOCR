import { GoogleGenAI, GenerateContentResponse, Part } from "@google/genai";
import { InvoiceData } from "../types";

// Define process for Vite environment to avoid TS errors
declare const process: {
  env: {
    GEMINI_API_KEY?: string;
    API_KEY?: string;
    [key: string]: string | undefined;
  }
};

const SYSTEM_INSTRUCTION = `
You are an expert OCR system for Taiwanese Unified Invoices (GUI) and related business documents.
Your goal is to extract structured data from document images with 100% precision.

### 0. Document Type Classification (CRITICAL - First Step)
Before extracting any data, classify the document type:

**Priority Order** (if multiple types detected):
1. **"Invoice"** - If the document contains the word "INVOICE" (English, usually on commercial/import documents)
2. **"進口報關"** - If the document contains "進口報單" or "海關" text
3. **"統一發票"** - Any of the following:
   - Standard Taiwan GUI format (2 Letters + 8 Digits invoice number)
   - Contains "電子發票", "證明聯", "e-invoice", or "電子發票證明聯"
   - Contains QR codes (typically two QR codes on right side) with an 8-10 digit invoice number
   - Contains "載体", "隨載", "公共載体雲窾套" patterns
   - IMPORTANT: 電子發票證明聯 IS a type of 統一發票, NOT 非發票
4. **"非發票"** - **Mandatory Exclusion ONLY for**: "銷貨單" (Delivery Note), "出貨單", "Packing List", "出貨憑證", "估價單" - documents that are NOT receipt/invoice type at all.

**Rules**:
- Delivery Notes and Packing Lists MUST be "非發票" even if they contain money amounts.
- 電子發票證明聯 and 電子發票小票/業用發票 MUST be "統一發票".
- If both "Invoice" and "進口報關" appear → Output "Invoice"
- If only "進口報關" appears → Output "進口報關"
- If standard Taiwan GUI format or any 電子發票 keywords → Output "統一發票"
- If none of above → Output "非發票"

### 1. Field Extraction Rules
- **Invoice Number**: Must be 2 English Letters + 8 Digits (e.g., AB-12345678). Remove strict spaces.
- **Date**: Normalize to YYYY-MM-DD. Handle ROC years (e.g., 113/05/01 -> 2024-05-01).
- **Tax IDs**: Must be 8 digits.
- **Orientation**: Auto-detect rotation. Identify the main invoice if multiple are present (e.g. A3 scan).

### 2. Output Format
Return ONLY valid JSON matching the schema.
Confidence Scoring: For EACH field, assign a score (0-100).
`;



const invoiceObjectSchema = {
  type: "OBJECT",
  properties: {
    document_type: {
      type: "STRING",
      enum: ["統一發票", "Invoice", "進口報關", "非發票"],
      description: "Document classification. Priority: Invoice > 進口報關 > 統一發票 > 非發票"
    },
    error_code: { type: "STRING", enum: ["SUCCESS", "BLURRY", "NOT_INVOICE", "PARTIAL", "UNKNOWN"] },
    invoice_number: { type: "STRING" },
    invoice_date: { type: "STRING" },
    seller_name: { type: "STRING" },
    seller_tax_id: { type: "STRING", description: "The Tax ID of the Seller (賣方). Use '?' for unclear digits." },
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
        amount_sales: { type: "NUMBER" },
        amount_tax: { type: "NUMBER" },
        amount_total: { type: "NUMBER" }
      },
      required: ["invoice_number", "invoice_date", "seller_name", "seller_tax_id", "amount_sales", "amount_tax", "amount_total"]
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

export const analyzeInvoice = async (base64Data: string, mimeType: string, modelName: string = 'gemini-1.5-flash', retryCount = 0, knownSellers: Record<string, string> = {}): Promise<InvoiceData[]> => {
  // Support both process.env.GEMINI_API_KEY (User instruction) and process.env.API_KEY (System standard)
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.API_KEY;

  // Create a new GoogleGenAI instance right before making an API call 
  // to ensure it always uses the most up-to-date API key from the environment.
  const ai = new GoogleGenAI({ apiKey: apiKey as string });

  try {
    const contentPart = {
      inlineData: {
        mimeType: mimeType,
        data: base64Data.split(',')[1] || base64Data,
      },
    };

    const effectiveModel = modelName.includes('hybrid') ? 'gemini-2.5-flash' : modelName;

    // DEBUG LOGGING
    console.log("DEBUG GEMINI PAYLOAD:");
    console.log("Model:", effectiveModel);
    console.log("Typeof base64Data:", typeof base64Data);
    console.log("Base64Data Length:", base64Data.length);
    console.log("MimeType:", mimeType);
    console.log("ContentPart:", JSON.stringify(contentPart, null, 2));
    console.log("SystemInstruction (Type):", typeof SYSTEM_INSTRUCTION);


    const response: GenerateContentResponse = await ai.models.generateContent({
      model: effectiveModel, // Use the real model name (stripped of hybrid suffix)
      contents: {
        parts: [
          contentPart,
          { text: "Extract all invoice data. IMPORTANT: If the document contains MULTIPLE physical invoices (e.g. top and bottom halves, multiple stapled pages, or multiple invoice numbers), return EACH invoice as a SEPARATE object in the JSON array - do NOT merge them. If the document is a Delivery Note (銷貨單/出貨單) or Packing List, classify it as '非發票' and DO NOT extract invoice numbers or amounts. If image is blurry, set 'error_code' accordingly." }
        ]
      },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      },
    });

    const text = response.text;
    if (!text) {
      console.warn("AI returned empty response text.");
      return [];
    };

    const usage = response.usageMetadata;
    const inputPrice = 0.075 / 1000000; // $0.075 per 1M input tokens
    const outputPrice = 0.30 / 1000000; // $0.30 per 1M output tokens
    const cost = usage ? (usage.promptTokenCount * inputPrice) + (usage.candidatesTokenCount * outputPrice) : 0;

    const usageData = usage ? {
      promptTokenCount: usage.promptTokenCount,
      candidatesTokenCount: usage.candidatesTokenCount,
      totalTokenCount: usage.totalTokenCount,
      cost_usd: cost
    } : undefined;

    const parsedData = JSON.parse(text);

    let results: InvoiceData[] = [];
    // Ensure the final output is always an array for consistent handling downstream.
    if (Array.isArray(parsedData)) {
      results = parsedData;
    } else if (typeof parsedData === 'object' && parsedData !== null) {
      results = [parsedData];
    }

    // Load Static Seller DB once
    let STATIC_SELLERS: Record<string, string> = {};
    try {
      const db = await import('../src/data/seller_db.json');
      STATIC_SELLERS = db.default || db;
    } catch (e) {
      console.warn('Failed to load seller_db.json', e);
    }

    // Merge Static DB with Dynamic DB (Dynamic takes precedence)
    const MERGED_SELLERS = { ...STATIC_SELLERS, ...knownSellers };

    // Post-processing to enforce business rules
    const processedResults = await Promise.all(results.map(async (item) => {
      const logs: string[] = [`[${new Date().toISOString()}] Started processing`, `Model: ${modelName}`];

      // Inject usage data into each item (redundant but useful for item-level tracking)
      item.usage_metadata = usageData;
      item.raw_response = text; // Attach raw text for debugging

      // Default success if not specified
      if (!item.error_code) item.error_code = "SUCCESS" as any;
      logs.push(`Initial Error Code: ${item.error_code}`);

      // --- 4. DATA ENRICHMENT & VALIDATION (Business Logic) ---

      // A. Seller Tax ID Logic (Database Lookup)
      // If we extracted a name but ID is unclear, try to find in DB
      if (item.seller_name && (!item.seller_tax_id || item.seller_tax_id.includes('?'))) {
        for (const [name, id] of Object.entries(MERGED_SELLERS)) {
          if (item.seller_name.includes(name)) {
            item.seller_tax_id = id;
            logs.push(`Enriched: Found Seller Tax ID from DB (${name} -> ${id})`);
            break;
          }
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

      // Rule 3: Validating & Auto-Correcting Amounts (amount_total = amount_sales + amount_tax)
      const sales = item.amount_sales || 0;
      const tax = item.amount_tax || 0;
      const total = item.amount_total || 0;

      // Auto-Swap Logic: If Total < Tax, it's likely swapped
      if (total > 0 && total < tax) {
        const temp = total;
        item.amount_total = tax;
        item.amount_tax = temp;
        logs.push(`Fixed: Swapped Total (${temp}) and Tax (${total})`);
      }

      const calculatedTotal = (item.amount_sales || 0) + (item.amount_tax || 0);
      if (Math.abs((item.amount_total || 0) - calculatedTotal) > 1) {
        logs.push(`Rule 3: Amount Mismatch - auto-correcting total from ${item.amount_total} to ${calculatedTotal}`);
        item.amount_total = calculatedTotal;
        item.verification.logic_is_valid = true; // We fixed it
      } else {
        logs.push(`Rule 3: Amount Logic Valid`);
      }

      item.trace_logs = logs;
      return item;
    }));

    // Assign processed results back
    results = processedResults;

    // --- Deduplicate ghost results (null invoice_number with same amount as a real result) ---
    // Happens when multi-page TIFs include blank/carbon-copy pages that partially match real invoices
    results = results.filter((item, index) => {
      if (item.document_type === '非發票') {
        // Keep 非發票 but mark as NOT_INVOICE for UI clarity
        item.error_code = 'NOT_INVOICE' as any;
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
      return true;
    });

    // --- Hybrid Auto-Escalation Logic ---
    // Only enabled if the user explicitly selected the Hybrid option (modelName incl. 'hybrid')
    if (modelName.includes('hybrid')) {
      const needsEscalation = results.some(r =>
        r.error_code !== 'SUCCESS' ||
        !r.verification.logic_is_valid ||
        (r.invoice_number === undefined) // Missing critical field
      );

      if (needsEscalation) {
        console.log(`[Auto-Escalation] Validation failed with ${modelName}. Retrying with gemini-2.5-pro...`);

        // Recursive call with Pro model
        const proResults = await analyzeInvoice(base64Data, mimeType, 'gemini-2.5-pro', retryCount, knownSellers);

        // Append a log to the Pro result indicating it was an escalation
        return proResults.map(item => {
          const escalationLog = `[System] Auto-escalated from Hybrid Flash to Pro due to validation failure.`;
          item.trace_logs = [escalationLog, ...(item.trace_logs || [])];
          return item;
        });
      }
    }

    return results;

  } catch (err: any) {
    // Retry logic for 429 (Too Many Requests) or 5xx Server Errors
    const isRetryable = err?.message?.includes('429') || err?.status === 503 || err?.status === 500;

    if (isRetryable && retryCount < 3) { // Reduced max retries
      // Exponential backoff: 1s, 2s, 4s
      const waitTime = Math.pow(2, retryCount) * 1000 + (Math.random() * 500);
      console.log(`API Busy/Error. Retrying in ${Math.round(waitTime)}ms (Attempt ${retryCount + 1}/3)`);
      await sleep(waitTime);
      return analyzeInvoice(base64Data, mimeType, modelName, retryCount + 1, knownSellers);
    }
    console.error("Error analyzing invoice:", err);
    throw err;
  }
};
