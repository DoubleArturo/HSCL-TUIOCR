# 專案 AI 工作規則

## 全球規則（自動繼承）

@~/.claude/PROJECT-INIT/CLAUDE-universal.md
@~/.claude/PROJECT-INIT/WORKFLOW-universal.md

---

## 專案類型：default

---

## 載入的模組

永遠載入：
- @.claude/QUICK-REF.md（TOP 10 踩坑速查，動手前先看）
- @.claude/modules/CLAUDE-data-contract.md
- @.claude/modules/CLAUDE-debug-rules.md
- @.claude/modules/CLAUDE-testing-requirements.md
- @.claude/memory/design-decisions.md（設計決策、為什麼這樣做）
- @.claude/memory/known-bugs.md（已知問題、邊界情況）

按需載入：
- @.claude/modules/CLAUDE-ocr-business-logic.md（修改 OCR / 審計 / Gemini prompt 相關時）
- @.claude/rules-and-checks.json（修改 auditLogic / geminiService 時用 JSON 自動檢查）

---

## 專案特化規則

### 技術棧

- React + TypeScript + Vite（前端）
- Tailwind CSS + shadcn/ui（UI）
- Gemini API（`@google/genai`）：OCR 主力，模型 gemini-2.5-flash / gemini-2.5-pro
- Supabase：sellers 動態資料庫
- Google Cloud Vision API：買方統編手寫辨識輔助

### 核心資料結構

- `InvoiceData`：單張 OCR 發票結果（見 CLAUDE-data-contract.md）
- `ERPRecord`：ERP 匯入的憑證資料
- `AuditRow`：ERP × OCR 配對後的比對列

### 禁止清單 (Blocklist)

違反以下規則會導致邏輯錯誤，改動前必讀：

1. ❌ **禁止改 claimedOCRInvNos 為陣列**  
   → 會導致同 voucher_id 多行時發票重複計算  
   → 相關檔：auditLogic.ts L85–121 / 設計決策見 design-decisions.md

2. ❌ **禁止在 amount diff 中加回 T500 判定**  
   → T500 ERP 行已在 L129 skip，勿重複或移除  
   → 相關檔：auditLogic.ts L176–181（fallback 也要 skip）

3. ❌ **禁止直接判 `tax_code !== 'TXXX'` 來篩發票**  
   → 漏掉 voucher_type 檢查（交通票券）  
   → 必用 isCountableForAmount() 統一篩選

4. ❌ **禁止跳過「非發票頁→Ghost→重複」三層去重流程**  
   → 順序固定，改動會導致重複發票混入  
   → 相關檔：geminiService.ts L420–470（後處理）

5. ❌ **禁止改 shouldSkipFromAudit 後忘記改 ERP 層級 skip**  
   → 若 OCR 可 skip，ERP 也要 skip，否則誤判 MISSING_FILE  
   → 相關檔：auditLogic.ts L95–99

6. ❌ **禁止在 Supabase upsertSeller 時允許 '16547744'**  
   → 買方自身統編會污染動態資料庫  
   → 相關檔：supabaseService.ts（需驗證檢查是否已實裝）

7. ❌ **禁止移除 normInvoiceNumber() 的標準化**  
   → ERP 欄位可能含空格、大小寫混淆、破折號，必須正規化  
   → 相關檔：auditLogic.ts L70–73

8. ❌ **禁止假設 ERP invoice_numbers 已標準化**  
   → 必經 normInvoiceNumber() 轉換後再比對  
   → 相關檔：auditLogic.ts L97

9. ❌ **禁止直接用 Gemini 結果，跳過後處理 11 步**  
   → 金額可能錯誤、tax_code 推算、mod-5 驗證都在 validationPipeline  
   → 相關檔：geminiService.ts L300–470

10. ❌ **禁止無限升級 Gemini 模型**  
    → 成本爆炸（Pro 貴 4 倍），最多升 2 次後改手動  
    → 相關檔：App.tsx L534–558

### 常見踩坑 + 防護

- **T302 判定**：「收銀機統一發票」文字必須在發票本體，同頁有機列出貨單不等於 T302  
  📌 相關檔：geminiService.ts L18–25 prompt  
  ⚠️ 容易踩坑：改 Gemini prompt 時不小心改掉這個規則  
  🛡️ 防護：改 prompt 前檢查 test case（auditLogic.test.ts 有無涵蓋）

- **amount diff 只計 claimed OCR 加總**：若 ERP 行 claim 了 AB+CD，amount_total 應是兩者和，不能只用 AB  
  📌 相關檔：auditLogic.ts L128–134（Fix 2）  
  ⚠️ 容易踩坑：多行同 voucher_id 時，發票分配邏輯改錯  
  🛡️ 防護：見 auditLogic.test.ts L229–276（Fix 2 case）

- **TXXX 和 T500 不計 amount**：TXXX 收據、T500 車票天生不計入金額比對  
  📌 相關檔：auditLogic.ts L10–12（isCountableForAmount）、L129（T500 skip）  
  ⚠️ 容易踩坑：新增稅別時忘了加 isCountableForAmount 判定  
  🛡️ 防護：見 auditLogic.test.ts L141–193（Fix 1 case）、L195–226（Fix 3 case）

