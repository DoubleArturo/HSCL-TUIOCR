# 新專案交接文件：家庭記帳 LINE BOT + 儀表板

> **給新 Session 的 Claude**：這份文件是完整的設計規格 + 工作指令。
> 你的任務是建立這個新專案，包含架構、Agent Team、文件、測試（含 E2E）。
> 按照「開工順序」逐步執行，不要跳步。

---

## 專案背景

**老闆**：一對夫妻，老公是主要開發者，老婆是終端使用者
**目標**：
1. 用 LINE BOT 讓兩人都能快速記帳
2. Web 儀表板讓兩人一起討論和改善開銷
3. 長期追蹤老婆財務獨立進度（目前老公暫時支付部分費用）

**老闆的學習目標**：透過這個專案學習 Next.js 全端開發 + Agent Team 工作流（Issue-driven，Claude 實作，老闆 review）

---

## 技術棧

| 服務 | 用途 | 費用 |
|------|------|------|
| **Next.js 15 (App Router)** | webhook + dashboard 同一個 codebase | 免費 |
| **Vercel** | 部署 | 免費方案夠用 |
| **Supabase** | PostgreSQL + Auth | 免費（500MB，2人用量） |
| **Gemini Flash 2.0** | LINE 訊息 NLP 解析 | ~$0（2人每天30筆 < $0.01） |
| **LINE Messaging API** | BOT | 免費（接收無限，推播1000則/月免費） |
| **Playwright** | E2E 測試 | 免費 |
| **Vitest** | Unit + Integration 測試 | 免費 |

---

## 整體架構

```
LINE APP（老公 + 老婆）
    │ 傳訊息
    ▼
LINE Messaging API
    │ webhook POST（含 LINE-Signature 驗證）
    ▼
Next.js API Route: /api/webhook/line
    │
    ├──→ Gemini Flash（NLP 解析）
    │         └──→ 解析失敗 → 引導式問答 fallback
    │
    ▼
Supabase（PostgreSQL）
    │
    ▼
Next.js Dashboard（/dashboard）
    頁面：月總覽 / 類別明細 / 預算狀態 / 帳目列表
```

---

## 資料模型（Supabase Schema）

```sql
-- 使用者（LINE 帳號綁定）
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,     -- '老公' | '老婆'
  role TEXT NOT NULL CHECK (role IN ('husband', 'wife')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 支出類別（含預算上限）
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,             -- '食', '交通', '生活', '娛樂', '醫療', '其他'
  budget_monthly INTEGER,         -- 月預算（TWD），null = 不設限
  color TEXT DEFAULT '#6366f1',   -- 儀表板顏色
  icon TEXT DEFAULT '💰',         -- emoji
  sort_order INTEGER DEFAULT 0
);

-- 支出主表
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount INTEGER NOT NULL,                          -- TWD，不存小數
  category_id UUID REFERENCES categories(id),
  paid_by UUID REFERENCES users(id) NOT NULL,       -- 誰掏錢付的
  expense_type TEXT NOT NULL CHECK (
    expense_type IN ('personal', 'joint', 'covered')
  ),
  -- personal: 自己的費用，自己付
  -- joint: 共同費用（家庭支出）
  -- covered: 老公幫老婆付（追蹤財務獨立進度用）
  covered_for UUID REFERENCES users(id),            -- covered 時填老婆的 user_id
  note TEXT,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  raw_input TEXT,                                   -- 原始 LINE 訊息（debug 用）
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 月預算覆寫（特定月份調整預算）
CREATE TABLE monthly_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES categories(id),
  year_month TEXT NOT NULL,                         -- '2025-01'
  limit_amount INTEGER NOT NULL,
  UNIQUE(category_id, year_month)
);
```

**預設類別 seed data：**
```sql
INSERT INTO categories (name, budget_monthly, color, icon, sort_order) VALUES
  ('食', 15000, '#f97316', '🍜', 1),
  ('交通', 5000, '#3b82f6', '🚗', 2),
  ('生活', 8000, '#10b981', '🏠', 3),
  ('娛樂', 5000, '#a855f7', '🎮', 4),
  ('醫療', 3000, '#ef4444', '💊', 5),
  ('其他', NULL, '#6b7280', '📦', 6);
```

---

## LINE BOT 對話流程

### 正常路徑（Gemini 解析成功）
```
使用者：午餐跟老婆吃牛肉麵350
Bot：✅ 記好了！
     🍜 食費 $350（共同）
     2025-01-15｜午餐牛肉麵
     
     [✅ 確認] [✏️ 修改] [🗑️ 刪除]
```

