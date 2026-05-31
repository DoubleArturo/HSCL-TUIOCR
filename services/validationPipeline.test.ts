import { describe, it, expect } from 'vitest';
import { validateInvoice, buildCorrectionPrompt, autoCorrectAmounts, normalizeBuyerTaxId } from './validationPipeline';
import type { InvoiceData } from '../types';

// ─── helpers ───────────────────────────────────────────────────────────────

function makeInvoice(overrides: Partial<InvoiceData> = {}): InvoiceData {
  return {
    document_type: '統一發票',
    tax_code: 'T302',
    invoice_number: 'VT12345678',
    invoice_date: '2026-03-02',
    seller_name: '測試廠商',
    seller_tax_id: '12345678',
    currency: 'TWD',
    amount_sales: 1000,
    amount_tax: 100,
    amount_total: 1100,
    has_stamp: false,
    verification: { status: 'UNVERIFIED', issues: [] },
    field_confidence: {},
    ...overrides,
  };
}

// ─── validateInvoice ────────────────────────────────────────────────────────

describe('validateInvoice()', () => {
  // a) invoice_number 格式
  describe('invoice_number format', () => {
    it('有效 "VT12345678" — 無失敗', () => {
      const failures = validateInvoice(makeInvoice({ invoice_number: 'VT12345678' }));
      expect(failures.filter(f => f.field === 'invoice_number')).toHaveLength(0);
    });

    it('無效 "VT1234567"（7 數字）— 失敗 invoice_number', () => {
      const failures = validateInvoice(makeInvoice({ invoice_number: 'VT1234567' }));
      expect(failures.some(f => f.field === 'invoice_number')).toBe(true);
    });

    it('無效 "vt12345678"（小寫）— 失敗 invoice_number', () => {
      const failures = validateInvoice(makeInvoice({ invoice_number: 'vt12345678' }));
      expect(failures.some(f => f.field === 'invoice_number')).toBe(true);
    });

    it('INV- 格式 "INV-12345" — 略過不檢查', () => {
      const failures = validateInvoice(makeInvoice({ invoice_number: 'INV-12345' }));
      expect(failures.some(f => f.field === 'invoice_number')).toBe(false);
    });

    it('invoice_number 為 null — 無失敗（可選欄位）', () => {
      const failures = validateInvoice(makeInvoice({ invoice_number: null }));
      expect(failures.some(f => f.field === 'invoice_number')).toBe(false);
    });
  });

  // b) amount arithmetic
  describe('amount arithmetic', () => {
    it('正確: 1000 + 100 = 1100 — 無失敗', () => {
      const failures = validateInvoice(
        makeInvoice({ amount_sales: 1000, amount_tax: 100, amount_total: 1100 }),
      );
      expect(failures.some(f => f.rule === 'AMOUNT_ARITHMETIC')).toBe(false);
    });

    it('誤差 ±1: amount_total=1101 — 無失敗', () => {
      const failures = validateInvoice(
        makeInvoice({ amount_sales: 1000, amount_tax: 100, amount_total: 1101 }),
      );
      expect(failures.some(f => f.rule === 'AMOUNT_ARITHMETIC')).toBe(false);
    });

    it('誤差 >1: amount_total=1150 — 失敗 amount_total', () => {
      const failures = validateInvoice(
        makeInvoice({ amount_sales: 1000, amount_tax: 100, amount_total: 1150 }),
      );
      expect(failures.some(f => f.field === 'amount_total' && f.rule === 'AMOUNT_ARITHMETIC')).toBe(
        true,
      );
    });

    it('全為 0: 0 + 0 = 0 — 無失敗', () => {
      const failures = validateInvoice(
        makeInvoice({ amount_sales: 0, amount_tax: 0, amount_total: 0 }),
      );
      expect(failures.some(f => f.rule === 'AMOUNT_ARITHMETIC')).toBe(false);
    });
  });

  // c) amount 非負
  describe('amount 非負', () => {
    it('amount_total < 0 — 失敗 AMOUNT_NEGATIVE', () => {
      const failures = validateInvoice(
        makeInvoice({ amount_sales: 1000, amount_tax: 100, amount_total: -1 }),
      );
      expect(failures.some(f => f.field === 'amount_total' && f.rule === 'AMOUNT_NEGATIVE')).toBe(
        true,
      );
    });

    it('amount_sales < 0 — 實作未涵蓋此規則，回傳無 AMOUNT_NEGATIVE 失敗', () => {
      // 實作只檢查 amount_total < 0，不檢查 amount_sales < 0
      const failures = validateInvoice(
        makeInvoice({ amount_sales: -100, amount_tax: 100, amount_total: 0 }),
      );
      expect(failures.some(f => f.rule === 'AMOUNT_NEGATIVE')).toBe(false);
    });
  });

  // d) seller_tax_id 格式
  describe('seller_tax_id format', () => {
    it('有效 "12345678" — 無失敗', () => {
      const failures = validateInvoice(makeInvoice({ seller_tax_id: '12345678' }));
      expect(failures.some(f => f.field === 'seller_tax_id')).toBe(false);
    });

    it('含 "?" 的 "1234?678" — 無失敗（模糊值）', () => {
      const failures = validateInvoice(makeInvoice({ seller_tax_id: '1234?678' }));
      expect(failures.some(f => f.field === 'seller_tax_id')).toBe(false);
    });

    it('無效 "1234567"（7 位）— 失敗 seller_tax_id', () => {
      const failures = validateInvoice(makeInvoice({ seller_tax_id: '1234567' }));
      expect(failures.some(f => f.field === 'seller_tax_id')).toBe(true);
    });

    it('無效 "12345678A"（含字母）— 失敗 seller_tax_id', () => {
      const failures = validateInvoice(makeInvoice({ seller_tax_id: '12345678A' }));
      expect(failures.some(f => f.field === 'seller_tax_id')).toBe(true);
    });

    it('null seller_tax_id — 無失敗', () => {
      const failures = validateInvoice(makeInvoice({ seller_tax_id: null }));
      expect(failures.some(f => f.field === 'seller_tax_id')).toBe(false);
    });

    it('空字串 seller_tax_id — 無失敗', () => {
      const failures = validateInvoice(makeInvoice({ seller_tax_id: '' }));
      expect(failures.some(f => f.field === 'seller_tax_id')).toBe(false);
    });
  });

  // e) invoice_date 格式
  describe('invoice_date format', () => {
    it('有效 "2026-03-02" — 無失敗', () => {
      const failures = validateInvoice(makeInvoice({ invoice_date: '2026-03-02' }));
      expect(failures.some(f => f.field === 'invoice_date')).toBe(false);
    });

    it('無效 "03-02-2026" — 失敗 invoice_date', () => {
      const failures = validateInvoice(makeInvoice({ invoice_date: '03-02-2026' }));
      expect(failures.some(f => f.field === 'invoice_date')).toBe(true);
    });

    it('無效 "2026-3-2"（缺前置 0）— 失敗 invoice_date', () => {
      const failures = validateInvoice(makeInvoice({ invoice_date: '2026-3-2' }));
      expect(failures.some(f => f.field === 'invoice_date')).toBe(true);
    });

    it('null invoice_date — 無失敗', () => {
      const failures = validateInvoice(makeInvoice({ invoice_date: null }));
      expect(failures.some(f => f.field === 'invoice_date')).toBe(false);
    });
  });

  // f) tax_code 存在
  describe('tax_code 存在', () => {
    it('有 tax_code — 無失敗', () => {
      const failures = validateInvoice(makeInvoice({ tax_code: 'T302' }));
      expect(failures.some(f => f.field === 'tax_code')).toBe(false);
    });

    it('null tax_code 且 error_code !== "NOT_INVOICE" — 失敗 tax_code', () => {
      const failures = validateInvoice(makeInvoice({ tax_code: null, error_code: undefined }));
      expect(failures.some(f => f.field === 'tax_code' && f.rule === 'TAX_CODE_MISSING')).toBe(
        true,
      );
    });

    it('null tax_code 但 error_code === "NOT_INVOICE" — 無失敗', () => {
      const failures = validateInvoice(
        makeInvoice({ tax_code: null, error_code: 'NOT_INVOICE' }),
      );
      expect(failures.some(f => f.field === 'tax_code')).toBe(false);
    });
  });
});

