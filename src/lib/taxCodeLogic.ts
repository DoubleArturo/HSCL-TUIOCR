import type { VoucherType } from '../../types';

export type TaxCode = 'T300' | 'T301' | 'T302' | 'T400' | 'T500' | 'TXXX';

const VOUCHER_TO_TAX: Record<string, TaxCode> = {
  '三聯手寫': 'T300',
  '三聯電子': 'T301',
  '三聯收銀': 'T302',
  '二聯收銀': 'T500',
  '車票': 'T500',
  'Invoice': 'TXXX',
  '收據': 'TXXX',
  '非發票': 'TXXX',
};

const TAX_TO_VOUCHER: Record<TaxCode, VoucherType> = {
  T300: '三聯手寫',
  T301: '三聯電子',
  T302: '三聯收銀',
  T400: '其他',
  T500: '二聯收銀',
  TXXX: '收據',
};

/** Derive tax_code from voucher_type, falling back to document_type heuristics. */
export function assignTaxCode(
  voucherType: string | undefined,
  documentType: string | undefined,
  invoiceNumber: string | undefined,
): TaxCode {
  if (voucherType && voucherType in VOUCHER_TO_TAX) {
    return VOUCHER_TO_TAX[voucherType];
  }

  const dt = (documentType || '').toLowerCase();

  if (dt.includes('海關') || dt.includes('customs') || dt.includes('進口報單') || dt.includes('稅費繳納')) return 'T400';
  if (dt.includes('高鐵') || dt.includes('火車') || dt.includes('客運') || dt.includes('捷運') || dt.includes('ticket') || dt.includes('車票')) return 'T500';
  if (dt.includes('電子發票')) return 'T301';
  if (dt.includes('統一發票') || documentType === '統一發票') return 'T302';
  if (
    documentType === 'Invoice' || documentType === 'Commercial Invoice' ||
    dt.includes('收据') || dt.includes('receipt') || dt.includes('免用') || dt.includes('計程車') ||
    !invoiceNumber
  ) return 'TXXX';

  return 'TXXX';
}

/** Derive voucher_type from tax_code when AI didn't provide one. */
export function syncVoucherType(taxCode: TaxCode): VoucherType {
  return TAX_TO_VOUCHER[taxCode] ?? '其他';
}

/** True for foreign Invoice / Commercial Invoice that should be skipped in TW audit. */
export function isForeignInvoice(documentType: string | undefined): boolean {
  return documentType === 'Invoice' || documentType === 'Commercial Invoice';
}
