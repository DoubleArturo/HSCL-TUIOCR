export const PROMPT_T302 = `
## TYPE: T302 三聯收銀機統一發票 (格式25), voucher_type="三聯收銀"

**Visual fingerprint — ALL of these must be present:**
1. Text "收銀機統一發票" is printed on the invoice form header
2. "扣抵聯" OR "買受人存根聯" OR "收執聯" appears somewhere on the form
3. A4 or half-A4 size (wider format), machine-printed, NO QR codes, NO "電子發票" text
4. Has a grid with 買受人 / 品名 / 數量 / 單價 columns (B2B format)

**Extraction:**
- seller_tax_id: from seller's header block at top. The "買受人" field contains the BUYER's tax ID — do NOT use it as seller_tax_id.
- buyer_tax_id: from "買受人:" or "買受人統一編號:" field.
- amounts: from 銷售額合計 / 營業稅 / 總計 cells of the invoice form ONLY.
- For multi-page PDFs: scan ALL pages. A delivery note on page 1 + invoice on page 2 = extract page 2 invoice.

**Reclassify if:**
- "收銀機統一發票" absent → NOT T302. Handwritten amounts → T300. QR codes + "電子發票" → T301.
- Paper is a narrow thermal strip (長條型, ~7cm wide) → T500
- Foreign Invoice without TW number → NOT_INVOICE
- Image quality is too poor to CLEARLY read "收銀機統一發票" text → default to T300. Never guess T302 when the text is unclear.
`;