// ─── buildCorrectionPrompt ──────────────────────────────────────────────────

describe('buildCorrectionPrompt()', () => {
  it('單失敗 — 包含 Attempt 1 標頭與欄位名稱', () => {
    const failures = [
      { field: 'invoice_number', rule: 'GUI_FORMAT', message: '格式錯誤，請重新辨識' },
    ];
    const result = buildCorrectionPrompt(failures, 1);
    expect(result).toContain('[CORRECTION REQUIRED - Attempt 1]');
    expect(result).toContain('1. [invoice_number]');
  });

  it('多失敗 — 包含 2 validation error(s) 與兩個欄位', () => {
    const failures = [
      { field: 'amount_total', rule: 'AMOUNT_ARITHMETIC', message: '金額不符' },
      { field: 'seller_tax_id', rule: 'TAX_ID_FORMAT', message: '統編格式錯誤' },
    ];
    const result = buildCorrectionPrompt(failures, 2);
    expect(result).toContain('2 validation error(s)');
    expect(result).toContain('[amount_total]');
    expect(result).toContain('[seller_tax_id]');
    expect(result).toContain('[CORRECTION REQUIRED - Attempt 2]');
  });

  it('空清單 — 應正常回傳字串（不拋錯）', () => {
    const result = buildCorrectionPrompt([], 1);
    expect(typeof result).toBe('string');
    expect(result).toContain('0 validation error(s)');
  });
});

