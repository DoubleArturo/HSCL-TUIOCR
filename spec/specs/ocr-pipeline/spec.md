# OCR Pipeline 規範

> Last verified: 2026-06-25, commit 1b7455e  
> 實作檔案：`services/geminiService.ts`, `services/invoicePostProcessor.ts`, `services/promptBuilder.ts`, `src/hooks/useOCRBatch.ts`, `services/validationPipeline.ts`

---

## Requirement: 條件式圖像增強（P2a）

WHEN 上傳圖像進行 OCR，
系統 SHALL 先評估圖像清晰度，只在必要時才做增強，避免浪費 API 成本。

### 決策樹（3 條路徑）

```
圖像輸入
 ├─ Path A: Laplacian > 100 且 contrast > 50 → 清晰
 │    └─ 直接 Flash OCR（1x 成本）
 ├─ Path B: 模糊，但 Flash OCR 品質已足夠（keyFieldsConfidence ≥ 80%）
 │    └─ 採用 Flash 結果（1x 成本）
 ├─ Path C: 模糊 + Flash 品質不足
 │    └─ 增強圖像 → 再次 Flash → 必要時升 Pro（> 1x 成本）
 └─ Path D/E: 評估失敗 → 保守 fallback 視為模糊，繼續 C 路徑
```

#### Scenario: Path A — 清晰圖像跳過增強
GIVEN Laplacian variance > 100 AND contrast > 50  
WHEN clarity 評估完成  
THEN 跳過 `enhanceImageForOCR()`  
AND 直接呼叫 Flash OCR  
AND trace_logs 記錄 `direct_flash`

#### Scenario: Path C — 模糊 + Flash 品質不足
GIVEN clarity 評估為模糊 AND keyFieldsConfidence < 80%  
WHEN Flash OCR 完成  
THEN 執行 `enhanceImageForOCR()` 重新增強  
AND 以增強圖像再次呼叫 Flash OCR  
AND trace_logs 記錄 `quality_based_enhanced`

#### Scenario: Path E — 增強失敗 fallback
GIVEN `enhanceImageForOCR()` 拋出例外  
WHEN catch 區塊執行  
THEN console.warn `WARN: Enhancement failed, falling back to Flash result`  
AND 使用原始 Flash 結果繼續  
AND 不中斷整批 OCR

---

## Requirement: OCR 後處理 11 步 Pipeline

WHEN Gemini 回傳原始 JSON，
系統 SHALL 執行 11 步後處理，包含去重、金額修正、tax_code 推算等。

步驟順序（在 `invoicePostProcessor.postProcessItems` 內）：
1. JSON parse 與陣列標準化
2. 非發票頁過濾（`NOT_INVOICE` / Ghost 去除）
3. 發票號碼正規化（`normInvoiceNumber`：去空白、大寫、標準化破折號）
4. tax_code 推算（缺失時依 seller 動態 DB 推算）
5. amount 自動修正（swap / 加總誤差 ≤ 50 自動校正）
6. mod-5 發票號碼驗證
7. buyer_tax_id 格式驗證（含 `?` 佔位符支援）
8. FieldConfidence 計算
9. VerificationData 建立（ai_confidence、logic_is_valid）
10. trace_logs 附加
11. `deduplicateResults`（同號碼去重）

#### Scenario: Ghost 發票去除
GIVEN Gemini 回傳 `invoice_number: null` 且 `amount_total: 0`  
WHEN postProcessItems 執行  
THEN 該筆被標記為 Ghost 並移除  
AND 不進入最終結果

#### Scenario: 重複發票去除
GIVEN 兩筆 `invoice_number` 相同（經正規化後）  
WHEN `deduplicateResults` 執行  
THEN 保留第一筆，刪除後續重複  
AND 不論 seller 或 amount 是否一致

---

## Requirement: Flash → Pro 自動升級（ERP crosscheck）

WHEN Flash OCR 結果與 ERP 資料有金額或數量落差，
系統 SHALL 自動升級至 gemini-2.5-pro 重試一次。

#### Scenario: 金額差異觸發升級
GIVEN `expectedERP.amount_total` 存在  
WHEN `Math.abs(ocrTotalSum - expectedERP.amount_total) > 1`  
THEN `validationRetryCount < 1` 條件下升級至 Pro  
AND trace_logs 附加 `Escalated to PRO due to ERP mismatch`

#### Scenario: 發票數量不足觸發升級
GIVEN ERP 期望 2 張發票（`invoice_numbers.length > 1`）  
WHEN Flash OCR 只找到 1 張（有效 `invoice_number` 數 < 期望數）  
THEN countMismatch = true，觸發 Pro 升級  
AND 訊息：`Count mismatch: ERP expects N invoices, OCR found M`

#### Scenario: Pro ROI Guard — Flash 可信時跳過升級
GIVEN 所有有效發票均滿足：ai_confidence ≥ 85 AND 加總無誤差（≤1）AND invoice_number 存在  
WHEN ERP 金額差異出現  
THEN 推斷差異來自 ERP 本身，跳過 Pro 升級  
AND flagged_fields 加入 `erp_amount_suspicious`  
AND 節省 4x 的 Pro API 成本

#### Scenario: 最多升級 2 次
GIVEN `validationRetryCount === 1`（已升過一次）  
WHEN 仍有差異  
THEN 不再升級（`skipValidationRetry = true`）  
AND 回傳 Pro 結果並標記差異由人工處理

---

## Requirement: Hybrid Auto-Escalation（模型層級）

WHEN 模型名稱包含 `hybrid`，
系統 SHALL 在 Flash 無法可靠辨識時自動升級至 gemini-2.5-pro。

#### Scenario: Flash 結果不可靠時升 Pro
GIVEN `modelName.includes('hybrid')`  
WHEN validInvoices 中有任何：加總誤差 > 1 OR 缺 invoice_number OR ai_confidence < 70 OR logic_is_valid=false  
THEN 升級呼叫 `gemini-2.5-pro`  
AND 結果 trace_logs 加入 `Escalated: {flashModel} → gemini-2.5-pro`

---

## Requirement: 發票後處理驗證規則

WHEN `validationPipeline.validateInvoice` 執行，
系統 SHALL 驗證以下格式規則，違規時標記 flagged_fields。

| 規則 | 條件 | flagged_field |
|------|------|--------------|
| GUI 格式 | `invoice_number` 不符 `^[A-Z]{2}\d{8}$` 且非 INV- 格式 | `invoice_number` |
| GUI 長度 | 符合字母 pattern 但為 9 或 11 碼 | `invoice_number` + GUI_LENGTH |
| 加總驗證 | `abs(sales + tax - total) > 1` | `amount_total` |
| 統編格式 | `seller_tax_id` 非 8 位數字（含 `?` 例外） | `seller_tax_id` |
| 日期格式 | `invoice_date` 不符 `YYYY-MM-DD` | `invoice_date` |
| 稅別必填 | `tax_code` 為 null 且非 NOT_INVOICE | `tax_code` |
| 金額非負 | `amount_total < 0` | `AMOUNT_NEGATIVE` |
| T500 豁免 | T500 發票號不驗 GUI 格式（條碼格式不同） | ─ |
