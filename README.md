# Taiwan Invoice OCR Audit Pro（台灣進項發票 AI 稽核系統）

> 用 Google Gemini AI 辨識發票影像，自動與 ERP 匯出資料交叉比對，找出金額不符、發票號碼錯誤、統編異常等問題。**純前端架構、不上傳任何資料到外部伺服器**，適合有資料隱私需求的會計環境。

---

## 為什麼需要這個工具？

台灣企業每月需大量人工核對進項發票與 ERP 帳務是否一致。傳統流程耗時，且容易因 OCR 品質或人工疏失造成漏判。這套系統將 AI 辨識、邏輯驗證、人工覆核整合成一個流程，目標是：

- **減少人工逐張比對的時間**
- **降低因統編、金額、發票號碼錯誤造成的稽核風險**
- **產出可直接給會計使用的 CSV 差異報表**

---

## 核心流程

```
上傳發票掃描檔 (PDF/JPG/TIF)
       ↓
匯入 ERP 匯出的 Excel/CSV
       ↓
Gemini AI 辨識每張發票欄位
（Flash 低信心 → 自動升級 Pro 重試）
       ↓
自動比對 ERP vs OCR（金額、號碼、統編、日期）
       ↓
異常清單 + 人工覆核
       ↓
匯出 CSV 報表（UTF-8 with BOM）
```

---

## 系統架構

### 技術棧

| 層級 | 技術 |
|------|------|
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS |
| AI OCR | Google Gemini 2.5 Flash / Pro（多模態） |
| 手寫辨識 | Google Cloud Vision API（買方統編專用） |
| 廠商資料庫 | Supabase（可選，未設定 env 則自動停用） |
| 本地儲存 | LocalStorage（專案列表）+ IndexedDB（原始檔案） |
| 影像前處理 | UTIF.js（TIF → PNG 轉換） |

### 核心模組

```
services/
  geminiService.ts       # Gemini AI OCR，含完整 System Prompt 與混合模型策略
  visionService.ts       # Google Cloud Vision，手寫買方統編驗證
  supabaseService.ts     # 廠商資料庫（seller_db），可選功能
  fileStorageService.ts  # IndexedDB 檔案存取封裝
  loggerService.ts       # 系統日誌（最多 5000 筆，防記憶體溢位）

src/lib/
  auditLogic.ts          # ERP vs OCR 比對核心，產出 AuditRow[]
  erpParser.ts           # ERP Excel/CSV 解析，支援中英文混合欄位名稱
  invoiceNormalizer.ts   # OCR 結果後處理（日期格式、金額自動修正、發票號碼清理）
  taxIdValidator.ts      # 台灣統一編號 mod-5 checksum 驗證（含第 7 碼為 7 的特殊規則）
  taxCodeLogic.ts        # 稅別代碼推算（T300/T301/T302/T400/T500/TXXX）
  amountValidation.ts    # 黃金恆等式驗證（sales + tax = total，允許 ±1 誤差）
  csvExport.ts           # 差異分析 CSV 產出

components/
  InvoiceEditor.tsx      # 主工作區（三欄式：列表 / 原圖預覽 / 欄位表單）
  ErrorReviewPage.tsx    # 異常稽核頁（只列有問題的發票，支援類別篩選）
  CostDashboard.tsx      # API Token 費用追蹤
  InvoiceForm.tsx        # 欄位輸入表單（含即時驗證）
  InvoicePreview.tsx     # PDF 分頁 / 圖片預覽
  InvoiceResult.tsx      # 單筆 OCR 結果呈現
```

---

## 核心資料結構

### InvoiceData（OCR 結果）

```typescript
{
  document_type: string;     // "統一發票" / "Invoice" / "收據" / "非發票" 等
  voucher_type?: VoucherType; // 三聯手寫 / 三聯收銀 / 三聯電子 / 二聯收銀 / ...
  tax_code: string | null;   // T300 / T301 / T302 / T400 / T500 / TXXX
  invoice_number: string | null; // 2 英文字母 + 8 數字（台灣統編格式）
  invoice_date: string | null;
  seller_name: string;
  seller_tax_id: string | null;
  currency: string;          // TWD / USD / EUR / ...
  amount_sales: number;      // 未稅金額
  amount_tax: number;        // 稅額
  amount_total: number;      // 含稅金額
  has_stamp: boolean;
  verification: VerificationData;   // ai_confidence, logic_is_valid, flagged_fields
  field_confidence: FieldConfidence; // 各欄位信心分數（0-100）
}
```

