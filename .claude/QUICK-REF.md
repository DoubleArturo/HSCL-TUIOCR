# 🚨 Quick Ref — TOP 10 踩坑

> 1 頁速查。動代碼前掃一眼。詳細出處見每條的「→」。

| # | 不要做 | 為什麼 | 出處 |
|---|--------|--------|------|
| 1 | 把 `claimedOCRInvNos` 改成陣列 | 同 voucher 多行會重複計算 | auditLogic.ts L85–121 |
| 2 | 在 amount diff 加回 T500 判定 | T500 ERP 已 skip，重複會錯 | auditLogic.ts L129、L176 |
| 3 | 用 `tax_code !== 'TXXX'` 篩發票 | 漏掉 voucher_type 檢查 | 必用 `isCountableForAmount()` |
| 4 | 跳過「非發票頁→Ghost→重複」三層去重 | 順序固定，亂改會混入重複 | geminiService.ts L420–470 |
| 5 | 改 `shouldSkipFromAudit` 忘了 ERP 層 skip | OCR skip 但 ERP 不 skip → 誤判 MISSING_FILE | auditLogic.ts L24–36 + L95–99 |
| 6 | upsertSeller 沒過濾 '16547744' | 買方自身統編污染動態庫 | supabaseService.ts |
| 7 | 移除 `normInvoiceNumber()` | ERP 含空格/大小寫/破折號會比錯 | auditLogic.ts L70–73 |
| 8 | 直接用 Gemini 結果跳過 11 步後處理 | 金額/tax_code/mod-5 都在 pipeline | geminiService.ts L300–470 |
| 9 | 無限升級 Gemini 模型 | Pro 貴 4 倍，最多升 2 次 | App.tsx L534–558 |
| 10 | 改 `imageEnhancement.ts` gamma 偏離 0.75 | 會把清晰圖過銳化 | 範圍 < 100 用 0.75，≥ 100 用 0.9 |

---

## ⚡ 動代碼前 30 秒檢查

1. `npm test` 跑得過嗎？（基線）
2. 我改的條目對應 CLAUDE.md 禁止清單第幾條？
3. 我有沒有改到上表 1–10 任何一條的邏輯？
4. 對應 test 我寫了嗎？

## 🩺 金額不符時的 5 層診斷順序

1. **型別篩選** — `isCountableForAmount()` 是否正確排除 TXXX / T500 交通票券
2. **多行去重** — `claimedOCRInvNos` Set 是否漏 add / 漏 has 檢查
3. **發票號正規化** — ERP 端有沒有經過 `normInvNo()`
4. **Type skip 同步** — OCR skip 時 ERP 是否也 skip
5. **Fallback 邏輯** — `matchedOCRInvoices=[]` 時有沒有用 fallback 比金額

詳見 `.claude/memory/known-bugs.md`「金額不符診斷樹」。

## 📁 該讀哪個檔

| 情境 | 讀 |
|------|----|
| 動 `auditLogic.ts` | 此檔 + CLAUDE.md 禁止清單 + design-decisions.md #1–3 |
| 動 Gemini prompt | 此檔 + 常見踩坑「T302 判定」+ design-decisions.md #7 |
| 新增 tax_code | 此檔 + design-decisions.md #3 #5 + CLAUDE-ocr-business-logic.md |
| 金額不符告警 | known-bugs.md 診斷樹（從第 1 層開始） |
| 線上爆掉急救 | known-bugs.md「回退策略」 |

## 🔴 已知未修

（目前無未修項目。Issue 9 已修 — 方案 A 移除 extraFiles。）
