import type { ERPRecord, InvoiceEntry, InvoiceData, AuditRow } from '../../types';
import { normalizeDate } from './invoiceNormalizer';
import { isForeignInvoice } from './taxCodeLogic';

export type DiffKey = 'date' | 'amount' | 'inv_no' | 'tax_code' | 'tax_id' | 'tax_id_unclear' | 'count_mismatch' | 'no_match_found';

function normInvNo(s: string | null | undefined): string {
  return (s || '').replace(/[\s-]/g, '').toUpperCase();
}

// 修2：1 碼誤讀容差
// 台灣統一發票號碼是固定 10 碼（2L+8D），OCR 誤讀 1 碼非常常見（Y→V, O→0 等）。
// 相同長度、Levenshtein 距離 = 1 → 視為匹配。
function levenshtein1(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diffs = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && ++diffs > 1) return false;
  }
  return diffs === 1;
}

function invNoMatch(ocrNo: string, erpNo: string): boolean {
  return ocrNo === erpNo || ocrNo.includes(erpNo) || erpNo.includes(ocrNo) || levenshtein1(ocrNo, erpNo);
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
  // Skip audit for: foreign invoices, non-invoice documents, and other/miscellaneous items
  if (isForeignInvoice(inv.document_type) || inv.voucher_type === 'Invoice') return true;

  // Skip documents that are not billable invoices
  const unbillableTypes = ['Packing List', 'Delivery Note', 'Receipt', 'Other', '其他'];
  if (inv.document_type && unbillableTypes.some(t => inv.document_type?.includes(t))) return true;

  // Skip TXXX (miscellaneous/receipt items) — not subject to audit matching
  if (inv.tax_code === 'TXXX') return true;

  return false;
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

      // Skip audit for ERP rows that are TXXX or T400 (海關進口：存檔即可，不比對 OCR 數值)
      const erpTaxCode = (erp.tax_code || '').toUpperCase();
      if (erpTaxCode === 'TXXX' || erpTaxCode === 'T400') {
        auditStatus = 'SKIPPED';
      } else if (matchingFiles.length === 0) {
        auditStatus = 'MISSING_FILE';
      } else if (allOCRInvoices.length > 0) {
        const erpInvNos = erp.invoice_numbers.map(normInvNo);

        if (erpTaxCode === 'T500') {
          // T500 交通票券/二聯收銀: ERP 存的是內部序號（YYYYMMDDNN），票面印的是實際條碼。
          // 兩者格式本質不同，不做 invoice number 比對。
          // 每個 ERP row 只取 1 張未被 claim 的 T500 OCR 結果（依序配對）。
          const firstUnclaimed = allOCRInvoices.find(inv => {
            if (!isInvoiceDoc(inv)) return false;
            if (inv.tax_code !== 'T500') return false;
            const ocrNo = normInvNo(inv.invoice_number);
            return !claimedOCRInvNos.has(ocrNo || '\x00');
          });
          if (firstUnclaimed) matchedOCRInvoices = [firstUnclaimed];
        } else {
          // Fix 2: only match OCR invoices not already claimed by a prior row in this group
          // 修2 修正：Levenshtein 只作 fallback，不作主要過濾器。
          // 主要過濾：exact / substring（精確）。
          // 這樣 XW10376254 不會誤配到 XW10376255（連續發票號碼差 1 碼是合法的不同發票）。
          const exactMatch = (ocrNo: string, erpNo: string) =>
            ocrNo === erpNo || ocrNo.includes(erpNo) || erpNo.includes(ocrNo);

          matchedOCRInvoices = allOCRInvoices.filter(inv => {
            const ocrNo = normInvNo(inv.invoice_number);
            if (!ocrNo) return false;
            if (!isInvoiceDoc(inv)) return false;
            if (claimedOCRInvNos.has(ocrNo)) return false;
            return erpInvNos.some(n => exactMatch(ocrNo, n));
          });

          // Levenshtein fallback：只有完全找不到 exact match，且 ERP 只有 1 個發票號碼時，
          // 才用模糊比對（用於 Y→V、O→D 等 OCR 字型混淆，不適用連續號碼）。
          if (matchedOCRInvoices.length === 0 && erpInvNos.length === 1) {
            const fuzzy = allOCRInvoices.find(inv => {
              const ocrNo = normInvNo(inv.invoice_number);
              return ocrNo && isInvoiceDoc(inv) && !claimedOCRInvNos.has(ocrNo) &&
                levenshtein1(ocrNo, erpInvNos[0]);
            });
            if (fuzzy) matchedOCRInvoices = [fuzzy];
          }
        }

        // Fallback: blank OCR invoice number, single ERP inv_no, single unclaimed valid OCR
        const validOCR = allOCRInvoices.filter(inv =>
          isCountableForAmount(inv) && !claimedOCRInvNos.has(normInvNo(inv.invoice_number) || ''),
        );
        const hasReadableOCRInvNo = validOCR.some(inv => normInvNo(inv.invoice_number));
        if (matchedOCRInvoices.length === 0 && erpTaxCode !== 'T500' && erpInvNos.length === 1 && validOCR.length === 1 && !hasReadableOCRInvNo) {
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
        const ocrTaxCode = (matchedOCRInvoices[0]?.tax_code || '').toUpperCase();
        if (erpTaxCode && ocrTaxCode && erpTaxCode !== ocrTaxCode && matchedOCRInvoices.length > 0) {
          diffDetails.push('tax_code');
        }

        // 4. Invoice number mismatch (expected N but matched fewer)
        if (erpInvNos.length !== matchedOCRInvoices.length) {
          diffDetails.push('inv_no');
        }

        // 5. Seller tax ID
        // 修3：T300（三聯手寫）統編降級
        // 手寫發票的賣方統編受格線/印章遮擋，OCR 誤讀機率高且難以修正。
        // 即使 ERP vs OCR 統編不符，視為「需確認」而非「確定錯誤」。
        const erpTaxId = erp.seller_tax_id || '';
        const erpIsHandwritten = erpTaxCode === 'T300';
        matchedOCRInvoices.forEach(inv => {
          if (shouldSkipFromAudit(inv)) return;
          const ocrTaxId = inv.seller_tax_id || '';
          if (ocrTaxId && erpTaxId && ocrTaxId !== erpTaxId) {
            if (!diffDetails.includes('tax_id') && !diffDetails.includes('tax_id_unclear')) {
              // T300 手寫：統編不符降為 unclear（警告），不直接算硬 MISMATCH
              diffDetails.push(erpIsHandwritten ? 'tax_id_unclear' : 'tax_id');
            }
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

        if (diffDetails.length > 0) {
          // 修4：NEEDS_REVIEW vs MISMATCH 分級
          // 只有「軟警告」（統編模糊）→ NEEDS_REVIEW（黃色，需人工確認但不算紅燈）
          // 有任何硬差異（金額/發票號碼/稅別/日期） → MISMATCH（紅燈）
          const SOFT_ONLY_DIFFS = new Set<string>(['tax_id_unclear']);
          const hasHardDiff = diffDetails.some(d => !SOFT_ONLY_DIFFS.has(d));
          auditStatus = hasHardDiff ? 'MISMATCH' : 'NEEDS_REVIEW';
        }
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

  // Issue 9 fix: OCR files with no matching ERP record are intentionally dropped.
  // Per product decision, audit list should not synthesize rows for orphan uploads.
  return mappedRows.sort((a, b) => a.id.localeCompare(b.id));
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
