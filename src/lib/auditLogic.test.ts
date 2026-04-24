import { describe, it, expect } from 'vitest';
import { computeAuditRows } from './auditLogic';
import type { ERPRecord, InvoiceEntry, InvoiceData } from '../../types';

function makeERP(overrides: Partial<ERPRecord> = {}): ERPRecord {
  return {
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
    ...overrides,
  };
}

function makeOCR(overrides: Partial<InvoiceData> = {}): InvoiceData {
  return {
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
    ...overrides,
  };
}

function makeEntry(id: string, ocr: InvoiceData): InvoiceEntry {
  return {
    id,
    file: new File([], `${id}.jpg`) as any,
    previewUrl: '',
    status: 'SUCCESS',
    data: [ocr],
  };
}

describe('computeAuditRows - basic status', () => {
  it('MATCH when everything aligns', () => {
    const rows = computeAuditRows([makeERP()], [makeEntry('G11-Q10001', makeOCR())]);
    expect(rows[0].auditStatus).toBe('MATCH');
    expect(rows[0].diffDetails).toHaveLength(0);
  });

  it('MISSING_FILE when no file uploaded', () => {
    const rows = computeAuditRows([makeERP()], []);
    expect(rows[0].auditStatus).toBe('MISSING_FILE');
  });

  it('EXTRA_FILE when file has no ERP match', () => {
    const rows = computeAuditRows([], [makeEntry('G11-Q10099', makeOCR())]);
    expect(rows[0].auditStatus).toBe('EXTRA_FILE');
  });
});

describe('computeAuditRows - diffs', () => {
  it('detects amount mismatch', () => {
    const rows = computeAuditRows(
      [makeERP({ amount_total: 2000 })],
      [makeEntry('G11-Q10001', makeOCR({ amount_total: 1050 }))],
    );
    expect(rows[0].diffDetails).toContain('amount');
    expect(rows[0].auditStatus).toBe('MISMATCH');
  });

  it('detects date mismatch', () => {
    const rows = computeAuditRows(
      [makeERP({ invoice_date: '2026-01-07' })],
      [makeEntry('G11-Q10001', makeOCR({ invoice_date: '2026-01-06' }))],
    );
    expect(rows[0].diffDetails).toContain('date');
  });

  it('detects tax_code mismatch', () => {
    const rows = computeAuditRows(
      [makeERP({ tax_code: 'T300' })],
      [makeEntry('G11-Q10001', makeOCR({ tax_code: 'T302' }))],
    );
    expect(rows[0].diffDetails).toContain('tax_code');
  });

  it('detects inv_no mismatch when ERP has 1 number but OCR matches 0', () => {
    const rows = computeAuditRows(
      [makeERP({ invoice_numbers: ['ZZ99999999'] })],
      [makeEntry('G11-Q10001', makeOCR({ invoice_number: 'AB12345678' }))],
    );
    // matchedOCRInvoices.length (0) !== erpInvNos.length (1)
    expect(rows[0].diffDetails).toContain('inv_no');
  });

  it('detects tax_id mismatch', () => {
    const rows = computeAuditRows(
      [makeERP({ seller_tax_id: '99999999' })],
      [makeEntry('G11-Q10001', makeOCR({ seller_tax_id: '12345678' }))],
    );
    expect(rows[0].diffDetails).toContain('tax_id');
  });

  it('detects tax_id_unclear when OCR has ?', () => {
    const rows = computeAuditRows(
      [makeERP()],
      [makeEntry('G11-Q10001', makeOCR({ seller_tax_id: '1234?678' }))],
    );
    expect(rows[0].diffDetails).toContain('tax_id_unclear');
  });
});

describe('computeAuditRows - exclusions', () => {
  it('Invoice type does not trigger tax_id diff', () => {
    const rows = computeAuditRows(
      [makeERP({ seller_tax_id: '99999999' })],
      [makeEntry('G11-Q10001', makeOCR({ document_type: 'Invoice', voucher_type: 'Invoice', seller_tax_id: '00000000' }))],
    );
    expect(rows[0].diffDetails).not.toContain('tax_id');
  });

  it('prefix match: G11-Q10001-1 matches ERP G11-Q10001', () => {
    const rows = computeAuditRows(
      [makeERP({ invoice_numbers: ['AB12345678'] })],
      [makeEntry('G11-Q10001-1', makeOCR())],
    );
    expect(rows.find(r => r.id === 'G11-Q10001')?.auditStatus).toBe('MATCH');
  });
});
