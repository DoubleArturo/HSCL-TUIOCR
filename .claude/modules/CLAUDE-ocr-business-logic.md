# OCR 業務邏輯

> 按需載入（`@.claude/modules/CLAUDE-ocr-business-logic.md`）
> 修改 geminiService.ts / auditLogic.ts / 任何 OCR 相關邏輯前必讀

## 主要檔案

| 功能 | 檔案 |
|------|------|
| Gemini prompt + 後處理 | `services/geminiService.ts` |
| 審計比對邏輯 | `src/lib/auditLogic.ts` |
| 金額修正 | `src/lib/invoiceNormalizer.ts` |
| 稅號校驗 | `src/lib/taxIdValidator.ts` |
| 稅別分類 fallback | `src/lib/taxCodeLogic.ts` |
| ERP 欄位解析 | `src/lib/erpParser.ts` |

## Prompt 架構（geminiService.ts）

### SYSTEM_INSTRUCTION（L13–L99）
永久 system prompt，給 Gemini 的角色定義與規則。涵蓋：
1. 文件類型分類（統一發票 / 進口報單 / 非發票）
2. 欄位提取規則（幣別、發票號、金額、日期、統編）
3. 稅別分類 T300–TXXX
4. 混合頁面辨識（手寫發票 + 出貨單同頁）

### 使用者 Prompt（L205–L233）
每次 call 動態附加，涵蓋：
1. 多張發票隔離規則（side-by-side, top/bottom）
2. ERP 交叉驗證提示（expectedERP 有值時附加）

## 後處理規則（geminiService.ts L300–L470）

每張 OCR 結果逐一過：

1. **tax_code 補全**（L313–L338）：AI 沒給 → 從 voucher_type / document_type fallback
2. **voucher_type 補全**（L342–L348）：從 tax_code 反推
3. **外國發票 skip**（L351–L373）：`document_type === 'Invoice'` → error_code = NOT_INVOICE
4. **賣方統編庫查詢**（L378–L386）：統編含 '?' 或空值 → 查 MERGED_SELLERS 補全
5. **新廠商自動寫入 Supabase**（L388–L404）：清晰 8 位統編且非買方 → upsert
6. **GUI 格式驗證**（L407–L418）：2 大寫字母 + 8 數字，不符只 warn 不 fail
7. **Rule 1 - 發票號清潔**（L421–L426）：移除空格、轉大寫
8. **Rule 2 - 統編 '?' flag**（L429–L434）：加入 flagged_fields
9. **Rule 2b - mod-5 校驗**（L436–L445）：財政部 2023 規則，失敗 → flag
10. **Rule 2c - buyer_tax_id 驗證**（Fix 5 加入）：`buyer_tax_id` 含 '?' → flag；8 位數字但不等於 `16547744` → flag
11. **Rule 3 - 金額修正**（L447–L467）：
    - Auto-Swap：total < tax → 兩者對調
    - 重算：`sales + tax ≠ total`（差 > 1 元）→ total = sales + tax

## 去重與過濾（geminiService.ts L476–L532）

按順序執行，**順序不可調換**：

1. **非發票頁過濾**：同一掃描有真實發票時，drop 所有 document_type 屬於出貨單的結果
   - 非發票關鍵字：`'非發票' | 'packing list' | '出貨單' | '送貨單' | '訂單出貨' | '出貨憑證' | '出貨通知' | '銷貨單' | '收料單' | '驗收單'| '收據'| 'Invoice'`
2. **Ghost 去除**：無 invoice_number 但有金額，且存在同額（±5 元）的有 invoice_number 的結果 → drop
3. **完全重複去除**：相同 invoice_number 第二次出現 → drop

## 自動升級模型（geminiService.ts L534–L607）

### Hybrid 升級（L534–L558）
條件（任一觸發）：
- `sales + tax ≠ total`（差 > 1 元）
- 缺 invoice_number（T300/T301/T302）
- `ai_confidence < 70`
- `logic_is_valid = false`

→ 自動 call `gemini-2.5-pro` 重跑

