# 項目記憶索引

> 2026-05-26 建立，用於查詢過去會話的決策和發現

## 設計與架構

- [設計決策](design-decisions.md) — 7 個核心設計的原理與權衡（claimedOCRInvNos、T500 skip、buyer_tax_id 等）
- [已知問題](known-bugs.md) — 8 個已知 bug pattern、邊界情況、workaround

## 快速檢查

- 改 auditLogic.ts 前：讀「設計決策」#1–3 + 禁止清單 1–4
- 改 Gemini prompt 前：讀「設計決策」#7 + 常見踩坑「T302 判定」
- 新增稅別前：讀「設計決策」#3、#5 + 禁止清單 3、5
- 遇到發票數量很多或金額爆掉：讀「已知問題」#3、#8

## 檔案版本追蹤

| 檔案 | 最後驗證 | 改動需同步 |
|------|--------|---------|
| CLAUDE-ocr-business-logic.md | 2026-05-26, commit 2413516 | geminiService.ts / auditLogic.ts / 新稅別 |
| auditLogic.ts | 2026-05-26, commit 2413516 | CLAUDE-ocr-business-logic.md / design-decisions.md |
| geminiService.ts | 2026-05-26, commit 2413516 | CLAUDE-ocr-business-logic.md / known-bugs.md |