// ─── autoCorrectAmounts ──────────────────────────────────────────────────────

describe('autoCorrectAmounts()', () => {
  // a) Swap 邏輯
  describe('swap 邏輯', () => {
    it('total < tax 時交換 amount_total 與 amount_tax', () => {
      const item = makeInvoice({ amount_sales: 1000, amount_tax: 1000, amount_total: 100 });
      const result = autoCorrectAmounts(item);
      expect(result.corrected).toBe(true);
      expect(item.amount_total).toBe(1000);
      expect(item.amount_tax).toBe(100);
      expect(result.log.toLowerCase()).toContain('swapped');
    });
  });

  // b) 加總修正（誤差閾值）
  describe('加總修正（誤差閾值）', () => {
    it('誤差 >50（diff=101）— corrected=false', () => {
      const item = makeInvoice({ amount_sales: 1000, amount_tax: 100, amount_total: 999 });
      const result = autoCorrectAmounts(item);
      expect(result.corrected).toBe(false);
    });

    it('誤差 >50（diff=110）— corrected=false', () => {
      const item = makeInvoice({ amount_sales: 1000, amount_tax: 100, amount_total: 990 });
      const result = autoCorrectAmounts(item);
      expect(result.corrected).toBe(false);
    });

    it('誤差恰好 =50 — corrected=true，amount_total 修正為 1100', () => {
      const item = makeInvoice({ amount_sales: 1000, amount_tax: 100, amount_total: 1050 });
      const result = autoCorrectAmounts(item);
      expect(result.corrected).toBe(true);
      expect(item.amount_total).toBe(1100);
      expect(result.log.toLowerCase()).toContain('auto-corrected');
    });
  });

  // c) 不需修正
  describe('不需修正', () => {
    it('amount_total 已正確 — corrected=false, log=空字串', () => {
      const item = makeInvoice({ amount_sales: 1000, amount_tax: 100, amount_total: 1100 });
      const result = autoCorrectAmounts(item);
      expect(result.corrected).toBe(false);
      expect(result.log).toBe('');
    });
  });

  // d) 0 值邊界
  describe('0 值邊界', () => {
    it('全為 0 — corrected=false（無需修正）', () => {
      const item = makeInvoice({ amount_sales: 0, amount_tax: 0, amount_total: 0 });
      const result = autoCorrectAmounts(item);
      expect(result.corrected).toBe(false);
    });
  });
});

// ─── normalizeBuyerTaxId ────────────────────────────────────────────────────

describe('normalizeBuyerTaxId()', () => {
  it('T300 + null → ? (scan quality poor, placeholder needed)', () => {
    expect(normalizeBuyerTaxId(null, 'T300', undefined)).toBe('?');
  });

  it('三聯手寫 voucher_type + null → ? (even without explicit tax_code)', () => {
    expect(normalizeBuyerTaxId(null, null, '三聯手寫')).toBe('?');
  });

  it('非 T300 + null → null unchanged (收據/TXXX 無 buyer_tax_id 是正常的)', () => {
    expect(normalizeBuyerTaxId(null, 'TXXX', '收據')).toBeNull();
  });

  it('T302 + null → null unchanged (三聯收銀不強制要求 buyer_tax_id)', () => {
    expect(normalizeBuyerTaxId(null, 'T302', '三聯收銀')).toBeNull();
  });

  it('T300 + 有值 → 值不變', () => {
    expect(normalizeBuyerTaxId('12345678', 'T300', '三聯手寫')).toBe('12345678');
  });

  it('T300 + ? → 值不變（已是 placeholder，不重複轉換）', () => {
    expect(normalizeBuyerTaxId('165?7744', 'T300', '三聯手寫')).toBe('165?7744');
  });

  it('undefined 視同 null：T300 + undefined → ?', () => {
    expect(normalizeBuyerTaxId(undefined, 'T300', '三聯手寫')).toBe('?');
  });
});
