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

// ─── T300 三聯手寫 ────────────────────────────────────────────────────────────
describe('computeAuditRows - T300 三聯手寫', () => {
  it('MATCH when hand-written invoice amounts align', () => {
    const rows = computeAuditRows(
      [makeERP({ tax_code: 'T300', amount_sales: 5000, amount_tax: 250, amount_total: 5250 })],
      [makeEntry('G11-Q10001', makeOCR({ tax_code: 'T300', voucher_type: '三聯手寫', amount_sales: 5000, amount_tax: 250, amount_total: 5250 }))],
    );
    expect(rows[0].auditStatus).toBe('MATCH');
    expect(rows[0].diffDetails).toHaveLength(0);
  });

  it('amount within ±1 tolerance should still MATCH (rounding)', () => {
    const rows = computeAuditRows(
      [makeERP({ amount_total: 5251 })],
      [makeEntry('G11-Q10001', makeOCR({ amount_total: 5250 }))],
    );
    expect(rows[0].diffDetails).not.toContain('amount');
  });

  it('amount difference of exactly 2 triggers amount diff', () => {
    const rows = computeAuditRows(
      [makeERP({ amount_total: 5252 })],
      [makeEntry('G11-Q10001', makeOCR({ amount_total: 5250 }))],
    );
    expect(rows[0].diffDetails).toContain('amount');
  });

  it('mixed page: delivery note (NOT_INVOICE) alongside hand-written invoice is ignored in amount sum', () => {
    const realInvoice = makeOCR({ invoice_number: 'AB12345678', amount_total: 1050 });
    const deliveryNote = makeOCR({
      invoice_number: '',
      document_type: '非發票',
      error_code: 'NOT_INVOICE' as any,
      amount_total: 9999, // delivery note amount must NOT affect audit
    });
    const rows = computeAuditRows(
      [makeERP({ amount_total: 1050 })],
      [{ id: 'G11-Q10001', file: new File([], 'G11-Q10001.jpg') as any, previewUrl: '', status: 'SUCCESS', data: [realInvoice, deliveryNote] }],
    );
    expect(rows[0].diffDetails).not.toContain('amount');
    expect(rows[0].auditStatus).toBe('MATCH');
  });

  it('ROC year on hand-written invoice matches AD year from ERP', () => {
    // OCR normalizes 115/03/25 → 2026-03-25; ERP has 2026-03-25
    const rows = computeAuditRows(
      [makeERP({ invoice_date: '2026-03-25' })],
      [makeEntry('G11-Q10001', makeOCR({ invoice_date: '2026-03-25' }))],
    );
    expect(rows[0].diffDetails).not.toContain('date');
  });
});

// ─── T301 三聯電子 ────────────────────────────────────────────────────────────
describe('computeAuditRows - T301 三聯電子', () => {
  it('MATCH for e-invoice with correct 2-letter+8-digit invoice number', () => {
    const rows = computeAuditRows(
      [makeERP({ tax_code: 'T301', invoice_numbers: ['EV12345678'] })],
      [makeEntry('G11-Q10001', makeOCR({ tax_code: 'T301', voucher_type: '三聯電子', invoice_number: 'EV12345678' }))],
    );
    expect(rows[0].auditStatus).toBe('MATCH');
  });

  it('ERP has 2 invoice numbers, both matched by OCR → MATCH no inv_no diff', () => {
    const ocr1 = makeOCR({ invoice_number: 'AB12345678', amount_total: 1050 });
    const ocr2 = makeOCR({ invoice_number: 'CD87654321', amount_total: 2100 });
    const rows = computeAuditRows(
      [makeERP({ invoice_numbers: ['AB12345678', 'CD87654321'], amount_sales: 3000, amount_tax: 150, amount_total: 3150 })],
      [{ id: 'G11-Q10001', file: new File([], 'G11-Q10001.jpg') as any, previewUrl: '', status: 'SUCCESS', data: [ocr1, ocr2] }],
    );
    expect(rows[0].diffDetails).not.toContain('inv_no');
  });

  it('ERP has 2 invoice numbers but OCR only matches 1 → inv_no diff flagged', () => {
    const rows = computeAuditRows(
      [makeERP({ invoice_numbers: ['AB12345678', 'CD87654321'] })],
      [makeEntry('G11-Q10001', makeOCR({ invoice_number: 'AB12345678' }))],
    );
    expect(rows[0].diffDetails).toContain('inv_no');
  });

  it('OCR invoice number with spaces is normalized before matching', () => {
    // OCR might return 'EV 1234 5678'; normInvNo strips spaces
    const rows = computeAuditRows(
      [makeERP({ invoice_numbers: ['EV12345678'] })],
      [makeEntry('G11-Q10001', makeOCR({ invoice_number: 'EV 1234 5678' }))],
    );
    expect(rows[0].diffDetails).not.toContain('inv_no');
  });
});

