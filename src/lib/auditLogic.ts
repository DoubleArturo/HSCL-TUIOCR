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

// Fix 1: TXXX receipts and T500 transit tickets must not count toward amount totals.
// T500 two-part receipts (voucher_type=二聯收銀) are real invoices and remain included.
function isCountableForAmount(inv: InvoiceData): boolean {
  if (!isInvoiceDoc(inv)) return false;
  if (inv.tax_code === 'TXXX') return false;
  if (inv.tax_code === 'T500' && inv.voucher_type === '交通票券') return false;
  return true;
}

function shouldSkipFromAudit(inv: InvoiceData): boolean {
  return isForeignInvoice(inv.document_type) || inv.voucher_type === 'Invoice';
}

/**
 * Pure function: pair ERP records with uploaded invoice files and compute audit status.
 *
 * Fix 2: ERP rows are grouped by voucher_id so rows sharing the same voucher claim
 * their own OCR invoices without overlap (claimedOCRInvNos Set).
 */
export function computeAuditRows(
  erpData: ERPRecord[],
  invoices: InvoiceEntry[],
): AuditRow[] {
  const fileMap = new Map<string, InvoiceEntry>(invoices.map(i => [i.id, i]));
  const matchedFileIds = new Set<string>();

  // Fix 2: group ERP rows by voucher_id, preserving original order within each group
  const erpGroups = new Map<string, ERPRecord[]>();
  for (const erp of erpData) {
    const group = erpGroups.get(erp.voucher_id) ?? [];
    group.push(erp);
    erpGroups.set(erp.voucher_id, group);
  }

  const mappedRows: AuditRow[] = [];

  for (const [voucherId, erpGroup] of erpGroups) {
    // Collect matching files once, shared across all rows in the group
    const matchingFiles: InvoiceEntry[] = [];
    const exact = fileMap.get(voucherId);
    if (exact) matchingFiles.push(exact);
    for (const [key, entry] of fileMap.entries()) {
      if (key === voucherId) continue;
      if (key.startsWith(voucherId + '-') || key.startsWith(voucherId + '_')) {
        matchingFiles.push(entry);
      }
    }
    matchingFiles.forEach(f => matchedFileIds.add(f.id));

    // Collect and deduplicate OCR results across all matching files
    const rawAllOCR = matchingFiles.flatMap(f => f.data);
    const allOCRInvoices = rawAllOCR.filter((inv, i, self) =>
      i === self.findIndex(t =>
        t.invoice_number === inv.invoice_number &&
        t.invoice_number &&
        t.amount_total === inv.amount_total,
      ) || !inv.invoice_number,
    );

    // Track which OCR invoice numbers have been claimed by earlier rows in this group
    const claimedOCRInvNos = new Set<string>();

    erpGroup.forEach((erp, groupIndex) => {
      const originalIndex = erpData.indexOf(erp);
      let auditStatus: AuditRow['auditStatus'] = 'MATCH';
      const diffDetails: DiffKey[] = [];

      let matchedOCRInvoices: InvoiceData[] = [];

      if (matchingFiles.length === 0) {
        auditStatus = 'MISSING_FILE';
      } else if (allOCRInvoices.length > 0) {
        const erpInvNos = erp.invoice_numbers.map(normInvNo);

        // Fix 2: only match OCR invoices not already claimed by a prior row in this group
        matchedOCRInvoices = allOCRInvoices.filter(inv => {
          const ocrNo = normInvNo(inv.invoice_number);
          if (!ocrNo) return false;
          if (!isInvoiceDoc(inv)) return false;
          if (claimedOCRInvNos.has(ocrNo)) return false;
          return erpInvNos.some(n => ocrNo.includes(n) || n.includes(ocrNo));
        });

        // Fallback: blank OCR invoice number, single ERP inv_no, single unclaimed valid OCR
        const validOCR = allOCRInvoices.filter(inv =>
          isCountableForAmount(inv) && !claimedOCRInvNos.has(normInvNo(inv.invoice_number) || ''),
        );
        const hasReadableOCRInvNo = validOCR.some(inv => normInvNo(inv.invoice_number));
        if (matchedOCRInvoices.length === 0 && erpInvNos.length === 1 && validOCR.length === 1 && !hasReadableOCRInvNo) {
          matchedOCRInvoices = [validOCR[0]];
        }

        // Mark these invoices as claimed so later rows in this group won't reuse them
        matchedOCRInvoices.forEach(inv => {
          const no = normInvNo(inv.invoice_number);
          if (no) claimedOCRInvNos.add(no);
        });

        // --- Diffs ---

        // 1. Amount — compare only this row's matched OCR invoices (Fix 2).
        // Fix 1: exclude TXXX receipts and T500 transit tickets from amount totals.
        // Fix 3: skip amount diff entirely when ERP row itself is a transit ticket (T500).
        const validOCRForAmount = matchedOCRInvoices.filter(isCountableForAmount);
        const erpIsBusOrRailTicket = (erp.tax_code || '').toUpperCase() === 'T500';
        if (!erpIsBusOrRailTicket && validOCRForAmount.length > 0) {
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

        // Fix: when OCR didn't match any invoice, still compare ERP against fallback OCR
        // so we surface ALL discrepancies (amount, tax_code, tax_id), not just inv_no
        if (matchedOCRInvoices.length === 0 && allOCRInvoices.length > 0) {
          const fallback = allOCRInvoices.find(
            i => isCountableForAmount(i) && !claimedOCRInvNos.has(normInvNo(i.invoice_number) || '')
          );
          if (fallback) {
            // Amount diff against fallback
            const erpIsBusOrRailTicket = (erp.tax_code || '').toUpperCase() === 'T500';
            if (!erpIsBusOrRailTicket && (fallback.amount_total || 0) > 0) {
              if (Math.abs((fallback.amount_total || 0) - erp.amount_total) > 1) {
                diffDetails.push('amount');
              }
            }
            // Tax code diff against fallback
            const erpTaxCode = (erp.tax_code || '').toUpperCase();
            const fallbackTaxCode = (fallback.tax_code || '').toUpperCase();
            if (erpTaxCode && fallbackTaxCode && erpTaxCode !== fallbackTaxCode) {
              diffDetails.push('tax_code');
            }
            // Tax ID diff against fallback
            if (!shouldSkipFromAudit(fallback)) {
              const ocrTaxId = fallback.seller_tax_id || '';
              if (ocrTaxId && erpTaxId && ocrTaxId !== erpTaxId) {
                diffDetails.push('tax_id');
              }
              if (ocrTaxId.includes('?')) {
                diffDetails.push('tax_id_unclear');
              }
            }
          }
        }

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

      mappedRows.push({
        key: `${voucherId}_${originalIndex}`,
        id: voucherId,
        erp,
        files: matchingFiles,
        file: primaryFile,
        ocr: displayOCR,
        auditStatus,
        diffDetails,
        initialInvoiceIndex: invoiceIndex,
      });
    });
  }

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