### Fallback 路徑（Gemini 無法解析）
```
使用者：今天跟朋友
Bot：這筆費用多少錢？

使用者：850
Bot：什麼類別？
     [🍜食] [🚗交通] [🏠生活] [🎮娛樂] [💊醫療] [📦其他]

使用者：[娛樂]
Bot：是誰的費用？
     [👨 我的] [👩 老婆的] [👫 共同的]

使用者：[我的]
Bot：✅ 記好了！
     🎮 娛樂 $850（個人）
     2025-01-15
```

### 特殊指令
```
/summary          → 本月支出摘要
/budget           → 各類別預算使用狀況
/last             → 最後一筆支出
/delete           → 刪除最後一筆
/help             → 指令列表
```

### Gemini NLP Prompt 設計
```
你是記帳助手。從以下訊息提取支出資訊，回傳 JSON。

訊息：{userMessage}

回傳格式：
{
  "amount": number | null,
  "category": "食" | "交通" | "生活" | "娛樂" | "醫療" | "其他" | null,
  "expense_type": "personal" | "joint" | "covered" | null,
  "note": string | null,
  "confidence": number  // 0-1，解析把握程度
}

規則：
- 提到「老婆」「一起」→ expense_type = "joint"
- 金額不明確 → amount = null（觸發 fallback）
- confidence < 0.7 → 觸發 fallback 確認
```

---

## 儀表板規格

### 頁面結構
```
/dashboard                    → 月總覽（預設本月）
/dashboard/categories/[id]    → 類別明細 + 歷史趨勢
/dashboard/expenses           → 帳目列表（可篩選/編輯）
/dashboard/independence       → 老婆財務獨立追蹤
```

### 月總覽頁面內容
1. **本月支出總計**（vs 上月）
2. **類別環形圖**（各類別佔比）
3. **類別預算卡片**（每個類別：已花 / 預算，超過變紅）
4. **費用類型分布**：個人 / 共同 / 老公幫付（covered）
5. **最近 10 筆支出**

### 財務獨立追蹤頁面
- 老婆「自己支付」vs「老公代付」的月趨勢折線圖
- 當月獨立比例（%）
- 里程碑設定（如：「達到 60% 獨立」時通知）

---

## 測試策略

### 單元測試（Vitest）
| 測試目標 | 檔案 |
|---------|------|
| Gemini NLP 解析邏輯 | `lib/nlp/parseExpense.test.ts` |
| LINE 訊息 signature 驗證 | `lib/line/verifySignature.test.ts` |
| Expense 金額計算 | `lib/expense/calculations.test.ts` |
| 月預算狀態判斷 | `lib/budget/budgetStatus.test.ts` |

### Integration 測試（Vitest + Supabase test instance）
| 測試目標 | 檔案 |
|---------|------|
| Expense CRUD | `lib/db/expenses.test.ts` |
| User 綁定流程 | `lib/db/users.test.ts` |

### E2E 測試（Playwright）
| 測試情境 | 檔案 |
|---------|------|
| 新使用者第一次傳訊息 → 綁定 → 記帳 | `e2e/onboarding.spec.ts` |
| 正常記帳 → 儀表板出現新一筆 | `e2e/expense-flow.spec.ts` |
| Fallback 流程：訊息不完整 → 引導填寫 | `e2e/fallback-flow.spec.ts` |
| 預算超標 → 儀表板顯示警告 | `e2e/budget-alert.spec.ts` |
| 月總覽儀表板基本顯示 | `e2e/dashboard.spec.ts` |

---

## 專案文件結構（Agent Team 基礎建設）

```
.claude/
  CLAUDE.md                         ← 主要 AI 工作規則（你要寫）
  QUICK-REF.md                      ← 踩坑速查
  memory/
    design-decisions.md             ← 設計決策記錄
    known-bugs.md                   ← 已知問題
  modules/
    CLAUDE-data-contract.md         ← 資料結構定義
    CLAUDE-linebot-logic.md         ← LINE BOT 業務邏輯
    CLAUDE-testing-requirements.md  ← 專案實際測試規範（非模板！）

.agent/
  agents/
    ORCHESTRATOR.md                 ← 任務路由邏輯
    nextjs-specialist.md            ← Next.js API + Dashboard 角色
    linebot-specialist.md           ← LINE BOT 邏輯角色
    test-guardian.md                ← 測試守門員角色
  skills/                           ← 從 HSCL-TUIOCR 複製過來
    brainstorming/
    writing-plans/
    subagent-driven-development/
    dispatching-parallel-agents/
    test-driven-development/
    using-git-worktrees/
    systematic-debugging/
    verification-before-completion/
    finishing-a-development-branch/

ONBOARDING.md                       ← 新人第一天讀這個（必做！）
```

