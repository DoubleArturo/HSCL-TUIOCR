-- ============================================================
-- Migration 001: Cloud Projects & Invoices
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Projects table (一個帳號可以有多個月份專案)
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT        PRIMARY KEY,          -- "proj_1234567890"
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,             -- "2024-05月 進項發票"
  year        INTEGER,
  month       INTEGER,
  erp_data    JSONB       NOT NULL DEFAULT '[]', -- ERPRecord[] 完整陣列
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Invoices table (每張上傳的發票/OCR 結果)
CREATE TABLE IF NOT EXISTS invoices (
  id           TEXT        NOT NULL,            -- "G61-PC0001"
  project_id   TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status       TEXT        NOT NULL DEFAULT 'PENDING', -- PENDING/SUCCESS/ERROR
  ocr_data     JSONB       NOT NULL DEFAULT '[]',      -- InvoiceData[] 陣列
  file_name    TEXT,
  file_type    TEXT,
  storage_path TEXT,                            -- Supabase Storage 路徑
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, project_id)
);

-- 3. Enable Row Level Security (每人只能看自己的資料)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
CREATE POLICY "projects_owner_only" ON projects
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "invoices_owner_only" ON invoices
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 5. 更新時間自動更新 trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 6. Storage Bucket (在 Supabase Dashboard 執行 或 用以下 SQL)
-- ============================================================

-- 建立私有 bucket (只有登入使用者才能存取)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'invoice-files',
  'invoice-files',
  false,
  10485760,  -- 10MB per file limit
  ARRAY['image/jpeg', 'image/png', 'image/tiff', 'application/pdf', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: 每人只能存取自己的資料夾 ({user_id}/...)
CREATE POLICY "invoice_files_owner_only" ON storage.objects
  FOR ALL USING (
    bucket_id = 'invoice-files' AND
    auth.uid()::text = (string_to_array(name, '/'))[1]
  )
  WITH CHECK (
    bucket_id = 'invoice-files' AND
    auth.uid()::text = (string_to_array(name, '/'))[1]
  );
