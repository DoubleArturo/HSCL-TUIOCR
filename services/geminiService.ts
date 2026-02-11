import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { InvoiceData } from "../types";
import { validateTaxIdWithVision } from './visionService';

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
1. **"Invoice"** - If the document contains the word "INVOICE" (English)
2. **"進口報關"** - If the document contains "進口報單" or "海關" text
3. **"統一發票"** - Standard Taiwan GUI (2 Letters + 8 Digits invoice number format)
4. **"非發票"** - Anything else (e.g., Packing List, Receipt, Purchase Order)

**Rules**:
- If both "Invoice" and "進口報關" appear → Output "Invoice"
- If only "進口報關" appears → Output "進口報關"
- If standard Taiwan GUI format → Output "統一發票"
- If none of above → Output "非發票"

### 1. Unified Business No. (Unifying/Buyer Tax ID) Priority
- **CRITICAL**: The Buyer Tax ID (買方統編) is widely expected to be **"16547744"**.
- If the handwritten or printed text looks remotely like "16547744" (e.g., "16547744", "I6547744", "16541744"), **OUTPUT "16547744"**.
- Priority: If there is ambiguity, prefer "16547744" over other interpretations.

### 1.1 Handwriting & Grid Handling (IMPORTANT)
- **Ignore Grid Lines**: The document often contains **blue or printed grid boxes** for the Tax ID. Treat these vertical/horizontal lines as background noise.
- **Focus on Ink**: Pay attention only to the **handwritten black/dark ink** inside the boxes.
- **Do not read lines as '1' or 'I'**: Vertical separators `| ` are NOT the digit 1.
- **Layout**: If digits are separated by boxes (e.g., `| 1 | 6 | 5 | `), concatenate them into a single string "165".

### 2. Field Extraction Rules
- **Invoice Number**: Must be 2 English Letters + 8 Digits (e.g., AB-12345678). Remove strict spaces.
- **Date**: Normalize to YYYY-MM-DD. Handle ROC years (e.g., 113/05/01 -> 2024-05-01).
- **Tax IDs**: Must be 8 digits.
- **Orientation**: Auto-detect rotation. Identify the main invoice if multiple are present (e.g. A3 scan).

