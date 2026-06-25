# Cloud Sync 雲端同步規範

> Last verified: 2026-06-25, commit 1b7455e  
> 實作檔案：`services/cloudSyncService.ts`, `services/cloudFileService.ts`, `src/hooks/useProject.ts`

---

## Requirement: 專案清單同步

WHEN 使用者登入後，
系統 SHALL 從 Supabase 拉取該帳號的所有 ProjectMeta，並支援 localStorage cache。

#### Scenario: 首次登入（無 cache）
GIVEN 使用者剛登入，localStorage 無 `project_list`  
WHEN `useProject(userId)` 的 `useEffect` 執行  
THEN `fetchProjectList()` 呼叫 `audit_projects` + `invoice_entries` join  
AND 結果寫入 `setProjectList` 與 `cacheWriteList`

#### Scenario: 再次登入（有 cache）
GIVEN localStorage 有 `project_list` cache  
WHEN `useEffect` 執行  
THEN 先用 cache 立即填入 `setProjectList`（樂觀顯示）  
AND 再 fetch 雲端資料覆寫（最終一致）

---

## Requirement: 專案自動儲存

WHEN 專案資料有變動，
系統 SHALL 在以下三個時機自動同步至 Supabase，不需使用者手動儲存。

#### Scenario: 定時儲存（10 秒）
GIVEN `isDirtyRef.current === true`（資料有改動）  
WHEN 每 10 秒的 interval 觸發  
THEN `syncProject()` 呼叫 upsertProject + upsertInvoiceEntries + upsertErpRecords  
AND `isDirtyRef.current = false`

#### Scenario: 分頁隱藏儲存（Chrome Memory Saver 防護）
GIVEN 使用者切換至另一個分頁  
WHEN `document.visibilityState === 'hidden'`  
THEN `handleVisibilityChange` 立即觸發 `syncProject()`  
AND 防止 Chrome 回收 tab 造成未儲存資料遺失

#### Scenario: OCR 完成後強制儲存
GIVEN 一批 OCR 處理完成  
WHEN `onBatchComplete` 回呼執行  
THEN `forceSave()` 立即執行 `saveSnapshot()`  
AND 確保 OCR 結果不因 tab 關閉而遺失

---

## Requirement: 專案載入（跨裝置）

WHEN 使用者在不同裝置或不同瀏覽器開啟同一專案，
系統 SHALL 從 Supabase 拉取資料並重建本地 IndexedDB cache。

#### Scenario: 相同裝置相同瀏覽器
GIVEN 本地 IndexedDB 與 localStorage cache 皆存在  
WHEN `loadProject(id)` 執行  
THEN Step 1：立即從 cache 顯示（`setProject(preloaded)`）  
AND Step 2：fetch Supabase 資料覆寫  
AND Step 3：async 從 IndexedDB rehydrate 圖檔 + previewUrl

#### Scenario: 不同瀏覽器或新裝置（跨瀏覽器存取）
GIVEN IndexedDB 無檔案，但 invoice_entry 有 `storage_path`  
WHEN Step 3 執行 `fileStorageService.getFileWithCloudFallback(inv.id, inv.storagePath)`  
THEN 先查 IndexedDB（miss）  
AND 從 Supabase Storage `invoices` bucket 下載  
AND 寫回 IndexedDB（cache locally）  
AND 回傳 File 物件，`previewUrl = URL.createObjectURL(file)`

---

## Requirement: ERP 資料同步

WHEN 使用者上傳 ERP Excel，
系統 SHALL 以 delete-then-insert 策略寫入 `erp_records`，避免重複鍵衝突。

#### Scenario: ERP 上傳
GIVEN 使用者選取 ERP Excel 檔  
WHEN `parseERPRows()` 解析成功  
THEN 先刪除舊的 `erp_records`（`DELETE WHERE project_id = ?`）  
AND 再批次 insert 新 rows  
AND 避免 ON CONFLICT 導致的 upsert 衝突

---

## Requirement: 跨裝置 invoice_entries 寫入

WHEN upsertInvoiceEntries 執行，
系統 SHALL 不寫入 `file_deleted_at`（由 lazy cleanup 寫），只寫 `storage_path` 與 `uploaded_at`。

#### Scenario: 首次上傳後 sync
GIVEN invoice 有 `storagePath`，`uploadedAt` 已由 useOCRBatch 設定  
WHEN `upsertInvoiceEntries` 執行  
THEN `storage_path = inv.storagePath`  
AND `uploaded_at = inv.uploadedAt`（不 fallback 到 now()，避免重置計時器）

> ⚠️ **已知缺陷**：目前 `useOCRBatch` 上傳後只設 `storagePath`，未設 `uploadedAt`，  
> 導致 `upsertInvoiceEntries` fallback 到 `new Date()`，60 天計時器每次 sync 都重置。  
> 修復追蹤：見 file-retention/spec.md Requirement: uploadedAt 鎖定。
