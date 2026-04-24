import { describe, it, expect } from 'vitest';
import { buildAuditCSV } from './csvExport';
import type { AuditRow } from '../../types';

function makeRow(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    key: 'G11-Q10001_0',
    id: 'G11-Q10001',
    erp: {
      voucher_id: 'G11-Q10001',
      invoice_date: '2026-01-06',
      tax_code: 'T302',
      invoice_numbers: ['AB12345678'],
      seller_name: '某廠商',
      seller_tax_id: '12345678',
      amount_sales: 1000,
      amount_tax: 50,
      amount_total: 1050,
      raw_row: [],
    },
    files: [],
    file: null,
    ocr: {
      document_type: '統一發票',
      voucher_type: '三聯收銀',
      tax_code: 'T302',
      invoice_number: 'AB12345678',
      invoice_date: '2026-01-06',
      seller_name: '某廠商',
      seller_tax_id: '12345678',
      currency: 'TWD',
      amount_sales: 1000,
      amount_tax: 50,
      amount_total: 1050,
      has_stamp: true,
      verification: { ai_confidence: 95, logic_is_valid: true, flagged_fields: [] },
      field_confidence: { invoice_number: 99, invoice_date: 99, seller_name: 99, seller_tax_id: 99, currency: 99, amount_sales: 99, amount_tax: 99, amount_total: 99 },
      error_code: 'SUCCESS' as any,
    },
    auditStatus: 'MATCH',
    diffDetails: [],
    initialInvoiceIndex: 0,
    ...overrides,
  };
}

const BASE_OPTS = { projectName: '測試專案', model: 'gemini-flash', accuracy: 95.5, duration: 12300 };

describe('buildAuditCSV', () => {
  it('starts with BOM', () => {
    const csv = buildAuditCSV([makeRow()], BASE_OPTS);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });

  it('includes summary fields', () => {
    const csv = buildAuditCSV([makeRow()], BASE_OPTS);
    expect(csv).toContain('測試專案');
    expect(csv).toContain('95.5%');
    expect(csv).toContain('12.3秒');
    expect(csv).toContain('總筆數,1');
  });

  it('maps MATCH → OK', () => {
    const csv = buildAuditCSV([makeRow()], BASE_OPTS);
    expect(csv).toContain(',OK,');
  });

  it('maps MISMATCH → 異常 and includes diff labels', () => {
    const csv = buildAuditCSV([makeRow({ auditStatus: 'MISMATCH', diffDetails: ['amount', 'date'] })], BASE_OPTS);
    expect(csv).toContain('異常');
    expect(csv).toContain('金額不符');
    expect(csv).toContain('日期不符');
  });

  it('maps MISSING_FILE → 缺件', () => {
    const csv = buildAuditCSV([makeRow({ auditStatus: 'MISSING_FILE', ocr: null })], BASE_OPTS);
    expect(csv).toContain('缺件');
  });

  it('escapes commas in values', () => {
    const row = makeRow({ id: 'A,B' });
    const csv = buildAuditCSV([row], BASE_OPTS);
    expect(csv).toContain('"A,B"');
  });
});
