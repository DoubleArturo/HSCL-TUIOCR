# Golden Test Sample - Implementation Guide

## 問題背景

每次人工驗證 OCR 結果都需要花費 API 成本，無法頻繁迭代測試。

## 解決方案

建立 **免費本地驗證框架**，使用 37 張實際發票 + 配套 ERP 資料，實現：

1. **零成本回歸測試** — 本地執行完整的 OCR → ERP 比對流程
2. **CI/CD 自動化** — 每次提交自動驗證審計邏輯
3. **邊界 case 發現** — 在付費驗證前發現潛在問題

## 資料集組成

### 發票檔案（37 張）

分 8 個錯誤類別：

```
Golden Test Sample/
├── date_errors/              (6 files)  — 日期讀取錯誤
├── tax_id_errors/            (4 files)  — 統編辨識錯誤
├── amount_errors/            (4 files)  — 金額計算錯誤
├── invoice_number_errors/    (6 files)  — 發票號碼誤讀
├── classification_errors/    (4 files)  — 稅別/分類錯誤
├── verification_errors/      (4 files)  — 信心度不足
├── edge_cases/               (4 files)  — 多頁/模糊/特殊格式
└── other_errors/             (5 files)  — 其他異常
```

### ERP 資料（50 筆記錄）

- **檔案**: `erp-data.json`
- **格式**: 按 `voucher_id` 分組的標準化 ERPRecord
- **來源**: 
  - 202604進項檢核/進項發票-4.xls (266 行)
  - 202605進項檢核/2605進項發票.xls (180 行)

## 本地測試框架

### 執行測試

```bash
# 驗證 Golden Test Sample 組織完整性
npm test -- golden-test-sample

# 監視模式（開發中實時測試）
npm test -- --watch golden-test-sample
```

### 測試覆蓋項目

✅ **已實現**:
- ERP 資料完整性驗證
- 32 個 vouchers × 50 筆 ERP 記錄
- 8 個錯誤類別組織驗證

🔲 **待實現（當 OCR 服務整合後）**:
- `compareOCRResultsWithERP()` — 批量 OCR 測試
- `verifyAuditLogic()` — 審計邏輯正確性驗證
- `measureConfidenceAccuracy()` — 信心度評分驗證

## 使用流程

### 1. 開發新功能時

```typescript
// 在 geminiService.ts 或 validationPipeline.ts 中修改

// 修改後，本地執行：
npm test

// 如果通過，再用 API 成本驗證實際案例
// 可節省 20~50% 的驗證成本
```

### 2. 定期性能檢查

```bash
# 每月執行一次，驗證 OCR 模型性能是否退化
npm test -- golden-test-sample

# 記錄結果（可加入 CI/CD 報告）
npm test -- --reporter=verbose golden-test-sample
```

### 3. 問題除錯

遇到生產環境 OCR 錯誤時：

1. 檢查錯誤屬於哪個類別（date / amount / tax_id 等）
2. 查看對應類別目錄中是否已有類似案例
3. 若無，從生產環境導出發票 + ERP 資料，加入 Golden Sample
4. 在本地驗證修復，再上線

## 成本控制

### API 使用建議

| 階段 | 驗證方式 | 頻率 | 成本 |
|------|--------|------|------|
| **開發** | Golden Sample 本地測試 | 每提交 | 免費 |
| **特性驗證** | 5~10 張新案例 API 驗證 | 每週 | ~$1~2 |
| **月度檢查** | 全 37 張實際 API 驗證 | 每月 | ~$10 |
| **上線前** | 完整審計檢查（500+ 張） | 每次發版 | ~$50~100 |

## 未來擴展

### 1. 自動化性能報告

```bash
npm run test:golden -- --reporter=json > golden-results.json

# 生成趨勢報告（信心度、誤差率、耗時）
npm run analyze:golden
```

### 2. 成本預測

```javascript
// 在 Gemini API 呼叫前計算預期成本
const estimatedCost = calculateBatchCost(fileCount, modelVersion);
if (estimatedCost > budgetLimit) {
  warn(`⚠️ Estimated cost: $${estimatedCost}. Use Golden Sample instead?`);
}
```

### 3. Golden Sample 版本管理

```json
{
  "version": "1.0",
  "created": "2026-05-26",
  "coverage": "32 vouchers, 50 ERP records",
  "categories": 8,
  "lastVerified": "2026-05-26",
  "knownIssues": [
    "G61-Q40016: 日期模糊，預期低信心度"
  ]
}
```

## 技術細節

### ERPRecord 標準化

```typescript
interface ERPRecord {
  voucher_id: string;          // G61-Q40001
  invoice_date: string;        // 2026/03/24
  tax_code: string;            // T300 | T302 | TXXX | ...
  invoice_numbers: string[];   // ["XW22600505", "XW22600506"]
  seller_name: string;         // 廠商簡稱
  seller_tax_id: string;       // 12546771
  amount_sales: number;        // 未稅金額
  amount_tax: number;          // 稅額
  amount_total: number;        // 含稅金額
  raw_row: string[];           // 原始 Excel 列（保留用）
}
```

### 檔案組織邏輯

發票檔名規則：`{voucher_id}{variant}.{ext}`

```
G61-Q40001.pdf           # 主檔
G61-Q40001-1.jpg         # 單頁掃描
G61-Q40001-2.pdf         # 多頁 PDF 第二頁
G61-Q40020.jpg
```

## 常見問題

**Q: 為什麼要把 ERP 資料放進 Git？**
A: 本地測試必須可重現，ERP 資料是測試的一部分。.gitignore 已忽略 Test Data，但 erp-data.json 是精簡版，無敏感信息。

**Q: 本地測試和 API 驗證結果會不同嗎？**
A: 會。本地測試只驗證審計邏輯，API 驗證包括 OCR 精準度。本地測試 pass 不代表 API 也會 pass。

**Q: 如何加入新的錯誤案例？**
A: 
1. 複製實際發票到對應類別目錄
2. 從 ERP 系統導出對應記錄，加入 erp-data.json
3. 更新此文件的記錄數量

---

**Last Updated**: 2026-05-26
**Maintainer**: 專案團隊
