# OCR 自我調整與反饋迴圈

## 系統架構

```
用戶上傳發票
    ↓
OCR 處理
    ↓
結果有誤或新類別？
    ↓ 是
[OCRFeedbackDialog] 用戶回報
    ↓
Supabase 儲存反饋
    ↓
[process-ocr-feedback] Edge Function
    ├─ AI (Gemini) 分析
    ├─ 識別根因
    ├─ 提出改進建議
    └─ 更新 ocr_feedback 表
    ↓
[EmailNotificationService] 發送通知
    ↓
📧 Email 送達你的信箱
    ├─ 根因分析
    ├─ 建議改進（Prompt / 驗證規則 / Registry）
    ├─ 預期影響評估
    └─ 核准 / 拒絕 連結
    ↓
你確認 → ✅ 核准
    ↓
自動執行改動（待實現）
    ├─ 更新 Prompt 檔案
    ├─ 更新驗證規則
    ├─ 更新 documentRegistry
    └─ 將案例加入 Golden Test Sample
    ↓
Golden Test Sample 驗證
    ↓
部署到生產環境
```

## 元件清單

### 後端服務

#### 1. `services/ocrFeedbackService.ts`
- **職責**: AI 分析、結構化報告生成
- **主方法**:
  - `analyzeFeedback()`: 調用 Gemini 分析反饋
  - `formatReportForEmail()`: 格式化 Email 內容
- **使用場景**: Edge Function 調用

#### 2. `services/emailNotificationService.ts`
- **職責**: Email 發送、報告彙總
- **主方法**:
  - `sendFeedbackReport()`: 立即發送個別報告（有新反饋時）
  - `sendWeeklyDigest()`: 每週一發送彙總報告
  - `sendApprovalConfirmation()`: 發送核准/拒絕確認
- **觸發頻率**: 
  - 即時（每次有新反饋）
  - 每週一早上 9:00（彙總報告）

#### 3. `supabase/functions/process-ocr-feedback/index.ts`
- **職責**: 接收反饋、調用 AI、儲存結果
- **觸發方式**: HTTP POST 從前端
- **流程**:
  1. 儲存反饋到 `ocr_feedback` 表
  2. 調用 Gemini 分析
  3. 更新 `suggested_actions` 字段
  4. 觸發 Email 發送

### 前端元件

#### 1. `src/components/OCRFeedbackDialog.tsx`
- **職責**: 用戶反饋 UI
- **功能**:
  - 錯誤類型選擇（4 種）
  - 問題描述輸入
  - 預期修正（可選）
  - 原始 OCR 結果預覽
  - 進度指示
- **集成點**: 在 OCR 結果顯示頁面，加入「回報問題」按鈕

### 資料庫表

#### `ocr_feedback` 表
```sql
id (UUID)                       -- 主鍵
file_name (TEXT)               -- 發票檔名
file_id (TEXT)                 -- 檔案 ID
user_id (TEXT)                 -- 上傳用戶 ID
user_email (TEXT)              -- 用戶 Email
error_type (TEXT)              -- ocr_error, classification_error, 等
error_description (TEXT)       -- 用戶描述
original_ocr_result (JSONB)    -- 原始 OCR 結果
ai_analysis (TEXT)             -- AI 分析文本
suggested_actions (JSONB)      -- 結構化的改進建議
report_status (TEXT)           -- pending_review, approved, rejected, implemented
reviewed_at (TIMESTAMP)        -- 審核時間
reviewed_by (TEXT)             -- 審核者 ID
review_notes (TEXT)            -- 審核備註
implementation_started_at      -- 實裝開始時間
implementation_completed_at    -- 實裝完成時間
implementation_notes (TEXT)    -- 實裝備註
created_at / updated_at        -- 系統時間戳
```

## 實作步驟

### Step 1: 環境配置

在 `.env` 中添加：

```bash
VITE_SUPABASE_URL=https://...supabase.co
VITE_SUPABASE_ANON_KEY=...
GEMINI_API_KEY=...
ADMIN_EMAIL=你的email@example.com
ADMIN_PANEL_URL=http://localhost:5173/admin/feedback
```

### Step 2: 建立 Supabase 表

執行遷移：
```bash
npm run db:migrate
```

（已在 `mcp__claude_ai_Supabase__apply_migration` 中執行）

### Step 3: 部署 Edge Function

```bash
supabase functions deploy process-ocr-feedback
```

或使用 Supabase Dashboard 上傳。

### Step 4: 前端集成

在 OCR 結果頁面加入反饋按鈕：

```tsx
import { OCRFeedbackDialog } from '@/components/OCRFeedbackDialog';

function OCRResultPage() {
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <>
      <button onClick={() => setFeedbackOpen(true)}>
        回報問題
      </button>
      <OCRFeedbackDialog
        isOpen={feedbackOpen}
        fileName={invoiceEntry.id}
        fileId={invoiceEntry.file.id}
        ocrResult={ocrData}
        onClose={() => setFeedbackOpen(false)}
      />
    </>
  );
}
```

### Step 5: 設置 Email 服務

目前示範程式碼使用 console.log。實際部署時選擇一個：

#### 選項 A: Resend (推薦)

```bash
npm install resend
```

更新 `emailNotificationService.ts`:

```typescript
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

private async sendEmail(options: any): Promise<boolean> {
  const result = await resend.emails.send({
    from: 'noreply@example.com',
    to: options.to,
    subject: options.subject,
    html: options.html
  });
  return !result.error;
}
```

#### 選項 B: SendGrid

```bash
npm install @sendgrid/mail
```

