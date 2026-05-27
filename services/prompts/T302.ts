export const PROMPT_T302 = `
### Tax Code T302
- **"T302"**: 三聯式收銀機統一發票（印有「收銀機統一發票」字樣，**三聯**，有「扣抵聯」或「買受人存根聯」字樣，格式25，A4橫式或接近A4尺寸）→ voucher_type="三聯收銀"

### Voucher Type: 三聯收銀
- **"三聯收銀"**: T302 — 收銀機三聯發票，格式25，無QR code

### KEY DISTINCTION T302 vs T500
- T302 (三聯收銀, 格式25): **THREE-PART** invoice. Has "扣抵聯" OR "買受人存根聯" OR "收執聯" printed. Paper size is approximately A4 or half-A4 (wider format). The invoice has a grid with 買受人 / 品名 / 數量 / 單價 columns. Commonly issued by B2B suppliers.
- T500 (二聯收銀, 格式22): **TWO-PART** invoice. **NO "扣抵聯" text anywhere**. Paper is a **narrow thermal receipt strip** (長條型熱感紙，寬約7-8cm). Commonly issued by: parking lots (停車場), gas stations (加油站), supermarkets (超市), convenience stores (便利商店). If the document looks like a long narrow receipt strip → it is T500, NOT T302.

### CRITICAL SKIP RULES for T302
1. English "Invoice" documents (foreign supplier invoices without TW invoice number) - set error_code="NOT_INVOICE"
2. Pure 訂單出貨憑證 / 送貨單 / 出貨通知單 pages with NO attached 統一發票 — these are delivery support docs, not invoices. **IMPORTANT: For multi-page PDFs, you MUST scan ALL pages before deciding. A page 1 delivery note (出貨憑證) followed by a page 2 統一發票 is a valid invoice document — extract the 統一發票 from page 2, ignore the delivery note. Only set NOT_INVOICE if the ENTIRE document contains zero 統一發票 forms.**
`;