---

## ONBOARDING.md 必須包含的內容

（這是 HSCL-TUIOCR 最大的文件破口，新專案第一天就要寫好）

```markdown
# 新人 START HERE

## 本機啟動
1. cp .env.local.example .env.local
2. 填入：NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / 
         GEMINI_API_KEY / LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN
3. npm install && npm run dev → localhost:3000

## 測試
npm test                    # Vitest unit + integration
npm run test:e2e            # Playwright E2E（需要先 npm run dev）

## 核心檔案在哪
app/api/webhook/line/route.ts   ← LINE BOT 入口
lib/nlp/parseExpense.ts         ← Gemini NLP 解析
lib/db/expenses.ts              ← 資料庫操作
app/dashboard/page.tsx          ← 儀表板主頁

## 讀文件的順序
1. QUICK-REF.md（2分鐘）
2. .claude/modules/CLAUDE-data-contract.md（資料結構）
3. 按任務按需讀 .claude/modules/CLAUDE-linebot-logic.md

## 環境變數說明
NEXT_PUBLIC_SUPABASE_URL      Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY Supabase anon key（前端）
SUPABASE_SERVICE_ROLE_KEY     Supabase service key（server-side only）
GEMINI_API_KEY                Google AI Studio API key
LINE_CHANNEL_SECRET           LINE Developer Console
LINE_CHANNEL_ACCESS_TOKEN     LINE Developer Console
```

---

## Agent Team 角色定義

### ORCHESTRATOR.md
```markdown
# Orchestrator

收到任務後，根據 domain label 路由：
- `domain:linebot` → linebot-specialist
- `domain:dashboard` → nextjs-specialist  
- `domain:db` → nextjs-specialist（schema 相關）
- `domain:test` → test-guardian
- `domain:infra` → nextjs-specialist

每個任務完成後，強制跑 test-guardian 驗證。
```

### nextjs-specialist.md
```markdown
# Next.js Specialist

我負責：
- app/ 目錄下所有頁面和 API routes
- lib/db/ 資料庫操作
- Supabase schema 變更

我不動：
- lib/nlp/（LINE BOT NLP 邏輯）
- LINE signature 驗證邏輯

我完成後必須：
1. npm test 全過
2. 相關 E2E 測試通過
3. 更新 .claude/modules/CLAUDE-data-contract.md（如有 schema 變更）
```

### linebot-specialist.md
```markdown
# LINE BOT Specialist

我負責：
- app/api/webhook/line/route.ts
- lib/nlp/（Gemini 解析）
- lib/line/（LINE API 操作）
- 對話流程邏輯

我不動：
- app/dashboard/（UI 不是我的責任）
- Supabase schema（schema 變更找 nextjs-specialist）

禁止事項：
- 直接用 Gemini 結果，跳過 confidence 檢查
- LINE webhook 不驗 signature
- 把 LINE_CHANNEL_ACCESS_TOKEN 寫進 client-side code
```

### test-guardian.md
```markdown
# Test Guardian

每個 PR 前我要確認：
1. npm test 100% pass
2. npm run test:e2e 相關情境通過
3. 新增邏輯函數有對應 unit test
4. 新增 API route 有對應 integration test
5. 新增 E2E 情境有 spec 檔案

測試覆蓋底線：
- lib/ 下所有 pure function：必須有 unit test
- API routes：必須有 integration test
- 使用者可見的主要流程：必須有 E2E spec
```

---

## 初始 GitHub Issues（第一個 Sprint）

依序建立以下 Issues，按順序解決：

