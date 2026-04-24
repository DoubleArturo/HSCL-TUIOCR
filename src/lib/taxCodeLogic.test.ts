import { describe, it, expect } from 'vitest';
import { assignTaxCode, syncVoucherType, isForeignInvoice } from './taxCodeLogic';

describe('assignTaxCode', () => {
  describe('from voucher_type', () => {
    it('三聯手寫 → T300', () => expect(assignTaxCode('三聯手寫', undefined, 'AB12345678')).toBe('T300'));
    it('三聯電子 → T301', () => expect(assignTaxCode('三聯電子', undefined, 'AB12345678')).toBe('T301'));
    it('三聯收銀 → T302', () => expect(assignTaxCode('三聯收銀', undefined, 'AB12345678')).toBe('T302'));
    it('二聯收銀 → T500', () => expect(assignTaxCode('二聯收銀', undefined, 'NR12345678')).toBe('T500'));
    it('車票 → T500', () => expect(assignTaxCode('車票', undefined, undefined)).toBe('T500'));
    it('Invoice → TXXX', () => expect(assignTaxCode('Invoice', undefined, undefined)).toBe('TXXX'));
    it('收據 → TXXX', () => expect(assignTaxCode('收據', undefined, undefined)).toBe('TXXX'));
    it('非發票 → TXXX', () => expect(assignTaxCode('非發票', undefined, undefined)).toBe('TXXX'));
  });

  describe('fallback to document_type', () => {
    it('海關 → T400', () => expect(assignTaxCode(undefined, '海關進口報單', 'something')).toBe('T400'));
    it('高鐵 → T500', () => expect(assignTaxCode(undefined, '高鐵車票', undefined)).toBe('T500'));
    it('電子發票 → T301', () => expect(assignTaxCode(undefined, '電子發票證明聯', 'AB12345678')).toBe('T301'));
    it('統一發票 → T302', () => expect(assignTaxCode(undefined, '統一發票', 'AB12345678')).toBe('T302'));
    it('Commercial Invoice → TXXX', () => expect(assignTaxCode(undefined, 'Commercial Invoice', undefined)).toBe('TXXX'));
    it('no invoice number → TXXX', () => expect(assignTaxCode(undefined, '某文件', undefined)).toBe('TXXX'));
  });
});

describe('syncVoucherType', () => {
  it('T300 → 三聯手寫', () => expect(syncVoucherType('T300')).toBe('三聯手寫'));
  it('T301 → 三聯電子', () => expect(syncVoucherType('T301')).toBe('三聯電子'));
  it('T302 → 三聯收銀', () => expect(syncVoucherType('T302')).toBe('三聯收銀'));
  it('T500 → 二聯收銀', () => expect(syncVoucherType('T500')).toBe('二聯收銀'));
  it('TXXX → 收據', () => expect(syncVoucherType('TXXX')).toBe('收據'));
});

describe('isForeignInvoice', () => {
  it('Invoice → true', () => expect(isForeignInvoice('Invoice')).toBe(true));
  it('Commercial Invoice → true', () => expect(isForeignInvoice('Commercial Invoice')).toBe(true));
  it('統一發票 → false', () => expect(isForeignInvoice('統一發票')).toBe(false));
  it('undefined → false', () => expect(isForeignInvoice(undefined)).toBe(false));
});
