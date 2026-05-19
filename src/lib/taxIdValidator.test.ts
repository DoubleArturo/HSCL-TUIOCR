import { describe, it, expect } from 'vitest';
import { validateTaiwanTaxId } from './taxIdValidator';

// Known-valid real tax IDs (publicly registered companies)
const VALID_IDS = [
  '97332997', // test fixture from existing invoices
  '12345670', // mod-5 = 0 → valid
  '10458575', // 統一發票常見廠商
  '16547744', // buyer tax ID (HSCL itself)
  '22099131',
];

// Known-invalid
const INVALID_IDS = [
  '12345678', // z=33, fails mod-5 (even with digit[6]=7 special case)
  '12345679', // z=34, fails mod-5
  '99999999', // z=72, fails mod-5
  '11111111', // z=14, fails mod-5
];
// Note: '00000000' is technically valid (z=0, 0%5===0) — not a useful business value
// but passes the mathematical checksum.

describe('validateTaiwanTaxId - basic length check', () => {
  it('returns false for empty string', () => {
    expect(validateTaiwanTaxId('')).toBe(false);
  });
  it('returns false for 7-digit ID', () => {
    expect(validateTaiwanTaxId('1234567')).toBe(false);
  });
  it('returns false for 9-digit ID (OCR leading-zero bug)', () => {
    expect(validateTaiwanTaxId('097332997')).toBe(false);
  });
  it('returns false for non-numeric characters', () => {
    expect(validateTaiwanTaxId('1234567A')).toBe(false);
  });
  it('strips non-digits before checking length', () => {
    // '?' placeholder — should fail length check after strip
    expect(validateTaiwanTaxId('1234?678')).toBe(false);
  });
});

describe('validateTaiwanTaxId - mod-5 checksum', () => {
  it('validates buyer tax ID 16547744', () => {
    expect(validateTaiwanTaxId('16547744')).toBe(true);
  });

  it('validates 97332997 (seller in test fixtures)', () => {
    expect(validateTaiwanTaxId('97332997')).toBe(true);
  });

  VALID_IDS.forEach(id => {
    it(`valid: ${id}`, () => expect(validateTaiwanTaxId(id)).toBe(true));
  });

  INVALID_IDS.forEach(id => {
    it(`invalid: ${id}`, () => expect(validateTaiwanTaxId(id)).toBe(false));
  });
});

describe('validateTaiwanTaxId - special case digit[6] === 7', () => {
  // When digit at index 6 (7th digit) is 7, the official rule allows z or (z-1)
  // to be divisible by 5. Both variants must pass.
  it('accepts the first valid variant when digit[6]=7', () => {
    // 04595257: digit[6]=5 not 7, this is just a checksum-valid ID
    // We test the branching logic: if a real ID with digit[6]=7 passes, the
    // special-case branch fires correctly.
    // 00000070 is constructed: weights [1,2,1,2,1,2,4,1], digit[6]=7
    // 7*4=28 → digitSum=1; z without special = 0+0+0+0+0+0+1+0 = 1 → not %5
    // z-1 = 0 → 0%5=0 → valid via special case
    expect(validateTaiwanTaxId('00000070')).toBe(true);
  });

  it('correctly rejects a bad ID that happens to have digit[6]=7', () => {
    // 00000071: same weights, digit[6]=7, digit[7]=1
    // z = 0+0+0+0+0+0+1+1 = 2; z%5≠0; (z-1)=1; 1%5≠0 → invalid
    expect(validateTaiwanTaxId('00000071')).toBe(false);
  });
});
