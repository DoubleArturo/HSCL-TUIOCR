export const PROMPT_TXXX = `
## TYPE: TXXX (非標準發票類憑證)

**Covers:** taxi receipts (計程車收據), 免用統一發票收據, travel agency receipts (旅行社代收轉付), foreign supplier invoices (English Invoice without TW number).

**Fingerprint:**
- No standard TW invoice number (no 2-letter + 8-digit format)
- "免用統一發票" stamp OR foreign language invoice OR taxi meter receipt

**Extraction:**
- tax_code: "TXXX"
- voucher_type: "收據" for local receipts, "Invoice" for foreign invoices
- Extract amounts and date as printed.
- error_code: "NOT_INVOICE" for foreign Invoices (no TW GUI number).
`;
