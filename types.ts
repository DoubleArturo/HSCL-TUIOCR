
export interface VerificationData {
  ai_confidence: number;
  logic_is_valid: boolean;
  flagged_fields: string[];
}

export interface FieldConfidence {
  invoice_number: number;
  invoice_date: number;
  buyer_tax_id: number; // New
  seller_name: number;
  seller_tax_id: number;
  amount_sales: number;
  amount_tax: number;
  amount_total: number;
}


export interface UsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  cost_usd?: number; // Calculated cost
}

export enum VerificationCode {
  SUCCESS = "SUCCESS",
  BLURRY = "BLURRY",
  NOT_INVOICE = "NOT_INVOICE",
  PARTIAL = "PARTIAL",
  UNKNOWN = "UNKNOWN"
}

export interface InvoiceData {
  document_type: '統一發票' | 'Invoice' | '進口報關' | '非發票'; // Document classification
  invoice_number: string | null;
  invoice_date: string | null;
  buyer_tax_id: string | null; // New: 買方統編
  seller_name: string;
  seller_tax_id: string | null;
  amount_sales: number;
  amount_tax: number;
  amount_total: number;
  has_stamp: boolean;
  verification: VerificationData;
  field_confidence: FieldConfidence;
  usage_metadata?: UsageMetadata; // New: Cost tracking
  error_code?: VerificationCode; // New: Error handling
  raw_response?: string; // New: Full AI JSON response text
  trace_logs?: string[]; // New: Step-by-step processing log
}

export interface InvoiceEntry {
  id: string; // This corresponds to the filename (e.g. "G61-PC0001")
  file: File;
  previewUrl: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'ERROR';
  data: InvoiceData[];
  error?: string;
}

export interface ERPRecord {
  voucher_id: string;      // 帳款單號 (Key)
  invoice_date: string;    // 發票日期
  invoice_numbers: string[];  // 發票號碼 (Array to support multiple invoices per voucher)
  seller_name: string;     // 廠商簡稱
  seller_tax_id: string;   // 廠商統一編號
  amount_sales: number;    // 未稅金額
  amount_tax: number;      // 稅額
  amount_total: number;    // 含稅金額
  raw_row: string[];
}

export enum AppStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  VIEWING_LIST = 'VIEWING_LIST',
  ERROR_REVIEW = 'ERROR_REVIEW'
}

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: string;
  invoiceCount: number;
  erpCount: number;
}

export interface Project {
  id: string;
  name: string;
  invoices: InvoiceEntry[];
  erpData: ERPRecord[];
  createdAt: string;
  updatedAt: string;
}
export interface ProcessingState {
  current: number;
  total: number;
  status: 'IDLE' | 'PROCESSING' | 'COMPLETED';
}
