import { useMemo } from 'react';
import type { Project, AuditRow, InvoiceEntry } from '../../types';
import { computeAuditRows } from '../lib/auditLogic';

export interface AuditMetrics {
  accuracy: number;
  duration: number;
  parsed: number;
  total: number;
}

export function useAuditList(project: Project | null, batchDuration: number): { auditList: AuditRow[]; metrics: AuditMetrics } {
  const auditList = useMemo<AuditRow[]>(() => {
    if (!project) return [];
    return computeAuditRows(project.erpData, project.invoices);
  }, [project]);

  const metrics = useMemo<AuditMetrics>(() => {
    if (!project) return { accuracy: 0, duration: 0, parsed: 0, total: 0 };

    const parsed = auditList.filter(row => {
      if (row.auditStatus === 'MISSING_FILE') return false;
      const f = row.file as (InvoiceEntry | null);
      if (!f || f.status === 'PENDING' || f.status === 'PROCESSING') return false;
      if (row.ocr?.error_code === 'NOT_INVOICE') return false;
      if (row.ocr?.document_type === 'Invoice' || row.ocr?.voucher_type === 'Invoice') return false;
      return true;
    });

    const correct = parsed.filter(r => r.auditStatus === 'MATCH').length;
    const accuracy = parsed.length > 0 ? (correct / parsed.length) * 100 : 0;
    return { accuracy, duration: batchDuration, parsed: parsed.length, total: auditList.length };
  }, [auditList, batchDuration]);

  return { auditList, metrics };
}
