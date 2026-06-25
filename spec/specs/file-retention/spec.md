# File Retention 檔案保留政策規範

> Last verified: 2026-06-25, commit 1b7455e  
> 實作檔案：`services/cloudFileService.ts`, `src/hooks/useProject.ts`, `src/hooks/useOCRBatch.ts`  
> DB 欄位：`invoice_entries.storage_path`, `invoice_entries.uploaded_at`, `invoice_entries.file_deleted_at`

---

## 背景與設計目標

Supabase 免費方案 Storage 限制 1 GB。為控制空間使用：
- **60 天**：刪除 Supabase Storage 中的原始憑證（PDF/圖片）
- **90 天**：關閉（封存）整個專案（OCR 文字資料 + ERP 資料保留）

---

## Requirement: 原始憑證上傳至 Supabase Storage

WHEN OCR 處理完成，
系統 SHALL 將原始圖檔/PDF 上傳至 Supabase Storage，並記錄路徑與時間戳。

#### Scenario: 成功上傳
GIVEN OCR 處理完成，檔案存在於 IndexedDB  
WHEN `uploadInvoiceFile(projectId, invoiceId, file)` 呼叫  
THEN 上傳至 `invoices` bucket，路徑 `{projectId}/{invoiceId}/{fileName}`  
AND 回傳 `storagePath`  
AND `updateProjectInvoices` 設定 `inv.storagePath = storagePath`  
AND `inv.uploadedAt = new Date().toISOString()`（60 天計時器起點）

> ⚠️ **缺陷**：目前 `useOCRBatch.ts:160` 只設 `storagePath`，未設 `uploadedAt`。  
> 導致 `cloudSyncService.upsertInvoiceEntries` 每次 sync 都將 `uploaded_at` 重置為現在。  
> **需修復**：上傳成功後同時設定 `uploadedAt`。

#### Scenario: 上傳失敗
GIVEN 網路錯誤或 Storage 空間不足  
WHEN `uploadInvoiceFile` 回傳 null  
THEN `storagePath` 維持 undefined  
AND 本地 IndexedDB 仍有檔案可讀  
AND 不影響 OCR 結果顯示

---

## Requirement: uploadedAt 鎖定（計時器起點）

WHEN 原始憑證成功上傳，
系統 SHALL 鎖定 `uploadedAt` 時間戳，後續 sync 不得覆蓋。

#### Scenario: 首次上傳後 uploadedAt 固定
GIVEN invoice 首次上傳，`uploadedAt` 尚未設定  
WHEN 上傳成功  
THEN 設定 `uploadedAt = new Date().toISOString()`  
AND 後續 `upsertInvoiceEntries` 使用此值（不 fallback 到 now()）

#### Scenario: 再次 sync 不重置
GIVEN `inv.uploadedAt` 已設定  
WHEN `upsertInvoiceEntries` 再次執行  
THEN `uploaded_at = inv.uploadedAt`（非 `new Date()`）  
AND 60 天計時器不被重置

> **狀態**：❌ 尚未實作（計時器重置 bug 存在）

---

## Requirement: 60 天 Lazy Cleanup（原始憑證刪除）

WHEN 使用者開啟任一專案，
系統 SHALL 掃描並刪除該專案中已過期（> 60 天）的原始憑證。

#### Scenario: 過期檔案刪除
GIVEN `invoice_entries` 中有 `uploaded_at < now - 60天` AND `file_deleted_at IS NULL`  
WHEN `pruneExpiredFilesForProject(projectId)` 執行  
THEN 對每個過期 entry：  
  AND `deleteInvoiceFile(storagePath)` 從 Storage 刪除  
  AND `UPDATE invoice_entries SET file_deleted_at = NOW()`  
AND 回傳刪除數量

#### Scenario: 觸發時機
GIVEN `loadProject(id)` 執行完成  
WHEN 雲端資料 fetch 成功  
THEN `pruneExpiredFilesForProject(id).catch(() => {})` 背景觸發  
AND 不阻塞 UI 顯示

#### Scenario: 已刪除檔案的顯示
GIVEN `invoice_entry.fileDeletedAt` 不為 null（已刪除）  
WHEN 使用者嘗試預覽該發票  
THEN 顯示「檔案已於 N 天前自動刪除」訊息  
AND OCR 辨識結果（文字）仍可查閱

> ⚠️ **限制**：Lazy cleanup 只在「有人開啟專案」時觸發。  
> 若無人開啟過期專案，檔案不會自動刪除。  
> 完整方案需 Supabase pg_cron 定期執行（尚未實作）。

---

## Requirement: 90 天專案到期

WHEN 專案建立後 90 天，
系統 SHALL 封存該專案（OCR 文字與 ERP 資料保留，僅停止更新）。

#### Scenario: 到期計算
GIVEN `audit_projects.expires_at = created_at + 90天`  
WHEN 當前時間 > `expires_at`  
THEN `isProjectExpired(expires_at)` 回傳 true  
AND UI 顯示「專案已到期」badge  
AND 禁止上傳新發票（read-only mode）

#### Scenario: 到期後資料可查閱
GIVEN 專案已到期  
WHEN 使用者開啟專案  
THEN OCR 結果與 ERP 比對資料仍顯示  
AND 可匯出 CSV  
AND 不可上傳新發票或匯入 ERP

> **狀態**：❌ 尚未實作  
> 需要：  
> 1. `audit_projects` 加 `expires_at` 欄位（migration）  
> 2. `cloudSyncService.upsertProject` 建立時設 `expires_at = created_at + 90天`  
> 3. UI 判斷 `isProjectExpired()` 並限制操作

---

## Requirement: 跨瀏覽器原始憑證存取

WHEN 使用者在不同瀏覽器或裝置開啟已上傳的發票，
系統 SHALL 從 Supabase Storage 下載原始檔並顯示。

#### Scenario: 跨瀏覽器載入
GIVEN 發票在另一瀏覽器上傳，本地 IndexedDB 無此檔案  
WHEN `loadProject` Step 3 執行 `getFileWithCloudFallback(inv.id, inv.storagePath)`  
THEN 查 IndexedDB（miss）  
AND `downloadInvoiceFile(storagePath)` 從 `invoices` bucket 下載  
AND 寫回 IndexedDB（cache locally for next time）  
AND 回傳 File 物件供預覽

#### Scenario: Storage 已刪除（60 天後）
GIVEN `inv.storagePath` 存在但 Storage 檔案已被清除  
WHEN `downloadInvoiceFile` 呼叫  
THEN 回傳 null  
AND `getFileWithCloudFallback` 回傳 null  
AND UI 顯示「檔案已自動刪除」（由 `fileDeletedAt` 判斷）
