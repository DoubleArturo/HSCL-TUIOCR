export const PROMPT_T300 = `
## TYPE: T300 三聯手寫統一發票 (格式21), voucher_type="三聯手寫"

**Visual fingerprint — look for ALL of these:**
1. Amounts (銷售額合計, 營業稅, 總計) are handwritten in ink/pen — NOT machine-printed
2. A "買受人統一編號" or "買受人" field exists at the bottom-left, hand-filled
3. NO "收銀機統一發票" text on the invoice form itself
4. NO QR codes on the invoice form

**Extraction:**
- seller_tax_id: from seller's header block (top of form). If unclear → null (system will look up).
- buyer_tax_id: from "買受人統一編號" (bottom-left). Use "?" per obscured digit (grid lines / stamps). null if entirely absent.
- amounts: read the handwritten numbers in 銷售額合計 / 營業稅 / 總計 cells — from the INVOICE GRID ONLY.
- IGNORE any accompanying printed delivery note (訂單出貨憑證/送貨單) on the same scan — its machine-printed amounts are NOT invoice amounts.

**Reclassify if you see:**
- "收銀機統一發票" printed on the form → T302
- "電子發票證明聯" or QR codes → T301
- Doubt between T300/T302: if ANY amount cell is hand-filled → T300. T302 requires "收銀機" text — no exceptions.
`;
