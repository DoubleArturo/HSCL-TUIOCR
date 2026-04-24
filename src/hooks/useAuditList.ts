import { useMemo } from 'react';
import type { Project, AuditRow } from '../../types';
import { computeAuditRows } from '../lib/auditLogic';

export interface AuditMetrics {
  accuracy: number;
  duration: number;
  /** 已匯入憑證數（有檔案、已完成解析、排除外國Invoice） */
  uploaded: number;
  /** 未匯入憑證數（MISSING_FILE） */
  missing: number;
  /** auditList 總行數 */
  total: number;
}

function isInvoiceType(row: AuditRow): boolean {
  return row.ocr?.document_type === 'Invoice' ||
    row.ocr?.voucher_type === 'Invoice' ||
    row.ocr?.error_code === 'NOT_INVOICE';
}

export function useAuditList(project: Project | null, batchDuration: number): { auditList: AuditRow[]; metrics: AuditMetrics } {
  const auditList = useMemo<AuditRow[]>(() => {
    if (!project) return [];
    return computeAuditRows(project.erpData, project.invoices);
  }, [project]);

  const metrics = useMemo<AuditMetrics>(() => {
    const empty: AuditMetrics = { accuracy: 0, duration: 0, uploaded: 0, missing: 0, total: 0 };
    if (!project) return empty;

    const missing = auditList.filter(r => r.auditStatus === 'MISSING_FILE').length;

    // 已匯入 = has file, OCR done (not PENDING/PROCESSING), not a foreign Invoice type
    const uploaded = auditList.filter(row => {
      if (row.auditStatus === 'MISSING_FILE') return false;
      if (!row.file || row.file.status === 'PENDING' || row.file.status === 'PROCESSING') return false;
      if (isInvoiceType(row)) return false;
      return true;
    });

    const correct = uploaded.filter(r => r.auditStatus === 'MATCH').length;
    const accuracy = uploaded.length > 0 ? (correct / uploaded.length) * 100 : 0;

    return {
      accuracy,
      duration: batchDuration,
      uploaded: uploaded.length,
      missing,
      total: auditList.length,
    };
  }, [auditList, batchDuration]);

  return { auditList, metrics };
}
