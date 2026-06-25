import { getSupabase } from './supabaseClient';

function getClient() { return getSupabase(); }

const BUCKET = 'invoices';
const FILE_RETENTION_DAYS = 60;

// ─── Upload ───────────────────────────────────────────────────────────────────

/**
 * Upload file to Supabase Storage.
 * Path convention: {projectId}/{invoiceId}/{fileName}
 * Returns storagePath on success, null on failure.
 */
export async function uploadInvoiceFile(
  projectId: string,
  invoiceId: string,
  file: File,
): Promise<string | null> {
  try {
    const storagePath = `${projectId}/${invoiceId}/${file.name}`;
    const { error } = await getClient()
      .storage
      .from(BUCKET)
      .upload(storagePath, file, { upsert: true });

    if (error) {
      console.error('[cloudFileService] uploadInvoiceFile error:', error.message, { projectId, invoiceId });
      return null;
    }
    return storagePath;
  } catch (err) {
    console.error('[cloudFileService] uploadInvoiceFile exception:', err);
    return null;
  }
}

// ─── Download ─────────────────────────────────────────────────────────────────

/**
 * Download file from Supabase Storage.
 * Returns null if not found, deleted, or on error.
 */
export async function downloadInvoiceFile(storagePath: string): Promise<Blob | null> {
  try {
    const { data, error } = await getClient()
      .storage
      .from(BUCKET)
      .download(storagePath);

    if (error) {
      console.error('[cloudFileService] downloadInvoiceFile error:', error.message, { storagePath });
      return null;
    }
    return data;
  } catch (err) {
    console.error('[cloudFileService] downloadInvoiceFile exception:', err);
    return null;
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * Delete file from Supabase Storage.
 * Called by lazy cleanup — does not throw on failure.
 */
export async function deleteInvoiceFile(storagePath: string): Promise<void> {
  try {
    const { error } = await getClient()
      .storage
      .from(BUCKET)
      .remove([storagePath]);

    if (error) {
      console.error('[cloudFileService] deleteInvoiceFile error:', error.message, { storagePath });
    }
  } catch (err) {
    console.error('[cloudFileService] deleteInvoiceFile exception:', err);
  }
}

// ─── Lazy Cleanup ─────────────────────────────────────────────────────────────

/**
 * Lazy cleanup: scan invoice_entries for this project where uploaded_at < 60 days ago,
 * storage_path IS NOT NULL, and file_deleted_at IS NULL.
 * For each expired file: delete from Storage, set file_deleted_at = NOW().
 * Returns count of files deleted (0 on any failure).
 */
export async function pruneExpiredFilesForProject(projectId: string): Promise<number> {
  try {
    const client = getClient();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - FILE_RETENTION_DAYS);

    const { data, error } = await client
      .from('invoice_entries')
      .select('id, storage_path')
      .eq('project_id', projectId)
      .not('storage_path', 'is', null)
      .is('file_deleted_at', null)
      .lt('uploaded_at', cutoff.toISOString());

    if (error) {
      console.error('[cloudFileService] pruneExpiredFilesForProject query error:', error.message, { projectId });
      return 0;
    }

    const rows = data ?? [];
    if (rows.length === 0) return 0;

    let deletedCount = 0;
    for (const row of rows) {
      const storagePath: string = row.storage_path;

      await deleteInvoiceFile(storagePath);

      const { error: updateErr } = await client
        .from('invoice_entries')
        .update({ file_deleted_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('project_id', projectId);

      if (updateErr) {
        console.error('[cloudFileService] pruneExpiredFilesForProject update error:', updateErr.message, { id: row.id });
      } else {
        deletedCount++;
      }
    }

    return deletedCount;
  } catch (err) {
    console.error('[cloudFileService] pruneExpiredFilesForProject exception:', err);
    return 0;
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * How many days until this file expires (60-day window from uploadedAt).
 * Returns negative if already expired.
 */
export function daysUntilFileExpiry(uploadedAtISO: string): number {
  const uploadedAt = new Date(uploadedAtISO).getTime();
  const expiresAt = uploadedAt + FILE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const now = Date.now();
  return Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000));
}

/**
 * Whether a project is expired (expires_at < now).
 */
export function isProjectExpired(expiresAtISO: string | null): boolean {
  if (!expiresAtISO) return false;
  return new Date(expiresAtISO).getTime() < Date.now();
}
