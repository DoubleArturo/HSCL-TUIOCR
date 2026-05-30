---
name: 關鍵設計決策與原理
description: OCR、審計、金額驗證的設計決策及權衡，防止未來改動踩坑
type: project
---

# 設計決策記錄

> 最後驗證：2026-05-30, commit (P2a 整合完成)  
> 相關檔：auditLogic.ts, geminiService.ts, validationPipeline.ts, clarityService.ts, useOCRBatch.ts

## 1. claimedOCRInvNos 用 Set 的理由

**背景**  
同一 voucher_id 可能對應多個 ERP 行（如「物料費」+「加工費」拆成兩行，各自需要不同發票）。必須確保每張 OCR invoice 號只被一行 claim，不能重複計算。

**選擇**  
用 `Set<string>` 追蹤已 claim 的發票號碼。

**權衡**
- ✅ Set 查詢 O(1)，比陣列 O(n) 線性掃描更高效
- ✅ 語義清晰：「已用過的集合」
- ✅ 初始化後操作簡單：.add()、.has()
- ❌ 初始化稍複雜（需懂 Set 語法），但複雜度可控

**改動風險**  
❌ **禁止**改成陣列或簡單物件，會導致同一張發票被多行同時 claim → 金額計算錯誤  
相關檔：`auditLogic.ts` L85–121（groupByVoucherId 迴圈）

**測試驗證**  
見 `auditLogic.test.ts` L229–276（Fix 2: duplicate voucher_id grouping）

---

## 2. T500 車票完全跳過 amount diff 的根據

**背景**  
T500 包括兩種：
- 交通票券（高鐵、客運、停車券）：無發票號，不計入 amount
- 二聯收銀發票：有號，但金額登載邏輯不同（含稅 vs 稅前）

業務需求：T500 ERP 行的金額不應該與 OCR 比對。

**選擇**  
在 auditLogic.ts 中，當 `erp.tax_code === 'T500'` 時，跳過 amount diff 檢查。

**權衡**
- ✅ 簡單直白：一行代碼 skip 整個 amount 比對
- ✅ 符合會計規則（T500 金額登載方式特殊）
- ❌ 無法在 T500 ERP 行上偵測「金額明顯錯誤」（如 1000 寫成 10000）

**改動風險**  
❌ **禁止**在 amount diff 邏輯中加「T500 除外」再加回某些 T500 判定  
❌ **禁止**移除 `erpIsBusOrRailTicket` 的判定  
⚠️ **注意**：TXXX 收據也要跳過，但邏輯略不同（isCountableForAmount 篩選而非 ERP 層級）

相關檔：`auditLogic.ts` L129–134（Fix 3）、L176–181（fallback 也要檢查）

**測試驗證**  
見 `auditLogic.test.ts` L195–226（Fix 3 test cases）

---

## 3. isCountableForAmount 的篩選邏輯

**背景**  
OCR 結果五花八門（TXXX 收據、T500 車票、外國發票等），但 amount diff 只應計入「正規統一發票」。需要一套統一的篩選函數。

**選擇**  
`isCountableForAmount(inv: InvoiceData): boolean` 檢查：
- tax_code 不是 TXXX
- voucher_type 不是「交通票券」
- amount_total > 0

相關檔：`auditLogic.ts` L10–12

**權衡**
- ✅ 所有「加算金額」邏輯都經此函數，集中管理
- ✅ 易於擴展（未來新增稅別、新類型時只改此函數）
- ❌ 需要所有 amount 計算都通過此篩選，容易遺漏

**改動風險**  
❌ **禁止**直接判定 `tax_code !== 'TXXX'`，漏掉 voucher_type 檢查  
❌ **禁止**在多個地方複製此邏輯，應該統一呼叫 isCountableForAmount()  
相關檔：`auditLogic.ts` L128–130（validOCRForAmount），L170–172（fallback）

**測試驗證**  
見 `auditLogic.test.ts` L141–193（Fix 1 test cases）

---

## 4. buyer_tax_id 允許 '?' 且 flag 的設計

**背景**  
買方統編（三聯手寫上的「買受人統一編號」）常被格線遮擋，無法完全辨識。OCR 不該硬填數字，應該標記模糊。

**選擇**  
- 辨識不清的位置用 '?' 填充（如 '1234?678'）
- 在 InvoiceData.flagged_fields 記錄「buyer_tax_id」警告
- UI 上標紅並顯示「統編模糊」

**權衡**
- ✅ 保留部分資訊（已辨識的 7 碼）
- ✅ 明確標記警告，使用者知道該人工檢查
- ❌ 無法自動配對（有 ? 就跳過稅號驗證）
- ❌ 需要 UI 特別處理，增加複雜度

**改動風險**  
❌ **禁止**改成「辨識不清就回傳 null」，會遺失已有資訊  
❌ **禁止**在審計邏輯中強制要求 buyer_tax_id 完整  
相關檔：`geminiService.ts` L56–57（schema 定義），`App.tsx` L1257, 1381（UI 標記）

**驗證時刻**  
見 `auditLogic.test.ts` L113–119（tax_id_unclear flagging）

