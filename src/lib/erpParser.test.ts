import { describe, it, expect } from 'vitest';
import { detectHeaderMap, parseERPRows } from './erpParser';

const HEADER_ROW = ['傳票編號', '發票日期', '稅別', '', '', '', '', '', '廠商名稱', '', '發票號碼', '統一編號', '', '未稅金額', '稅額', '含稅金額'];
const DATA_ROW = ['G11-Q10001', '2026/01/06', 'TXXX', '', '', '', '', '', '某廠商', '', 'AB12345678', '12345678', '', '1000', '50', '1050'];

describe('detectHeaderMap', () => {
  it('finds header and maps column indices', () => {
    const map = detectHeaderMap([HEADER_ROW as any]);
    expect(map).not.toBeNull();
    expect(map!.voucher_id).toBe(0);
    expect(map!.invoice_date).toBe(1);
    expect(map!.invoice_number).toBe(10);
    expect(map!.amount_total).toBe(15);
  });

  it('returns null when no voucher_id column found', () => {
    expect(detectHeaderMap([['A', 'B', 'C']])).toBeNull();
  });

  it('picks most specific keyword match', () => {
    // '含稅金額' should win over '金額' when both appear
    const row = ['傳票編號', '含稅金額', '金額'];
    const map = detectHeaderMap([row as any]);
    // amount_total keyword '含稅金額' is index 0 in its list → higher priority
    expect(map!.amount_total).toBe(1); // col 1 = '含稅金額'
  });
});

describe('parseERPRows', () => {
  it('parses a typical ERP export', () => {
    const rows = [HEADER_ROW, DATA_ROW];
    const result = parseERPRows(rows as any);
    expect(result).toHaveLength(1);
    expect(result[0].voucher_id).toBe('G11-Q10001');
    expect(result[0].invoice_date).toBe('2026-01-06');
    expect(result[0].invoice_numbers).toEqual(['AB12345678']);
    expect(result[0].amount_sales).toBe(1000);
    expect(result[0].amount_tax).toBe(50);
    expect(result[0].amount_total).toBe(1050);
  });

  it('handles multiple invoice numbers separated by space', () => {
    const row = [...DATA_ROW];
    row[10] = 'AB12345678 CD87654321';
    const result = parseERPRows([HEADER_ROW, row] as any);
    expect(result[0].invoice_numbers).toEqual(['AB12345678', 'CD87654321']);
  });

  it('skips blank rows', () => {
    const result = parseERPRows([HEADER_ROW, [], DATA_ROW] as any);
    expect(result).toHaveLength(1);
  });

  it('skips header-like rows after header', () => {
    const rows = [HEADER_ROW, HEADER_ROW, DATA_ROW];
    const result = parseERPRows(rows as any);
    expect(result).toHaveLength(1);
  });

  it('parses amounts with commas', () => {
    const row = [...DATA_ROW];
    row[15] = '1,050';
    const result = parseERPRows([HEADER_ROW, row] as any);
    expect(result[0].amount_total).toBe(1050);
  });

  it('normalizes ROC date from ERP', () => {
    const row = [...DATA_ROW];
    row[1] = '115/01/06';
    const result = parseERPRows([HEADER_ROW, row] as any);
    expect(result[0].invoice_date).toBe('2026-01-06');
  });
});