#### 選項 C: Supabase 內建 (無額外成本)

使用 Supabase 的 email 功能，但需要額外配置。

### Step 6: 設置週一早上 9:00 的自動報告

在 GitHub Actions 中或 Supabase Cron 中設置：

```sql
-- Supabase SQL Editor
-- 建立 cron job
select cron.schedule(
  'send-weekly-ocr-feedback-digest',
  '0 1 * * 1',  -- 每週一 UTC 01:00 (台灣 09:00)
  $$
  select send_weekly_digest()
  $$
);
```

或在 Vercel Cron 中設置（見下方）。

## Email 報告格式

### 個別報告（立即發送）

```
【OCR 自我調整報告】

檔案名稱: G61-Q40033.pdf
上傳者: user@example.com
分析時間: 2026-05-26 09:15

━━━━━━━━━━━━━━━━━━━━━━━

📊 根因分析
━━━━━━━━━━━━━━━━━━━━━━━

日期欄位識別為 '2O26' 而非 '2026'（OCR 混淆 O 和 0）

━━━━━━━━━━━━━━━━━━━━━━━

🔧 建議改進方案
━━━━━━━━━━━━━━━━━━━━━━━

1. [HIGH] prompt_update
   檔案/模組: services/prompts/T300.ts
   修改內容: 在 T300 prompt 中加入 "日期欄位中，0 是數字零，不是字母 O" 的提示
   理由: 提高 Gemini 對數字和字母區別的敏感度

2. [HIGH] validation_rule
   檔案/模組: services/validationPipeline.ts
   修改內容: 驗證發票日期格式，年份只接受 20xx (4 位數字)
   理由: 防止 OCR 誤讀導致的無效日期通過

3. [MEDIUM] test_case
   檔案/模組: Test Data/Golden Test Sample/date_errors/
   修改內容: 將本案例 G61-Q40033.pdf 加入 Golden Test Sample date_errors 類別
   理由: 作為回歸測試的基準，確保日期誤讀問題不會再次發生

━━━━━━━━━━━━━━━━━━━━━━━

💡 預期影響
━━━━━━━━━━━━━━━━━━━━━━━━

高影響：建議的改動可能影響 T300 稅別處理。
需要在 Golden Test Sample 進行完整回歸測試。

摘要: 該錯誤源於 OCR 模型無法清晰區分數字 0 和字母 O。
透過 Prompt 優化 + 驗證規則 + 測試資料，可預期降低 80% 的類似誤讀。

━━━━━━━━━━━━━━━━━━━━━━━

✅ 請確認下列行動
━━━━━━━━━━━━━━━━━━━━━━━

[核准並執行] [拒絕 - 需重新分析]

後續步驟:
1. 確認上述建議
2. 核准後，系統將自動執行改動
3. 在 Golden Test Sample 上執行驗證
4. 如驗證通過，自動部署到生產環境
```

### 每週彙總報告

```
【每週報告】OCR 自我調整 - 3 筆待確認

本週發現 3 筆待確認的 OCR 反饋

[統計]
- 待確認案例: 3
- 錯誤類型: 2 種 (ocr_error, classification_error)
- 已分析: 3
- 等待審核: ⏳

[詳細列表]
G61-Q40033.pdf - ocr_error - user@example.com
G61-Q40034.pdf - classification_error - user@example.com
G61-Q40035.pdf - ocr_error - user@example.com

[快速連結]
所有待確認報告 → http://...admin/feedback?status=pending_review
反饋分析儀表板 → http://...admin/feedback/analytics
```

## 實施檢查清單

- [ ] 建立 `ocr_feedback` 表
- [ ] 部署 `process-ocr-feedback` Edge Function
- [ ] 實裝 Email 服務（選擇一個方案）
- [ ] 前端集成 OCRFeedbackDialog
- [ ] 配置環境變數
- [ ] 建立週一早上 9:00 的彙總報告排程
- [ ] 測試反饋流程（測試->分析->Email）
- [ ] 建立管理後台的核准/拒絕 UI（待實現）
- [ ] 實裝自動執行改動的邏輯（待實現）

## 後續實現

### Phase 2: 自動執行改動

當你在 Email 中點擊「核准」後：

1. 後端根據 `suggested_actions` 自動執行改動
   - 更新 Prompt 檔案
   - 更新驗證規則
   - 更新 documentRegistry
   
2. 提交到 feature 分支（自動建立 Pull Request）

3. 在 Golden Test Sample 執行 `npm test`

4. 如果通過，自動合併到 main 並部署

### Phase 3: 管理後台

建立管理頁面：
- `/admin/feedback` — 所有反饋列表
- `/admin/feedback/:id` — 詳細檢視 + 核准/拒絕按鈕
- `/admin/feedback/analytics` — 趨勢分析

## FAQ

**Q: 為什麼要一週才發一次 Email？**
A: 避免郵件轟炸。如果每次都發，你的信箱會被淹沒。一週一次彙總能讓你批量評審。

**Q: 核准後自動改動可靠嗎？**
A: 目前是手動執行，確保穩定後再自動化。自動化的改動會先在測試環境驗證，只有通過才會部署。

**Q: Golden Test Sample 要怎麼自動更新？**
A: 核准的案例會自動複製到 `Test Data/Golden Test Sample/` 的對應類別，然後提交 Pull Request 給你確認。

**Q: 如果 AI 分析有誤呢？**
A: 你可以拒絕報告並加上備註。系統會記錄，幫助改進 AI 的分析準確度。

---

**Last Updated**: 2026-05-26
