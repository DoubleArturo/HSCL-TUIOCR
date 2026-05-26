---
name: 已知問題與邊界情況
description: 過去發現的 bug pattern、邊界情況、workaround，防止重複踩坑
type: project
---

# 已知問題與邊界情況

> 最後更新：2026-05-26, commit 2413516

## Issue 1：XW17220651 淡墨發票無法辨識

**症狀**  
- 掃描件筆跡淡、墨水量少，Gemini Flash 信心 < 50%
- OCR 結果為空或錯誤（invoice_number=null）
- 即使升級到 Pro，仍無法穩定提取

**根因分析**  
掃描品質問題，不是 prompt 問題。Gemini 看不清原始影像。

**解法**  
在 `App.tsx` handleFiles 中，上傳時自動套用 `enhanceImageForOCR()` 前置處理：
- 直方圖對比度分析
- 對比度拉伸到 [0, 255]
- Gamma 校正（0.75 power for range < 100）
- 亮度乘數（1.3x for very dark）

相關檔：
- `src/lib/imageEnhancement.ts`（實作）
- `App.tsx` L448–458（初始上傳）、L758–763（re-OCR）

**驗證**  
需要手動測試（無法自動化）。上傳 G12-Q50007.pdf，檢查 console 的 `[GEMINI] Invoice numbers extracted` 是否包含 XW17220651。

**優化空間**  
- 若持續失敗，考慮加「unsharp mask」銳化
- 若掃描件太多，考慮前端用 pdfjs-dist 逐頁渲染而非直接 base64

---

## Issue 2：TXXX 憑證誤判為「缺件」

**症狀**  
- ERP tax_code=TXXX（雜項收據）
- OCR 已成功上傳（見 OCR 欄有發票號或「收據」標籤）
- 但 auditStatus 顯示「缺件」（應該「已跳過」）

**根因分析**  
`auditLogic.ts` 中只在 ERP 層級 skip（L95–99），但 UI 判定仍用舊邏輯。

**解法**  
已修復（commit 97cc78d）：
- 改 `shouldSkipFromAudit()` 涵蓋 TXXX、Packing List、Delivery Note
- 加 `isSkipped` 判定於 `App.tsx` L1256
- UI 顯示「已跳過」灰色標籤而非「缺件」警告

相關檔：
- `src/lib/auditLogic.ts` L24–36（shouldSkipFromAudit）
- `src/lib/auditLogic.ts` L95–99（ERP TXXX skip）
- `App.tsx` L1256, 1265, 1306（UI 判定）

**測試驗證**  
見 `auditLogic.test.ts` L363–387

---

## Issue 3：同 voucher_id 多行時發票重複計算

**症狀**  
- 傳票拆成「物料費」+「加工費」兩行（同 voucher_id）
- 上傳多張發票（如 AB12345678 + CD87654321）
- 結果：AB 被 row1 claim，但也被 row2 計算了 → 金額不符

**根因分析**  
`claimedOCRInvNos` 的 Set 沒有正確維護，或者初始化時漏掉。

**解法**  
`auditLogic.ts` L85–121（Fix 2）：
- `groupByVoucherId()` 內部維護 Set，確保每張發票只被 claim 一次
- 遍歷每個 ERP 行時檢查 `claimedOCRInvNos.has(ocrNo)`
- Claim 後立即加入 Set

**驗證邏輯**  
```typescript
// row1 claim AB
matchedOCRInvoices = [AB];
claimedOCRInvNos.add('AB');

// row2 嘗試 claim AB 失敗
matchedOCRInvoices = []; // AB 已被 claim
// 只能用 fallback（CD）比對
```

**測試驗證**  
見 `auditLogic.test.ts` L229–276（Fix 2 cases）

**改動風險**  
❌ **禁止**在 ERP 迴圈外初始化 Set → 會重置  
❌ **禁止**改成陣列 `[].includes()` → 性能下降  
⚠️ **修改此邏輯時**：需同時修改 5 個地方（L85 init、L118 add、L104 has、L170 fallback、L172 fallback add）

---

## Issue 4：T500 二聯發票與交通票券混淆

**症狀**  
- T500 有兩種：「二聯收銀發票」（有號）vs「交通票券」（無號）
- 某些檔案被誤判為不計 amount
- 或者相反，不該計 amount 的被計了

**根因分析**  
`isCountableForAmount()` 檢查 `voucher_type === '交通票券'`，但若掃描件品質差，OCR 可能無法區分。

**設計決策**  
- T500 ERP 行：完全跳過 amount diff（因為無法判定 OCR type）
- T500 OCR：用 voucher_type 判定（交通票券 → 不計，二聯 → 計）

