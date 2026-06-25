import { PROMPT_T300 } from './prompts/T300';
import { PROMPT_T301 } from './prompts/T301';
import { PROMPT_T302 } from './prompts/T302';
import { PROMPT_T500 } from './prompts/T500';
import { PROMPT_TXXX } from './prompts/TXXX';

export function getTypeSpecificPrompt(tax_code?: string | null): string {
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

export const invoiceObjectSchema = {
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
  required: ["verification", "field_confidence"]
};

export const responseSchema = {
  type: "ARRAY",
  items: invoiceObjectSchema,
};
