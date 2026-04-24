import { describe, it, expect } from 'vitest';
import { isAmountValid } from './amountValidation';

describe('isAmountValid', () => {
  it('exact match is valid', () => {
    expect(isAmountValid(1000, 50, 1050)).toBe(true);
  });

  it('tolerance of 1 is valid', () => {
    expect(isAmountValid(1000, 50, 1051)).toBe(true);
    expect(isAmountValid(1000, 50, 1049)).toBe(true);
  });

  it('difference of 2 is invalid', () => {
    expect(isAmountValid(1000, 50, 1052)).toBe(false);
    expect(isAmountValid(1000, 50, 1048)).toBe(false);
  });

  it('all zeros is valid', () => {
    expect(isAmountValid(0, 0, 0)).toBe(true);
  });

  it('zero-tax invoice is valid', () => {
    expect(isAmountValid(500, 0, 500)).toBe(true);
  });
});
