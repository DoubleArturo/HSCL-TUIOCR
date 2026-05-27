export const PROMPT_T300 = `
### Tax Code T300
- **"T300"**: 三聯式手開統一發票（手寫填入，發票格式21）→ voucher_type="三聯手寫"

### Voucher Type: 三聯手寫
- **"三聯手寫"**: T300 — 手寫填入三聯發票，格式21

### KEY DISTINCTION T300 vs T302
- T300 (手寫): The monetary amounts and buyer info are written by hand/pen/ink. No "收銀機" text. Format 21. The invoice form has blank lines to fill in — amounts are hand-filled.
- T302 (收銀): ALL amounts are machine-printed (laser/thermal). **HARD REQUIREMENT: the text "收銀機統一發票" MUST appear printed on the invoice form itself. If you cannot find "收銀機統一發票" on the document → it is NOT T302. Do not assign T302 just because a delivery note on the same page is machine-printed.**

### MIXED PAGE WARNING — THIS IS VERY COMMON
A scanned PDF page frequently contains BOTH a 三聯手寫 invoice (pink/red paper, handwritten amounts) AND a 訂單出貨憑證 / 送貨單 (printed delivery note with item table, QR code, 買方品號, 規格, 單價) placed or stapled together and scanned as one image.

**STEP 1 — LOCATE the 統一發票**: Find the form that has: (a) a 2-letter + 8-digit invoice number (e.g. VT44914261), (b) labeled cells for 銷售額合計, 營業稅, and 總計 or 應付金額, (c) a government-format invoice grid.

**STEP 2 — IGNORE the 訂單出貨憑證**: The delivery note has item codes (料號), quantities (數量), unit prices (單價), QR codes, and a company-specific document number (e.g. P02-PB0088). It is a support document. **NEVER extract amounts from it. NEVER let its machine-printed appearance influence your tax_code or voucher_type.**

**STEP 3 — CLASSIFY from the invoice only**:
→ If the invoice amounts are written in ink/pen (hand-filled) → T300 三聯手寫, regardless of how the delivery note looks.
→ If "收銀機統一發票" is printed on the invoice form AND all amounts are machine-printed → T302 三聯收銀.
→ When in doubt between T300 and T302: if ANY amount cell appears hand-filled → choose T300.
→ **ABSOLUTE RULE for T302**: The exact text "收銀機統一發票" MUST be physically printed in the invoice form's header or title area. If this text is absent, it is T300 — full stop. The presence of machine-printed delivery notes (出貨單) elsewhere in the same PDF does NOT make an invoice T302. Each invoice page must be classified solely from its own form content, independent of all other pages in the PDF.

**STEP 4 — EXTRACT amounts from the invoice grid ONLY**:
→ 銷售額 (sales) comes from the 銷售額合計 / 未稅金額 cell of the 統一發票.
→ 營業稅 (tax) comes from the 營業稅 cell of the 統一發票.
→ NEVER use amounts from the 訂單出貨憑證's 金額 column, 含稅金額, or 稅額 fields.
`;
