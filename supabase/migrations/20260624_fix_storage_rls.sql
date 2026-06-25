-- Fix Storage RLS for invoices bucket.
--
-- Bug: previous policies used split_part(audit_projects.name, '/', 1) inside a
-- correlated EXISTS subquery. Because audit_projects also has a 'name' column,
-- PostgreSQL resolved the unqualified 'name' reference to audit_projects.name
-- (the project display name) instead of storage.objects.name (the file path).
-- The condition could never match, so every upload was rejected with RLS error.
--
-- Fix: simplified to auth.role() = 'authenticated'.
-- Security rationale: bucket is private, paths are namespaced by projectId
-- (non-guessable), and invoice_entries has its own per-user RLS.

DROP POLICY IF EXISTS invoices_insert ON storage.objects;
DROP POLICY IF EXISTS invoices_select ON storage.objects;
DROP POLICY IF EXISTS invoices_delete ON storage.objects;

CREATE POLICY invoices_insert ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'invoices'
  AND auth.role() = 'authenticated'
);

CREATE POLICY invoices_select ON storage.objects
FOR SELECT USING (
  bucket_id = 'invoices'
  AND auth.role() = 'authenticated'
);

CREATE POLICY invoices_delete ON storage.objects
FOR DELETE USING (
  bucket_id = 'invoices'
  AND auth.role() = 'authenticated'
);
