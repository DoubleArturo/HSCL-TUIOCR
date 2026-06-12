import { describe, it, expect } from 'vitest';
import { deduplicateResults } from './geminiService';
import type { InvoiceData } from '../types';

function makeResult(overrides: Partial<InvoiceData> = {}): InvoiceData {
  return {
    document_type: '統一發票',
    voucher_type: '三聯收銀',
    tax_code: 'T302',
    invoice_number: 'AB12345678',
    invoice_date: '2026-03-02',
    seller_name: '測試廠商',
    seller_tax_id: '12345678',
    currency: 'TWD',
    amount_sales: 1000,
    amount_tax: 50,
    amount_total: 1050,
    has_stamp: false,
    verification: { ai_confidence: 90, logic_is_valid: true, flagged_fields: [] },
    field_confidence: { invoice_number: 0.95, invoice_date: 0.9, seller_name: 0.9, seller_tax_id: 0.9, currency: 0.9, amount_sales: 0.9, amount_tax: 0.9, amount_total: 0.9 },
    error_code: 'SUCCESS' as any,
    ...overrides,
  };
}

describe('deduplicateResults()', () => {
  describe('Non-invoice (generic) document filtering', () => {
    it('packing list is dropped when a real invoice exists', () => {
      const packing = makeResult({ document_type: '出貨單', invoice_number: null, amount_total: 0 });
      const invoice = makeResult({ invoice_number: 'AB12345678' });
      const out = deduplicateResults([packing, invoice]);
      expect(out).toHaveLength(1);
      expect(out[0].invoice_number).toBe('AB12345678');
    });

    it('packing list is KEPT (as NOT_INVOICE) when there is no real invoice in the batch', () => {
      const packing = makeResult({ document_type: '出貨單', invoice_number: null, amount_total: 500 });
      const out = deduplicateResults([packing]);
      expect(out).toHaveLength(1);
      expect(out[0].error_code).toBe('NOT_INVOICE');
      expect(out[0].amount_total).toBe(0);
    });

    it('delivery note is dropped when real invoice exists', () => {
      const delivery = makeResult({ document_type: '送貨單', invoice_number: null });
      const invoice = makeResult({ invoice_number: 'CD99999999' });
      const out = deduplicateResults([delivery, invoice]);
      expect(out.some(r => r.document_type === '送貨單')).toBe(false);
    });
  });

  describe('Ghost result deduplication', () => {
    it('ghost (no invoice_number, same amount as real) is dropped', () => {
      const ghost = makeResult({ invoice_number: null, amount_total: 1050 });
      const real = makeResult({ invoice_number: 'AB12345678', amount_total: 1050 });
      const out = deduplicateResults([ghost, real]);
      expect(out).toHaveLength(1);
      expect(out[0].invoice_number).toBe('AB12345678');
    });

    it('ghost with unique amount (no real match) is kept', () => {
      const ghost = makeResult({ invoice_number: null, amount_total: 9999 });
      const real = makeResult({ invoice_number: 'AB12345678', amount_total: 1050 });
      const out = deduplicateResults([ghost, real]);
      expect(out).toHaveLength(2);
    });
  });

  describe('Exact duplicate deduplication', () => {
    it('second occurrence of same invoice_number is dropped', () => {
      const first = makeResult({ invoice_number: 'AB12345678', amount_sales: 1000 });
      const dupe = makeResult({ invoice_number: 'AB12345678', amount_sales: 1000 });
      const out = deduplicateResults([first, dupe]);
      expect(out).toHaveLength(1);
    });

    it('two invoices with different invoice_numbers are both kept', () => {
      const inv1 = makeResult({ invoice_number: 'AB12345678', amount_total: 1050 });
      const inv2 = makeResult({ invoice_number: 'CD87654321', amount_total: 2100 });
      const out = deduplicateResults([inv1, inv2]);
      expect(out).toHaveLength(2);
    });
  });

  describe('Mixed realistic scenarios', () => {
    it('packing list + real invoice + ghost + exact duplicate → only real invoice survives', () => {
      const packing = makeResult({ document_type: '出貨單', invoice_number: null, amount_total: 0 });
      const real = makeResult({ invoice_number: 'AB12345678', amount_total: 1050 });
      const ghost = makeResult({ invoice_number: null, amount_total: 1050 }); // same total as real → ghost
      const dupe = makeResult({ invoice_number: 'AB12345678', amount_total: 1050 }); // duplicate
      const out = deduplicateResults([packing, real, ghost, dupe]);
      expect(out).toHaveLength(1);
      expect(out[0].invoice_number).toBe('AB12345678');
    });

    it('two real invoices + one packing list → two invoices survive', () => {
      const packing = makeResult({ document_type: '訂單出貨', invoice_number: null, amount_total: 0 });
      const inv1 = makeResult({ invoice_number: 'AB12345678', amount_total: 1050 });
      const inv2 = makeResult({ invoice_number: 'CD87654321', amount_total: 2100 });
      const out = deduplicateResults([packing, inv1, inv2]);
      expect(out).toHaveLength(2);
      expect(out.some(r => r.document_type === '訂單出貨')).toBe(false);
    });
  });
});
