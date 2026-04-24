import type { AuditRow } from '../../types';
import { DIFF_LABELS } from './auditLogic';

export interface CSVExportOptions {
  projectName: string;
  model: string;
  accuracy: number;
  duration: number;
}

const STATUS_LABELS: Record<string, string> = {
  MATCH: 'OK',
  MISMATCH: '異常',
  MISSING_FILE: '缺件',
  EXTRA_FILE: '多餘',
};

function escapeCSV(val: string | number | null | undefined): string {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildAuditCSV(rows: AuditRow[], opts: CSVExportOptions): string {
  const summary = [
    `專案名稱,${escapeCSV(opts.projectName)}`,
    `匯出時間,${new Date().toLocaleString()}`,
    `使用模型,${escapeCSV(opts.model)}`,
    `辨識正確率,${opts.accuracy.toFixed(1)}%`,
    `總耗時,${(opts.duration / 1000).toFixed(1)}秒`,
    `總筆數,${rows.length}`,
    '',
  ];

  const headers = [
    '傳票編號', '狀態',
    'ERP_發票號碼', 'OCR_發票號碼',
    'ERP_賣方統編', 'OCR_賣方統編',
    'ERP_含稅總額', 'OCR_含稅總額',
    '差異說明',
  ];

  const dataRows = rows.map(item => [
    escapeCSV(item.id),
    escapeCSV(STATUS_LABELS[item.auditStatus] ?? item.auditStatus),
    escapeCSV(item.erp?.invoice_numbers.join(' / ') ?? ''),
    escapeCSV(item.ocr?.invoice_number ?? ''),
    escapeCSV(item.erp?.seller_tax_id ?? ''),
    escapeCSV(item.ocr?.seller_tax_id ?? ''),
    escapeCSV(item.erp?.amount_total ?? 0),
    escapeCSV(item.ocr?.amount_total ?? 0),
    escapeCSV(item.diffDetails.map(d => DIFF_LABELS[d as keyof typeof DIFF_LABELS] ?? d).join('; ')),
  ].join(','));

  return '﻿' + [...summary, headers.join(','), ...dataRows].join('\n');
}

export function downloadCSV(content: string, filename: string): void {
  const link = document.createElement('a');
  link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(content);
  link.download = filename;
  link.click();
}
