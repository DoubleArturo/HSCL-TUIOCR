
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { InvoiceData } from "../types";

const SYSTEM_INSTRUCTION = `
Role Definition: You are a detailed-oriented Taiwanese Audit Expert (台灣資深會計審計員) specializing in digitizing "Uniform Invoices" (三聯式發票).
Target: Extract structured data for ALL invoices found in the provided image or PDF document. Return a JSON array of invoice objects.

Critical Extraction Rules:
1. **Invoice Number**: Remove ALL whitespace. (e.g. "XX 12345678" -> "XX12345678").
2. **Buyer Tax ID (買方統編)**: Look for "買受人統一編號" or usually the upper tax ID box.
3. **Seller Tax ID (賣方統編)**: Look for "統一編號" inside the stamp. **CRITICAL**: If digits are blurry, blocked, or unclear, output "?" for those digits. Do NOT guess or hallucinate. Example: "23?456?8".
4. **Amounts**: ensure Sales + Tax = Total (±1 TWD tolerance).
5. **Dates**: Convert ROC year to Gregorian (e.g. 114/05/01 -> 2025-05-01).

Confidence Scoring:
- For EACH field extracted, assign a confidence score (0-100).
`;

const invoiceObjectSchema = {
  type: Type.OBJECT,
  properties: {
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
    }
  },
  required: ["invoice_number", "invoice_date", "buyer_tax_id", "seller_name", "seller_tax_id", "amount_sales", "amount_tax", "amount_total", "has_stamp", "verification", "field_confidence"]
};

const responseSchema = {
  type: Type.ARRAY,
  items: invoiceObjectSchema,
};

// 輔助函式：等待
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const analyzeInvoice = async (base64Data: string, mimeType: string, retryCount = 0): Promise<InvoiceData[]> => {
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

    const response: GenerateContentResponse = await ai.models.generateContent({
      // Use gemini-2.5-flash for high speed and low cost, suitable for OCR tasks.
      model: 'gemini-2.5-flash',
      contents: { 
        parts: [
          contentPart, 
          { text: "Extract all invoice data. STRICTLY remove spaces from invoice numbers. Use '?' for any unclear digits in Tax IDs." }
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

    const parsedData = JSON.parse(text);

    let results: InvoiceData[] = [];
    // Ensure the final output is always an array for consistent handling downstream.
    if (Array.isArray(parsedData)) {
        results = parsedData;
    } else if (typeof parsedData === 'object' && parsedData !== null) {
        results = [parsedData];
    }
    
    // Post-processing to enforce business rules
    results = results.map(item => {
        // Rule 1: Force remove all whitespaces from Invoice Number
        if (item.invoice_number) {
            item.invoice_number = item.invoice_number.replace(/\s+/g, '').toUpperCase();
        }

        // Rule 2: Check for '?' in Seller Tax ID and flag it
        if (item.seller_tax_id && item.seller_tax_id.includes('?')) {
            if (!item.verification.flagged_fields.includes('seller_tax_id')) {
                item.verification.flagged_fields.push('seller_tax_id');
            }
        }
        
        return item;
    });

    return results;
    
  } catch (err: any) {
    // Retry logic for 429 (Too Many Requests) or 5xx Server Errors
    const isRetryable = err?.message?.includes('429') || err?.status === 503 || err?.status === 500;
    
    if (isRetryable && retryCount < 5) { // Increased max retries for bulk processing
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      const waitTime = Math.pow(2, retryCount) * 1000 + (Math.random() * 500); 
      console.log(`API Busy/Error. Retrying in ${Math.round(waitTime)}ms (Attempt ${retryCount + 1}/5)`);
      await sleep(waitTime);
      return analyzeInvoice(base64Data, mimeType, retryCount + 1);
    }
    console.error("Error analyzing invoice:", err);
    throw err;
  }
};
