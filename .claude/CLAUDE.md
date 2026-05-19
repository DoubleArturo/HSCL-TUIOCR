# 專案 AI 工作規則

## 全球規則（自動繼承）

@~/.claude/PROJECT-INIT/CLAUDE-universal.md
@~/.claude/PROJECT-INIT/WORKFLOW-universal.md

---

## 專案類型：default

---

## 載入的模組

永遠載入：
- @.claude/modules/CLAUDE-data-contract.md
- @.claude/modules/CLAUDE-debug-rules.md
- @.claude/modules/CLAUDE-testing-requirements.md

按需載入（修改 OCR / 審計 / Gemini prompt 相關時）：
- @.claude/modules/CLAUDE-ocr-business-logic.md

---

## 專案特化規則

### 技術棧

- React + TypeScript + Vite（前端）
- Tailwind CSS + shadcn/ui（UI）
- Gemini API（`@google/genai`）：OCR 主力，模型 gemini-2.0-flash / gemini-2.5-pro
- Supabase：sellers 動態資料庫
- Google Cloud Vision API：買方統編手寫辨識輔助

### 核心資料結構

- `InvoiceData`：單張 OCR 發票結果（見 CLAUDE-data-contract.md）
- `ERPRecord`：ERP 匯入的憑證資料
- `AuditRow`：ERP × OCR 配對後的比對列

### 常見踩坑

- T302 判定：「收銀機統一發票」文字必須在發票本體，同頁有機列出貨單不等於 T302
- amount diff 只比「此 ERP 行已 claim 的 OCR 發票加總」vs 此行 amount_total（Fix 2 後）
- TXXX 收據和 T500 車票不計入金額比對（`isCountableForAmount`）；ERP tax_code=T500 整行跳過 amount diff
- 外國 Invoice（document_type === 'Invoice'）略過 tax_id 比對
- 買方自身統編 `16547744` 永不寫入 Supabase seller DB
- 同一 voucher_id 多個 ERP 行：group 共享 OCR，用 `claimedOCRInvNos` 確保每張發票只屬於一行
- buyer_tax_id 欄位：schema 已加入，格線遮擋時用 '?' 填充，不等於 16547744 時 flag