### ERPRecord（ERP 匯入資料）

```typescript
{
  voucher_id: string;        // 傳票號碼（唯一鍵）
  invoice_date: string;
  tax_code: string;
  invoice_numbers: string[]; // 一張傳票可含多張發票
  seller_name: string;
  seller_tax_id: string;
  amount_sales: number;
  amount_tax: number;
  amount_total: number;
}
```

### AuditRow（比對結果）

```typescript
{
  auditStatus: 'MATCH' | 'MISMATCH' | 'MISSING_FILE' | 'EXTRA_FILE';
  diffDetails: string[];     // 具體差異欄位列表（date / amount / inv_no / tax_id / ...）
  erp: ERPRecord | null;
  ocr: InvoiceData | null;
}
```

---

## 業務邏輯規則

| 規則 | 說明 |
|------|------|
| **黃金恆等式** | `sales + tax = total`，允許 ±1 誤差（四捨五入） |
| **台灣統一編號驗證** | 8 碼、mod-5 checksum，第 7 碼為 7 有特殊規則 |
| **買方統編** | 預設必須為 `16547744`，不符則標記錯誤 |
| **非發票排除** | 銷貨單/出貨單/Packing List 自動分類為「非發票」，不進入稽核 |
| **外幣發票** | document_type = "Invoice" 者跳過台灣稅別驗證 |
| **混合模型策略** | Flash 辨識後若 `ai_confidence < 閾值` 或 `logic_is_valid = false`，自動以 Pro 重試 |
| **金額自動修正** | 若 total < tax（AI 填反了），自動對調後繼續，記錄在 trace_logs |

---

## 支援的檔案格式

| 格式 | 處理方式 |
|------|----------|
| `.pdf` | 每頁獨立截圖後送 OCR |
| `.png` / `.jpg` / `.jpeg` | 直接送 OCR |
| `.tif` / `.tiff` | UTIF.js 轉 PNG 後送 OCR |

---

## 四個主要視圖（App.tsx `view` 狀態）

| 視圖 | 用途 |
|------|------|
| `PROJECT_LIST` | 專案管理，建立/選取年月份帳期 |
| `WORKSPACE` | 發票編輯器主工作區 |
| `ERROR_REVIEW` | 異常稽核頁，僅顯示有問題的項目 |
| `SELLER_DB` | 廠商資料庫管理（Supabase） |

---

## 環境變數設定

```env
# 必填
GEMINI_API_KEY=...              # Google Gemini API Key

# 選填：啟用手寫統編辨識（Google Cloud Vision）
VITE_GOOGLE_CLOUD_API_KEY=...

# 選填：啟用廠商資料庫（Supabase）
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Supabase 和 Vision API 未設定時系統仍可正常運作，相關功能自動停用。

---

## 快速啟動

```bash
npm install
npm run dev       # 開發模式
npm run build     # 生產建置
npm run test      # 執行單元測試（vitest）
```

---

## AI 開發指南（Agent Skills）

`.agent/skills/` 下有三份開發文件，接手時建議先讀：

- `Business_Logic/SKILL.md` — 會計規則、資料模型、稽核邏輯詳解
- `OCR_Prompts/SKILL.md` — Gemini System Prompt 設計原則與常見錯誤
- `UI_Interface/SKILL.md` — 前端元件架構與狀態管理規範

---

## 注意事項

- 所有資料存在**瀏覽器本地**（LocalStorage + IndexedDB），清除瀏覽器資料會遺失所有專案
- Supabase 廠商資料庫為跨裝置同步用，不影響核心 OCR 稽核功能
- `BUYER_TAX_ID_REQUIRED = "16547744"` 硬編碼在 `App.tsx`，換公司使用需修改此值