### 3. Output Format
Return ONLY valid JSON matching the schema.
Confidence Scoring: For EACH field, assign a score (0-100).
`;

// Helper: Levenshtein Distance for Fuzzy Matching
const levenshteinDistance = (a: string, b: string): number => {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
  for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) == a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1,   // insertion
            matrix[i - 1][j] + 1    // deletion
          )
        );
      }
    }
  }
  return matrix[b.length][a.length];
};

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
    buyer_tax_id: { type: "STRING", description: "The Tax ID of the Buyer (買方/買受人)" },
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
        buyer_tax_id: { type: "NUMBER" },
        seller_name: { type: "NUMBER" },
        seller_tax_id: { type: "NUMBER" },
        amount_sales: { type: "NUMBER" },
        amount_tax: { type: "NUMBER" },
        amount_total: { type: "NUMBER" }
      },
      required: ["invoice_number", "invoice_date", "buyer_tax_id", "seller_name", "seller_tax_id", "amount_sales", "amount_tax", "amount_total"]
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

    const response: GenerateContentResponse = await ai.models.generateContent({
      model: effectiveModel, // Use the real model name (stripped of hybrid suffix)
      contents: {
        parts: [
          contentPart,
          { text: "Extract all invoice data. If image is blurry or not an invoice, set 'error_code' accordingly." }
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

      // B. Buyer Tax ID Validation & Fuzzy Auto-Correction
      const EXPECTED_BUYER_ID = "16547744";
      let needsVisionValidation = false;
      let fuzzyMatchApplied = false;

      if (item.buyer_tax_id) {
        let cleanBuyerId = item.buyer_tax_id.replace(/\D/g, '');

        // Exact Match
        if (cleanBuyerId === EXPECTED_BUYER_ID) {
          // Good, nothing to do
        } else {
          // Fuzzy Match: Check Levenshtein Distance
          const dist = levenshteinDistance(cleanBuyerId, EXPECTED_BUYER_ID);
          // If distance is small (<= 3) and length is somewhat similar, Auto-Correct
          if (dist <= 3 && Math.abs(cleanBuyerId.length - EXPECTED_BUYER_ID.length) <= 1) {
            const oldId = item.buyer_tax_id;
            item.buyer_tax_id = EXPECTED_BUYER_ID;
            cleanBuyerId = EXPECTED_BUYER_ID; // Update for verification check below
            logs.push(`Auto-Correction: Fuzzy Match Fixed Buyer ID (${oldId} -> ${EXPECTED_BUYER_ID}, dist=${dist})`);
            fuzzyMatchApplied = true;
            needsVisionValidation = true; // Double-check with Vision API
          } else {
            // Real Error - definitely needs Vision validation
            needsVisionValidation = true;
            item.verification.flagged_fields.push('buyer_tax_id');
            logs.push(`Validation Fail: Buyer ID is ${cleanBuyerId}, expected ${EXPECTED_BUYER_ID}`);
          }
        }
      } else {
        // Missing buyer tax ID - flag for Vision check
        needsVisionValidation = true;
        logs.push(`Buyer Tax ID missing - will attempt Vision API extraction`);
      }

      // B2. Vision API Cross-Validation (Phase 2 Enhancement)
      if (needsVisionValidation) {
        try {
          logs.push(`[Vision API] Initiating cross-validation for Buyer Tax ID`);
          const visionResult = await validateTaxIdWithVision(base64Data, EXPECTED_BUYER_ID, mimeType);

          if (visionResult.extractedId) {
            logs.push(`[Vision API] Extracted: ${visionResult.extractedId}, Confidence: ${visionResult.confidence}%`);

            // Case 1: Vision API confirms Gemini's result
            if (visionResult.extractedId === item.buyer_tax_id) {
              logs.push(`[Vision API] Confirmed Gemini result: ${item.buyer_tax_id}`);
              // Remove flag if both agree
              if (fuzzyMatchApplied) {
                const flagIndex = item.verification.flagged_fields.indexOf('buyer_tax_id');
                if (flagIndex > -1) {
                  item.verification.flagged_fields.splice(flagIndex, 1);
                }
              }
            }
            // Case 2: Vision API disagrees - prefer Vision for handwriting
            else {
              const oldValue = item.buyer_tax_id;
              item.buyer_tax_id = visionResult.extractedId;
              logs.push(`[Vision API] Corrected Buyer ID: ${oldValue} -> ${visionResult.extractedId}`);

              // If Vision API result matches expected, remove flag
              if (visionResult.extractedId === EXPECTED_BUYER_ID) {
                const flagIndex = item.verification.flagged_fields.indexOf('buyer_tax_id');
                if (flagIndex > -1) {
                  item.verification.flagged_fields.splice(flagIndex, 1);
                }
              }
            }
          } else {
            logs.push(`[Vision API] Could not extract Buyer Tax ID`);
          }
        } catch (visionError: any) {
          // Vision API failed - keep Gemini result
          logs.push(`[Vision API] Error: ${visionError.message || 'Unknown error'}`);
          console.warn('[Vision API] Validation failed, using Gemini result:', visionError);
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

      // Rule 3: Validating Amounts
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

      if (Math.abs((sales + tax) - item.amount_total) > 1) {
        logs.push(`Rule 3: Amount Mismatch detected (Sales ${sales} + Tax ${tax} != Total ${item.amount_total})`);
        item.verification.logic_is_valid = false;
      } else {
        logs.push(`Rule 3: Amount Logic Valid`);
      }

      item.trace_logs = logs;
      return item;
    }));

    // Assign processed results back
    results = processedResults;

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