### ERP 驗證升級（L560–L607）
條件：提供了 expectedERP 且金額不符（差 > 1 元）
→ 用 `gemini-2.5-pro` 重試一次（`validationRetryCount < 1`，嚴格只試一次）
→ 首次完全無有效發票時不升級（避免浪費）

## 審計比對邏輯（auditLogic.ts）

### 檔案配對規則
- 完全相等：`file.id === erp.voucher_id`
- 前綴相等：`file.id.startsWith(erp.voucher_id + '-')` 或 `+ '_'`（一個憑證多個附件）

### 多個 ERP 行同 voucher_id 的處理（重要）
- 先 group ERP rows by `voucher_id`，每個 group **共享**同一批 `matchingFiles` 和 `allOCRInvoices`
- group 內部用 `claimedOCRInvNos: Set<string>` 確保每張 OCR invoice 只屬於一個 ERP 行
- Amount diff 只比「此行已 claim 的 OCR invoices 加總」vs「此行 amount_total」

### 發票號配對規則
- 正規化後模糊比對：`ocrNo.includes(erpNo) || erpNo.includes(ocrNo)`
- **後備**：ERP 只有 1 張、OCR 只有 1 張有效但讀不到號碼，且尚未被 claim → 直接配對

### amount diff 的有效發票（isCountableForAmount）
- 排除：`document_type === '非發票'` 或 `error_code === 'NOT_INVOICE'`
- 排除：`tax_code === 'TXXX'`（收據、外國發票不應計入金額比對）
- 排除：`tax_code === 'T500' && voucher_type === '車票'`（大眾運輸票券）
- **保留**：`tax_code === 'T500' && voucher_type === '二聯收銀'`（二聯統一發票，正常計入）

### T500 ERP 行的特殊規則
- ERP `tax_code=T500` 時**完全跳過 amount diff**（車票金額登載方式不一致）
- 仍比對 `tax_code`、`date`、`inv_no`

## 賣方統編三層資料庫

優先級（低 → 高，高者覆蓋低者）：
1. `src/data/seller_db.json`（靜態庫）
2. ERP Excel 解析出的 knownSellers（上傳時傳入）
3. Supabase `sellers` table（動態，即時查詢）

**買方自身統編**（永不寫入 Supabase）：`16547744`

## 常見踩坑

### T300 vs T302 判定
- 關鍵：**「收銀機統一發票」文字必須出現在發票本體**
- 同頁有機列出貨單 ≠ T302；看發票本身的金額是否手填
- 若任何金額欄看起來手填 → 一律 T300

### 三聯收銀（T302）買受人統編
- `買受人` 欄旁的統編 = **買方**，不是賣方
- 賣方統編在發票頂端公司 header 或同頁出貨單的廠商統編欄
- OCR 若抓錯，系統會從 seller DB 查詢補正

### 多張發票同一掃描
- Gemini 要求回傳陣列，每張各自一個 JSON 物件
- 後處理再做去重（Ghost + 完全重複）

### 民國年轉換
- 3 位數年份（113, 114, 115）= 民國年 → +1911
- 4 位數 20xx = 西元年，直接用

### ERP 比對的金額容差
- **±1 元**（四捨五入誤差）
- diff 條件：`Math.abs(差) > 1`

### TXXX 收據和 T500 車票不計入金額比對
- 同一憑證若只有 TXXX 結果（如停車費、計程車），不觸發 amount diff
- T500 車票（`voucher_type=車票`）被排除在 `isCountableForAmount` 之外
- T500 二聯收銀（如超商統一發票）仍正常計入

### 同一 voucher_id 多個 ERP 行
- 常見於 TipTop 一筆傳票拆成「物料費」＋「加工費」兩行
- 每行各自要配到自己的那張發票（由 invoice_number 精準 claim）
- 改動前行為：兩行都拿同一批 OCR → 各自金額比對都失敗
- 改動後：group 內部用 `claimedOCRInvNos` 保護，已被 claim 的發票不可再用