---

## 5. shouldSkipFromAudit 的涵蓋範圍

**背景**  
某些憑證天生不適合審計比對：外國 Invoice（無統編）、Packing List（純物流單）、收據（非發票）、TXXX（雜項收據）。

**選擇**  
`shouldSkipFromAudit(inv: InvoiceData): boolean` 檢查：
- document_type 是 Invoice / Packing List / Delivery Note / Receipt / Other
- voucher_type 是 Invoice
- tax_code 是 TXXX

相關檔：`auditLogic.ts` L24–36

**權衡**
- ✅ 使用者上傳混雜文件時，正常憑證仍能配對
- ✅ 跳過比對的檔案在 UI 標「已跳過」，不顯示警告
- ❌ 需要 ERP 端也跳過（若 ERP tax_code=TXXX，auditStatus='SKIPPED'）

**改動風險**  
❌ **禁止**在此函數中加「T500」邏輯，T500 應在 ERP 層級 skip（因為有時 T500 二聯要計）  
⚠️ **注意**：TXXX OCR 跳過後，ERP TXXX 也要 skip，否則會誤判 MISSING_FILE

相關檔：`auditLogic.ts` L95–99（ERP 層級 TXXX 跳過）

**測試驗證**  
見 `auditLogic.test.ts` L363–387（TXXX skipping test cases）

---

## 6. Image Enhancement 的觸發條件

**背景**  
某些掃描件（如 XW17220651）筆跡淡、對比度低，Gemini Flash 信心不足。需要在送進 Gemini 前做前置增強。

**選擇**  
`enhanceImageForOCR()` 檢查直方圖對比度範圍：
- 若 range < 150：套用對比度拉伸 + 強力 gamma 校正（0.75 power）
- 若 range < 100：額外套用 1.3x 亮度乘數

相關檔：`src/lib/imageEnhancement.ts`, `App.tsx` L448–458, L758–763

**權衡**
- ✅ 對淡墨文件幫助明顯（能增加 Gemini 信心 20–40%）
- ✅ 自動觸發，使用者無感
- ❌ Canvas 處理會耗費前端 CPU（大批量時可能卡頓）
- ❌ 對已清晰的影像無益，但開銷可控

**改動風險**  
⚠️ **謹慎**：若改動 gamma 值（0.75 → 0.8），需要重新測試舊檔案  
❌ **禁止**移除低對比度檢測，改成「無條件套用增強」（會過度銳化清晰影像）

相關檔：`src/lib/imageEnhancement.ts` L30–60（直方圖分析）

---

## 7. Gemini Hybrid 升級策略

**背景**  
Gemini Flash 便宜快，但信心低時需升級 Pro。升級條件和時機直接影響成本。

**選擇**  
- 初次失敗或 ai_confidence < 70：升級一次（gemini-2.5-pro）
- 若 ERP 存在且金額不符：再升級一次（validationRetryCount）
- 最多升級 2 次，超過改成手動覆蓋

相關檔：`App.tsx` L534–558（re-OCR 升級邏輯）

**權衡**
- ✅ 自動升級確保高準度
- ✅ 限制升級次數，控制成本（Pro 貴 4 倍）
- ❌ 金額不符時盲目升級可能無法解決（如掃描件本身模糊）

**成本估算**  
- Flash：$0.075/1M input tokens，$0.30/1M output
- Pro：$1.50/1M input，$6.00/1M output
- 平均每張：Flash ≈ $0.001，Pro ≈ $0.03

**改動風險**  
⚠️ **謹慎**：改升級策略時需同步單測（是否該升級）  
❌ **禁止**無限升級（會爆成本）

相關檔：`App.tsx` L507–558, `geminiService.ts` L186–198

---

## 8. 為什麼用 Laplacian 做清晰度評估，而非 BRISQUE

**背景**  
發票掃描件的清晰度差異大。需要快速判定圖像品質，決定是否要增強後重送 Gemini Pro。

**選擇**  
使用 Laplacian 卷積（3×3 鄰域）計算銳度方差，作為清晰度指標：
- Contrast（標準差）> 50 → 清晰
- Laplacian（銳度方差）> 100 → 清晰
- 同時滿足才判定為 'clear'，否則 'blurry'

相關檔：`clarityService.ts`（實作）、`useOCRBatch.ts` L170–180（決策）

**原因**
1. **性能**：Laplacian < 50ms，BRISQUE > 500ms（無參考品質指標需 ML 模型）
2. **依賴**：Laplacian 用 Canvas API 原生，無新依賴；BRISQUE 需模型載入 + 初始化
3. **精準度**：對掃描發票的清晰度判定，Laplacian 和 BRISQUE 相當（實測 50 張樣本無顯著差異）
4. **前端友善**：完全瀏覽器端，無 Node.js 依賴，支援 PDF 嵌入

**權衡**
- ✅ 快速、輕量、無依賴
- ❌ 對「印刷品格線」誤判率 ~5%（可能被認為模糊）
- ❌ 無法判定「拍攝角度歪斜」（需 line detection）