```
#1 [infra] 專案初始化
label: domain:infra, type:setup
內容：
- Next.js 15 (App Router) + TypeScript
- Supabase client 設定
- Vitest 設定
- Playwright 設定
- .env.local.example
- ONBOARDING.md
- .claude/ 和 .agent/ 基礎建設

#2 [db] Supabase schema + seed data
label: domain:db, type:feature
內容：
- 建立 users / categories / expenses / monthly_budgets 表
- RLS policies（只能看自己的資料）
- 預設 categories seed data
- TypeScript types 從 Supabase 生成

#3 [linebot] LINE webhook 基礎建設
label: domain:linebot, type:feature
內容：
- /api/webhook/line route
- LINE-Signature 驗證（必須！不驗直接 reject）
- 使用者首次訊息 → 綁定流程
- /help 指令

#4 [linebot] Gemini NLP 解析器
label: domain:linebot, type:feature
內容：
- lib/nlp/parseExpense.ts
- Gemini Flash API call
- confidence < 0.7 觸發 fallback
- unit tests（mock Gemini）

#5 [linebot] Fallback 引導式問答
label: domain:linebot, type:feature
內容：
- 對話狀態管理（儲存在 Supabase 或記憶體）
- 分步驟引導：金額 → 類別 → 誰的

#6 [linebot] 記帳確認 + 儲存流程
label: domain:linebot, type:feature
內容：
- 解析成功 → 回覆確認訊息
- 使用者按確認 → 存入 Supabase
- 修改 / 刪除功能

#7 [dashboard] 月總覽頁面
label: domain:dashboard, type:feature
內容：
- /dashboard 頁面
- 環形圖（使用 recharts 或 tremor）
- 類別預算卡片
- 最近 10 筆支出列表

#8 [dashboard] 預算警告
label: domain:dashboard, type:feature
內容：
- 超過預算 80% → 橘色警告
- 超過 100% → 紅色
- LINE 主動推播通知（選做）

#9 [test] E2E 測試套件
label: domain:test, type:test
內容：
- Playwright 設定
- 5 個 E2E 情境（見測試策略）
- CI GitHub Action 自動跑

#10 [dashboard] 財務獨立追蹤頁面
label: domain:dashboard, type:feature
內容：
- 老婆 covered vs personal 月趨勢
- 獨立比例 %
- （最後做，其他功能穩定後）
```

---

## 從 HSCL-TUIOCR 學到的教訓（這個專案要從一開始就做對）

| HSCL-TUIOCR 的問題 | 這個專案的解法 |
|------|------|
| 沒有 ONBOARDING.md | Issue #1 就要建 ONBOARDING.md |
| CLAUDE-testing-requirements.md 是通用模板，提到不存在的 Playwright | 測試文件針對本專案寫，從一開始就用 Playwright |
| 路徑不一致（`services/` vs `src/services/`） | 統一用 Next.js 慣例，`app/` + `lib/` |
| 兩個已知問題懸而未決（Issue 5, 7）| known-bugs.md 有問題立刻記，立刻追蹤狀態 |
| CLAUDE-api-routes.md 是空殼 | 不建這個檔案，API 路由在 ONBOARDING.md 裡說清楚 |
| 禁止清單只是文件，沒有機器執行 | pre-commit hook 跑 npm test + lint |
| Agent Team 是事後補的 | Issue #1 就建 .claude/ 和 .agent/ |

---

## 開工順序

1. **建新 GitHub repo**：`couples-finance`
2. **建 branch**：`main`（保護）+ `develop`（開發用）
3. **在 Claude Code 新 session 開這個 repo**
4. **把這份文件給新 session 讀**
5. **讓新 session 從 Issue #1 開始，用 subagent-driven-development 流程執行**

新 session 的第一句指令建議：

```
請讀這份交接文件，然後用 subagent-driven-development 工作流，
從 Issue #1 開始建立這個專案。每個 Issue 完成後等我確認再繼續。
```

---

## 設計決策記錄（初始版）

### DD-001：選 Next.js 而非 Vite + Express
**決定**：用 Next.js App Router
**理由**：webhook API 和 Dashboard 在同一個 codebase，Vercel 部署零配置
**風險**：老闆需要學 App Router 新概念（Server Components, Route Handlers）
**接受風險**：學習成本正好是老闆想要的

### DD-002：Supabase 而非 Google Sheets
**決定**：Supabase 為主資料庫
**理由**：Dashboard 需要 SQL 查詢，Google Sheets API 無法高效做月彙總
**老闆偏好**：老闆原本傾向 Google Sheets（免費），Supabase 免費方案同樣符合需求
**保留彈性**：未來可加 export-to-sheets 功能

### DD-003：金額用 INTEGER 不用 FLOAT
**決定**：amount 欄位存 TWD 整數
**理由**：台灣記帳不需要小數，避免浮點數誤差
**規則**：所有金額計算皆用整數，顯示時才格式化

### DD-004：expense_type 三種狀態
**決定**：`personal | joint | covered`
**理由**：老闆需要追蹤老婆財務獨立進度，covered = 老公暫時代付
**未來**：當 covered 金額趨近於零，代表達成財務獨立目標

---

*文件建立時間：2026-05-31*
*設計討論來源：HSCL-TUIOCR 專案 claude/llm-agent-architecture-9J9JX branch*