**改動風險**  
⚠️ **謹慎**：若改動 T500 判定，需確保：
1. ERP 層級 skip 邏輯不變
2. OCR 層級 voucher_type 能正確判定
3. 測試涵蓋「T500 二聯有發票號」的 case

相關檔：
- `auditLogic.ts` L129–134（ERP T500 skip）
- `auditLogic.ts` L10–12（isCountableForAmount）
- `geminiService.ts` prompt（voucher_type 判定）

**測試驗證**  
見 `auditLogic.test.ts` L159–193（Fix 1 T500 cases）

---

## Issue 5：外國 Invoice 統編比對失敗

**症狀**  
- document_type='Invoice' 或 'Commercial Invoice'（英文發票）
- seller_tax_id 是英文代碼（如 ABC123）或護照號
- auditStatus 誤判為 MISMATCH（tax_id 不符）

**設計決策**  
外國 Invoice 天生無統編，應該跳過 tax_id 比對。

**現狀**  
已記錄在 `.claude/CLAUDE.md` L47，但 auditLogic 層級未完全涵蓋。

**修復進度**  
- ✅ `shouldSkipFromAudit()` 檢查 document_type='Invoice'
- ⚠️ **但**若 ERP 有 seller_tax_id，邏輯仍會比對
- 建議：改 `isInvoiceDoc()` 也涵蓋外國 Invoice，或在 diff 檢查時加判定

相關檔：
- `auditLogic.ts` L24–36（shouldSkipFromAudit）
- `auditLogic.ts` L157–166（tax_id diff 檢查）

---

## Issue 6：buyer_tax_id 格線遮擋導致辨識模糊

**症狀**  
- 三聯手寫發票，買受人統編欄被橫線遮擋
- OCR 無法完整辨識，回傳 '1234?678'
- 無法自動配對，需人工確認

**設計決策**  
允許 '?' 佔位符，在 flagged_fields 記錄警告，UI 標紅。

**改動風險**  
❌ **禁止**改成「無法辨識就回傳 null」  
⚠️ **謹慎**：若提高辨識精度（如用 Vision API 手寫辨識），需同步調整 flag 邏輯

相關檔：
- `geminiService.ts` L57（schema 允許 '?'）
- `auditLogic.ts` L163–164（flag 辨識）
- `App.tsx` L1381（UI 紅字標記）

---

## Issue 7：買方自身統編永不寫入 Supabase

**症狀**  
- buyer_tax_id = '16547744'（買方自身）
- 若寫入 sellers 表，會污染動態資料庫
- 下次查庫會誤用自身統編配對其他交易

**設計決策**  
在 Supabase upsert 前檢查，'16547744' 永不寫入。

**相關檔**  
- `.claude/CLAUDE.md` L48（常見踩坑）
- 應在 supabaseService.ts 中實作檢查（目前尚未確認是否已實裝）

**改動風險**  
⚠️ **驗證**：upsertSeller() 是否有 `if (taxId === '16547744') return;` 檢查？

---

## Issue 8：Amount diff 只計「此 ERP 行已 claim 的 OCR」加總

**症狀**  
- ERP row1 claim 了 AB, CD 兩張發票（都有發票號）
- amount_sales + amount_tax 應該是「AB 和 CD 的合計」
- 若只拿 AB 的額度比對，會誤判金額不符

**設計決策**  
Fix 2 修復：`validOCRForAmount` 先篩選已 match 的 OCR，再加總。

相關檔：`auditLogic.ts` L128–134

**測試驗證**  
見 `auditLogic.test.ts` L229–253（Fix 2 case）

---

## 邊界情況 Checklist

遇到以下情況時，需要特別留意邏輯漂移：

- [ ] 新稅別（新增 T3xx）：需更新 isCountableForAmount、shouldSkipFromAudit、Gemini prompt
- [ ] 新 voucher_type（如「轉帳收據」）：需更新 shouldSkipFromAudit、isCountableForAmount
- [ ] 同 voucher_id 超過 3 行：驗證 claimedOCRInvNos 邏輯不爆掉
- [ ] 金額超過 1M 元：檢查 integer overflow（JavaScript Number 精度）
- [ ] 買方統編含特殊字符（如 '/'）：檢查正規化邏輯
- [ ] 發票號含空格（如 'AB 123 456'）：檢查 normInvNo() 有沒有 trim
- [ ] 多頁 PDF 混淆（出貨單 + 發票混在一起）：需要 Gemini prompt 的「多發票隔離」規則生效

---

## 回退策略

若新改動導致線上爆掉，快速回退：

1. **revert commit**：`git revert [commit-hash]`
2. **檢查版本戳**：確認 CLAUDE-ocr-business-logic.md 的「Last verified」
3. **記錄到本檔**：為什麼改動失敗、下次怎麼避免
4. **監控金額不符率**：若超過平時 2 倍，立即 alert
