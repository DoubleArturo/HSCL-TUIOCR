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
見 `.claude/CLAUDE.md` 禁止清單 #1。修改此邏輯需同步 5 處：L85 init、L118 add、L104 has、L170 fallback、L172 fallback add。

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
見 `.claude/CLAUDE.md` 禁止清單 #2。改動 T500 判定需驗證：(a) ERP 層級 skip 不變、(b) OCR voucher_type 能正確判定、(c) 測試涵蓋「T500 二聯有發票號」case。

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
見 `.claude/CLAUDE.md` 常見踩坑「buyer_tax_id 含 '?'」。若提高辨識精度（如用 Vision API 手寫辨識），需同步調整 flag 邏輯。

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

## Issue 9：OCR 有但 ERP 無時，不應自動補一列 ✅ 已修

**症狀**  
- 使用者上傳一張發票，OCR 成功辨識
- 但這張發票不在當期 ERP 資料中（可能是別月份、或誤上傳）
- 系統自動補一列 `auditStatus = 'EXTRA_FILE'`，造成總列數虛增

**根因**  
`auditLogic.ts` L256–268：`extraFiles` 把所有未 match 的 OCR 檔案都建一列。

**解法（方案 A — 完全移除）**  
- `auditLogic.ts`：移除 `extraFiles` 區段，只 return `mappedRows.sort(...)`；同時清掉死碼 `matchedFileIds` Set 和 L72 的 `matchedFileIds.add()`
- `App.tsx`：移除 `isExtra` 變數和「無 ERP」amber badge（L1254、L1269）
- `auditLogic.test.ts`：原 EXTRA_FILE 測試改成 `expect(rows).toHaveLength(0)`，並新增「orphan OCR 不影響其他 ERP-match 列」測試
- `types.ts`、`csvExport.ts`：保留 `'EXTRA_FILE'` union 與 label 對映，避免外部消費端炸（實際不再產生）

**驗證**  
`npm test -- auditLogic` → 23/23 通過。

**改動風險（已評估）**  
- 副作用：上傳孤兒檔案後不再顯示，使用者除錯時可能不易發現「為何這張發票沒入帳」→ 後續若需要可加獨立的「未對應檔案」UI 區塊（方案 B）
- 死碼 `matchedFileIds` 已清除，避免下次 onboard 工程師誤以為還在用

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

## 金額不符診斷樹

線上發現金額不符（auditStatus = AMOUNT_MISMATCH）時，按優先級檢查：

**第 1 層：型別篩選**
```
amount_sales/amount_tax 有差值
  ↓ isCountableForAmount() 檢查
  ├─ voucher_type = '交通票券' → 預期跳過，不該在 diff
  ├─ tax_code = 'TXXX' → 預期跳過，不該在 diff
  └─ 以上都是 false → 進行金額比對
```
**檢查點：** auditLogic.ts L10–12，geminiService.ts prompt

**第 2 層：多行同 voucher 去重**
```
同一 voucher_id 有多個 ERP 行（如物料費 + 加工費）
  ↓ claimedOCRInvNos Set 追蹤
  ├─ row1 claim [AB, CD] → Set 記錄 {AB, CD}
  ├─ row2 嘗試 match AB → 失敗（已被 claim）
  └─ row2 fallback [CD] → Set 已有，也失敗
```
**檢查點：** auditLogic.ts L85–121，L104 has() 檢查

**第 3 層：發票號正規化**
```
發票號比對失敗（matched = 0）
  ↓ normInvoiceNumber() 檢查
  ├─ ERP: 'AB 123456' → norm → 'AB123456'
  ├─ OCR: 'AB123456' → norm → 'AB123456' → 符合 ✓
  └─ 未 norm 會導致虛假不符
```
**檢查點：** auditLogic.ts L70–73（normInvNo）、L97（應用）

**第 4 層：Type skip 一致性**
```
OCR skip 但 ERP 未 skip（或反之）
  ↓ shouldSkipFromAudit() vs ERP skip 邏輯
  ├─ OCR document_type='Invoice' → skip（外國發票）
  ├─ ERP 仍有此行 → 應該被 auditStatus=SKIPPED 排除
  └─ 不同步 → 虛假 AMOUNT_MISMATCH
```
**檢查點：** auditLogic.ts L24–36 (shouldSkipFromAudit)、L95–99 (ERP skip)

**第 5 層：Fallback 邏輯**
```
invoice_number 完全 miss（matchedOCRInvoices = []）
  ↓ fallback OCR 比對（應有的發票，就算號碼不符也比金額）
  ├─ 找到 fallback（amount 接近，未被 claim）
  ├─ 用 fallback.amount_total vs erp.amount_total
  └─ 無 fallback → 應該只記錄 inv_no diff，不記 amount
```
**檢查點：** auditLogic.ts L170–181 (fallback 邏輯)

**實戰例子：G12-Q50007**
- ERP: XW17220651 (T302, 11926, seller_tax_id=83632740)
- OCR: 漏掉，但有 ZH56112376 (T301, 1050)
- 診斷：
  1. ✓ isCountableForAmount(ZH...) = true（T301 可計）
  2. ✓ claimedOCRInvNos 確認 ZH... 未被其他行 claim
  3. ✓ normInvoiceNumber('XW17220651') 正確
  4. ✓ shouldSkipFromAudit(ZH...) = false（T301 不跳過）
  5. ✓ fallback 邏輯：matchedOCRInvoices.length = 0，用 ZH... 比對
  - 結果：應記錄 inv_no + amount + tax_code + tax_id diffs（4 個）

---

## 回退策略

若新改動導致線上爆掉，快速回退：

1. **revert commit**：`git revert [commit-hash]`
2. **檢查版本戳**：確認 CLAUDE-ocr-business-logic.md 的「Last verified」
3. **記錄到本檔**：為什麼改動失敗、下次怎麼避免
4. **監控金額不符率**：若超過平時 2 倍，立即 alert
5. **用診斷樹除錯**：若金額不符率異常，按上述 5 層逐項檢查
