import { useMemo } from 'react';
import type { Project, AuditRow } from '../../types';
import { computeAuditRows } from '../lib/auditLogic';

const REVIEWABLE_DIFF_KEYS = ['date', 'amount', 'inv_no', 'tax_code', 'tax_id', 'tax_id_unclear'];

export interface AuditMetrics {
  /** 稽核覆蓋率 = 已匯入 / (已匯入 + 未匯入)，反映有多少比例的帳款成功核對到實體憑證 */
  auditCoverage: number;
  /** 異常捕獲數：MISMATCH 中含有真實 diff key 的絕對筆數 */
  discrepancyCount: number;
  duration: number;
  /** 已匯入憑證數（有檔案、已完成解析、排除外國Invoice、排除純no_match_found） */
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
    const empty: AuditMetrics = { auditCoverage: 0, discrepancyCount: 0, duration: 0, uploaded: 0, missing: 0, total: 0 };
    if (!project) return empty;

    const missing = auditList.filter(r => r.auditStatus === 'MISSING_FILE').length;

    // 已匯入 = has file, OCR done, not Invoice type, not pure no_match_found
    const uploaded = auditList.filter(row => {
      if (row.auditStatus === 'MISSING_FILE') return false;
      if (!row.file || row.file.status === 'PENDING' || row.file.status === 'PROCESSING') return false;
      if (isInvoiceType(row)) return false;
      if (row.auditStatus === 'MISMATCH' && row.diffDetails.length === 1 && row.diffDetails[0] === 'no_match_found') return false;
      return true;
    });

    const n = uploaded.length;
    // 稽核覆蓋率 = 已匯入 / (已匯入 + 未匯入)
    const auditCoverage = (n + missing) > 0 ? (n / (n + missing)) * 100 : 0;
    // 異常捕獲數 = MISMATCH rows with at least one reviewable diff key
    const discrepancyCount = uploaded.filter(r =>
      r.auditStatus === 'MISMATCH' && r.diffDetails.some(d => REVIEWABLE_DIFF_KEYS.includes(d))
    ).length;

    return {
      auditCoverage,
      discrepancyCount,
      duration: batchDuration,
      uploaded: n,
      missing,
      total: auditList.length,
    };
  }, [auditList, batchDuration]);

  return { auditList, metrics };
}
