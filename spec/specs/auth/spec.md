# Auth 認證規範

> Last verified: 2026-06-25, commit 1b7455e  
> 實作檔案：`services/authService.ts`, `services/supabaseClient.ts`, `components/LoginScreen.tsx`

---

## Requirement: Email/Password 登入

WHEN 使用者提交有效的 email 與密碼，
系統 SHALL 透過 Supabase Auth 驗證身份並建立 session。

#### Scenario: 登入成功
GIVEN 使用者輸入正確 email 與 password  
WHEN 提交登入表單  
THEN `authService.signIn()` 呼叫 Supabase `signInWithPassword`  
AND session 寫入 `supabaseClient.safeStorage`（記憶體 fallback 防 QuotaExceededError）  
AND `getSession()` 回傳 `AppUser { id, email }`  
AND UI 切換至 PROJECT_LIST 視圖

#### Scenario: 登入失敗
GIVEN 使用者輸入錯誤密碼  
WHEN 提交登入表單  
THEN Supabase 回傳 error  
AND LoginScreen 顯示錯誤訊息  
AND `setLoading(false)` 一定執行（finally block）

---

## Requirement: Session 持久化與重啟恢復

WHEN 頁面重新整理，
系統 SHALL 從 Supabase 重新驗證 session，不強制再次登入。

#### Scenario: 有效 session 重啟
GIVEN 使用者先前已登入  
WHEN 頁面重新整理  
THEN `initSession()` 呼叫 `supabase.auth.getUser()`  
AND 成功時回傳 AppUser，`setCurrentUser` 更新狀態  
AND `authLoading` 設為 false 後 UI 顯示

#### Scenario: Session 過期或無效
GIVEN localStorage token 過期  
WHEN `initSession()` 執行  
THEN Supabase 回傳 error  
AND `setCurrentUser(null)`  
AND UI 顯示 LoginScreen

---

## Requirement: 登出與 Cache 清除

WHEN 使用者登出，
系統 SHALL 清除 Supabase session 與所有本地 project cache。

#### Scenario: 正常登出
GIVEN 使用者已登入  
WHEN 點擊登出  
THEN `clearSession()` 呼叫 `supabase.auth.signOut()`  
AND `localStorage.removeItem('project_list')` 清除專案清單 cache  
AND `setCurrentUser(null)` 清除 React state  
AND UI 回到 LoginScreen

#### Scenario: 用戶切換（多帳號）
GIVEN 帳號 A 已登入且有 cache  
WHEN 帳號 A 登出、帳號 B 登入  
THEN `useProject` 的 `userId` 改變  
AND `useEffect([userId])` 立即清除 `projectList` 與 `project` state  
AND 重新從 Supabase 拉取帳號 B 的專案清單  
AND 帳號 A 的資料不會殘留

---

## Requirement: localStorage QuotaExceededError 防護

WHEN 裝置 localStorage 空間不足，
系統 SHALL fallback 至記憶體儲存，不拋出例外中斷操作。

#### Scenario: Quota 超出時 fallback
GIVEN localStorage.setItem 拋出 QuotaExceededError  
WHEN Supabase client 嘗試寫入 session  
THEN `safeStorage` adapter 攔截例外  
AND 改寫入 `_memStore`（Map）  
AND 後續 getItem 從 `_memStore` 讀取  
AND 使用者不感知任何錯誤

---

## Requirement: RLS 資料隔離

WHEN 任何使用者對 Supabase 進行 query，
系統 SHALL 只回傳該使用者自己的資料。

#### Scenario: 跨帳號 query 隔離
GIVEN 帳號 A 的 audit_projects 資料存在  
WHEN 帳號 B 查詢 audit_projects  
THEN RLS policy `ap_select` 過濾 `user_id = auth.uid()`  
AND 帳號 B 拿不到帳號 A 的任何專案

#### Scenario: invoice_entries 透過 project 隔離
GIVEN invoice_entries 無直接 user_id 欄位  
WHEN 查詢 invoice_entries  
THEN `ie_select` policy 使用 EXISTS subquery 驗證 audit_projects.user_id  
AND 只回傳屬於當前使用者專案的 entries
