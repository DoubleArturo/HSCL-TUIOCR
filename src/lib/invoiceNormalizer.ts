import type { InvoiceData } from '../../types';

/** Remove whitespace and uppercase an invoice number. */
export function cleanInvoiceNumber(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/**
 * Auto-fix swapped amounts: if total < tax, the two were likely swapped.
 * Returns corrected { sales, tax, total } without mutating input.
 */
export function autoFixAmounts(
  sales: number,
  tax: number,
  total: number,
): { sales: number; tax: number; total: number } {
  if (total > 0 && total < tax) {
    return { sales, tax: total, total: tax };
  }
  // If sales+tax doesn't match total, recalculate total (AI arithmetic error)
  const calculated = sales + tax;
  if (Math.abs(total - calculated) > 1) {
    return { sales, tax, total: calculated };
  }
  return { sales, tax, total };
}

/**
 * Remove ghost results: items with no invoice_number that have a near-duplicate
 * with a real invoice_number and the same total amount (within 5).
 */
export function deduplicateResults(results: InvoiceData[]): InvoiceData[] {
  return results.filter((item, index) => {
    if (item.invoice_number) return true;
    const hasBetterMatch = results.some(
      (other, otherIdx) =>
        otherIdx !== index &&
        other.invoice_number &&
        Math.abs((other.amount_total || 0) - (item.amount_total || 0)) <= 5,
    );
    return !hasBetterMatch;
  });
}

/** Normalize a date string to YYYY-MM-DD for comparison. Handles ROC years and slash separators. */
export function normalizeDate(raw: string): string {
  if (!raw) return '';
  const s = String(raw).trim();

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // YYYY/MM/DD or YYYY.MM.DD
  const slashMatch = s.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/);
  if (slashMatch) {
    const [, y, m, d] = slashMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // ROC YYY/MM/DD (3-digit year like 115/01/06)
  const rocMatch = s.match(/^(\d{3})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (rocMatch) {
    const [, roc, m, d] = rocMatch;
    const year = parseInt(roc) + 1911;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Excel serial number (number stored as string)
  const serial = parseInt(s);
  if (!isNaN(serial) && serial > 40000 && serial < 60000) {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + serial * 86400000);
    return date.toISOString().split('T')[0];
  }

  return s;
}
