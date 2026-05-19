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

// Fix 1: TXXX receipts and T500 transit tickets must not count toward amount totals
describe('computeAuditRows - Fix 1: isCountableForAmount', () => {
  it('TXXX receipt does not trigger amount diff', () => {
    const txxx = makeOCR({
      tax_code: 'TXXX',
      voucher_type: '收據',
      document_type: '收據',
      invoice_number: null,
      amount_total: 200,
      amount_sales: 200,
      amount_tax: 0,
    });
    const rows = computeAuditRows(
      [makeERP({ amount_total: 1050 })],
      [makeEntry('G11-Q10001', txxx)],
    );
    expect(rows[0].diffDetails).not.toContain('amount');
  });

  it('T500 transit ticket (voucher_type=車票) does not trigger amount diff', () => {
    const ticket = makeOCR({
      tax_code: 'T500',
      voucher_type: '車票',
      document_type: '高鐵票',
      invoice_number: null,
      amount_total: 540,
      amount_sales: 514,
      amount_tax: 26,
    });
    const rows = computeAuditRows(
      [makeERP({ tax_code: 'T302', amount_total: 1050 })],
      [makeEntry('G11-Q10001', ticket)],
    );
    expect(rows[0].diffDetails).not.toContain('amount');
  });

  it('T500 two-part receipt (voucher_type=二聯收銀) IS counted in amount comparison', () => {
    // ERP is T302 (not T500), so Fix 3 does NOT skip amount diff.
    // OCR is T500 二聯收銀 — isCountableForAmount returns true for this type.
    // Amount should differ (1050 vs 2000), so 'amount' diff must appear.
    const receipt = makeOCR({
      tax_code: 'T500',
      voucher_type: '二聯收銀',
      document_type: '統一發票',
      invoice_number: 'AB12345678',
      amount_total: 1050,
    });
    const rows = computeAuditRows(
      [makeERP({ tax_code: 'T302', amount_total: 2000 })],
      [makeEntry('G11-Q10001', receipt)],
    );
    expect(rows[0].diffDetails).toContain('amount');
  });
});

// Fix 3: ERP rows with tax_code=T500 skip amount diff entirely
describe('computeAuditRows - Fix 3: T500 ERP row skips amount diff', () => {
  it('MATCH when ERP is T500 and amounts match', () => {
    const ticket = makeOCR({
      tax_code: 'T500',
      voucher_type: '車票',
      invoice_number: 'THSR001',
      amount_sales: 514,
      amount_tax: 26,
      amount_total: 540,
    });
    const rows = computeAuditRows(
      [makeERP({ tax_code: 'T500', amount_total: 540, invoice_numbers: ['THSR001'] })],
      [makeEntry('G11-Q10001', ticket)],
    );
    expect(rows[0].diffDetails).not.toContain('amount');
  });

  it('no amount diff when ERP is T500 even if OCR total differs', () => {
    const ticket = makeOCR({
      tax_code: 'T500',
      voucher_type: '車票',
      invoice_number: 'THSR002',
      amount_total: 540,
    });
    const rows = computeAuditRows(
      [makeERP({ tax_code: 'T500', amount_total: 999, invoice_numbers: ['THSR002'] })],
      [makeEntry('G11-Q10001', ticket)],
    );
    expect(rows[0].diffDetails).not.toContain('amount');
  });
});

// Fix 2: multiple ERP rows sharing the same voucher_id claim their own OCR invoices
describe('computeAuditRows - Fix 2: duplicate voucher_id grouping', () => {
  it('two ERP rows sharing same voucher_id each get their own OCR invoice', () => {
    const ocr1 = makeOCR({ invoice_number: 'AB12345678', amount_total: 1050, amount_sales: 1000, amount_tax: 50 });
    const ocr2 = makeOCR({ invoice_number: 'CD87654321', amount_total: 2100, amount_sales: 2000, amount_tax: 100 });

    const entry: InvoiceEntry = {
      id: 'G11-Q10001',
      file: new File([], 'G11-Q10001.jpg') as any,
      previewUrl: '',
      status: 'SUCCESS',
      data: [ocr1, ocr2],
    };

    const erp1 = makeERP({ invoice_numbers: ['AB12345678'], amount_total: 1050, amount_sales: 1000, amount_tax: 50 });
    const erp2 = makeERP({ invoice_numbers: ['CD87654321'], amount_total: 2100, amount_sales: 2000, amount_tax: 100 });

    const rows = computeAuditRows([erp1, erp2], [entry]);
    const row1 = rows.find(r => r.erp?.invoice_numbers?.includes('AB12345678'));
    const row2 = rows.find(r => r.erp?.invoice_numbers?.includes('CD87654321'));

    expect(row1?.auditStatus).toBe('MATCH');
    expect(row1?.diffDetails).not.toContain('amount');
    expect(row2?.auditStatus).toBe('MATCH');
    expect(row2?.diffDetails).not.toContain('amount');
  });

  it('second ERP row does not claim an OCR invoice already claimed by first row', () => {
    const ocr1 = makeOCR({ invoice_number: 'AB12345678', amount_total: 1050 });
    const entry: InvoiceEntry = {
      id: 'G11-Q10001',
      file: new File([], 'G11-Q10001.jpg') as any,
      previewUrl: '',
      status: 'SUCCESS',
      data: [ocr1],
    };

    const erp1 = makeERP({ invoice_numbers: ['AB12345678'], amount_total: 1050 });
    const erp2 = makeERP({ invoice_numbers: ['CD87654321'], amount_total: 2100 });

    const rows = computeAuditRows([erp1, erp2], [entry]);
    const row1 = rows.find(r => r.erp?.invoice_numbers?.includes('AB12345678'));
    const row2 = rows.find(r => r.erp?.invoice_numbers?.includes('CD87654321'));

    expect(row1?.auditStatus).toBe('MATCH');
    // row2 cannot claim AB (already taken), no OCR matches CD → inv_no diff
    expect(row2?.diffDetails).toContain('inv_no');
  });
});
