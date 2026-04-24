import { useMemo } from 'react';
import type { Project, AuditRow } from '../../types';
import { computeAuditRows } from '../lib/auditLogic';

export interface AuditMetrics {
  /** ERP比對正確率 = MATCH / 已匯入（受ERP資料品質影響） */
  erpMatchRate: number;
  /** AI辨識正確率 = (MATCH + 標記為ERP問題) / 已匯入（純反映AI讀取能力） */
  ocrAccuracy: number;
  duration: number;
  /** 已匯入憑證數（有檔案、已完成解析、排除外國Invoice、排除純no_match_found） */
  uploaded: number;
  /** 未匯入憑證數（MISSING_FILE） */
  missing: number;
  /** 標記為ERP問題的筆數 */
  erpDiscrepancyCount: number;
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
    const empty: AuditMetrics = { erpMatchRate: 0, ocrAccuracy: 0, duration: 0, uploaded: 0, missing: 0, erpDiscrepancyCount: 0, total: 0 };
    if (!project) return empty;

    const missing = auditList.filter(r => r.auditStatus === 'MISSING_FILE').length;

    // 已匯入 = has file, OCR done, not Invoice type, not pure no_match_found
    const uploaded = auditList.filter(row => {
      if (row.auditStatus === 'MISSING_FILE') return false;
      if (!row.file || row.file.status === 'PENDING' || row.file.status === 'PROCESSING') return false;
      if (isInvoiceType(row)) return false;
      // Exclude rows where the ONLY diff is no_match_found — file/ERP naming issue, not an OCR error
      if (row.auditStatus === 'MISMATCH' && row.diffDetails.length === 1 && row.diffDetails[0] === 'no_match_found') return false;
      return true;
    });

    const matchCount = uploaded.filter(r => r.auditStatus === 'MATCH').length;
    // Rows that are MISMATCH but user confirmed it's ERP data error (not OCR error)
    const erpDiscrepancyRows = uploaded.filter(r =>
      r.auditStatus === 'MISMATCH' && r.erp?.erp_discrepancy === true
    );

    const n = uploaded.length;
    const erpMatchRate = n > 0 ? (matchCount / n) * 100 : 0;
    // OCR accuracy counts both MATCH and confirmed-ERP-discrepancy as "AI read correctly"
    const ocrAccuracy = n > 0 ? ((matchCount + erpDiscrepancyRows.length) / n) * 100 : 0;

    return {
      erpMatchRate,
      ocrAccuracy,
      duration: batchDuration,
      uploaded: n,
      missing,
      erpDiscrepancyCount: erpDiscrepancyRows.length,
      total: auditList.length,
    };
  }, [auditList, batchDuration]);

  return { auditList, metrics };
}
