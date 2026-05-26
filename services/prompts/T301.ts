export const PROMPT_T301 = `
### Tax Code T301
- **"T301"**: 三聯式電子發票（印有「電子發票證明聯」字樣，發票格式25）→ voucher_type="三聯電子"

### Voucher Type: 三聯電子
- **"三聯電子"**: T301 — 電子發票證明聯，格式25

### KEY DISTINCTION T301 vs T302
- T301 (三聯電子): MUST have "電子發票證明聯" text. Has "格式25" or "格式 25" printed. Needs e-invoice platform upload.
- T302 (三聯收銀): Has "收銀機統一發票" text, shows "(三聯式" or "扣抵聯", NO QR codes, NO "電子發票" text.
`;
