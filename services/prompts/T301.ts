export const PROMPT_T301 = `
## TYPE: T301 三聯電子發票 (格式25), voucher_type="三聯電子"

**Visual fingerprint — ALL of these must be present:**
1. Text "電子發票證明聯" is printed on the document
2. Two QR codes (left + right) OR a long barcode at the bottom
3. Machine-printed, A4 or half-A4 size, issued via the government e-invoice platform

**Extraction:**
- seller_tax_id: from the seller's header block. If not visible → null.
- buyer_tax_id: from "買受人統一編號" or "買方統編" field, if printed. null if absent.
- amounts: from 銷售額合計 / 營業稅 / 總計 (or 應付金額) printed fields.
- invoice_number: 2 letters + 8 digits.

**Reclassify if:**
- "電子發票證明聯" is absent but "收銀機統一發票" is present → T302
- Document is handwritten → T300
`;
