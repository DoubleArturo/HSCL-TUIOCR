-- Fix data isolation: replace permissive qual=true policies with per-user RLS.
-- Previously all three tables had read_all/write policies with qual='true',
-- allowing any authenticated user to read/write any row. App-layer user_id
-- filters were the only protection — fragile and bypassable via stale sessions.
--
-- audit_projects: filter by user_id directly (owner column on the table).
-- invoice_entries / erp_records: filter via EXISTS on audit_projects ownership.
-- Also adds indexes to keep the EXISTS subqueries fast.

-- ── audit_projects ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS read_all        ON audit_projects;
DROP POLICY IF EXISTS projects_insert ON audit_projects;
DROP POLICY IF EXISTS projects_update ON audit_projects;
DROP POLICY IF EXISTS projects_delete ON audit_projects;

CREATE POLICY ap_select ON audit_projects
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY ap_insert ON audit_projects
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY ap_update ON audit_projects
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY ap_delete ON audit_projects
  FOR DELETE USING (auth.uid() = user_id);

-- ── invoice_entries ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS read_all               ON invoice_entries;
DROP POLICY IF EXISTS invoice_entries_insert ON invoice_entries;
DROP POLICY IF EXISTS invoice_entries_update ON invoice_entries;
DROP POLICY IF EXISTS invoice_entries_delete ON invoice_entries;

CREATE POLICY ie_select ON invoice_entries
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM audit_projects p WHERE p.id = invoice_entries.project_id AND p.user_id = auth.uid())
  );
CREATE POLICY ie_insert ON invoice_entries
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM audit_projects p WHERE p.id = invoice_entries.project_id AND p.user_id = auth.uid())
  );
CREATE POLICY ie_update ON invoice_entries
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM audit_projects p WHERE p.id = invoice_entries.project_id AND p.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM audit_projects p WHERE p.id = invoice_entries.project_id AND p.user_id = auth.uid())
  );
CREATE POLICY ie_delete ON invoice_entries
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM audit_projects p WHERE p.id = invoice_entries.project_id AND p.user_id = auth.uid())
  );

-- ── erp_records ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS read_all           ON erp_records;
DROP POLICY IF EXISTS erp_records_insert ON erp_records;
DROP POLICY IF EXISTS erp_records_update ON erp_records;
DROP POLICY IF EXISTS erp_records_delete ON erp_records;

CREATE POLICY er_select ON erp_records
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM audit_projects p WHERE p.id = erp_records.project_id AND p.user_id = auth.uid())
  );
CREATE POLICY er_insert ON erp_records
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM audit_projects p WHERE p.id = erp_records.project_id AND p.user_id = auth.uid())
  );
CREATE POLICY er_update ON erp_records
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM audit_projects p WHERE p.id = erp_records.project_id AND p.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM audit_projects p WHERE p.id = erp_records.project_id AND p.user_id = auth.uid())
  );
CREATE POLICY er_delete ON erp_records
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM audit_projects p WHERE p.id = erp_records.project_id AND p.user_id = auth.uid())
  );

-- ── indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_audit_projects_user_id     ON audit_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_invoice_entries_project_id ON invoice_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_erp_records_project_id     ON erp_records(project_id);
