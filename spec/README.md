# HSCL-TUIOCR 規範索引

> 本目錄使用 OpenSpec 格式。格式說明見 `.claude/skills/openspec-*/`

## 常駐規範（spec/specs/）

| 模組 | 規範檔案 | 上次驗證 |
|------|---------|---------|
| 認證系統 | [auth/spec.md](specs/auth/spec.md) | 2026-06-25 |
| 雲端同步 | [cloud-sync/spec.md](specs/cloud-sync/spec.md) | 2026-06-25 |
| OCR Pipeline | [ocr-pipeline/spec.md](specs/ocr-pipeline/spec.md) | 2026-06-25 |
| 檔案保留政策 | [file-retention/spec.md](specs/file-retention/spec.md) | 2026-06-25 |

## 歸檔（spec/archive/）

已完成並歸檔的變更提案，保留為歷史記錄。

## 規範格式說明

```
### Requirement: [功能名稱]
WHEN [觸發條件]，
系統 SHALL [必要行為]。

#### Scenario: [情境名稱]
GIVEN [前提]
WHEN [動作]
THEN [預期結果]
AND [附加結果]
```

## 已知未完成項目（需要建 Changes）

- [ ] `uploadedAt` 鎖定（60 天計時器重置 bug）— 見 file-retention/spec.md
- [ ] 90 天專案到期功能 — 見 file-retention/spec.md
- [ ] `audit_projects`、`invoice_entries` 正式 DB migration（目前只有過期的 001 草稿）
- [ ] Supabase pg_cron 定期清理（server-side cleanup）