// ─── T302 三聯收銀 ────────────────────────────────────────────────────────────
describe('computeAuditRows - T302 三聯收銀', () => {
  it('MATCH for machine receipt when all fields align', () => {
    const rows = computeAuditRows(
      [makeERP({ tax_code: 'T302' })],
      [makeEntry('G11-Q10001', makeOCR({ tax_code: 'T302', voucher_type: '三聯收銀' }))],
    );
    expect(rows[0].auditStatus).toBe('MATCH');
  });

  it('flags tax_id when seller changes (e.g. different branch)', () => {
    const rows = computeAuditRows(
      [makeERP({ seller_tax_id: '12345670' })],
      [makeEntry('G11-Q10001', makeOCR({ seller_tax_id: '22099131' }))],
    );
    expect(rows[0].diffDetails).toContain('tax_id');
  });

  it('tax_code mismatch: ERP says T302 but OCR reads T301', () => {
    const rows = computeAuditRows(
      [makeERP({ tax_code: 'T302' })],
      [makeEntry('G11-Q10001', makeOCR({ tax_code: 'T301' }))],
    );
    expect(rows[0].diffDetails).toContain('tax_code');
  });
});

// ─── T500 二聯收銀 / 車票 ──────────────────────────────────────────────────────
describe('computeAuditRows - T500 二聯收銀 & 車票', () => {
  it('T500 二聯收銀 IS included in amount audit (not skipped like foreign Invoice)', () => {
    const rows = computeAuditRows(
      [makeERP({ tax_code: 'T500', amount_total: 500 })],
      [makeEntry('G11-Q10001', makeOCR({ tax_code: 'T500', voucher_type: '二聯收銀', amount_total: 600 }))],
    );
    expect(rows[0].diffDetails).toContain('amount');
  });

  it('T500 amount MATCH should not trigger false diff', () => {
    const rows = computeAuditRows(
      [makeERP({ tax_code: 'T500', amount_total: 500 })],
      [makeEntry('G11-Q10001', makeOCR({ tax_code: 'T500', voucher_type: '二聯收銀', amount_total: 500 }))],
    );
    expect(rows[0].diffDetails).not.toContain('amount');
  });
});

// ─── TXXX 外國 Invoice / 免用統一發票 ─────────────────────────────────────────
describe('computeAuditRows - TXXX foreign & exempt', () => {
  it('Commercial Invoice skips tax_id audit', () => {
    const rows = computeAuditRows(
      [makeERP({ seller_tax_id: '99999990' })],
      [makeEntry('G11-Q10001', makeOCR({ document_type: 'Commercial Invoice', voucher_type: 'Invoice', seller_tax_id: '00000000' }))],
    );
    expect(rows[0].diffDetails).not.toContain('tax_id');
  });

  it('免用統一發票 (TXXX) amount is still checked', () => {
    const rows = computeAuditRows(
      [makeERP({ tax_code: 'TXXX', amount_total: 300 })],
      [makeEntry('G11-Q10001', makeOCR({ tax_code: 'TXXX', voucher_type: '收據', amount_total: 500 }))],
    );
    expect(rows[0].diffDetails).toContain('amount');
  });
});

// ─── no_match_found 情境 ───────────────────────────────────────────────────────
describe('computeAuditRows - no_match_found', () => {
  it('flags inv_no diff when file contains only NOT_INVOICE (packing list) and ERP expects an invoice', () => {
    // The packing list is included in allOCRInvoices (empty invoice_number → not deduplicated out),
    // but isInvoiceDoc filters it, so matchedOCRInvoices stays empty → inv_no diff fires.
    const packingList = makeOCR({
      invoice_number: '',
      document_type: '非發票',
      error_code: 'NOT_INVOICE' as any,
      amount_total: 0,
    });
    const rows = computeAuditRows(
      [makeERP()],
      [{ id: 'G11-Q10001', file: new File([], 'G11-Q10001.jpg') as any, previewUrl: '', status: 'SUCCESS', data: [packingList] }],
    );
    expect(rows[0].diffDetails).toContain('inv_no');
    expect(rows[0].auditStatus).toBe('MISMATCH');
  });

  it('flags no_match_found when file has zero OCR results', () => {
    const rows = computeAuditRows(
      [makeERP()],
      [{ id: 'G11-Q10001', file: new File([], 'G11-Q10001.jpg') as any, previewUrl: '', status: 'SUCCESS', data: [] }],
    );
    expect(rows[0].diffDetails).toContain('no_match_found');
  });
});
