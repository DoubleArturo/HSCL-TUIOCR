export const PROMPT_TXXX = `
### Tax Code TXXX
- **"TXXX"**: All other: 收據（免用統一發票、計程車收據）、English Invoice（外國廠商）、旅行社代收轉付收据

### Voucher Type: 收據
- **"收據"**: TXXX — 各類收據（計程車、停車場、免用統一發票）

### Voucher Type: Invoice
- **"Invoice"**: TXXX — 英文Invoice（外國廠商）

### Voucher Type: 其他
- **"其他"**: 其他（T400海關、進口報單等）

### CRITICAL SKIP RULES
1. English "Invoice" documents (foreign supplier invoices without TW invoice number) - set error_code="NOT_INVOICE"
2. Transportation tickets (高鐵、火車、客運、捷遊 ticket, etc.) - set tax_code="T500" then skip by setting error_code="NOT_INVOICE"
`;
