# Golden Test Sample

本資料夾包含 37 張實際發票檔案，分類按 OCR 常見的錯誤模式組織，用於定期測試和性能檢查。

## 資料夾結構

- **date_errors/** (6 files) — 日期讀取錯誤 (G61-Q40016, Q40020, Q40031)
- **tax_id_errors/** (4 files) — 統編辨識錯誤 (G61-Q40003, Q40018, Q40024, Q40029)
- **amount_errors/** (4 files) — 金額計算錯誤 (G61-Q40004, Q40011, Q40025, Q40032)
- **invoice_number_errors/** (6 files) — 發票號碼誤讀 (G61-Q40001, Q40008, Q40014, Q40028)
- **classification_errors/** (4 files) — 稅別/文件類型分類錯誤 (G61-Q40005, Q40012, Q40019, Q40026)
- **verification_errors/** (4 files) — 信心度不足的案例 (G61-Q40006, Q40017, Q40023, Q40030)
- **edge_cases/** (4 files) — 多頁PDF、模糊、特殊格式 (G61-Q40007, Q40013, Q40021, Q40027)
- **other_errors/** (5 files) — 其他異常情況 (G61-Q40002, Q40009, Q40010, Q40015, Q40022)

## 使用方式

用於定期驗證 OCR Pipeline 的性能：

```bash
# 批量測試 Golden Sample
npm test -- --include="**/golden-test/**"

# 或寫入 CI/CD pipeline
npm test -- --grep="Golden Test Sample"
```

## 檔案來源

- 202604進項檢核 審計週期的實際發票掃描檔
- 已驗證每個檔案都代表特定的 OCR 失敗模式
- 配合 services/ 中的驗證測試使用
