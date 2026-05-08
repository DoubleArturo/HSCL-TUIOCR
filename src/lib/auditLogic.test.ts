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

describe('computeAuditRows - regression: side-by-side multi-invoice file', () => {
  // G61-Q40010 bug: one file contains two invoices scanned side-by-side.
  // ERP record for XV37730672 (97963) should NOT get 金額不符 just because
  // the same file also contains XV37730673 (106680).
  it('does not sum all-file invoices when the target invoice is already matched', () => {
    const ocr1 = makeOCR({ invoice_number: 'XV37730672', amount_sales: 93298, amount_tax: 4665, amount_total: 97963 });
    const ocr2 = makeOCR({ invoice_number: 'XV37730673', amount_sales: 101600, amount_tax: 5080, amount_total: 106680 });
    // Both invoices in the same file entry
    const sharedFile: import('../../types').InvoiceEntry = {
      id: 'G61-Q40010',
      file: new File([], 'G61-Q40010.jpg') as any,
      previewUrl: '',
      status: 'SUCCESS',
      data: [ocr1, ocr2],
    };
    const erp1 = makeERP({ voucher_id: 'G61-Q40010', invoice_numbers: ['XV37730672'], amount_sales: 93298, amount_tax: 4665, amount_total: 97963 });
    const rows = computeAuditRows([erp1], [sharedFile]);
    const row = rows.find(r => r.id === 'G61-Q40010');
    expect(row?.diffDetails).not.toContain('amount');
    expect(row?.auditStatus).toBe('MATCH');
  });
});

describe('computeAuditRows - regression: OCR leading-zero on tax ID', () => {
  // XV37730675 bug: OCR returns "097332997" (9 digits) for a valid 8-digit tax ID "97332997".
  // normTaxId should strip the leading zero so comparison passes.
  it('does not flag tax_id mismatch when OCR adds a leading zero', () => {
    const rows = computeAuditRows(
      [makeERP({ seller_tax_id: '97332997' })],
      [makeEntry('G11-Q10001', makeOCR({ seller_tax_id: '097332997' }))],
    );
    expect(rows[0].diffDetails).not.toContain('tax_id');
    expect(rows[0].auditStatus).toBe('MATCH');
  });
});
