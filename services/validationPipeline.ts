import type { InvoiceData } from '../types';

export interface ValidationFailure {
  field: string;
  rule: string;
  message: string;
}

/**
 * 對單一 InvoiceData 執行所有驗證規則。
 * 回傳失敗清單，空陣列代表全部通過。
 */
export function validateInvoice(item: InvoiceData): ValidationFailure[] {
  const failures: ValidationFailure[] = [];

  // Rule 1 & 2: invoice_number format + length
  if (item.invoice_number && !item.invoice_number.startsWith('INV-') && !item.invoice_number.includes('-')) {
    const cleanInv = item.invoice_number.replace(/[^A-Z0-9]/g, '');
    const guiRegex = /^[A-Z]{2}\d{8}$/;
    if (!guiRegex.test(cleanInv)) {
      // Rule 1: format
      failures.push({
        field: 'invoice_number',
        rule: 'GUI_FORMAT',
        message: `invoice_number '${cleanInv}' has ${cleanInv.length} chars but Taiwan GUI requires exactly 2 uppercase letters + 8 digits (10 chars total). Re-read the invoice number carefully.`,
      });
      // Rule 2: length hint
      if (cleanInv.length === 9 || cleanInv.length === 11) {
        failures.push({
          field: 'invoice_number',
          rule: 'GUI_LENGTH',
          message: `invoice_number '${cleanInv}' is ${cleanInv.length} chars — you likely misread one character. Expected exactly 10 chars (2 letters + 8 digits). Re-examine each character individually.`,
        });
      }
    }
  }

  // Rule 3: amount arithmetic
  const sales = item.amount_sales || 0;
  const tax = item.amount_tax || 0;
  const total = item.amount_total || 0;
  if (Math.abs(total - (sales + tax)) > 1) {
    failures.push({
      field: 'amount_total',
      rule: 'AMOUNT_ARITHMETIC',
      message: `amount_total (${total}) ≠ amount_sales (${sales}) + amount_tax (${tax}) = ${sales + tax}. One of these three values was misread from the document. Re-examine each printed number individually.`,
    });
  }

  // Rule 4: amount_total not negative
  if (total < 0) {
    failures.push({
      field: 'amount_total',
      rule: 'AMOUNT_NEGATIVE',
      message: `amount_total (${total}) is negative, which is not valid for a standard invoice. Re-read the total amount from the document.`,
    });
  }

  // Rule 5: seller_tax_id format
  if (item.seller_tax_id && !item.seller_tax_id.includes('?')) {
    if (!/^\d{8}$/.test(item.seller_tax_id)) {
      failures.push({
        field: 'seller_tax_id',
        rule: 'TAX_ID_FORMAT',
        message: `seller_tax_id '${item.seller_tax_id}' is not 8 digits. Either re-read it carefully or output null if not visible.`,
      });
    }
  }

  // Rule 6: invoice_date format
  if (item.invoice_date && !/^\d{4}-\d{2}-\d{2}$/.test(item.invoice_date)) {
    failures.push({
      field: 'invoice_date',
      rule: 'DATE_FORMAT',
      message: `invoice_date '${item.invoice_date}' does not match required format YYYY-MM-DD (e.g. 2024-03-15). Re-read the date and output it in ISO 8601 format.`,
    });
  }

  // Rule 7: tax_code must exist
  if (item.tax_code === null && item.error_code !== 'NOT_INVOICE') {
    failures.push({
      field: 'tax_code',
      rule: 'TAX_CODE_MISSING',
      message: `tax_code is null but this document is not marked as NOT_INVOICE. Determine the correct tax code (T300, T301, T302, T400, T500, or TXXX) from the document type and content.`,
    });
  }

  return failures;
}

/**
 * 將驗證失敗清單轉成給 Gemini 看的 correction prompt 段落。
 */
export function buildCorrectionPrompt(failures: ValidationFailure[], attemptNumber: number): string {
  return `[CORRECTION REQUIRED - Attempt ${attemptNumber}]
The previous extraction had ${failures.length} validation error(s). Fix ALL of them:
${failures.map((f, i) => `${i + 1}. [${f.field}] ${f.message}`).join('\n')}

Re-examine the document image carefully for each field listed above before outputting.`;
}

/**
 * 自動修正：amount 相差 <= 50 時直接修正，不需要重跑 Gemini。
 * mutates item in place。
 */
export function autoCorrectAmounts(item: InvoiceData): { corrected: boolean; log: string } {
  const tax = item.amount_tax || 0;
  const total = item.amount_total || 0;
  const sales = item.amount_sales || 0;

  // Swap logic: if total < tax, they're likely swapped
  if (total > 0 && total < tax) {
    const oldTotal = total;
    const oldTax = tax;
    item.amount_total = oldTax;
    item.amount_tax = oldTotal;
    return {
      corrected: true,
      log: `Auto-corrected: swapped amount_total(${oldTotal}) and amount_tax(${oldTax})`,
    };
  }

  const expectedTotal = sales + (item.amount_tax || 0);
  const diff = Math.abs((item.amount_total || 0) - expectedTotal);

  if (diff > 1 && diff <= 50) {
    const oldTotal = item.amount_total;
    item.amount_total = expectedTotal;
    return {
      corrected: true,
      log: `Auto-corrected: amount_total set to ${expectedTotal} (was ${oldTotal}, diff=${diff})`,
    };
  }

  if (diff > 50) {
    return {
      corrected: false,
      log: `Amount diff ${diff} exceeds auto-correct threshold (50), needs Gemini retry`,
    };
  }

  return { corrected: false, log: '' };
}

/**
 * Rule 2c null guard: T300/三聯手寫 invoices should have buyer_tax_id.
 * When Gemini returns null due to poor scan quality, convert to '?' so
 * downstream flagging works instead of silently receiving null.
 */
export function normalizeBuyerTaxId(
  buyerTaxId: string | null | undefined,
  taxCode: string | null,
  voucherType?: string | null
): string | null | undefined {
  if (buyerTaxId == null && (taxCode === 'T300' || voucherType === '三聯手寫')) {
    return '?';
  }
  return buyerTaxId;
}
