import type { ERPRecord, InvoiceEntry, InvoiceData, AuditRow } from '../../types';
import { normalizeDate } from './invoiceNormalizer';
import { isForeignInvoice } from './taxCodeLogic';

export type DiffKey = 'date' | 'amount' | 'inv_no' | 'tax_code' | 'tax_id' | 'tax_id_unclear' | 'count_mismatch' | 'no_match_found';

function normInvNo(s: string | null | undefined): string {
  return (s || '').replace(/[\s-]/g, '').toUpperCase();
}

function isInvoiceDoc(inv: InvoiceData): boolean {
  return inv.document_type !== '非發票' && inv.error_code !== 'NOT_INVOICE';
}

function shouldSkipFromAudit(inv: InvoiceData): boolean {
  return isForeignInvoice(inv.document_type) || inv.voucher_type === 'Invoice';
}

/**
 * Pure function: pair ERP records with uploaded invoice files and compute audit status.
 * Replaces the auditList useMemo in App.tsx.
 */
export function computeAuditRows(
  erpData: ERPRecord[],
  invoices: InvoiceEntry[],
): AuditRow[] {
  const fileMap = new Map<string, InvoiceEntry>(invoices.map(i => [i.id, i]));
  const matchedFileIds = new Set<string>();

  const mappedRows: AuditRow[] = erpData.map((erp, index) => {
    const matchingFiles: InvoiceEntry[] = [];

    const exact = fileMap.get(erp.voucher_id);
    if (exact) matchingFiles.push(exact);

    for (const [key, entry] of fileMap.entries()) {
      if (key === erp.voucher_id) continue;
      if (key.startsWith(erp.voucher_id + '-') || key.startsWith(erp.voucher_id + '_')) {
        matchingFiles.push(entry);
      }
    }

    matchingFiles.forEach(f => matchedFileIds.add(f.id));

    let auditStatus: AuditRow['auditStatus'] = 'MATCH';
    const diffDetails: DiffKey[] = [];

    const rawAllOCR = matchingFiles.flatMap(f => f.data);
    // Deduplicate across files by invoice_number + amount_total
    const allOCRInvoices = rawAllOCR.filter((inv, i, self) =>
      i === self.findIndex(t =>
        t.invoice_number === inv.invoice_number &&
        t.invoice_number &&
        t.amount_total === inv.amount_total,
      ) || !inv.invoice_number,
    );

    let matchedOCRInvoices: InvoiceData[] = [];

    if (matchingFiles.length === 0) {
      auditStatus = 'MISSING_FILE';
    } else if (allOCRInvoices.length > 0) {
      const erpInvNos = erp.invoice_numbers.map(normInvNo);

      matchedOCRInvoices = allOCRInvoices.filter(inv => {
        const ocrNo = normInvNo(inv.invoice_number);
        if (!ocrNo) return false;
        if (!isInvoiceDoc(inv)) return false;
        return erpInvNos.some(n => ocrNo.includes(n) || n.includes(ocrNo));
      });

      const validOCR = allOCRInvoices.filter(isInvoiceDoc);
      // Fall back only when OCR couldn't read any invoice number (blank) — not when it read a different one
      const hasReadableOCRInvNo = validOCR.some(inv => normInvNo(inv.invoice_number));
      if (matchedOCRInvoices.length === 0 && erpInvNos.length === 1 && validOCR.length === 1 && !hasReadableOCRInvNo) {
        matchedOCRInvoices = [validOCR[0]];
      }

      // --- Diffs ---

      // 1. Amount — compare ERP total directly against all valid OCR invoices in the file,
      // regardless of whether invoice numbers matched. This avoids false 'amount' diffs
      // when inv_no mismatch causes matchedOCRInvoices to be empty (sum would be 0).
      const validOCRForAmount = allOCRInvoices.filter(isInvoiceDoc);
      if (validOCRForAmount.length > 0) {
        const erpTotal = erp.amount_total;
        const ocrTotalSum = validOCRForAmount.reduce((s, inv) => s + (inv.amount_total || 0), 0);
        if (Math.abs(ocrTotalSum - erpTotal) > 1) diffDetails.push('amount');
      }

      // 2. Invoice date
      const erpDate = normalizeDate(erp.invoice_date);
      const ocrDate = normalizeDate(matchedOCRInvoices[0]?.invoice_date || '');
      if (erpDate && ocrDate && erpDate !== ocrDate && matchedOCRInvoices.length > 0) {
        diffDetails.push('date');
      }

      // 3. Tax code
      const erpTaxCode = (erp.tax_code || '').toUpperCase();
      const ocrTaxCode = (matchedOCRInvoices[0]?.tax_code || '').toUpperCase();
      if (erpTaxCode && ocrTaxCode && erpTaxCode !== ocrTaxCode && matchedOCRInvoices.length > 0) {
        diffDetails.push('tax_code');
      }

      // 4. Invoice number mismatch (expected N but matched fewer)
      if (erpInvNos.length !== matchedOCRInvoices.length) {
        diffDetails.push('inv_no');
      }

      // 5. Seller tax ID
      const erpTaxId = erp.seller_tax_id || '';
      matchedOCRInvoices.forEach(inv => {
        if (shouldSkipFromAudit(inv)) return;
        const ocrTaxId = inv.seller_tax_id || '';
        if (ocrTaxId && erpTaxId && ocrTaxId !== erpTaxId && !diffDetails.includes('tax_id')) {
          diffDetails.push('tax_id');
        }
        if (ocrTaxId.includes('?') && !diffDetails.includes('tax_id_unclear')) {
          diffDetails.push('tax_id_unclear');
        }
      });

      if (diffDetails.length > 0) auditStatus = 'MISMATCH';
    } else {
      auditStatus = 'MISMATCH';
      diffDetails.push('no_match_found');
    }

    // Build display OCR object
    let displayOCR: InvoiceData | null = null;
    if (matchedOCRInvoices.length > 0) {
      const valid = matchedOCRInvoices.filter(i => !shouldSkipFromAudit(i));
      const invoiceNumbers = [...new Set(
        valid.map(i => normInvNo(i.invoice_number)).filter(Boolean),
      )].join(' / ');
      displayOCR = {
        ...(valid[0] || matchedOCRInvoices[0]),
        amount_total: valid.reduce((s, i) => s + (i.amount_total || 0), 0),
        amount_sales: valid.reduce((s, i) => s + (i.amount_sales || 0), 0),
        amount_tax: valid.reduce((s, i) => s + (i.amount_tax || 0), 0),
        invoice_number: invoiceNumbers,
      };
    } else if (allOCRInvoices.length > 0) {
      const fallback = allOCRInvoices.find(i => isInvoiceDoc(i)) || allOCRInvoices[0];
      displayOCR = { ...fallback };
    }

    let primaryFile = matchingFiles[0] || null;
    if (matchedOCRInvoices.length > 0) {
      const found = matchingFiles.find(f => f.data.includes(matchedOCRInvoices[0]));
      if (found) primaryFile = found;
    }

    let invoiceIndex = 0;
    if (primaryFile && matchedOCRInvoices.length > 0) {
      invoiceIndex = primaryFile.data.indexOf(matchedOCRInvoices[0]);
      if (invoiceIndex === -1) invoiceIndex = 0;
    }

    return {
      key: `${erp.voucher_id}_${index}`,
      id: erp.voucher_id,
      erp,
      files: matchingFiles,
      file: primaryFile,
      ocr: displayOCR,
      auditStatus,
      diffDetails,
      initialInvoiceIndex: invoiceIndex,
    };
  });

  const extraFiles: AuditRow[] = invoices
    .filter(f => !matchedFileIds.has(f.id))
    .map(f => ({
      key: `extra_${f.id}`,
      id: f.id,
      erp: null,
      files: [f],
      file: f,
      ocr: f.data[0] || null,
      auditStatus: 'EXTRA_FILE' as const,
      diffDetails: [],
      initialInvoiceIndex: 0,
    }));

  return [...mappedRows, ...extraFiles].sort((a, b) => a.id.localeCompare(b.id));
}

/** Human-readable label for each diff key. */
export const DIFF_LABELS: Record<DiffKey, string> = {
  date: '日期不符',
  amount: '金額不符',
  inv_no: '發票號碼不符',
  tax_code: '稅別不符',
  tax_id: '統編不符',
  tax_id_unclear: '統編模糊',
  count_mismatch: '數量不符',
  no_match_found: '找不到對應',
};