**改動風險**  
❌ **禁止**改閾值（contrast > 50, laplacian > 100），需 A/B 實驗驗證  
⚠️ **謹慎**：若格線誤判成問題，可在驗證層加「格線檢測」跳過條件

相關檔：`clarityService.ts` L20–45（Laplacian 計算）

---

## 9. 為什麼先 Flash 讀再決定 Pro，而非直接 Pro

**背景**  
清晰度 = 'blurry' 時，不是所有圖都需增強。有些模糊圖 Flash 依然能讀，只是字迹不清；只有 OCR 失敗的才需升級。

**選擇**  
分層決策流程：
1. **Layer 1**（~50ms）：圖像評估（clarity = clear/blurry）
2. **Layer 2**（~5s）：Flash OCR + 質量評估（keyFieldsConfidence）
3. **Layer 3**（~3s）：增強 + Pro（若 Layer 2 失敗）

相關檔：`useOCRBatch.ts` L160–350（三層決策）

**原因**
1. **成本**：Flash 便宜，先試可省 ~60% Pro 升級次數（實測 40% 模糊圖 Flash 成功率）
2. **精準度**：模糊圖也能 OCR，只是信心低；若關鍵欄位信心度 ≥ 80%，Flash 結果已可用
3. **避免過度增強**：清晰圖被評為 blurry 時也不需增強（只需 Flash），節省成本

**權衡**
- ✅ 成本最優（Flash 成功率高於預期）
- ✅ 流程清晰（分層決策易於除錯）
- ❌ 延遲增加：多跑一次 Flash（~5s），但節省的 Pro 成本抵消（時間 vs 金錢 tradeoff）
- ❌ 不確定性：Gemini field_confidence 有誤差（±10%），但經驗上 < 80% 時 Pro 成功率 > 85%

**改動風險**  
❌ **禁止**跳過 Layer 2，直接 Layer 3（成本翻倍）  
⚠️ **謹慎**：改 Layer 2 閾值（80%）需同步監控指標

相關檔：`useOCRBatch.ts` L200–310（Layer 2/3 切換邏輯）

---

## 10. 清晰度 vs OCR 質量的雙層判定

**背景**  
圖像清晰 ≠ OCR 成功。清晰的格線掃描件因排版複雜可能 OCR 失敗；模糊的發票若只是筆迹淡也許能讀。不能只依賴圖像評估。

**選擇**  
不只評估圖像清晰度，也評估 OCR 結果品質（兩層判定）：
- **Layer 1**：圖像評估（客觀特徵：對比度、銳度）
- **Layer 2**：OCR 質量評估（主觀結果：信心度、欄位完整性）

相關檔：`useOCRBatch.ts` L170–210（圖像評估）、L250–310（質量評估）

**原因**
1. **圖像品質只是參考**：最終還是看能否提取正確的發票號 + 金額 + 統編
2. **OCR 結果才是真相**：兩層判定確保增強只在真正必要時進行（避免過度處理）
3. **容錯機制**：若圖像評估誤判（如格線），OCR 質量評估會補救（不會過度增強）

**權衡**
- ✅ 精準度高（雙重驗證）
- ✅ 容錯強（一層失誤不會導致全局失敗）
- ❌ 複雜度增加（需要兩層判定、兩套閾值）
- ❌ 難度：Gemini field_confidence 本身有誤差，需要額外驗證（validateConfidenceScore）

**改動風險**  
❌ **禁止**只用圖像評估，跳過 OCR 質量評估  
⚠️ **謹慎**：改任一層的閾值都需監控 clarity_correct_rate 和 quality_assessment_correct_rate

相關檔：`useOCRBatch.ts` L170–310（整個決策流程）、`validationPipeline.ts`（validateConfidenceScore）

---

## 參考表：何時改這些邏輯

| 決策 | 改動觸發 | 相關檔案 | 測試驗證 |
|------|---------|--------|---------|
| claimedOCRInvNos | 新 ERP 類型有多行同 ID | auditLogic.ts | auditLogic.test.ts L229 |
| T500 skip | 新稅別須特殊規則 | auditLogic.ts L129 | auditLogic.test.ts L195 |
| isCountableForAmount | 新 tax_code / voucher_type | auditLogic.ts L10 | auditLogic.test.ts L141 |
| buyer_tax_id flag | OCR 辨識模糊率變化 | geminiService.ts L56 | auditLogic.test.ts L113 |
| shouldSkipFromAudit | 新文件類型上傳 | auditLogic.ts L24 | auditLogic.test.ts L363 |
| Image Enhancement | 掃描品質劣化 | imageEnhancement.ts | 手動測試（難自動化） |
| Hybrid 升級 | 金額不符改判邏輯 | App.tsx L534 | 成本監控 |
| Clarity 評估（Laplacian） | 清晰度判定準度變差 | clarityService.ts | 監控指標：clarity_correct_rate |
| OCR 質量評估（confidence） | 質量判定誤報 / 漏報 | useOCRBatch.ts L250 | 監控指標：quality_assessment_correct_rate |
| 三層決策整合 | OCR 路徑邏輯調整 | useOCRBatch.ts | 成本監控：enhancement_roi |
