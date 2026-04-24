import { describe, it, expect } from 'vitest';
import { cleanInvoiceNumber, autoFixAmounts, deduplicateResults, normalizeDate } from './invoiceNormalizer';

describe('cleanInvoiceNumber', () => {
  it('removes whitespace and uppercases', () => {
    expect(cleanInvoiceNumber('ab 1234 5678')).toBe('AB12345678');
  });
  it('no-op when already clean', () => {
    expect(cleanInvoiceNumber('AB12345678')).toBe('AB12345678');
  });
});

describe('autoFixAmounts', () => {
  it('returns original when valid', () => {
    expect(autoFixAmounts(1000, 50, 1050)).toEqual({ sales: 1000, tax: 50, total: 1050 });
  });

  it('swaps total and tax when total < tax', () => {
    expect(autoFixAmounts(950, 1000, 50)).toEqual({ sales: 950, tax: 50, total: 1000 });
  });

  it('recalculates total when sales+tax mismatches by > 1', () => {
    expect(autoFixAmounts(1000, 50, 1100)).toEqual({ sales: 1000, tax: 50, total: 1050 });
  });

  it('keeps total when within tolerance', () => {
    expect(autoFixAmounts(1000, 50, 1051)).toEqual({ sales: 1000, tax: 50, total: 1051 });
  });
});

describe('deduplicateResults', () => {
  it('keeps items with invoice_number', () => {
    const items: any[] = [
      { invoice_number: 'AB12345678', amount_total: 1050 },
      { invoice_number: 'CD87654321', amount_total: 500 },
    ];
    expect(deduplicateResults(items)).toHaveLength(2);
  });

  it('drops ghost (null inv_no) when a real match with same total exists', () => {
    const items: any[] = [
      { invoice_number: 'AB12345678', amount_total: 1050 },
      { invoice_number: null, amount_total: 1052 }, // within 5 → ghost
    ];
    expect(deduplicateResults(items)).toHaveLength(1);
    expect(deduplicateResults(items)[0].invoice_number).toBe('AB12345678');
  });

  it('keeps ghost when no real match is close', () => {
    const items: any[] = [
      { invoice_number: 'AB12345678', amount_total: 1050 },
      { invoice_number: null, amount_total: 9999 }, // far away
    ];
    expect(deduplicateResults(items)).toHaveLength(2);
  });
});

describe('normalizeDate', () => {
  it('passes through ISO date', () => expect(normalizeDate('2026-01-06')).toBe('2026-01-06'));
  it('converts YYYY/MM/DD', () => expect(normalizeDate('2026/01/06')).toBe('2026-01-06'));
  it('converts ROC YYY/MM/DD', () => expect(normalizeDate('115/01/06')).toBe('2026-01-06'));
  it('returns empty string for empty input', () => expect(normalizeDate('')).toBe(''));
  it('pads single-digit month/day', () => expect(normalizeDate('2026/1/6')).toBe('2026-01-06'));
});
