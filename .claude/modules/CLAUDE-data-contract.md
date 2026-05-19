# 資料契約

## 核心 Interface

### InvoiceData（OCR 結果，單張發票）

```typescript
interface InvoiceData {
  document_type: string;           // '統一發票' | 'Invoice' | '進口報單' | '非發票' | ...
  voucher_type?: VoucherType;      // 三聯手寫 | 三聯收銀 | 三聯電子 | 二聯收銀 | 收據 | 車票 | Invoice | 其他
  tax_code: string | null;         // T300 | T301 | T302 | T400 | T500 | TXXX
  invoice_number: string | null;   // 台灣 GUI 格式：2 大寫字母 + 8 數字（已清除空格）
  invoice_date: string | null;     // YYYY-MM-DD（民國年已自動換算）
  seller_name: string;
  seller_tax_id: string | null;    // 8 位數字，含 '?' 代表模糊
  buyer_tax_id?: string | null;    // 買受人統一編號，8 位數字，含 '?' 代表模糊
  currency: string;                // 預設 'TWD'
  amount_sales: number;
  amount_tax: number;
  amount_total: number;
  has_stamp: boolean;
  manually_verified?: boolean;     // 使用者手動確認正確
  verification: VerificationData;
  field_confidence: FieldConfidence; // 各欄位 0-100
  error_code?: VerificationCode;   // SUCCESS | BLURRY | NOT_INVOICE | PARTIAL | UNKNOWN
  trace_logs?: string[];
}
```

### ERPRecord（ERP 匯入資料）

```typescript
interface ERPRecord {
  voucher_id: string;           // 帳款單號，作為配對 key（如 G11-Q10001）
  invoice_date: string;
  tax_code: string;
  invoice_numbers: string[];    // 支援一個憑證對應多張發票
  seller_name: string;
  seller_tax_id: string;
  amount_sales: number;
  amount_tax: number;
  amount_total: number;
  erpFlagged?: boolean;         // 使用者標注「ERP 待確認」
  erp_discrepancy?: boolean;    // 確認差異來自 ERP 登載問題，非 OCR 誤讀
}
```

### AuditRow（比對結果列）

```typescript
interface AuditRow {
  key: string;
  id: string;                           // voucher_id 或 file id
  erp: ERPRecord | null;
  files: InvoiceEntry[];
  ocr: InvoiceData | null;              // 多張發票已加總
  auditStatus: 'MATCH' | 'MISMATCH' | 'MISSING_FILE' | 'EXTRA_FILE';
  diffDetails: DiffKey[];
}
```

## 稅別對照表（tax_code / voucher_type）

| tax_code | voucher_type | 說明 | 必要條件 |
|----------|-------------|------|---------|
| T300 | 三聯手寫 | 手寫填入，格式 21 | 金額手填，無「收銀機」字樣 |
| T301 | 三聯電子 | 電子發票證明聯，格式 25 | 必須有「電子發票證明聯」字樣 |
| T302 | 三聯收銀 | 機列三聯，格式 25 | 必須有「收銀機統一發票」字樣 |
| T400 | 其他 | 海關進口稅，格式 28 | 進口報單 |
| T500 | 二聯收銀／車票 | 格式 22 或大眾運輸票券 | |
| TXXX | 收據／Invoice | 外國發票、免用統編收據等 | |

## DiffKey 對照表

| DiffKey | 中文 | 比對條件 |
|---------|------|---------|
| amount | 金額不符 | ERP total vs 此行**已 claim 的 OCR 發票**加總，差 > 1 元；ERP tax_code=T500 時完全跳過 |
| date | 日期不符 | normalizeDate 後不相等 |
| inv_no | 發票號碼不符 | ERP 發票數 ≠ 配對到的 OCR 發票數 |
| tax_code | 稅別不符 | ERP 與 OCR tax_code 不相等 |
| tax_id | 統編不符 | 8 位數字不相等（外國發票略過） |
| tax_id_unclear | 統編模糊 | seller_tax_id 含 '?' |
| no_match_found | 找不到對應 | OCR 無有效發票（全為非發票） |

**amount diff 的「有效發票」定義**（`isCountableForAmount`）：
- 排除：`document_type === '非發票'`、`error_code === 'NOT_INVOICE'`
- 排除：`tax_code === 'TXXX'`（收據、外國發票）
- 排除：`tax_code === 'T500' && voucher_type === '車票'`（大眾運輸票券）
- 保留：`tax_code === 'T500' && voucher_type === '二聯收銀'`（二聯統一發票，正常計入）

## error_code 意義

| error_code | 情境 |
|------------|------|
| SUCCESS | 正常提取 |
| BLURRY | AI 判定圖像模糊，金額設為 0 |
| NOT_INVOICE | 非發票文件（訂單、外國 Invoice）或純出貨單，金額全設 0 |
| PARTIAL | 部分資訊可讀 |
| UNKNOWN | 無法判定 |

## 規則

- 改欄位名稱 → 全專案 grep 確認無遺漏
- 新增 DiffKey → 同步更新 `DIFF_LABELS`（`auditLogic.ts`）
- amount 比對永遠用**所有有效 OCR 發票加總** vs ERP total，不只看配對上的發票
- 外國 Invoice（document_type === 'Invoice' 或 'Commercial Invoice'）略過 tax_id 比對