- **外國 Invoice 無統編**：document_type='Invoice' 時跳過 tax_id 比對  
  📌 相關檔：auditLogic.ts L24–36（shouldSkipFromAudit）  
  ⚠️ 容易踩坑：新增文件類型時忘了加 skip 邏輯  
  🛡️ 防護：加測試驗證 shouldSkipFromAudit 的涵蓋範圍

- **buyer_tax_id 含 '?'**：格線遮擋時用 '?' 佔位符，並 flag 警告  
  📌 相關檔：geminiService.ts L56–57、App.tsx L1381  
  ⚠️ 容易踩坑：改 OCR 後處理時誤刪 '?' 邏輯  
  🛡️ 防護：見 known-bugs.md Issue 6

- **claimedOCRInvNos Set 維護**：同 voucher_id 多行時，每張發票只能被 claim 一次  
  📌 相關檔：auditLogic.ts L85–121（groupByVoucherId）  
  ⚠️ 容易踩坑：加新的配對邏輯時忘了 mark claimed  
  🛡️ 防護：見 design-decisions.md #1、auditLogic.test.ts L255–275

---

### AI Code-Change Checklist（動手前必讀）

改 `auditLogic.ts` / `geminiService.ts` / `validationPipeline.ts` 前，依序檢查：

**Step 1：定位影響範圍**
- [ ] 我要改的是哪一條規則？對應 `.claude/rules-and-checks.json` 哪個 RULE_id？
- [ ] 這條規則的 line_ranges 是否還準確？（若代碼已位移，先更新 JSON）
- [ ] 我的改動會不會觸發禁止清單（CLAUDE.md L47–87）？

**Step 2：讀依賴**
- [ ] 讀目標檔案完整內容（不要片段 read）
- [ ] 讀對應 test 檔（auditLogic.test.ts / geminiService.test.ts）
- [ ] 讀 design-decisions.md 對應 # 號條目

**Step 3：寫測試（先於實作）**
- [ ] 為新行為寫一個會失敗的測試
- [ ] 為現有行為確認還有測試覆蓋（不會被改壞）
- [ ] 若新增 tax_code / voucher_type：必須有對應 isCountableForAmount / shouldSkipFromAudit 的測試

**Step 4：實作**
- [ ] 改動後本地跑 `npm test`（必須 100% pass）
- [ ] 改動行數 < 50 行？若超過，是否該拆 commit？
- [ ] 是否動到了禁止清單裡的 Set / skip / norm / 三層去重邏輯？

**Step 5：驗證 + 文檔同步**
- [ ] 更新 CLAUDE-ocr-business-logic.md 版本戳（若改 prompt 或 11 步後處理）
- [ ] 更新 rules-and-checks.json line_ranges（若行號位移）
- [ ] 若解了一個 bug，更新 known-bugs.md（標記 ✅ 已修復 + commit hash）

**Step 6：金額不符紅燈時的診斷順序**
若改完後監控發現 AMOUNT_MISMATCH 率升高，按 known-bugs.md「金額不符診斷樹」5 層逐項檢查。

---

### 文檔同步 Checklist

改代碼時，檢查是否需要同步文檔。**改了這些檔案 → 需同步這些文檔**：

| 代碼改動 | 涉及文檔 | 同步方式 | 優先級 |
|---------|--------|--------|--------|
| geminiService.ts (prompt / 後處理 11 步) | CLAUDE-ocr-business-logic.md | 更新版本戳 + 規則描述 | HIGH |
| auditLogic.ts (diff key / 配對邏輯) | CLAUDE-data-contract.md + ocr-business-logic.md | 更新版本戳 + AuditRow 定義 | HIGH |
| validationPipeline.ts (新驗證 / 升級邏輯) | ocr-business-logic.md | 記錄新驗證規則 | HIGH |
| 新增 tax_code | 同上 + geminiService.ts prompt | 詳細記錄此稅別的規則 | HIGH |
| imageEnhancement.ts 改 gamma 值 | design-decisions.md #6 + known-bugs.md | 更新演算法說明 + 驗證方式 | MEDIUM |
| Gemini 升級策略改動 | design-decisions.md #7 | 更新升級條件、成本估算 | MEDIUM |
| UI 改 auditStatus 判定 | 無需同步文檔 | - | - |

**版本戳格式**：`Last verified: YYYY-MM-DD, commit [short-hash]`（在文檔頂部）

**何時檢查同步**：
- 改 auditLogic.ts 或 geminiService.ts 時 → **必檢查**
- 改 UI 或純前端邏輯時 → 可忽略
- 新增稅別或 voucher_type 時 → **必檢查**

---

### 常用指令速查

```bash
# 開發
npm run dev              # 啟動 vite，localhost:3000

# 測試
npm run test            # 跑所有 .test.ts（必須 100% pass）
npm test -- auditLogic  # 跑特定檔案

# 建置
npm run build           # 產出 dist/
npm run preview         # build 後驗證生產環境

# Git
git log -5              # 查最近 5 commit，確認版本戳
git diff [file]        # 檢查改動有沒有漂移
```
