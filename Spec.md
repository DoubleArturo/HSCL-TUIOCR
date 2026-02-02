
# 台灣三聯式發票 AI 稽核系統 (Taiwan Invoice OCR Audit Pro) - 需求規格書

## 1. 產品概述 (Product Overview)
本系統旨在協助會計人員自動化比對「ERP 帳務資料」與「實體發票憑證影像」。透過 Google Gemini AI 模型進行高精度的 OCR 辨識與語意理解，自動擷取發票欄位，並與使用者匯入的 Excel 帳務資料進行邏輯勾稽，快速抓出金額不符、統編錯誤或憑證缺漏的異常項目。

---

## 2. 使用者故事 (User Stories - MVP)

| ID | 角色 | 功能描述 | 驗收標準 (Acceptance Criteria) |
|:---|:---|:---|:---|
| **US-01** | 使用者 | 匯入 ERP 帳務資料 (Excel/CSV) | 1. 支援 `.xlsx`, `.csv` 格式。<br>2. 自動偵測「稅額(本幣)」、「多發票號碼」等關鍵字。<br>3. 支援單一傳票對應多張發票號碼的解析。 |
| **US-02** | 使用者 | 上傳發票憑證影像 | 1. 支援批次上傳圖片 (`.jpg`, `.png`) 或 PDF。<br>2. 檔名需對應傳票編號 (Voucher ID) 以進行自動關聯。 |
| **US-03** | 系統 | AI 自動辨識 (OCR) | 1. 擷取發票號碼、日期、**買方統編**、賣方統編、金額明細。<br>2. 需回傳每個欄位的信心水準 (Confidence Score)。 |
| **US-04** | 系統 | 自動稽核比對 (Auto Audit) | 1. 比對 ERP 多組發票號碼是否包含 OCR 結果。<br>2. **強制檢查買方統編是否為 16547744**。<br>3. 明確標示異常原因 (如：買方統編錯誤、稅額不符)。 |
| **US-05** | 使用者 | 檢視與修正 (Editor) | 1. 提供左右對照介面，PDF 需能正常預覽。<br>2. 支援修正買方統編與金額，並即時重算驗證狀態。 |
| **US-06** | 使用者 | 匯出稽核報告 | 1. 匯出 CSV 格式。<br>2. 包含詳細差異說明。 |

---

## 3. 核心業務邏輯 (Business Logic)

### 3.1. ETL 資料擷取 (Excel Import)
*   **關鍵欄位解析**：
    *   `voucher_id`: 傳票編號/帳款單號 (Col B)。
    *   `invoice_numbers`: 多發票號碼 (Col K)，需依照 `,` ` ` `/` `、` 進行切割轉為陣列。
    *   `amount_tax`: 優先抓取「稅額(本幣)」(Col O)。
*   **資料清洗**：所有金額欄位需去除千分位逗號。

### 3.2. AI 處理邏輯
*   **模型**：`gemini-2.5-flash` (優化速度與成本)。
*   **效能目標 (Free Tier Limit)**：
    *   **Peak RPM**: ~15 (Requests Per Minute)。
    *   **Peak TPM**: ~1,000,000 (Tokens Per Minute)。
    *   **並發控制**：同時處理 **3** 個請求 (配合重試機制最大化免費額度使用)。
*   **OCR 數值處理規則 (Data Processing Rules)**：
    1.  **發票號碼 (Invoice Number)**：
        *   **規則**：必須強制移除所有空白 (Spaces/Whitespace)。
        *   **範例**：識別結果 `AB 12 345678` 需轉換為 `AB12345678`。
        *   **目的**：避免因排版空格導致與 ERP 資料比對失敗。
    2.  **賣方統編 (Seller Tax ID)**：
        *   **規則**：若影像模糊、有印章遮擋導致無法辨識特定位數，**必須**以 `?` 代替該位數字。
        *   **限制**：禁止 AI 根據上下文「幻想」或自動補全數值。
        *   **範例**：`12?45678`。
        *   **後續動作**：系統偵測到 `?` 時，需在 UI 標示「統編模糊 (Unclear)」並要求人工複核。
*   **新增擷取欄位**：`buyer_tax_id` (買方統一編號)。
*   **日期轉換**：民國年轉西元年。
*   **數學驗證**：`| (未稅 + 稅額) - 總額 | <= 1`。

### 3.3. 稽核比對演算法 (Matching Algorithm)
1.  **Key Match**: 使用 `voucher_id` 比對檔名。
2.  **內容驗證**：
    *   **買方統編檢核**：OCR `buyer_tax_id` 必須等於 `16547744`，否則為 `BUYER_ID_ERROR`。
    *   **發票號碼檢核**：將 OCR 與 ERP 發票號碼皆**去除空白**後進行包含比對 (Contains)。
    *   **金額檢核**：OCR 總額與 ERP 總額誤差需 <= 1。

---

## 4. 資料結構 (Data Models)

### 4.1. ERPRecord
```typescript
interface ERPRecord {
  voucher_id: string;
  invoice_numbers: string[]; // Changed to Array
  seller_tax_id: string;
  amount_sales: number;
  amount_tax: number;
  amount_total: number;
  // ... others
}
```

### 4.2. InvoiceData
```typescript
interface InvoiceData {
  invoice_number: string | null;
  buyer_tax_id: string | null; // New Field
  seller_tax_id: string | null;
  // ... others
}
```
