import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
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
Confidence Scoring:
- For EACH field extracted, assign a confidence score (0-100).
`;

const invoiceObjectSchema = {
  type: Type.OBJECT,
  properties: {
    error_code: { type: Type.STRING, enum: ["SUCCESS", "BLURRY", "NOT_INVOICE", "PARTIAL", "UNKNOWN"] },
    invoice_number: { type: Type.STRING },
    invoice_date: { type: Type.STRING },
    buyer_tax_id: { type: Type.STRING, description: "The Tax ID of the Buyer (買方/買受人)" },
    seller_name: { type: Type.STRING },
    seller_tax_id: { type: Type.STRING, description: "The Tax ID of the Seller (賣方). Use '?' for unclear digits." },
    amount_sales: { type: Type.INTEGER },
    amount_tax: { type: Type.INTEGER },
    amount_total: { type: Type.INTEGER },
    has_stamp: { type: Type.BOOLEAN },
    verification: {
      type: Type.OBJECT,
      properties: {
        ai_confidence: { type: Type.NUMBER },
        logic_is_valid: { type: Type.BOOLEAN },
        flagged_fields: { type: Type.ARRAY, items: { type: Type.STRING } }
      },
      required: ["ai_confidence", "logic_is_valid", "flagged_fields"]
    },
    field_confidence: {
      type: Type.OBJECT,
      properties: {
        invoice_number: { type: Type.NUMBER },
        invoice_date: { type: Type.NUMBER },
        buyer_tax_id: { type: Type.NUMBER },
        seller_name: { type: Type.NUMBER },
        seller_tax_id: { type: Type.NUMBER },
        amount_sales: { type: Type.NUMBER },
        amount_tax: { type: Type.NUMBER },
        amount_total: { type: Type.NUMBER }
      },
      required: ["invoice_number", "invoice_date", "buyer_tax_id", "seller_name", "seller_tax_id", "amount_sales", "amount_tax", "amount_total"]
    },
    usage_metadata: {
      type: Type.OBJECT,
      properties: {
        promptTokenCount: { type: Type.NUMBER },
        candidatesTokenCount: { type: Type.NUMBER },
        totalTokenCount: { type: Type.NUMBER },
        cost_usd: { type: Type.NUMBER }
      }
    }
  },
  // We make most fields optional to support error cases, but verification is required
  required: ["verification", "field_confidence"]
};

const responseSchema = {
  type: Type.ARRAY,
  items: invoiceObjectSchema,
};

// 輔助函式：等待
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const analyzeInvoice = async (base64Data: string, mimeType: string, modelName: string = 'gemini-1.5-flash', retryCount = 0, knownSellers: Record<string, string> = {}): Promise<InvoiceData[]> => {
  // Support both process.env.GEMINI_API_KEY (User instruction) and process.env.API_KEY (System standard)
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;

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
    results = results.map(item => {
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

      // B. Buyer Tax ID Validation (Fixed Requirement)
      const EXPECTED_BUYER_ID = "16547744";
      if (item.buyer_tax_id) {
        const cleanBuyerId = item.buyer_tax_id.replace(/\D/g, '');
        if (cleanBuyerId !== EXPECTED_BUYER_ID) {
          item.verification.flagged_fields.push('buyer_tax_id');
          logs.push(`Validation Fail: Buyer ID is ${cleanBuyerId}, expected ${EXPECTED_BUYER_ID}`);
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
